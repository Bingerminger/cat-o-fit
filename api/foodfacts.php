<?php
/* =========================================================================
   foodfacts.php — Open-Food-Facts-Nährwert-Proxy mit lokalem Cache.

   GET ?action=foodfacts&q=<Zutat>  ->  { found, name, kcal100, protein100 }

   Liefert grobe Nährwerte je 100 g/ml zu einem Zutatennamen. Die Anfrage geht
   ausschließlich vom Server (Synology) an Open Food Facts – nie von den Clients –
   und ohne API-Key. Treffer werden in data/foodfacts.json gecacht, daher sind
   Wiederholungen schnell und funktionieren offline. Wird von api.php eingebunden;
   respond() stammt von dort, DATA_DIR aus storage.php.

   Open Food Facts ist eine offene, gemeinnützige Datenbank (ODbL). Wir schicken
   nur den generischen Zutatennamen (z. B. „Haferflocken“) – keinerlei Nutzerdaten.
   ========================================================================= */

$q = isset($_GET['q']) ? trim((string) $_GET['q']) : '';
if ($q === '' || mb_strlen($q) > 64) {
    respond(['found' => false]);
}
$key = mb_strtolower($q);

$cacheFile = DATA_DIR . '/foodfacts.json';
$ttlHit  = 60 * 60 * 24 * 90;   // Treffer 90 Tage gültig
$ttlMiss = 60 * 60 * 24 * 7;    // Fehltreffer nur 7 Tage (OFF wächst stetig)

$cache = is_file($cacheFile) ? json_decode((string) @file_get_contents($cacheFile), true) : [];
if (!is_array($cache)) {
    $cache = [];
}
if (isset($cache[$key])) {
    $age   = time() - (int) ($cache[$key]['ts'] ?? 0);
    $found = !empty($cache[$key]['data']['found']);
    if ($age < ($found ? $ttlHit : $ttlMiss)) {
        respond($cache[$key]['data']);   // Cache-Treffer -> offline + schnell
    }
}

/** Holt eine URL (curl bevorzugt, sonst file_get_contents). null bei Fehler. */
function ff_fetch(string $url): ?string
{
    $ua = 'Cat-O-Fit/1.0 (lokales Familien-Fitness-Tool; Open-Food-Facts-Nährwert-Lookup)';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_USERAGENT      => $ua,
            CURLOPT_FOLLOWLOCATION => true,
        ]);
        $body = curl_exec($ch);
        $ok   = $body !== false && curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
        // curl_close() ist seit PHP 8.0 wirkungslos und ab 8.5 deprecated (würde
        // sonst die JSON-Antwort verschmutzen) – der Handle wird automatisch frei.
        return $ok ? (string) $body : null;
    }
    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create(['http' => [
            'method'  => 'GET',
            'timeout' => 5,
            'header'  => "User-Agent: {$ua}\r\n",
        ]]);
        $body = @file_get_contents($url, false, $ctx);
        return $body === false ? null : (string) $body;
    }
    return null;   // Kein ausgehender HTTP-Weg verfügbar -> Client nutzt Heuristik
}

$result = ['found' => false];
// Nach Beliebtheit sortiert mehrere Treffer holen und den ERSTEN mit plausiblen
// Nährwerten nehmen – das Top-1-Produkt hat oft keine energy-kcal_100g.
// Nach Beliebtheit sortiert mehrere Treffer holen -> repräsentiert das echte
// generische Lebensmittel besser als ein zufälliges Marken­produkt.
$url = 'https://de.openfoodfacts.org/cgi/search.pl?' . http_build_query([
    'search_terms'  => $q,
    'search_simple' => 1,
    'action'        => 'process',
    'json'          => 1,
    'page_size'     => 30,
    'sort_by'       => 'unique_scans_n',
    'fields'        => 'product_name,nutriments',
]);

/** kcal je 100 g aus den Nährwerten – nutzt notfalls kJ (÷ 4,184). null wenn unplausibel. */
function ff_kcal100(array $nut): ?float
{
    if (isset($nut['energy-kcal_100g']) && is_numeric($nut['energy-kcal_100g'])) {
        $k = (float) $nut['energy-kcal_100g'];
    } elseif (isset($nut['energy-kj_100g']) && is_numeric($nut['energy-kj_100g'])) {
        $k = (float) $nut['energy-kj_100g'] / 4.184;
    } elseif (isset($nut['energy_100g']) && is_numeric($nut['energy_100g'])) {
        $k = (float) $nut['energy_100g'] / 4.184;   // energy_100g ist üblicherweise kJ
    } else {
        return null;
    }
    return ($k > 0 && $k < 1000) ? $k : null;        // nur plausible Werte je 100 g
}
/** Median einer Zahlenliste (robuster gegen Ausreißer als der erste/mittlere Treffer). */
function ff_median(array $xs): float
{
    sort($xs);
    $n = count($xs);
    return $n % 2 ? $xs[intdiv($n, 2)] : ($xs[$n / 2 - 1] + $xs[$n / 2]) / 2;
}

$raw = ff_fetch($url);
if ($raw !== null) {
    $j = json_decode($raw, true);
    $kcals = [];
    $prots = [];
    foreach (($j['products'] ?? []) as $p) {
        $nut = $p['nutriments'] ?? null;
        if (!is_array($nut)) {
            continue;
        }
        $k = ff_kcal100($nut);
        if ($k === null) {
            continue;
        }
        $kcals[] = $k;
        if (isset($nut['proteins_100g']) && is_numeric($nut['proteins_100g'])) {
            $pr = (float) $nut['proteins_100g'];
            if ($pr >= 0 && $pr < 100) {
                $prots[] = $pr;
            }
        }
    }
    // Mindestens 2 Stichproben -> ein einzelnes „komisches“ Produkt zählt nicht.
    if (count($kcals) >= 2) {
        $result = [
            'found'      => true,
            'name'       => $q,
            'kcal100'    => (int) round(ff_median($kcals)),
            'protein100' => $prots ? round(ff_median($prots), 1) : null,
            'source'     => 'off',
            'samples'    => count($kcals),
        ];
    }
}

// Ergebnis (auch Fehltreffer) cachen, damit man nicht wiederholt online geht.
$cache[$key] = ['ts' => time(), 'data' => $result];
@file_put_contents($cacheFile, json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

respond($result);

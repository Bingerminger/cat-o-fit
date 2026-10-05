<?php
/* =========================================================================
   foodfacts.php — Open-Food-Facts-Nährwert-Proxy mit lokalem Cache.

   GET ?action=foodfacts&q=<Zutat>     ->  { found, name, kcal100, protein100 }
   GET ?action=foodfacts&code=<EAN>    ->  dasselbe für ein Produkt (Strichcode, 8–14 Ziffern)
   Optional: &lc=<Sprache> (ISO 639-1; die App schickt ihre Sprache) und &cc=<Land> (ISO 3166-1
   Alpha-2) – Namen in dieser Sprache, Produkte aus diesem Land. Ohne lc gilt die Sprache der
   Instanz (ältere App-Versionen waren deutsch).

   Liefert grobe Nährwerte je 100 g/ml zu einem Zutatennamen. Die Anfrage geht
   ausschließlich vom Server (Synology) an Open Food Facts – nie von den Clients –
   und ohne API-Key. Treffer werden in data/foodfacts.json gecacht, daher sind
   Wiederholungen schnell und funktionieren offline. Wird von api.php eingebunden;
   respond() stammt von dort, DATA_DIR aus storage.php, person_language() aus i18n.php.

   Open Food Facts ist eine offene, gemeinnützige Datenbank (ODbL). Wir schicken
   nur den generischen Zutatennamen (z. B. „Haferflocken“) – keinerlei Nutzerdaten.
   ========================================================================= */

/** Strichcode gültig? 8, 12, 13 oder 14 Ziffern mit stimmender GS1-Prüfziffer. */
function ff_valid_gtin(string $code): bool
{
    if (!preg_match('/^\d{8,14}$/', $code) || !in_array(strlen($code), [8, 12, 13, 14], true)) return false;
    $d = array_map('intval', str_split($code));
    $check = array_pop($d);
    $sum = 0;
    for ($i = count($d) - 1, $w = 3; $i >= 0; $i--, $w = $w === 3 ? 1 : 3) $sum += $d[$i] * $w;
    return (10 - $sum % 10) % 10 === $check;
}

$code = isset($_GET['code']) ? preg_replace('/\s+/', '', (string) $_GET['code']) : '';
$q = isset($_GET['q']) ? trim((string) $_GET['q']) : '';
if ($code !== '') {
    // Nur echte Strichcodes gehen nach außen – keine beliebigen Zeichenketten in der Adresse.
    if (!ff_valid_gtin($code)) {
        respond(['found' => false, 'error' => 'Invalid barcode']);
    }
    $key = 'ean:' . $code;
} else {
    if ($q === '' || mb_strlen($q) > 64) {
        respond(['found' => false]);
    }
    $key = mb_strtolower($q);
}

require_once __DIR__ . '/i18n.php';
$param = static fn(string $name): string => strtolower(trim((string) ($_GET[$name] ?? '')));
$lc = preg_match('/^[a-z]{2}$/', $param('lc')) === 1 ? $param('lc') : explode('-', strtolower(person_language(null)))[0];
$cc = preg_match('/^[a-z]{2}$/', $param('cc')) === 1 ? $param('cc') : '';
// Results depend on language and country. German without a country keeps the keys from
// before v4.0.0 (then always de.openfoodfacts.org), so the existing cache stays valid.
if ($lc !== 'de' || $cc !== '') {
    $key = "{$lc}-{$cc}:{$key}";
}

$cacheFile = DATA_DIR . '/foodfacts.json';
$ttlHit  = 60 * 60 * 24 * 90;   // Treffer 90 Tage gültig
$ttlMiss = 60 * 60 * 24 * 7;    // Fehltreffer nur 7 Tage (OFF wächst stetig)
const FF_CACHE_MAX = 600;       // Obergrenze: älteste Einträge fallen heraus (sonst wächst die Datei ohne Ende)

/** Cache lesen (kaputt oder fehlend = leer). */
function ff_cache_read(string $file): array
{
    $c = is_file($file) ? json_decode((string) @file_get_contents($file), true) : [];
    return is_array($c) ? $c : [];
}

$cache = ff_cache_read($cacheFile);
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
    $ua = 'Cat-O-Fit/1.0 (self-hosted family fitness app; Open Food Facts nutrition lookup)';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_USERAGENT      => $ua,
            // Keinen Umleitungen folgen und nur HTTPS sprechen: Die Antwort kommt
            // ausschließlich von der fest eingestellten Open-Food-Facts-Adresse.
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        ]);
        $body = curl_exec($ch);
        $ok   = $body !== false && curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
        // curl_close() ist seit PHP 8.0 wirkungslos und ab 8.5 deprecated (würde
        // sonst die JSON-Antwort verschmutzen) – der Handle wird automatisch frei.
        return $ok ? (string) $body : null;
    }
    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create(['http' => [
            'method'          => 'GET',
            'timeout'         => 5,
            'header'          => "User-Agent: {$ua}\r\n",
            'follow_location' => 0,
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
$url = 'https://world.openfoodfacts.org/cgi/search.pl?' . http_build_query([
    'search_terms'  => $q,
    'lc'            => $lc,
    'search_simple' => 1,
    'action'        => 'process',
    'json'          => 1,
    'page_size'     => 30,
    'sort_by'       => 'unique_scans_n',
    'fields'        => 'product_name,nutriments',
] + ($cc !== '' ? ['cc' => $cc] : []));

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

if ($code !== '') {
    // Ein bestimmtes Produkt: Name (in der Sprache lc bevorzugt), Marke, Nährwerte je 100 g.
    $raw = ff_fetch('https://world.openfoodfacts.org/api/v2/product/' . $code . '.json?' . http_build_query([
        'fields' => "product_name,product_name_{$lc},brands,nutriments",
        'lc'     => $lc,
    ] + ($cc !== '' ? ['cc' => $cc] : [])));
    $j = $raw !== null ? json_decode($raw, true) : null;
    $p = is_array($j) && (int) ($j['status'] ?? 0) === 1 && is_array($j['product'] ?? null) ? $j['product'] : null;
    if ($p !== null) {
        $nut = is_array($p['nutriments'] ?? null) ? $p['nutriments'] : [];
        $k = ff_kcal100($nut);
        $name = trim((string) ($p["product_name_{$lc}"] ?? ''));
        if ($name === '') $name = trim((string) ($p['product_name'] ?? ''));
        $brand = trim(explode(',', (string) ($p['brands'] ?? ''))[0]);
        if ($brand !== '' && $name !== '' && !str_contains(mb_strtolower($name), mb_strtolower($brand))) $name .= " ({$brand})";
        $pr = isset($nut['proteins_100g']) && is_numeric($nut['proteins_100g']) ? (float) $nut['proteins_100g'] : null;
        if ($name !== '' || $k !== null) {
            $result = [
                'found'      => true,
                'name'       => mb_substr($name !== '' ? $name : server_text(server_match_language($lc) ?? person_language(null), 'food.product', ['code' => $code]), 0, 80),
                'kcal100'    => $k !== null ? (int) round($k) : null,
                'protein100' => $pr !== null && $pr >= 0 && $pr < 100 ? round($pr, 1) : null,
                'source'     => 'off',
                'code'       => $code,
            ];
        }
    }
    $raw = null;   // die Textsuche unten entfällt
} else {
    $raw = ff_fetch($url);
}
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
// Unter Lock frisch lesen (parallele Anfragen), begrenzen und atomar ersetzen.
$lock = @fopen($cacheFile . '.lock', 'c');
if ($lock !== false) {
    flock($lock, LOCK_EX);
    $cache = ff_cache_read($cacheFile);
    $cache[$key] = ['ts' => time(), 'data' => $result];
    if (count($cache) > FF_CACHE_MAX) {
        uasort($cache, static fn($a, $b) => ((int) ($b['ts'] ?? 0)) <=> ((int) ($a['ts'] ?? 0)));
        $cache = array_slice($cache, 0, FF_CACHE_MAX, true);
    }
    $tmp = @tempnam(DATA_DIR, '.tmp_foodfacts_');
    if ($tmp !== false && @file_put_contents($tmp, json_encode($cache, JSON_UNESCAPED_UNICODE)) !== false) {
        @rename($tmp, $cacheFile);
    } elseif ($tmp !== false) {
        @unlink($tmp);
    }
    flock($lock, LOCK_UN);
    fclose($lock);
}

respond($result);

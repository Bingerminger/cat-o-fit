<?php
/* =========================================================================
   foodfacts.php — Open Food Facts nutrition proxy with local cache.

   GET ?action=foodfacts&q=<ingredient>  ->  { found, name, kcal100, protein100 }
   GET ?action=foodfacts&code=<EAN>      ->  the same for a product (barcode, 8–14 digits)
   Optional: &lc=<language> (ISO 639-1; the app sends its language) and &cc=<country> (ISO 3166-1
   alpha-2) – names in that language, products from that country. Without lc the language of
   the instance applies (older app versions were German).

   Returns rough nutritional values per 100 g/ml for an ingredient name. The request goes
   exclusively from the server (Synology) to Open Food Facts – never from the clients –
   and without an API key. Hits are cached in data/foodfacts.json, so
   repeats are fast and work offline. Included by api.php;
   respond() comes from there, DATA_DIR from storage.php, person_language() from i18n.php.

   Open Food Facts is an open, non-profit database (ODbL). We send
   only the generic ingredient name (e.g. "rolled oats") – no user data whatsoever.
   ========================================================================= */

/** Is the barcode valid? 8, 12, 13 or 14 digits with a correct GS1 check digit. */
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
    // Only genuine barcodes go out – no arbitrary strings in the address.
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
$ttlHit  = 60 * 60 * 24 * 90;   // hits stay valid for 90 days
$ttlMiss = 60 * 60 * 24 * 7;    // misses only 7 days (OFF keeps growing)
const FF_CACHE_MAX = 600;       // upper limit: the oldest entries drop out (otherwise the file grows without end)

/** Read the cache (broken or missing = empty). */
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
        respond($cache[$key]['data']);   // cache hit -> offline + fast
    }
}

/** Fetches a URL (curl preferred, otherwise file_get_contents). null on error. */
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
            // Follow no redirects and speak HTTPS only: the response comes
            // exclusively from the hard-coded Open Food Facts address.
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        ]);
        $body = curl_exec($ch);
        $ok   = $body !== false && curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
        // curl_close() has had no effect since PHP 8.0 and is deprecated from 8.5 (it would
        // otherwise pollute the JSON response) – the handle is freed automatically.
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
    return null;   // No outgoing HTTP route available -> client uses a heuristic
}

$result = ['found' => false];
// Fetch several hits sorted by popularity and take the FIRST one with plausible
// nutritional values – the top-1 product often has no energy-kcal_100g.
// Fetch several hits sorted by popularity -> represents the real
// generic food better than a random branded product.
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

/** kcal per 100 g from the nutritional values – falls back to kJ (÷ 4.184) if need be. null if implausible. */
function ff_kcal100(array $nut): ?float
{
    if (isset($nut['energy-kcal_100g']) && is_numeric($nut['energy-kcal_100g'])) {
        $k = (float) $nut['energy-kcal_100g'];
    } elseif (isset($nut['energy-kj_100g']) && is_numeric($nut['energy-kj_100g'])) {
        $k = (float) $nut['energy-kj_100g'] / 4.184;
    } elseif (isset($nut['energy_100g']) && is_numeric($nut['energy_100g'])) {
        $k = (float) $nut['energy_100g'] / 4.184;   // energy_100g is usually kJ
    } else {
        return null;
    }
    return ($k > 0 && $k < 1000) ? $k : null;        // plausible values per 100 g only
}
/** Median of a list of numbers (more robust against outliers than the first/middle hit). */
function ff_median(array $xs): float
{
    sort($xs);
    $n = count($xs);
    return $n % 2 ? $xs[intdiv($n, 2)] : ($xs[$n / 2 - 1] + $xs[$n / 2]) / 2;
}

if ($code !== '') {
    // A specific product: name (preferably in the language lc), brand, nutritional values per 100 g.
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
    $raw = null;   // the text search below is skipped
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
    // At least 2 samples -> a single "odd" product does not count.
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

// Cache the result (misses too) so that we do not go online repeatedly.
// Read fresh under lock (parallel requests), limit and replace atomically.
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

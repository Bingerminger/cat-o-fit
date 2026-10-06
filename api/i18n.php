<?php
/**
 * i18n.php — text the server itself writes into results (calendar files, import titles).
 *
 * Catalogs: locales/<lang>/server.json, nested keys, placeholders as {name}; English is the
 * source language and the fallback (then the key itself). The list of languages is
 * locales/languages.json, as in the app (js/i18n.js).
 *
 * Error messages are not translated here: they are English and carry a stable `code`, which
 * the app translates (server.<code> in locales/<lang>/ui.json).
 */

declare(strict_types=1);

const LOCALES_DIR = __DIR__ . '/../locales';
const SERVER_SOURCE_LANGUAGE = 'en';
/** Languages written with a decimal point; all others use a decimal comma. */
const DECIMAL_POINT_LANGUAGES = ['en'];

/** Supported language codes (locales/languages.json), English first. */
function server_languages(): array
{
    static $codes = null;
    if ($codes === null) {
        $list = json_decode((string) @file_get_contents(LOCALES_DIR . '/languages.json'), true);
        $codes = is_array($list) && $list ? array_map('strval', array_keys($list)) : [SERVER_SOURCE_LANGUAGE];
    }
    return $codes;
}

/** Best supported language for a tag ('de-AT' → 'de', 'pt' → 'pt-BR') or null – like matchLanguage() in js/i18n.js. */
function server_match_language(mixed $tag): ?string
{
    if (!is_string($tag)) {
        return null;
    }
    $tag = strtolower(str_replace('_', '-', trim($tag)));
    if ($tag === '') {
        return null;
    }
    foreach (server_languages() as $code) {
        if (strtolower($code) === $tag) {
            return $code;
        }
    }
    $base = explode('-', $tag)[0];
    foreach (server_languages() as $code) {
        if (strtolower(explode('-', $code)[0]) === $base) {
            return $code;
        }
    }
    return null;
}

/**
 * Language of a person: their own choice (profile settings.language), else the instance
 * default (family __settings.language), else German when the instance already has members
 * (instances set up before v4.0.0 were German-only), else English. The app uses the same
 * order (js/language.js); the browser language only counts there.
 */
function person_language(?string $userId): string
{
    try {
        if ($userId !== null && is_valid_user($userId)) {
            $profile = read_store('profile', 'user', $userId)['records']['profile'] ?? null;
            $own = server_match_language(is_array($profile) ? ($profile['settings']['language'] ?? null) : null);
            if ($own !== null) {
                return $own;
            }
        }
        $records = read_store('family', 'family', null)['records'];
        $instance = server_match_language($records['__settings']['language'] ?? null);
        if ($instance !== null) {
            return $instance;
        }
        foreach ($records as $r) {
            if (is_array($r) && empty($r['deleted']) && ($r['_kind'] ?? 'member') === 'member') {
                return server_match_language('de') ?? SERVER_SOURCE_LANGUAGE;
            }
        }
    } catch (Throwable) {
        // Unreadable store: the text is not worth failing for.
    }
    return SERVER_SOURCE_LANGUAGE;
}

/** Kilometres per mile (international mile). */
const KM_PER_MI = 1.609344;

/**
 * Units of a person for server texts (calendar files): their own choice in the profile settings
 * (distanceUnit), else metric. The app saves the browser region's default on first use (unit-prefs.js).
 */
function person_units(?string $userId): array
{
    $units = ['distance' => 'km'];
    try {
        if ($userId !== null && is_valid_user($userId)) {
            $profile = read_store('profile', 'user', $userId)['records']['profile'] ?? null;
            $settings = is_array($profile) && is_array($profile['settings'] ?? null) ? $profile['settings'] : [];
            if (($settings['distanceUnit'] ?? null) === 'mi') {
                $units['distance'] = 'mi';
            }
        }
    } catch (Throwable) {
        // Unreadable store: metric is fine.
    }
    return $units;
}

/** Distance from kilometres with its unit: "10,5 km" / "6.5 mi". */
function server_distance(float $km, int $decimals, string $lang, array $units): string
{
    $mi = ($units['distance'] ?? 'km') === 'mi';
    return server_number($mi ? $km / KM_PER_MI : $km, $decimals, $lang) . ($mi ? ' mi' : ' km');
}

/** Pace from seconds per km as "m:ss" in the person's unit (per km or per mile). */
function server_pace(int $secPerKm, array $units): string
{
    $sec = (int) round(($units['distance'] ?? 'km') === 'mi' ? $secPerKm * KM_PER_MI : $secPerKm);
    return sprintf('%d:%02d', intdiv($sec, 60), $sec % 60);
}

/** Unit label of a pace: "min/km" / "min/mi". */
function server_pace_unit(array $units): string
{
    return ($units['distance'] ?? 'km') === 'mi' ? 'min/mi' : 'min/km';
}

/**
 * Generated plan texts carry metric amounts ("Long run 18 km at 5:20/km"); for a person on miles they
 * are converted like localizeUnits() in js/format.js – metre intervals and km/h stay.
 */
function server_localize_units(string $text, string $lang, array $units): string
{
    if (($units['distance'] ?? 'km') !== 'mi') {
        return $text;
    }
    $perMile = static function (string $mss): string {
        [$m, $s] = array_map('intval', explode(':', $mss));
        $sec = (int) round(($m * 60 + $s) * KM_PER_MI);
        return sprintf('%d:%02d', intdiv($sec, 60), $sec % 60);
    };
    $text = (string) preg_replace_callback('/(\d{1,2}:\d{2})(?:(\s?[–-]\s?)(\d{1,2}:\d{2}))?(\s?(?:min)?\s?)\/\s?km\b/u',
        static fn(array $m): string => $perMile($m[1]) . (($m[3] ?? '') !== '' ? $m[2] . $perMile($m[3]) : '') . $m[4] . '/mi', $text);
    return (string) preg_replace_callback('/(\d+(?:[.,]\d+)?)(\s?|\x{00a0})km\b(?!\/h)/u', static function (array $m) use ($lang): string {
        $mi = (float) str_replace(',', '.', $m[1]) / KM_PER_MI;
        $num = server_number($mi, $mi >= 3 ? 1 : 2, $lang);
        return $num . $m[2] . 'mi';
    }, $text);
}

/** Catalog of a language as a nested array ([] when it is missing or broken). */
function server_catalog(string $lang): array
{
    static $catalogs = [];
    if (!array_key_exists($lang, $catalogs)) {
        $data = in_array($lang, server_languages(), true)
            ? json_decode((string) @file_get_contents(LOCALES_DIR . '/' . $lang . '/server.json'), true)
            : null;
        $catalogs[$lang] = is_array($data) ? $data : [];
    }
    return $catalogs[$lang];
}

/** Text of a key in a language, else in English; null when neither has it. */
function server_lookup(string $lang, string $key): ?string
{
    foreach (array_unique([$lang, SERVER_SOURCE_LANGUAGE]) as $l) {
        $node = server_catalog($l);
        foreach (explode('.', $key) as $part) {
            $node = is_array($node) ? ($node[$part] ?? null) : null;
        }
        if (is_string($node)) {
            return $node;
        }
    }
    return null;
}

/** Text for a key (English fallback, then the key itself); $params fill its {placeholders}. */
function server_text(string $lang, string $key, array $params = []): string
{
    $text = server_lookup($lang, $key) ?? $key;
    return (string) preg_replace_callback('/\{(\w+)\}/', static fn(array $m): string =>
        array_key_exists($m[1], $params) && $params[$m[1]] !== null ? (string) $params[$m[1]] : $m[0], $text);
}

/** Number with at most $decimals decimals, without trailing zeros: 10,5 (de) / 10.5 (en). */
function server_number(float $value, int $decimals, string $lang): string
{
    $point = in_array($lang, DECIMAL_POINT_LANGUAGES, true) ? '.' : ',';
    $text = number_format($value, $decimals, $point, $point === '.' ? ',' : '.');
    return $decimals > 0 ? rtrim(rtrim($text, '0'), $point) : $text;
}

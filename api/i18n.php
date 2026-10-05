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

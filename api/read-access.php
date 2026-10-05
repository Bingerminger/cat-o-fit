<?php
/**
 * read-access.php — read access for own tools (e.g. an AI assistant that the
 * person runs themselves). OFF by default: only once the person generates a
 * key in the app (profile.readToken) does this endpoint respond – read-only, and only with
 * their own data.
 *
 *   GET api/api.php?action=read&user=<id>   Header  X-Catofit-Token: <key>
 *   optional: &areas=sessions,health   &from=2026-06-01
 *
 * Deliberately NOT included: cycle, labs and supplements (health data under Art. 9
 * GDPR – and lab evaluations do not belong in third-party analyses) as well as all keys
 * from the profile. Cat-O-Fit runs no AI itself; it only supplies data.
 *
 * Included by api.php (respond()/fail() are available there).
 */
declare(strict_types=1);

/** Areas that the read access may hand out. */
const READ_AREAS = ['events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'checklist', 'reports'];
/** Profile fields that are useful for an analysis – no keys, no settings. */
const READ_PROFILE_FIELDS = ['name', 'sex', 'birthYear', 'heightCm', 'weightKg', 'targetWeightKg', 'maxHr', 'restHr',
    'hrZones', 'paceZones', 'thresholdPaceSecPerKm', 'level', 'goals', 'activityFactor'];

$user  = isset($_GET['user']) ? (string) $_GET['user'] : '';
$token = (string) ($_SERVER['HTTP_X_CATOFIT_TOKEN'] ?? ($_GET['token'] ?? ''));

if ($user === '' || !is_valid_user($user)) {
    fail('Invalid or missing user ID.', 400, 'invalid_or_missing_user');
}
$profileStore = read_store('profile', 'user', $user);
$profile = $profileStore['records']['profile'] ?? [];
$expected = is_array($profile) ? (string) ($profile['readToken'] ?? '') : '';
// Without access switched on, the same response as for a wrong key: from the outside it
// must not be possible to tell who uses the access.
if ($expected === '' || $token === '' || !hash_equals($expected, $token)) {
    fail('Invalid or disabled access.', 401, 'invalid_access');
}

$wanted = READ_AREAS;
if (isset($_GET['areas']) && $_GET['areas'] !== '') {
    $wanted = array_values(array_intersect(READ_AREAS, array_map('trim', explode(',', (string) $_GET['areas']))));
}
$from = null;
if (isset($_GET['from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $_GET['from'])) {
    $from = (string) $_GET['from'];
}

$out = [];
foreach ($wanted as $area) {
    $store = read_store($area, 'user', $user);
    $list = [];
    foreach ($store['records'] as $rec) {
        if (!is_array($rec) || !empty($rec['deleted'])) continue;
        if ($from !== null && isset($rec['date']) && is_string($rec['date']) && $rec['date'] < $from) continue;
        unset($rec['rev']);
        $list[] = $rec;
    }
    $out[$area] = $list;
}
$safe = [];
foreach (READ_PROFILE_FIELDS as $k) {
    if (is_array($profile) && array_key_exists($k, $profile)) $safe[$k] = $profile[$k];
}

respond([
    'ok' => true,
    'user' => $user,
    'generatedAt' => date('c'),
    'note' => 'Read only. Without cycle, lab values and supplements. Values are for orientation, not a diagnosis.',
    'profile' => (object) $safe,
    'data' => (object) $out,
]);

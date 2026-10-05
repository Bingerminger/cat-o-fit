<?php
/**
 * read-access.php — Lesezugang für eigene Werkzeuge (z. B. einen KI-Assistenten, den die
 * Person selbst betreibt). Standardmäßig AUS: Erst wenn die Person in der App einen
 * Schlüssel erzeugt (profile.readToken), antwortet dieser Endpunkt – nur lesend, nur mit
 * ihren eigenen Daten.
 *
 *   GET api/api.php?action=read&user=<id>   Header  X-Catofit-Token: <schlüssel>
 *   optional: &areas=sessions,health   &from=2026-06-01
 *
 * Bewusst NICHT enthalten: Zyklus, Labor und Ergänzungen (Gesundheitsdaten nach Art. 9
 * DSGVO – und Laborbewertungen gehören nicht in fremde Auswertungen) sowie alle Schlüssel
 * aus dem Profil. Cat-O-Fit betreibt selbst keine KI; es liefert nur Daten.
 *
 * Eingebunden von api.php (respond()/fail() stehen dort bereit).
 */
declare(strict_types=1);

/** Bereiche, die der Lesezugang herausgeben darf. */
const READ_AREAS = ['events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'checklist', 'reports'];
/** Profilfelder, die für eine Auswertung nützlich sind – keine Schlüssel, keine Einstellungen. */
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
// Ohne eingeschalteten Zugang dieselbe Antwort wie bei falschem Schlüssel: Von außen soll
// nicht erkennbar sein, wer den Zugang nutzt.
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

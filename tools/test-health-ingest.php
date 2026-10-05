<?php
/**
 * test-health-ingest.php — tests for the pure Apple Health mapping logic
 * (api/health-map.php, `hi_parse`). Without server/DB. Run:
 *
 *   php tools/test-health-ingest.php
 *
 * Exit code 0 = all green, 1 = at least one failure. Also runs in the commit-git check run.
 */
declare(strict_types=1);
require __DIR__ . '/../api/health-map.php';

$pass = 0; $fail = 0;
function check(string $name, bool $cond, $got = null): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  OK  $name\n"; }
    else { $fail++; echo "  FAILED  $name" . ($got !== null ? "  (got: " . json_encode($got, JSON_UNESCAPED_UNICODE) . ")" : "") . "\n"; }
}

// --- 1) Metrics: names (incl. weight_&_body_mass), units, body fat ---
$r = hi_parse(['metrics' => [
    ['name' => 'weight_&_body_mass', 'units' => 'kg', 'data' => [['date' => '2026-07-01', 'qty' => 70.2]]],
    ['name' => 'body_fat_percentage', 'units' => '%', 'data' => [['date' => '2026-07-01', 'qty' => 0.185]]],
    ['name' => 'lean_body_mass', 'units' => 'kg', 'data' => [['date' => '2026-07-01', 'qty' => 55.0]]],
    ['name' => 'resting_heart_rate', 'units' => 'bpm', 'data' => [['date' => '2026-07-01', 'qty' => 51]]],
    ['name' => 'heart_rate_variability', 'units' => 'ms', 'data' => [['date' => '2026-07-01', 'qty' => 47]]],
    ['name' => 'vo2_max', 'units' => 'ml/min·kg', 'data' => [['date' => '2026-07-01', 'qty' => 50.12]]],
    ['name' => 'step_count', 'units' => 'count', 'data' => [['date' => '2026-07-01', 'qty' => 9450]]],
    ['name' => 'active_energy', 'units' => 'kcal', 'data' => [['date' => '2026-07-01', 'qty' => 680.4]]],
]]);
$h = $r['healthByDate']['2026-07-01'] ?? [];
check('weight from "weight_&_body_mass"', ($h['weight'] ?? null) === 70.2, $h['weight'] ?? null);
check('bodyFat 0..1 -> percent (0.185 -> 18.5)', ($h['bodyFat'] ?? null) === 18.5, $h['bodyFat'] ?? null);
check('lean_body_mass -> leanMass (lean mass, not muscle mass)', ($h['leanMass'] ?? null) === 55.0 && !isset($h['muscleMass']), $h);
check('restingHr (int)', ($h['restingHr'] ?? null) === 51, $h['restingHr'] ?? null);
check('hrv (int)', ($h['hrv'] ?? null) === 47, $h['hrv'] ?? null);
check('hrv with method SDNN (Apple)', ($h['hrvMethod'] ?? null) === 'sdnn', $h['hrvMethod'] ?? null);
check('vo2max (1 decimal place)', ($h['vo2max'] ?? null) === 50.1, $h['vo2max'] ?? null);
check('steps (int)', ($h['steps'] ?? null) === 9450, $h['steps'] ?? null);
check('active_energy -> activeEnergyKcal (int)', ($h['activeEnergyKcal'] ?? null) === 680, $h['activeEnergyKcal'] ?? null);

// --- 2) Weight in lb -> kg -------------------------------------------------
$r = hi_parse(['metrics' => [['name' => 'weight_&_body_mass', 'units' => 'lb', 'data' => [['date' => '2026-07-01', 'qty' => 154.0]]]]]);
check('Weight in lb -> kg', abs(($r['healthByDate']['2026-07-01']['weight'] ?? 0) - 69.85) < 0.05, $r['healthByDate']['2026-07-01']['weight'] ?? null);

// --- 3) Unknown metrics -> ignoredMetrics (not misused) -------
$r = hi_parse(['metrics' => [
    ['name' => 'heart_rate', 'units' => 'bpm', 'data' => [['date' => '2026-07-01', 'Min' => 48, 'Avg' => 62, 'Max' => 150]]],
    ['name' => 'blood_oxygen_saturation', 'units' => '%', 'data' => [['date' => '2026-07-01', 'qty' => 97]]],
]]);
check('heart_rate + SpO2 -> ignoredMetrics', in_array('heart_rate', $r['ignoredMetrics'], true) && in_array('blood_oxygen_saturation', $r['ignoredMetrics'], true), $r['ignoredMetrics']);
check('unknown metric writes no daily value', empty($r['healthByDate']), array_keys($r['healthByDate']));

// --- 4) Sleep plausibility limit + asleep fallback ----------------------
$r = hi_parse(['metrics' => [['name' => 'sleep_analysis', 'data' => [
    ['date' => '2026-06-28', 'totalSleep' => 36],                 // impossible -> discard
    ['date' => '2026-06-29', 'totalSleep' => 7.5],                // ok
    ['date' => '2026-06-30', 'totalSleep' => 36, 'asleep' => 6.8], // totalSleep broken -> fall back to asleep
]]]]);
check('Sleep 36 h discarded', !isset($r['healthByDate']['2026-06-28']['sleepHours']), $r['healthByDate']['2026-06-28'] ?? null);
check('Sleep 7.5 h kept', ($r['healthByDate']['2026-06-29']['sleepHours'] ?? null) === 7.5);
check('Sleep fallback to asleep (6.8)', ($r['healthByDate']['2026-06-30']['sleepHours'] ?? null) === 6.8);

// --- 5) Workout v2: duration=seconds, mi->km, objects { qty, units } ------
$r = hi_parse(['workouts' => [[
    'id' => 'UUID-RUN', 'name' => 'Running', 'start' => '2026-07-03 06:00:00 +0200', 'duration' => 1980,
    'distance' => ['qty' => 3.728, 'units' => 'mi'],
    'activeEnergyBurned' => ['qty' => 410, 'units' => 'kcal'],
    'avgHeartRate' => ['qty' => 148, 'units' => 'bpm'], 'maxHeartRate' => ['qty' => 171, 'units' => 'bpm'],
]]]);
$s = $r['newSessions']['hk-UUID-RUN'] ?? [];
check('Workout type Running -> easy', ($s['type'] ?? null) === 'easy', $s['type'] ?? null);
check('duration=1980 as seconds (not ×60)', ($s['durationSec'] ?? null) === 1980, $s['durationSec'] ?? null);
check('Distance mi -> km (3.728 mi ≈ 6.0 km)', abs(($s['distanceKm'] ?? 0) - 6.0) < 0.02, $s['distanceKm'] ?? null);
check('Pace = durSec/km', ($s['paceSecPerKm'] ?? null) === (int) round(1980 / ($s['distanceKm'] ?: 1)), $s['paceSecPerKm'] ?? null);
check('kcal from activeEnergyBurned (v2)', ($s['kcal'] ?? null) === 410, $s['kcal'] ?? null);
check('avgHr/maxHr from v2 objects', ($s['avgHr'] ?? null) === 148 && ($s['maxHr'] ?? null) === 171, [$s['avgHr'] ?? null, $s['maxHr'] ?? null]);
check('Session-ID = hk-<UUID>', ($s['id'] ?? null) === 'hk-UUID-RUN', $s['id'] ?? null);

// --- 6) Workout v1: activeEnergy + heartRateData fallback ------------------
$r = hi_parse(['workouts' => [[
    'id' => 'UUID-BIKE', 'name' => 'Cycling', 'start' => '2026-07-03 12:00:00 +0200', 'end' => '2026-07-03 12:40:00 +0200',
    'distance' => ['qty' => 18.0, 'units' => 'km'],
    'activeEnergy' => ['qty' => 300, 'units' => 'kcal'],                 // v1 name
    'heartRateData' => [['Avg' => 120], ['Avg' => 140, 'Max' => 165]],  // v1: HR only as a series
]]]);
$s = $r['newSessions']['hk-UUID-BIKE'] ?? [];
check('Cycling -> cross_bike', ($s['type'] ?? null) === 'cross_bike', $s['type'] ?? null);
check('duration from start/end (40 min = 2400 s)', ($s['durationSec'] ?? null) === 2400, $s['durationSec'] ?? null);
check('kcal from v1 activeEnergy', ($s['kcal'] ?? null) === 300, $s['kcal'] ?? null);
check('avgHr fallback from heartRateData (avg 130)', ($s['avgHr'] ?? null) === 130, $s['avgHr'] ?? null);
check('maxHr fallback from heartRateData (165)', ($s['maxHr'] ?? null) === 165, $s['maxHr'] ?? null);

// --- 7) Unknown workout type -> skippedUnmappedType --------------------
$r = hi_parse(['workouts' => [['name' => 'Curling', 'start' => '2026-07-03 10:00:00 +0200', 'duration' => 600]]]);
check('unknown workout type skipped', $r['skippedUnmappedType'] === 1 && empty($r['newSessions']), $r);

// --- 8) Lean daily format (Shortcuts template, free route) -------
check('Day object is recognised, Auto Export package is not', hi_is_simple(['date' => '2026-09-29', 'weight' => 72]) && !hi_is_simple(['metrics' => []]));
$r = hi_parse_simple(['date' => '2026-09-29T07:12:00+02:00', 'weight' => '72,4', 'restingHr' => '52', 'hrv' => 48.6,
    'sleepHours' => '7,3 h', 'steps' => 8421, 'bodyFat' => 0.185, 'mood' => 'gut']);
$h = $r['healthByDate']['2026-09-29'] ?? [];
check('Decimal-comma number as text ("72,4")', ($h['weight'] ?? null) === 72.4, $h);
check('Resting heart rate as text', ($h['restingHr'] ?? null) === 52, $h);
check('HRV with method SDNN (Apple) as the default', ($h['hrv'] ?? null) === 49 && ($h['hrvMethod'] ?? null) === 'sdnn', $h);
check('Sleep with unit in the text', ($h['sleepHours'] ?? null) === 7.3, $h);
check('Body fat 0..1 → percent', ($h['bodyFat'] ?? null) === 18.5, $h);
check('unknown field ignored and reported', !isset($h['mood']) && in_array('mood', $r['ignoredMetrics'], true), $r['ignoredMetrics']);
$r = hi_parse_simple(['days' => [
    ['date' => '2026-09-28', 'weight' => 160, 'weightUnit' => 'lb', 'hrv' => 35, 'hrvMethod' => 'rmssd'],
    ['date' => '2026-09-29', 'restingHr' => 400, 'sleepHours' => 30, 'weight' => 71.9],
    ['weight' => 70],
]]);
check('several days', isset($r['healthByDate']['2026-09-28'], $r['healthByDate']['2026-09-29']), array_keys($r['healthByDate']));
check('Pounds → kg', ($r['healthByDate']['2026-09-28']['weight'] ?? null) === 72.57, $r['healthByDate']['2026-09-28'] ?? null);
check('RMSSD stays RMSSD', ($r['healthByDate']['2026-09-28']['hrvMethod'] ?? null) === 'rmssd');
check('implausible values discarded (resting heart rate 400, sleep 30 h)', !isset($r['healthByDate']['2026-09-29']['restingHr']) && !isset($r['healthByDate']['2026-09-29']['sleepHours']) && ($r['healthByDate']['2026-09-29']['weight'] ?? null) === 71.9, $r['healthByDate']['2026-09-29'] ?? null);
check('Warnings name what was discarded and the day without a date', count($r['warnings']) === 3, $r['warnings']);
check('no workouts in the daily format', $r['newSessions'] === [] && $r['received'] === ['days' => 3]);
$r = hi_parse_simple(['days' => [['date' => '2026-09-29', 'weight' => 72]],
    'workouts' => [['name' => 'Running', 'start' => '2026-09-29 18:00:00 +0200', 'duration' => 2700, 'distanceKm' => 8.1, 'avgHeartRate' => 151]]]);
check('Daily values and sessions in the same package (Android scripts)', ($r['healthByDate']['2026-09-29']['weight'] ?? null) === 72.0
    && count($r['newSessions']) === 1 && (array_values($r['newSessions'])[0]['avgHr'] ?? null) === 151, $r);

// --- 9) Energy in kJ (Health Auto Export does not convert) -----------------
$r = hi_parse(['metrics' => [['name' => 'active_energy', 'units' => 'kJ', 'data' => [['date' => '2026-07-01', 'qty' => 2100]]]],
    'workouts' => [['id' => 'KJ', 'name' => 'Running', 'start' => '2026-07-01 07:00:00 +0200', 'duration' => 1800, 'activeEnergyBurned' => ['qty' => 1674, 'units' => 'kJ']]]]);
check('active energy 2100 kJ → 502 kcal', ($r['healthByDate']['2026-07-01']['activeEnergyKcal'] ?? null) === 502, $r['healthByDate']['2026-07-01'] ?? null);
check('workout energy 1674 kJ → 400 kcal', ($r['newSessions']['hk-KJ']['kcal'] ?? null) === 400, $r['newSessions']['hk-KJ'] ?? null);

// --- 10) Android: Health Connect via a bridge app ---------------------
$hc = [
    'timestamp' => '2026-09-29T06:00:00Z', 'app_version' => '1.4.0',
    'weight' => [['kilograms' => 72.8, 'time' => '2026-09-28T05:00:00Z'], ['kilograms' => 72.4, 'time' => '2026-09-28T20:00:00Z']],
    'body_fat' => [['percentage' => 24.1, 'time' => '2026-09-28T05:00:00Z']],
    'lean_body_mass' => [['kilograms' => 54.9, 'time' => '2026-09-28T05:00:00Z']],
    'resting_heart_rate' => [['bpm' => 51, 'time' => '2026-09-28T04:00:00Z']],
    'heart_rate_variability' => [['rmssd_millis' => 44, 'time' => '2026-09-28T02:00:00Z'], ['rmssd_millis' => 50, 'time' => '2026-09-28T03:00:00Z']],
    'steps' => [['count' => 4000, 'start_time' => '2026-09-28T08:00:00Z', 'end_time' => '2026-09-28T09:00:00Z'],
                ['count' => 3500, 'start_time' => '2026-09-28T15:00:00Z', 'end_time' => '2026-09-28T16:00:00Z']],
    'sleep' => [['session_end_time' => '2026-09-28T05:30:00Z', 'duration_seconds' => 28800, 'stages' => [
        ['stage' => 'light', 'duration_seconds' => 14400], ['stage' => 'deep', 'duration_seconds' => 7200],
        ['stage' => 'rem', 'duration_seconds' => 5400], ['stage' => 'awake', 'duration_seconds' => 1800]]]],
    'exercise' => [
        ['type' => 'EXERCISE_TYPE_RUNNING', 'start_time' => '2026-09-28T16:00:00Z', 'end_time' => '2026-09-28T16:50:00Z', 'duration_seconds' => 3000, 'distance_meters' => 9100],
        ['type' => 'BIKING', 'start_time' => '2026-09-27T22:30:00Z', 'end_time' => '2026-09-27T23:10:00Z', 'duration_seconds' => 2400, 'distance_meters' => 15000],
        ['type' => 'CURLING', 'start_time' => '2026-09-28T10:00:00Z', 'duration_seconds' => 600],
    ],
    'heart_rate' => [['bpm' => 140, 'time' => '2026-09-28T16:10:00Z'], ['bpm' => 160, 'time' => '2026-09-28T16:40:00Z'], ['bpm' => 70, 'time' => '2026-09-28T18:00:00Z']],
    'menstruation_period' => [['start_time' => '2026-09-20T06:00:00Z', 'end_time' => '2026-09-24T06:00:00Z']],
];
check('Health Connect package is recognised, the other formats are not', hi_is_hcw($hc) && !hi_is_hcw(['date' => '2026-09-29']) && !hi_is_hcw(['metrics' => []]));
$r = hi_parse_hcw($hc, 'Europe/Berlin');
$d = $r['healthByDate']['2026-09-28'] ?? [];
check('HC: latest weight of the day, body fat, lean mass, resting heart rate', ($d['weight'] ?? null) === 72.4 && ($d['bodyFat'] ?? null) === 24.1
    && ($d['leanMass'] ?? null) === 54.9 && ($d['restingHr'] ?? null) === 51, $d);
check('HC: HRV as daily mean with method RMSSD', ($d['hrv'] ?? null) === 47 && ($d['hrvMethod'] ?? null) === 'rmssd', $d);
check('HC: steps as daily total', ($d['steps'] ?? null) === 7500, $d);
check('HC: sleep without awake phases (7.5 h)', ($d['sleepHours'] ?? null) === 7.5, $d);
$run = array_values(array_filter($r['newSessions'], fn ($s) => $s['type'] === 'easy'))[0] ?? [];
check('HC: run with distance, duration and avg/max HR from the time window', ($run['distanceKm'] ?? null) === 9.1 && ($run['durationSec'] ?? null) === 3000
    && ($run['avgHr'] ?? null) === 150 && ($run['maxHr'] ?? null) === 160 && ($run['source'] ?? '') === 'health-connect', $run);
$bike = array_values(array_filter($r['newSessions'], fn ($s) => $s['type'] === 'cross_bike'))[0] ?? [];
check('HC: bike ride shortly before midnight UTC counts for the Berlin calendar day', ($bike['date'] ?? null) === '2026-09-28', $bike);
$r2 = hi_parse_hcw($hc, 'Mars/Olympus');
$bike2 = array_values(array_filter($r2['newSessions'], fn ($s) => $s['type'] === 'cross_bike'))[0] ?? [];
check('HC: unknown time zone → Europe/Berlin instead of a crash', ($r2['healthByDate']['2026-09-28']['weight'] ?? null) === 72.4
    && ($bike2['date'] ?? null) === '2026-09-28', $bike2);
check('HC: unknown exercise type skipped', $r['skippedUnmappedType'] === 1 && count($r['newSessions']) === 2, $r['warnings']);
check('HC: title names the source', str_ends_with((string) ($run['title'] ?? ''), '(Health Connect)'), $run['title'] ?? null);
// Titles in the person's language (locales/<lang>/server.json); without one: English.
check('HC: title without a language in English', ($run['title'] ?? null) === 'Run (Health Connect)', $run['title'] ?? null);
$runDe = array_values(array_filter(hi_parse_hcw($hc, 'Europe/Berlin', 'de')['newSessions'], fn ($s) => $s['type'] === 'easy'))[0] ?? [];
check('HC: title for a German-speaking person as before', ($runDe['title'] ?? null) === 'Lauf (Health Connect)', $runDe['title'] ?? null);
$aw = ['workouts' => [['name' => 'Outdoor Cycling', 'start' => '2026-07-02 07:00:00 +0200', 'end' => '2026-07-02 08:00:00 +0200']]];
$t = static fn (array $r) => array_values($r['newSessions'])[0]['title'] ?? null;
check('Apple: title per language (de as before, en, fr; unsupported → English)', $t(hi_parse($aw, 'de')) === 'Radtour (Apple Health)'
    && $t(hi_parse($aw, 'en')) === 'Bike ride (Apple Health)' && $t(hi_parse($aw, 'fr')) === 'Sortie à vélo (Apple Health)'
    && $t(hi_parse($aw, 'xx')) === 'Bike ride (Apple Health)', [$t(hi_parse($aw, 'de')), $t(hi_parse($aw, 'fr')), $t(hi_parse($aw, 'xx'))]);
check('Shortcuts format passes the language on to the sessions', $t(hi_parse_simple(['date' => '2026-07-02'] + $aw, 'de')) === 'Radtour (Apple Health)');
check('HC: period from the time span (start + length)', $r['periods'] === [['start' => '2026-09-20', 'length' => 5]], $r['periods']);

// --- 11) Cycle from Apple Health (Health Auto Export) -----------------------
$r = hi_parse(['metrics' => [['name' => 'menstrual_flow', 'data' => [
    ['date' => '2026-08-01 00:00:00 +0200', 'value' => 'medium'], ['date' => '2026-08-02 00:00:00 +0200', 'value' => 'light'],
    ['date' => '2026-08-04 00:00:00 +0200', 'value' => 'light'],   // a one-day gap still belongs to it
    ['date' => '2026-08-20 00:00:00 +0200', 'value' => 'none'],    // "none" is not bleeding
    ['date' => '2026-08-29 00:00:00 +0200', 'value' => 'heavy'],
]]]]);
check('Apple: bleeding days become periods (a gap of up to 1 day belongs to it, "none" does not count)',
    $r['periods'] === [['start' => '2026-08-01', 'length' => 4], ['start' => '2026-08-29', 'length' => 1]], $r['periods']);
check('Apple: cycle does not show up as an unknown metric', !in_array('menstrual_flow', $r['ignoredMetrics'], true), $r['ignoredMetrics']);

// --- Result --------------------------------------------------------------
echo "\nhealth-ingest mapping: {$pass} ok, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);

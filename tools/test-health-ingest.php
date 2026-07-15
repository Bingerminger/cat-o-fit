<?php
/**
 * test-health-ingest.php — Tests für die reine Apple-Health-Mapping-Logik
 * (api/health-map.php, `hi_parse`). Ohne Server/DB. Ausführen:
 *
 *   php tools/test-health-ingest.php
 *
 * Exit-Code 0 = alle grün, 1 = mind. ein Fehler. Läuft im commit-git-Prüflauf mit.
 */
declare(strict_types=1);
require __DIR__ . '/../api/health-map.php';

$pass = 0; $fail = 0;
function check(string $name, bool $cond, $got = null): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  OK  $name\n"; }
    else { $fail++; echo "  FEHLER  $name" . ($got !== null ? "  (got: " . json_encode($got, JSON_UNESCAPED_UNICODE) . ")" : "") . "\n"; }
}

// --- 1) Metriken: Namen (inkl. weight_&_body_mass), Einheiten, Körperfett ---
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
check('weight aus „weight_&_body_mass"', ($h['weight'] ?? null) === 70.2, $h['weight'] ?? null);
check('bodyFat 0..1 -> Prozent (0.185 -> 18.5)', ($h['bodyFat'] ?? null) === 18.5, $h['bodyFat'] ?? null);
check('lean_body_mass -> muscleMass', ($h['muscleMass'] ?? null) === 55.0, $h['muscleMass'] ?? null);
check('restingHr (int)', ($h['restingHr'] ?? null) === 51, $h['restingHr'] ?? null);
check('hrv (int)', ($h['hrv'] ?? null) === 47, $h['hrv'] ?? null);
check('vo2max (1 Nachkomma)', ($h['vo2max'] ?? null) === 50.1, $h['vo2max'] ?? null);
check('steps (int)', ($h['steps'] ?? null) === 9450, $h['steps'] ?? null);
check('active_energy -> activeEnergyKcal (int)', ($h['activeEnergyKcal'] ?? null) === 680, $h['activeEnergyKcal'] ?? null);

// --- 2) Gewicht in lb -> kg -------------------------------------------------
$r = hi_parse(['metrics' => [['name' => 'weight_&_body_mass', 'units' => 'lb', 'data' => [['date' => '2026-07-01', 'qty' => 154.0]]]]]);
check('Gewicht in lb -> kg', abs(($r['healthByDate']['2026-07-01']['weight'] ?? 0) - 69.85) < 0.05, $r['healthByDate']['2026-07-01']['weight'] ?? null);

// --- 3) Unbekannte Metriken -> ignoredMetrics (nicht fehl-verwertet) -------
$r = hi_parse(['metrics' => [
    ['name' => 'heart_rate', 'units' => 'bpm', 'data' => [['date' => '2026-07-01', 'Min' => 48, 'Avg' => 62, 'Max' => 150]]],
    ['name' => 'blood_oxygen_saturation', 'units' => '%', 'data' => [['date' => '2026-07-01', 'qty' => 97]]],
]]);
check('heart_rate + SpO2 -> ignoredMetrics', in_array('heart_rate', $r['ignoredMetrics'], true) && in_array('blood_oxygen_saturation', $r['ignoredMetrics'], true), $r['ignoredMetrics']);
check('unbekannte Metrik schreibt keinen Tageswert', empty($r['healthByDate']), array_keys($r['healthByDate']));

// --- 4) Schlaf-Plausibilitätsgrenze + asleep-Fallback ----------------------
$r = hi_parse(['metrics' => [['name' => 'sleep_analysis', 'data' => [
    ['date' => '2026-06-28', 'totalSleep' => 36],                 // unmöglich -> verwerfen
    ['date' => '2026-06-29', 'totalSleep' => 7.5],                // ok
    ['date' => '2026-06-30', 'totalSleep' => 36, 'asleep' => 6.8], // totalSleep kaputt -> Fallback asleep
]]]]);
check('Schlaf 36 h verworfen', !isset($r['healthByDate']['2026-06-28']['sleepHours']), $r['healthByDate']['2026-06-28'] ?? null);
check('Schlaf 7.5 h behalten', ($r['healthByDate']['2026-06-29']['sleepHours'] ?? null) === 7.5);
check('Schlaf-Fallback auf asleep (6.8)', ($r['healthByDate']['2026-06-30']['sleepHours'] ?? null) === 6.8);

// --- 5) Workout v2: duration=Sekunden, mi->km, Objekte { qty, units } ------
$r = hi_parse(['workouts' => [[
    'id' => 'UUID-RUN', 'name' => 'Running', 'start' => '2026-07-03 06:00:00 +0200', 'duration' => 1980,
    'distance' => ['qty' => 3.728, 'units' => 'mi'],
    'activeEnergyBurned' => ['qty' => 410, 'units' => 'kcal'],
    'avgHeartRate' => ['qty' => 148, 'units' => 'bpm'], 'maxHeartRate' => ['qty' => 171, 'units' => 'bpm'],
]]]);
$s = $r['newSessions']['hk-UUID-RUN'] ?? [];
check('Workout-Typ Running -> easy', ($s['type'] ?? null) === 'easy', $s['type'] ?? null);
check('duration=1980 als Sekunden (nicht ×60)', ($s['durationSec'] ?? null) === 1980, $s['durationSec'] ?? null);
check('Distanz mi -> km (3.728 mi ≈ 6.0 km)', abs(($s['distanceKm'] ?? 0) - 6.0) < 0.02, $s['distanceKm'] ?? null);
check('Pace = durSec/km', ($s['paceSecPerKm'] ?? null) === (int) round(1980 / ($s['distanceKm'] ?: 1)), $s['paceSecPerKm'] ?? null);
check('kcal aus activeEnergyBurned (v2)', ($s['kcal'] ?? null) === 410, $s['kcal'] ?? null);
check('avgHr/maxHr aus v2-Objekten', ($s['avgHr'] ?? null) === 148 && ($s['maxHr'] ?? null) === 171, [$s['avgHr'] ?? null, $s['maxHr'] ?? null]);
check('Session-ID = hk-<UUID>', ($s['id'] ?? null) === 'hk-UUID-RUN', $s['id'] ?? null);

// --- 6) Workout v1: activeEnergy + heartRateData-Fallback ------------------
$r = hi_parse(['workouts' => [[
    'id' => 'UUID-BIKE', 'name' => 'Cycling', 'start' => '2026-07-03 12:00:00 +0200', 'end' => '2026-07-03 12:40:00 +0200',
    'distance' => ['qty' => 18.0, 'units' => 'km'],
    'activeEnergy' => ['qty' => 300, 'units' => 'kcal'],                 // v1-Name
    'heartRateData' => [['Avg' => 120], ['Avg' => 140, 'Max' => 165]],  // v1: HF nur als Serie
]]]);
$s = $r['newSessions']['hk-UUID-BIKE'] ?? [];
check('Cycling -> cross_bike', ($s['type'] ?? null) === 'cross_bike', $s['type'] ?? null);
check('duration aus start/end (40 min = 2400 s)', ($s['durationSec'] ?? null) === 2400, $s['durationSec'] ?? null);
check('kcal aus v1-activeEnergy', ($s['kcal'] ?? null) === 300, $s['kcal'] ?? null);
check('avgHr Fallback aus heartRateData (Ø 130)', ($s['avgHr'] ?? null) === 130, $s['avgHr'] ?? null);
check('maxHr Fallback aus heartRateData (165)', ($s['maxHr'] ?? null) === 165, $s['maxHr'] ?? null);

// --- 7) Unbekannter Workout-Typ -> skippedUnmappedType --------------------
$r = hi_parse(['workouts' => [['name' => 'Curling', 'start' => '2026-07-03 10:00:00 +0200', 'duration' => 600]]]);
check('unbekannter Workout-Typ übersprungen', $r['skippedUnmappedType'] === 1 && empty($r['newSessions']), $r);

// --- Ergebnis --------------------------------------------------------------
echo "\nhealth-ingest mapping: {$pass} ok, {$fail} fehlgeschlagen\n";
exit($fail === 0 ? 0 : 1);

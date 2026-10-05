<?php
/**
 * test-health-xml.php — tests for the evaluation of the full Apple Health export
 * (api/health-xml.php, `hx_parse_file`). Without a server. Run:
 *
 *   php tools/test-health-xml.php
 *
 * Exit code 0 = all green, 1 = at least one failure.
 */
declare(strict_types=1);
require __DIR__ . '/../api/health-xml.php';

$pass = 0; $fail = 0;
function check(string $name, bool $cond, $got = null): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  OK  $name\n"; }
    else { $fail++; echo "  FEHLER  $name" . ($got !== null ? "  (got: " . json_encode($got, JSON_UNESCAPED_UNICODE) . ")" : "") . "\n"; }
}

// Small synthetic export: pounds, kilojoules, two sleep sources, a measurement shortly after
// midnight (local time), HRV and lean body mass.
$xml = <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="de_DE">
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Waage" unit="lb" value="165" startDate="2026-09-20 07:10:00 +0200" endDate="2026-09-20 07:10:00 +0200"/>
 <Record type="HKQuantityTypeIdentifierLeanBodyMass" sourceName="Waage" unit="lb" value="120" startDate="2026-09-20 07:10:00 +0200" endDate="2026-09-20 07:10:00 +0200"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Waage" unit="kg" value="70.4" startDate="2026-09-22 00:20:00 +0200" endDate="2026-09-22 00:20:00 +0200"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Uhr" unit="ms" value="48.6" startDate="2026-09-21 06:00:00 +0200" endDate="2026-09-21 06:01:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Uhr" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-20 23:00:00 +0200" endDate="2026-09-21 03:00:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Uhr" value="HKCategoryValueSleepAnalysisAsleepREM" startDate="2026-09-21 03:00:00 +0200" endDate="2026-09-21 06:30:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Schlaf-App" value="HKCategoryValueSleepAnalysisAsleepUnspecified" startDate="2026-09-20 23:05:00 +0200" endDate="2026-09-21 06:25:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Uhr" value="HKCategoryValueSleepAnalysisInBed" startDate="2026-09-20 22:30:00 +0200" endDate="2026-09-21 06:45:00 +0200"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="50" durationUnit="min" totalDistance="10" totalDistanceUnit="km" totalEnergyBurned="2500" totalEnergyBurnedUnit="kJ" startDate="2026-09-21 18:00:00 +0200" endDate="2026-09-21 18:50:00 +0200"/>
</HealthData>
XML;
$file = tempnam(sys_get_temp_dir(), 'hxtest_');
file_put_contents($file, $xml);

// Server time zone deliberately far away: the date must still be the day of the measurement.
date_default_timezone_set('America/Los_Angeles');
$r = hx_parse_file($file);
$rDe = hx_parse_file($file, 'de');
@unlink($file);
$byDate = [];
foreach ($r['health'] as $h) $byDate[$h['date']] = $h;

check('Gewicht in lb -> kg (165 lb ≈ 74,8 kg)', abs(($byDate['2026-09-20']['weight'] ?? 0) - 74.84) < 0.05, $byDate['2026-09-20']['weight'] ?? null);
check('Lean Body Mass -> leanMass in kg (120 lb ≈ 54,4 kg)', abs(($byDate['2026-09-20']['leanMass'] ?? 0) - 54.43) < 0.05 && !isset($byDate['2026-09-20']['muscleMass']), $byDate['2026-09-20'] ?? null);
check('Messung 00:20 Uhr Ortszeit bleibt am 22.09.', ($byDate['2026-09-22']['weight'] ?? null) === 70.4, array_keys($byDate));
check('HRV (SDNN) mit Messart', ($byDate['2026-09-21']['hrv'] ?? null) === 49 && ($byDate['2026-09-21']['hrvMethod'] ?? null) === 'sdnn', $byDate['2026-09-21'] ?? null);
// Watch: 4 h + 3.5 h = 7.5 h; sleep app: 7 h 20 min. Previously: sum of both ≈ 14.8 h.
check('Schlaf zweier Quellen nicht addiert (längste Quelle, 7,5 h)', ($byDate['2026-09-21']['sleepHours'] ?? null) === 7.5, $byDate['2026-09-21']['sleepHours'] ?? null);
check('„InBed" zählt nicht als Schlaf', ($byDate['2026-09-21']['sleepHours'] ?? 0) < 8.0, $byDate['2026-09-21']['sleepHours'] ?? null);
check('eine Schlafnacht gezählt', $r['sleepNights'] === 1, $r['sleepNights']);
$w = $r['workouts'][0] ?? [];
check('Lauf übernommen', ($w['distanceKm'] ?? null) === 10.0 && ($w['durationSec'] ?? null) === 3000, $w);
check('Workout-Energie in kJ -> kcal (2500 kJ ≈ 598 kcal)', ($w['kcal'] ?? null) === 598, $w['kcal'] ?? null);
check('Lauf-Datum aus der Ortszeit', ($w['date'] ?? null) === '2026-09-21', $w['date'] ?? null);
check('Titel in der Sprache der Person (ohne: englisch, de wie bisher)', ($w['title'] ?? null) === 'Run (Health import)'
    && ($rDe['workouts'][0]['title'] ?? null) === 'Lauf (Health-Import)', [$w['title'] ?? null, $rDe['workouts'][0]['title'] ?? null]);

// Impossible sleep (over 24 h from one source) is discarded.
$xml2 = <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Kaputt" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-19 20:00:00 +0200" endDate="2026-09-21 06:00:00 +0200"/>
</HealthData>
XML;
$file2 = tempnam(sys_get_temp_dir(), 'hxtest_');
file_put_contents($file2, $xml2);
$r2 = hx_parse_file($file2);
@unlink($file2);
check('Schlaf über 24 h verworfen', $r2['health'] === [] && $r2['sleepNights'] === 0, $r2);

// All sports that can be mapped (not only runs) and the cycle from the export.
$xml3 = <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
 <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="60" durationUnit="min" totalDistance="24" totalDistanceUnit="km" startDate="2026-09-12 10:00:00 +0200" endDate="2026-09-12 11:00:00 +0200"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeSwimming" duration="40" durationUnit="min" startDate="2026-09-13 07:00:00 +0200" endDate="2026-09-13 07:40:00 +0200"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeCurling" duration="30" durationUnit="min" startDate="2026-09-14 07:00:00 +0200" endDate="2026-09-14 07:30:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierMenstrualFlow" sourceName="Health" value="HKCategoryValueMenstrualFlowMedium" startDate="2026-09-01 08:00:00 +0200" endDate="2026-09-01 08:00:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierMenstrualFlow" sourceName="Health" value="HKCategoryValueMenstrualFlowLight" startDate="2026-09-02 08:00:00 +0200" endDate="2026-09-02 08:00:00 +0200"/>
 <Record type="HKCategoryTypeIdentifierMenstrualFlow" sourceName="Health" value="HKCategoryValueMenstrualFlowNone" startDate="2026-09-15 08:00:00 +0200" endDate="2026-09-15 08:00:00 +0200"/>
</HealthData>
XML;
$file3 = tempnam(sys_get_temp_dir(), 'hxtest_');
file_put_contents($file3, $xml3);
$r3 = hx_parse_file($file3);
@unlink($file3);
$types = array_column($r3['workouts'], 'type');
check('Radfahren und Schwimmen übernommen, Unbekanntes nicht', $types === ['cross_bike', 'swim'], $types);
check('Radfahrt mit Strecke und Dauer', ($r3['workouts'][0]['distanceKm'] ?? null) === 24.0 && ($r3['workouts'][0]['durationSec'] ?? null) === 3600, $r3['workouts'][0] ?? null);
check('Zyklus: Periode ab 1.9. (2 Tage), „keine Blutung“ zählt nicht', $r3['periods'] === [['start' => '2026-09-01', 'length' => 2]], $r3['periods']);

echo "\nhealth-xml: $pass ok, $fail fehlgeschlagen\n";
exit($fail ? 1 : 0);

<?php
/**
 * health-xml.php — PURE evaluation of an Apple Health export (export.xml) for the
 * full import. No upload, no $_FILES, no response – `health-import.php` includes
 * this, `tools/test-health-xml.php` tests it with small sample files.
 *
 * Since v3.20.0:
 *   - Units: weight and lean mass in lb or g are converted to kg,
 *     workout energy in kJ to kcal (previously 165 lb was taken over as "165 kg").
 *   - Sleep: summed per night and SOURCE, then the longest source is taken – a watch and a
 *     sleep app together otherwise gave double the sleep duration. More than 24 h: discarded.
 *   - Date: the calendar day from the date text itself (local time of the measurement), not the
 *     server's time zone – otherwise values shortly after midnight slid onto the previous day.
 *   - Lean Body Mass → `leanMass` (lean mass), HRV with measurement method `sdnn`.
 */
declare(strict_types=1);

/** Calendar day (YYYY-MM-DD) from an Apple date ("2026-09-21 00:30:00 +0200"). */
function hx_date(?string $s): ?string
{
    if (!$s) return null;
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $s, $m)) return "{$m[1]}-{$m[2]}-{$m[3]}";
    $t = strtotime($s);
    return $t === false ? null : date('Y-m-d', $t);
}

/** Apple date -> Unix timestamp (for durations) or null. */
function hx_ts(?string $s): ?int
{
    if (!$s) return null;
    $t = strtotime($s);
    return $t === false ? null : $t;
}

/** Mass in kg (Apple units "kg", "lb", "g"). */
function hx_kg($value, string $unit): ?float
{
    if (!is_numeric($value)) return null;
    $v = (float) $value;
    $u = strtolower(trim($unit));
    if (str_contains($u, 'lb')) $v *= 0.453592;
    elseif ($u === 'g') $v /= 1000;
    return round($v, 2);
}

/** Energy in kcal (Apple units "kcal", "Cal", "kJ"). */
function hx_kcal($value, string $unit): ?int
{
    if (!is_numeric($value)) return null;
    $v = (float) $value;
    if (str_contains(strtolower($unit), 'kj')) $v /= 4.184;
    return (int) round($v);
}

require_once __DIR__ . '/health-map.php';

/** Training type from HKWorkoutActivityType – the same mapping as the automatic
    intake (running → easy, cycling → cross_bike …); null = cannot be adopted. */
function hx_workout_type(string $activity): ?string
{
    return hi_wtype(hi_norm_activity($activity));
}

/** Records a health daily value (last value per day wins, in file order). */
function hx_set(array &$store, ?string $date, string $field, $value): void
{
    if ($date === null || $value === null || $value === '') return;
    if (!isset($store[$date])) $store[$date] = ['date' => $date];
    $store[$date][$field] = is_string($value) ? $value : $value + 0;
}

/**
 * Evaluates an export.xml; $lang is the language of the training titles.
 * @return array{workouts: array, health: array, sleepNights: int}
 * @throws RuntimeException if the file cannot be opened
 */
function hx_parse_file(string $xmlPath, string $lang = SERVER_SOURCE_LANGUAGE): array
{
    $reader = new XMLReader();
    if (!@$reader->open($xmlPath, null, LIBXML_NONET)) {
        throw new RuntimeException('export.xml could not be opened.');
    }

    $workouts = [];
    $healthByDate = [];
    $sleep = [];          // day of waking => [source => seconds]
    $flowDays = [];       // days with bleeding (cycle)

    while (@$reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;

        if ($reader->name === 'Record') {
            $type  = (string) $reader->getAttribute('type');
            $value = $reader->getAttribute('value');
            $unit  = (string) $reader->getAttribute('unit');
            $startStr = $reader->getAttribute('startDate');
            $day = hx_date($startStr);

            switch ($type) {
                case 'HKQuantityTypeIdentifierBodyMass':
                    hx_set($healthByDate, $day, 'weight', hx_kg($value, $unit));
                    break;
                case 'HKQuantityTypeIdentifierBodyFatPercentage':
                    // Apple stores the share as 0..1 -> convert to percent.
                    if (is_numeric($value)) {
                        $bf = (float) $value;
                        hx_set($healthByDate, $day, 'bodyFat', round($bf <= 1 ? $bf * 100 : $bf, 1));
                    }
                    break;
                case 'HKQuantityTypeIdentifierLeanBodyMass':
                    hx_set($healthByDate, $day, 'leanMass', hx_kg($value, $unit));
                    break;
                case 'HKQuantityTypeIdentifierRestingHeartRate':
                    hx_set($healthByDate, $day, 'restingHr', is_numeric($value) ? (int) round((float) $value) : null);
                    break;
                case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN':
                    if (is_numeric($value)) {
                        hx_set($healthByDate, $day, 'hrv', (int) round((float) $value));
                        hx_set($healthByDate, $day, 'hrvMethod', 'sdnn');
                    }
                    break;
                case 'HKQuantityTypeIdentifierVO2Max':
                    hx_set($healthByDate, $day, 'vo2max', is_numeric($value) ? round((float) $value, 1) : null);
                    break;
                case 'HKCategoryTypeIdentifierSleepAnalysis':
                    // Only "Asleep" phases count (not "InBed"), kept separate per source.
                    $endStr = $reader->getAttribute('endDate');
                    $start = hx_ts($startStr);
                    $end = hx_ts($endStr);
                    if ($start !== null && $end !== null && $end > $start && stripos((string) $value, 'Asleep') !== false) {
                        $night = hx_date($endStr);   // assign to the day of waking
                        $src = (string) $reader->getAttribute('sourceName');
                        $sleep[$night][$src] = ($sleep[$night][$src] ?? 0) + ($end - $start);
                    }
                    break;
                case 'HKCategoryTypeIdentifierMenstrualFlow':
                    if ($day !== null && hi_is_flow($value)) $flowDays[] = $day;
                    break;
            }
            continue;
        }

        if ($reader->name === 'Workout') {
            $activity = (string) $reader->getAttribute('workoutActivityType');
            $wtype = hx_workout_type($activity);
            if ($wtype === null) continue;   // sport without a counterpart in the app

            $startStr = $reader->getAttribute('startDate');
            $start = hx_ts($startStr);
            $durRaw = $reader->getAttribute('duration');           // mostly minutes
            $durUnit = (string) $reader->getAttribute('durationUnit');
            $distRaw = $reader->getAttribute('totalDistance');
            $distUnit = (string) $reader->getAttribute('totalDistanceUnit');
            $energy = $reader->getAttribute('totalEnergyBurned');
            $energyUnit = (string) $reader->getAttribute('totalEnergyBurnedUnit');

            // Read the workout subtree as a fragment (workouts are rare -> fine),
            // to capture heart-rate statistics (newer exports).
            $avgHr = null;
            $maxHr = null;
            $frag = $reader->readOuterXml();
            if ($frag) {
                $prev = libxml_use_internal_errors(true);
                $sx = simplexml_load_string($frag, 'SimpleXMLElement', LIBXML_NONET);
                libxml_use_internal_errors($prev);
                if ($sx !== false) {
                    foreach ($sx->WorkoutStatistics as $st) {
                        if ((string) $st['type'] === 'HKQuantityTypeIdentifierHeartRate') {
                            $avgHr = isset($st['average']) ? (int) round((float) $st['average']) : $avgHr;
                            $maxHr = isset($st['maximum']) ? (int) round((float) $st['maximum']) : $maxHr;
                        }
                        if ((string) $st['type'] === 'HKQuantityTypeIdentifierActiveEnergyBurned' && $energy === null) {
                            $energy = isset($st['sum']) ? (string) $st['sum'] : null;
                            $energyUnit = isset($st['unit']) ? (string) $st['unit'] : $energyUnit;
                        }
                    }
                }
            }

            $distKm = null;
            if (is_numeric($distRaw)) {
                $d = (float) $distRaw;
                $distKm = (stripos($distUnit, 'mi') !== false) ? round($d * 1.60934, 3) : round($d, 3);
            }
            $durSec = null;
            if (is_numeric($durRaw)) {
                $dv = (float) $durRaw;
                $durSec = (stripos($durUnit, 'min') !== false) ? (int) round($dv * 60) : (int) round($dv);
            }
            $paceSec = ($distKm && $durSec && $distKm > 0) ? (int) round($durSec / $distKm) : null;

            if ($start !== null) {
                $workouts[] = [
                    'startTs'     => $start,
                    'date'        => hx_date($startStr),
                    'isoStart'    => date('c', $start),
                    'type'        => $wtype,          // runs as "easy" – when matching, the planned type applies
                    'title'       => hi_title($wtype, 'healthImport', $lang),
                    'distanceKm'  => $distKm,
                    'durationSec' => $durSec,
                    'paceSecPerKm'=> $paceSec,
                    'avgHr'       => $avgHr,
                    'maxHr'       => $maxHr,
                    'kcal'        => hx_kcal($energy, $energyUnit),
                    'source'      => 'health',
                ];
            }
            continue;
        }
    }
    $reader->close();

    // Sleep: per night the longest SINGLE source (a watch and a sleep app measure the same night).
    $nights = 0;
    foreach ($sleep as $date => $bySource) {
        $sec = max($bySource);
        if ($sec <= 0 || $sec > 24 * 3600) continue;   // more than 24 h of sleep is impossible
        if (!isset($healthByDate[$date])) $healthByDate[$date] = ['date' => $date];
        $healthByDate[$date]['sleepHours'] = round($sec / 3600, 1);
        $nights++;
    }

    $health = array_values($healthByDate);
    usort($health, fn ($a, $b) => strcmp($a['date'], $b['date']));
    usort($workouts, fn ($a, $b) => $a['startTs'] <=> $b['startTs']);
    return ['workouts' => $workouts, 'health' => $health, 'sleepNights' => $nights, 'periods' => hi_periods($flowDays)];
}

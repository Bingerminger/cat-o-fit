<?php
/**
 * health-xml.php — REINE Auswertung eines Apple-Health-Exports (export.xml) für den
 * Voll-Import. Kein Upload, kein $_FILES, keine Antwort – `health-import.php` bindet
 * dies ein, `tools/test-health-xml.php` testet es mit kleinen Beispieldateien.
 *
 * Seit v3.20.0:
 *   - Einheiten: Gewicht und fettfreie Masse in lb oder g werden in kg umgerechnet,
 *     Workout-Energie in kJ in kcal (früher wurden 165 lb als „165 kg" übernommen).
 *   - Schlaf: je Nacht und QUELLE summiert, dann die längste Quelle genommen – Uhr und
 *     Schlaf-App zusammen ergaben sonst die doppelte Schlafdauer. Mehr als 24 h: verworfen.
 *   - Datum: der Kalendertag aus dem Datumstext selbst (Ortszeit der Messung), nicht die
 *     Zeitzone des Servers – sonst rutschten Werte kurz nach Mitternacht auf den Vortag.
 *   - Lean Body Mass → `leanMass` (fettfreie Masse), HRV mit Messart `sdnn`.
 */
declare(strict_types=1);

/** Kalendertag (YYYY-MM-DD) aus einem Apple-Datum („2026-09-21 00:30:00 +0200"). */
function hx_date(?string $s): ?string
{
    if (!$s) return null;
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $s, $m)) return "{$m[1]}-{$m[2]}-{$m[3]}";
    $t = strtotime($s);
    return $t === false ? null : date('Y-m-d', $t);
}

/** Apple-Datum -> Unix-Zeitstempel (für Dauern) oder null. */
function hx_ts(?string $s): ?int
{
    if (!$s) return null;
    $t = strtotime($s);
    return $t === false ? null : $t;
}

/** Masse in kg (Apple-Einheiten „kg", „lb", „g"). */
function hx_kg($value, string $unit): ?float
{
    if (!is_numeric($value)) return null;
    $v = (float) $value;
    $u = strtolower(trim($unit));
    if (str_contains($u, 'lb')) $v *= 0.453592;
    elseif ($u === 'g') $v /= 1000;
    return round($v, 2);
}

/** Energie in kcal (Apple-Einheiten „kcal", „Cal", „kJ"). */
function hx_kcal($value, string $unit): ?int
{
    if (!is_numeric($value)) return null;
    $v = (float) $value;
    if (str_contains(strtolower($unit), 'kj')) $v /= 4.184;
    return (int) round($v);
}

require_once __DIR__ . '/health-map.php';

/** Trainings-Typ aus HKWorkoutActivityType – dieselbe Zuordnung wie beim automatischen
    Eingang (Laufen → easy, Radfahren → cross_bike …); null = nicht übernehmbar. */
function hx_workout_type(string $activity): ?string
{
    return hi_wtype(hi_norm_activity($activity));
}

/** Trägt einen Health-Tageswert ein (letzter Wert pro Tag gewinnt, in Dateireihenfolge). */
function hx_set(array &$store, ?string $date, string $field, $value): void
{
    if ($date === null || $value === null || $value === '') return;
    if (!isset($store[$date])) $store[$date] = ['date' => $date];
    $store[$date][$field] = is_string($value) ? $value : $value + 0;
}

/**
 * Wertet eine export.xml aus.
 * @return array{workouts: array, health: array, sleepNights: int}
 * @throws RuntimeException wenn die Datei nicht geöffnet werden kann
 */
function hx_parse_file(string $xmlPath): array
{
    $reader = new XMLReader();
    if (!@$reader->open($xmlPath, null, LIBXML_NONET)) {
        throw new RuntimeException('export.xml konnte nicht geöffnet werden.');
    }

    $workouts = [];
    $healthByDate = [];
    $sleep = [];          // Aufwachtag => [Quelle => Sekunden]
    $flowDays = [];       // Tage mit Blutung (Zyklus)

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
                    // Apple speichert den Anteil als 0..1 -> in Prozent umrechnen.
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
                    // Nur "Asleep"-Phasen zählen (nicht "InBed"), je Quelle getrennt.
                    $endStr = $reader->getAttribute('endDate');
                    $start = hx_ts($startStr);
                    $end = hx_ts($endStr);
                    if ($start !== null && $end !== null && $end > $start && stripos((string) $value, 'Asleep') !== false) {
                        $night = hx_date($endStr);   // dem Aufwachtag zuordnen
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
            if ($wtype === null) continue;   // Sportart ohne Gegenstück in der App

            $startStr = $reader->getAttribute('startDate');
            $start = hx_ts($startStr);
            $durRaw = $reader->getAttribute('duration');           // meist Minuten
            $durUnit = (string) $reader->getAttribute('durationUnit');
            $distRaw = $reader->getAttribute('totalDistance');
            $distUnit = (string) $reader->getAttribute('totalDistanceUnit');
            $energy = $reader->getAttribute('totalEnergyBurned');
            $energyUnit = (string) $reader->getAttribute('totalEnergyBurnedUnit');

            // Workout-Teilbaum als Fragment lesen (Workouts sind selten -> ok),
            // um Herzfrequenz-Statistiken (neuere Exports) zu erfassen.
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
                    'type'        => $wtype,          // Läufe als „easy“ – beim Zuordnen gilt der geplante Typ
                    'title'       => preg_replace('/\(Apple Health\)$/', '(Health-Import)', hi_title($wtype)),
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

    // Schlaf: je Nacht die längste EINZELNE Quelle (Uhr und Schlaf-App messen dieselbe Nacht).
    $nights = 0;
    foreach ($sleep as $date => $bySource) {
        $sec = max($bySource);
        if ($sec <= 0 || $sec > 24 * 3600) continue;   // mehr als 24 h Schlaf ist unmöglich
        if (!isset($healthByDate[$date])) $healthByDate[$date] = ['date' => $date];
        $healthByDate[$date]['sleepHours'] = round($sec / 3600, 1);
        $nights++;
    }

    $health = array_values($healthByDate);
    usort($health, fn ($a, $b) => strcmp($a['date'], $b['date']));
    usort($workouts, fn ($a, $b) => $a['startTs'] <=> $b['startTs']);
    return ['workouts' => $workouts, 'health' => $health, 'sleepNights' => $nights, 'periods' => hi_periods($flowDays)];
}

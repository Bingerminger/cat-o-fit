<?php
/**
 * health-import.php — Import eines Apple-Health-Exports.
 *
 * Eingebunden von api.php bei POST ?action=health-import.
 *
 * Ablauf:
 *   1. Datei-Upload entgegennehmen (export.xml ODER das Health-Export-ZIP).
 *   2. Bei ZIP: export.xml herausstreamen (ZipArchive, falls verfügbar).
 *   3. export.xml mit XMLReader streamen (NICHT SimpleXML – die Datei kann
 *      hunderte MB groß sein).
 *   4. Relevante Daten extrahieren:
 *        - Lauf-Workouts            -> Kandidaten für durchgeführte Sessions
 *        - Gewicht/Körperfett/...   -> Kandidaten für den Health-Log (pro Tag)
 *        - Schlafanalyse            -> Schlafstunden pro Nacht (aggregiert)
 *   5. Normalisierte Kandidaten als JSON zurückgeben. Das De-Duplizieren gegen
 *      den lokalen Bestand und das Übernehmen passiert "local-first" im Client
 *      (health-import.js), damit der LocalStorage die führende Quelle bleibt.
 *
 * Die Funktion respond() stammt aus api.php (bereits geladen).
 */

declare(strict_types=1);

@set_time_limit(0);

if (!class_exists('XMLReader')) {
    respond(['ok' => false, 'error' => 'Auf dem Server fehlt die XMLReader-Erweiterung.'], 500);
}

// ---------------------------------------------------------------------------
// 1) Upload ermitteln.
// ---------------------------------------------------------------------------
if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
    respond(['ok' => false, 'error' => 'Keine Datei empfangen (erwartet Feld "file").'], 400);
}

$uploadTmp  = $_FILES['file']['tmp_name'];
$uploadName = (string) ($_FILES['file']['name'] ?? 'upload');
$xmlPath    = $uploadTmp;
$cleanup    = [];

// ---------------------------------------------------------------------------
// 2) ZIP-Erkennung und Entpacken von export.xml.
// ---------------------------------------------------------------------------
$isZip = preg_match('/\.zip$/i', $uploadName) === 1;
if (!$isZip) {
    // Magic Bytes prüfen ("PK\x03\x04").
    $fh = fopen($uploadTmp, 'rb');
    if ($fh) {
        $sig = fread($fh, 4);
        fclose($fh);
        if ($sig === "PK\x03\x04") {
            $isZip = true;
        }
    }
}

if ($isZip) {
    if (!class_exists('ZipArchive')) {
        respond([
            'ok' => false,
            'error' => 'ZIP-Upload erkannt, aber ZipArchive ist auf dem Server nicht verfügbar. '
                     . 'Bitte das ZIP lokal entpacken und nur die Datei export.xml hochladen.',
        ], 500);
    }
    $zip = new ZipArchive();
    if ($zip->open($uploadTmp) !== true) {
        respond(['ok' => false, 'error' => 'ZIP konnte nicht geöffnet werden.'], 400);
    }
    // export.xml im Archiv finden (liegt meist unter apple_health_export/export.xml).
    $entry = null;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name !== false && preg_match('#(^|/)export\.xml$#i', $name)) {
            $entry = $name;
            break;
        }
    }
    if ($entry === null) {
        $zip->close();
        respond(['ok' => false, 'error' => 'Im ZIP wurde keine export.xml gefunden.'], 400);
    }
    $extracted = tempnam(sys_get_temp_dir(), 'hx_');
    $cleanup[] = $extracted;
    $stream = $zip->getStream($entry);
    if ($stream === false) {
        $zip->close();
        respond(['ok' => false, 'error' => 'export.xml konnte nicht gelesen werden.'], 500);
    }
    $out = fopen($extracted, 'wb');
    stream_copy_to_stream($stream, $out);
    fclose($out);
    fclose($stream);
    $zip->close();
    $xmlPath = $extracted;
}

// ---------------------------------------------------------------------------
// 3) Hilfsfunktionen.
// ---------------------------------------------------------------------------

/** Apple-Datum ("2026-06-25 18:45:00 +0200") -> Unix-Timestamp oder null. */
function apple_ts(?string $s): ?int
{
    if (!$s) {
        return null;
    }
    $t = strtotime($s);
    return $t === false ? null : $t;
}

/** Trainings-Typ aus HKWorkoutActivityType ableiten (nur Laufrelevantes genau). */
function map_workout_type(string $activity): string
{
    return match ($activity) {
        'HKWorkoutActivityTypeRunning'  => 'run',
        'HKWorkoutActivityTypeCycling'  => 'cross_bike',
        'HKWorkoutActivityTypeSoccer'   => 'cross_football',
        'HKWorkoutActivityTypeWalking'  => 'walk',
        default                         => 'other',
    };
}

// ---------------------------------------------------------------------------
// 4) Streaming-Parsing.
// ---------------------------------------------------------------------------
$reader = new XMLReader();
if (!@$reader->open($xmlPath)) {
    foreach ($cleanup as $f) { @unlink($f); }
    respond(['ok' => false, 'error' => 'export.xml konnte nicht geöffnet werden.'], 500);
}

$workouts = [];            // durchgeführte Lauf-Einheiten
$healthByDate = [];        // date => [feld => wert] (Tagesaggregat)
$sleepByNight = [];        // date(Aufwachtag) => Sekunden Schlaf

/** Trägt einen Health-Tageswert ein (letzter Wert pro Tag gewinnt). */
function set_health(array &$store, ?int $ts, string $field, $value): void
{
    if ($ts === null || $value === null || $value === '') {
        return;
    }
    $date = date('Y-m-d', $ts);
    if (!isset($store[$date])) {
        $store[$date] = ['date' => $date];
    }
    // Letzter (zeitlich) Wert je Feld: hier genügt Überschreiben in Dateireihenfolge.
    $store[$date][$field] = $value + 0;
}

while (@$reader->read()) {
    if ($reader->nodeType !== XMLReader::ELEMENT) {
        continue;
    }

    if ($reader->name === 'Record') {
        $type  = (string) $reader->getAttribute('type');
        $value = $reader->getAttribute('value');
        $start = apple_ts($reader->getAttribute('startDate'));

        switch ($type) {
            case 'HKQuantityTypeIdentifierBodyMass':
                set_health($healthByDate, $start, 'weight', $value);
                break;
            case 'HKQuantityTypeIdentifierBodyFatPercentage':
                // Apple speichert den Anteil als 0..1 -> in Prozent umrechnen.
                if (is_numeric($value)) {
                    $bf = (float) $value;
                    set_health($healthByDate, $start, 'bodyFat', round($bf <= 1 ? $bf * 100 : $bf, 1));
                }
                break;
            case 'HKQuantityTypeIdentifierLeanBodyMass':
                set_health($healthByDate, $start, 'muscleMass', $value);
                break;
            case 'HKQuantityTypeIdentifierRestingHeartRate':
                set_health($healthByDate, $start, 'restingHr', is_numeric($value) ? (int) round((float) $value) : null);
                break;
            case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN':
                set_health($healthByDate, $start, 'hrv', is_numeric($value) ? (int) round((float) $value) : null);
                break;
            case 'HKQuantityTypeIdentifierVO2Max':
                set_health($healthByDate, $start, 'vo2max', is_numeric($value) ? round((float) $value, 1) : null);
                break;
            case 'HKCategoryTypeIdentifierSleepAnalysis':
                // Nur "Asleep"-Phasen zählen (nicht "InBed").
                $end = apple_ts($reader->getAttribute('endDate'));
                if ($start !== null && $end !== null && $end > $start && stripos((string) $value, 'Asleep') !== false) {
                    $night = date('Y-m-d', $end);   // dem Aufwachtag zuordnen
                    $sleepByNight[$night] = ($sleepByNight[$night] ?? 0) + ($end - $start);
                }
                break;
        }
        continue;
    }

    if ($reader->name === 'Workout') {
        $activity = (string) $reader->getAttribute('workoutActivityType');
        $mapped = map_workout_type($activity);
        if ($mapped !== 'run') {
            // Nur Laufeinheiten als Sessions übernehmen (Rest: Cross-Training optional).
            // Den Teilbaum überspringen.
            continue;
        }

        $start = apple_ts($reader->getAttribute('startDate'));
        $durRaw = $reader->getAttribute('duration');           // meist Minuten
        $durUnit = (string) $reader->getAttribute('durationUnit');
        $distRaw = $reader->getAttribute('totalDistance');
        $distUnit = (string) $reader->getAttribute('totalDistanceUnit');
        $energy = $reader->getAttribute('totalEnergyBurned');

        // Workout-Teilbaum als Fragment lesen (Workouts sind selten -> ok),
        // um Herzfrequenz-Statistiken (neuere Exports) zu erfassen.
        $avgHr = null;
        $maxHr = null;
        $frag = $reader->readOuterXml();
        if ($frag) {
            $prev = libxml_use_internal_errors(true);
            $sx = simplexml_load_string($frag);
            libxml_use_internal_errors($prev);
            if ($sx !== false) {
                foreach ($sx->WorkoutStatistics as $st) {
                    if ((string) $st['type'] === 'HKQuantityTypeIdentifierHeartRate') {
                        $avgHr = isset($st['average']) ? (int) round((float) $st['average']) : $avgHr;
                        $maxHr = isset($st['maximum']) ? (int) round((float) $st['maximum']) : $maxHr;
                    }
                    if ((string) $st['type'] === 'HKQuantityTypeIdentifierActiveEnergyBurned' && $energy === null) {
                        $energy = isset($st['sum']) ? (string) $st['sum'] : null;
                    }
                }
                // Ältere Exports: HR in MetadataEntry.
                foreach ($sx->MetadataEntry as $me) {
                    $k = (string) $me['key'];
                    if ($k === 'HKAverageMETs') { /* ignorieren */ }
                }
            }
        }

        // Distanz in km normalisieren.
        $distKm = null;
        if (is_numeric($distRaw)) {
            $d = (float) $distRaw;
            $distKm = (stripos($distUnit, 'mi') !== false) ? round($d * 1.60934, 3) : round($d, 3);
        }
        // Dauer in Sekunden normalisieren.
        $durSec = null;
        if (is_numeric($durRaw)) {
            $dv = (float) $durRaw;
            $durSec = (stripos($durUnit, 'min') !== false) ? (int) round($dv * 60) : (int) round($dv);
        }
        $paceSec = ($distKm && $durSec && $distKm > 0) ? (int) round($durSec / $distKm) : null;

        if ($start !== null) {
            $workouts[] = [
                'startTs'     => $start,
                'date'        => date('Y-m-d', $start),
                'isoStart'    => date('c', $start),
                'type'        => 'easy',          // konkreter Lauftyp wird beim Matching verfeinert
                'title'       => 'Lauf (Health-Import)',
                'distanceKm'  => $distKm,
                'durationSec' => $durSec,
                'paceSecPerKm'=> $paceSec,
                'avgHr'       => $avgHr,
                'maxHr'       => $maxHr,
                'kcal'        => is_numeric($energy) ? (int) round((float) $energy) : null,
                'source'      => 'health',
            ];
        }
        continue;
    }
}
$reader->close();
foreach ($cleanup as $f) { @unlink($f); }

// ---------------------------------------------------------------------------
// 5) Schlaf in die Tageswerte einmischen und Health-Liste bauen.
// ---------------------------------------------------------------------------
foreach ($sleepByNight as $date => $sec) {
    if (!isset($healthByDate[$date])) {
        $healthByDate[$date] = ['date' => $date];
    }
    $healthByDate[$date]['sleepHours'] = round($sec / 3600, 1);
}

$health = array_values($healthByDate);
usort($health, fn ($a, $b) => strcmp($a['date'], $b['date']));
usort($workouts, fn ($a, $b) => $a['startTs'] <=> $b['startTs']);

respond([
    'ok' => true,
    'summary' => [
        'workouts'    => count($workouts),
        'healthDays'  => count($health),
        'sleepNights' => count($sleepByNight),
    ],
    'workouts' => $workouts,
    'health'   => $health,
]);

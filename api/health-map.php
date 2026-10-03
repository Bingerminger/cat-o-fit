<?php
/**
 * health-map.php — REINE Mapping-Logik für den Apple-Health-Ingest.
 *
 * Enthält nur seiteneffektfreie Funktionen (keine DB, kein $_GET, kein Netz),
 * damit sie automatisiert testbar sind (siehe tools/test-health-ingest.php).
 * `health-ingest.php` bindet dies ein und ergänzt Auth + Merge/Dedup + Schreiben.
 *
 * Datenformat: help.healthyapps.dev (export-format), **JSON v2** empfohlen:
 *   - Metrik-Namen snake_case (Gewicht „weight_&_body_mass"); Datenpunkte „qty",
 *     Herzfrequenz „Min/Avg/Max".
 *   - Schlaf in STUNDEN (totalSleep/asleep …); Workout-`duration` in SEKUNDEN.
 *   - Distanz/Energie/HF sind Objekte { qty, units } (Distanz mi oder km);
 *     Energie heißt in v2 `activeEnergyBurned`, in v1 `activeEnergy` (beide gemappt).
 */
declare(strict_types=1);

/** Datum (YYYY-MM-DD) aus einem Auto-Export-Datumsstring – TZ-sicher über den Datums-Teil. */
function hi_date($s): ?string {
    $s = (string) $s;
    if (preg_match('/(\d{4})-(\d{2})-(\d{2})/', $s, $m)) return "{$m[1]}-{$m[2]}-{$m[3]}";
    $ts = strtotime($s);
    return $ts ? date('Y-m-d', $ts) : null;
}
/** Ersten vorhandenen Zahlenwert aus mehreren möglichen Feldern lesen (auch { qty }-Objekte). */
function hi_num($p, array $keys) {
    if (!is_array($p)) return is_numeric($p) ? (float) $p : null;
    foreach ($keys as $k) {
        if (!isset($p[$k])) continue;
        $v = $p[$k];
        if (is_array($v) && isset($v['qty']) && is_numeric($v['qty'])) return (float) $v['qty'];
        if (is_numeric($v)) return (float) $v;
    }
    return null;
}
/** Einheit eines möglichen { qty, units }-Feldes oder eines <feld>Units-Feldes. */
function hi_units($w, string $field): string {
    if (is_array($w[$field] ?? null) && isset($w[$field]['units'])) return strtolower((string) $w[$field]['units']);
    return strtolower((string) ($w[$field . 'Units'] ?? ''));
}
/** Metrik-Name -> [Zielfeld, Typ]. Erst exakt, dann heuristisch (robust gegen App-Versionen). */
function hi_map_metric(string $name): ?array {
    static $EXACT = [
        'weight_body_mass' => ['weight', 'kg'], 'weight_&_body_mass' => ['weight', 'kg'], 'body_mass' => ['weight', 'kg'],
        'body_fat_percentage' => ['bodyFat', 'pct'], 'lean_body_mass' => ['leanMass', 'kg'],
        'resting_heart_rate' => ['restingHr', 'int'], 'heart_rate_variability' => ['hrv', 'int'],
        'vo2_max' => ['vo2max', 'vo2'], 'active_energy' => ['activeEnergyKcal', 'int'], 'step_count' => ['steps', 'int'],
    ];
    if (isset($EXACT[$name])) return $EXACT[$name];
    $h = fn (string $n): bool => str_contains($name, $n);
    if ($h('vo2')) return ['vo2max', 'vo2'];
    if ($h('variability') || $h('hrv')) return ['hrv', 'int'];
    if ($h('resting') && $h('heart')) return ['restingHr', 'int'];
    if ($h('body_fat')) return ['bodyFat', 'pct'];
    if ($h('lean_body')) return ['leanMass', 'kg'];                 // fettfreie Masse – vor body_mass prüfen
    if ($h('body_mass') || $name === 'weight' || $h('weight_')) return ['weight', 'kg'];
    if ($h('step')) return ['steps', 'int'];
    if ($h('active_energy')) return ['activeEnergyKcal', 'int'];
    return null;
}
/** Wert je nach Typ normalisieren (Einheiten: kg aus lb; Körperfett 0..1 -> %). */
function hi_apply(string $tag, float $v, string $units) {
    if ($tag === 'kg' && str_contains($units, 'lb')) $v = $v * 0.453592;
    return match ($tag) {
        'int' => (int) round($v),
        'pct' => round($v <= 1 ? $v * 100 : $v, 1),
        'vo2' => round($v, 1),
        default => round($v, 2),
    };
}
/** Aktivität normalisieren („Trail Running" -> „trail_running", HealthKit- und Health-Connect-
    Präfixe weg: „HKWorkoutActivityTypeRunning", „EXERCISE_TYPE_RUNNING" -> „running"). */
function hi_norm_activity($s): string {
    return preg_replace('/^(hkworkoutactivitytype|exercise_type_)/', '', preg_replace('/[\s\-]+/', '_', strtolower(trim((string) $s))));
}
/** Energie in kcal – Health Auto Export rechnet kJ nicht um (2100 kJ kamen als „2100 kcal“ an). */
function hi_kcal(?float $v, string $units): ?float {
    if ($v === null) return null;
    return str_contains($units, 'kj') ? $v / 4.184 : $v;
}
/** Apple/HealthKit-Aktivität -> App-Session-Typ (exakt, dann heuristisch). */
function hi_wtype(string $act): ?string {
    static $MAP = [
        'running' => 'easy', 'trail_running' => 'easy', 'treadmill_running' => 'easy',
        'walking' => 'walk', 'hiking' => 'hike',
        'cycling' => 'cross_bike', 'indoor_cycling' => 'cross_bike',
        'swimming' => 'swim', 'traditional_strength_training' => 'strength',
        'functional_strength_training' => 'strength', 'core_training' => 'strength',
        'rowing' => 'rowing', 'tennis' => 'tennis', 'table_tennis' => 'tabletennis',
        'soccer' => 'cross_football', 'yoga' => 'mobility',
    ];
    if (isset($MAP[$act])) return $MAP[$act];
    $h = fn (string $n): bool => str_contains($act, $n);
    if ($h('run')) return 'easy';
    if ($h('cycl') || $h('bik')) return 'cross_bike';
    if ($h('swim')) return 'swim';
    if ($h('strength') || $h('functional')) return 'strength';
    if ($h('walk')) return 'walk';
    if ($h('hik')) return 'hike';
    if ($h('row')) return 'rowing';
    if ($h('yoga') || $h('flex') || $h('mobility') || $h('recovery')) return 'mobility';
    if ($h('tennis')) return 'tennis';
    return null;
}
function hi_title(string $type): string {
    static $L = ['easy' => 'Lauf', 'walk' => 'Gehen', 'hike' => 'Wandern', 'cross_bike' => 'Radtour',
        'swim' => 'Schwimmen', 'strength' => 'Kraft', 'rowing' => 'Rudern', 'tennis' => 'Tennis',
        'tabletennis' => 'Tischtennis', 'cross_football' => 'Fußball', 'mobility' => 'Mobility'];
    return ($L[$type] ?? 'Training') . ' (Apple Health)';
}
/** Herzfrequenz aus dem v1-`heartRateData`-Array ableiten (Fallback, wenn avg/max fehlen). */
function hi_hr_from_series(array $w): array {
    $hrd = $w['heartRateData'] ?? null;
    if (!is_array($hrd) || !$hrd) return [null, null];
    $avgs = []; $maxes = [];
    foreach ($hrd as $pt) {
        $a = hi_num($pt, ['Avg', 'avg', 'qty']); if ($a !== null) $avgs[] = $a;
        $m = hi_num($pt, ['Max', 'max', 'qty']); if ($m !== null) $maxes[] = $m;
    }
    return [$avgs ? array_sum($avgs) / count($avgs) : null, $maxes ? max($maxes) : null];
}

/* -------------------------------------------------------------------------
 * Schlankes Tagesformat für eine Kurzbefehl-Vorlage (kostenloser Weg, ohne Dritt-App):
 *   { "date": "2026-09-29", "weight": 72.4, "restingHr": 52, "hrv": 48, "sleepHours": 7.3 }
 * oder mehrere Tage als { "days": [ {…}, {…} ] }. Zahlen dürfen als Text mit Komma kommen
 * („72,4“ – so gibt die Kurzbefehle-App sie auf Deutsch aus). Unplausible Werte werden
 * verworfen und als Warnung gemeldet, unbekannte Felder ignoriert.
 * ------------------------------------------------------------------------- */
const HI_SIMPLE_FIELDS = [
    // Feld => [Typ, min, max]
    'weight' => ['kg', 20, 400], 'bodyFat' => ['pct', 1, 80], 'leanMass' => ['kg', 10, 200],
    'restingHr' => ['int', 25, 150], 'hrv' => ['int', 1, 400], 'vo2max' => ['vo2', 10, 100],
    'sleepHours' => ['sleep', 0.1, 24], 'steps' => ['int', 0, 200000], 'activeEnergyKcal' => ['int', 0, 20000],
];

/** Ist das ein Tages-Objekt (bzw. eine Liste davon) statt eines Health-Auto-Export-Pakets? */
function hi_is_simple(array $data): bool {
    if (isset($data['metrics'])) return false;
    return isset($data['date']) || (isset($data['days']) && is_array($data['days']));
}

/** Zahl aus Zahl oder Text („72,4“, „7.3 h“). */
function hi_simple_num($v): ?float {
    if (is_int($v) || is_float($v)) return (float) $v;
    if (!is_string($v)) return null;
    if (!preg_match('/-?\d+(?:[.,]\d+)?/', $v, $m)) return null;
    return (float) str_replace(',', '.', $m[0]);
}

function hi_parse_simple(array $data): array {
    $days = isset($data['days']) && is_array($data['days']) ? $data['days'] : [$data];
    $healthByDate = [];
    $warnings = [];
    $ignored = [];
    foreach ($days as $day) {
        if (!is_array($day)) continue;
        $date = hi_date($day['date'] ?? '');
        if ($date === null) { if (count($warnings) < 8) $warnings[] = 'Tag ohne gültiges Datum übersprungen'; continue; }
        foreach ($day as $key => $raw) {
            if ($key === 'date' || $key === 'hrvMethod' || $key === 'weightUnit') continue;
            if (!isset(HI_SIMPLE_FIELDS[$key])) {
                if (count($ignored) < 40 && !in_array($key, $ignored, true)) $ignored[] = (string) $key;
                continue;
            }
            [$tag, $min, $max] = HI_SIMPLE_FIELDS[$key];
            $v = hi_simple_num($raw);
            if ($v === null) continue;
            if ($key === 'weight' && strtolower((string) ($day['weightUnit'] ?? '')) === 'lb') $v *= 0.453592;
            if ($key === 'bodyFat' && $v > 0 && $v <= 1) $v *= 100;            // 0,185 → 18,5 %
            if ($v < $min || $v > $max) {
                if (count($warnings) < 8) $warnings[] = "{$key} am {$date} unplausibel ({$v}) – verworfen";
                continue;
            }
            $healthByDate[$date][$key] = match ($tag) {
                'int' => (int) round($v),
                'pct', 'vo2', 'sleep' => round($v, 1),
                default => round($v, 2),
            };
        }
        if (isset($healthByDate[$date]['hrv'])) {
            $method = strtolower((string) ($day['hrvMethod'] ?? 'sdnn'));
            $healthByDate[$date]['hrvMethod'] = $method === 'rmssd' ? 'rmssd' : 'sdnn';   // Apple Health speichert SDNN
        }
    }
    // Trainings dürfen im selben Paket mitkommen (Felder wie bei Health Auto Export:
    // name, start, end oder duration in Sekunden, distance in km, avgHeartRate …).
    $w = is_array($data['workouts'] ?? null) ? hi_parse(['workouts' => $data['workouts']]) : null;
    return [
        'healthByDate'        => $healthByDate,
        'newSessions'         => $w ? $w['newSessions'] : [],
        'periods'             => [],
        'ignoredMetrics'      => $ignored,
        'skippedUnmappedType' => $w ? $w['skippedUnmappedType'] : 0,
        'warnings'            => $w ? array_slice(array_merge($warnings, $w['warnings']), 0, 8) : $warnings,
        'received'            => ['days' => count($days)] + ($w ? ['workouts' => $w['received']['workouts']] : []),
    ];
}

/* -------------------------------------------------------------------------
 * Perioden aus Blutungstagen (Zyklus aus Apple Health bzw. Health Connect):
 * aufeinanderfolgende Tage – ein fehlender Tag dazwischen zählt mit – bilden eine Periode.
 * Rückgabe [['start' => 'YYYY-MM-DD', 'length' => Tage], …], älteste zuerst.
 * ------------------------------------------------------------------------- */
function hi_periods(array $dates): array {
    $dates = array_values(array_unique(array_filter($dates, fn ($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d))));
    sort($dates);
    $out = [];
    foreach ($dates as $d) {
        $n = count($out);
        if ($n) {
            $last = $out[$n - 1];
            $end = date('Y-m-d', strtotime($last['start'] . ' +' . ($last['length'] - 1) . ' days'));
            $gap = (int) round((strtotime($d) - strtotime($end)) / 86400);
            if ($gap <= 2) { $out[$n - 1]['length'] = min(14, $last['length'] + $gap); continue; }
        }
        $out[] = ['start' => $d, 'length' => 1];
    }
    return $out;
}
/** Blutung laut Apple/HealthKit-Wert? („none“ bzw. 5 heißt: keine). */
function hi_is_flow($v): bool {
    if ($v === null || $v === '' || $v === false) return false;
    $s = strtolower(trim((string) $v));
    return !in_array($s, ['none', 'keine', '5', '0', 'hkcategoryvaluemenstrualflownone'], true);
}

/* -------------------------------------------------------------------------
 * Android: Health Connect über eine Brücken-App (z. B. „HC Webhook“, quelloffen). Sie
 * schickt je Datentyp ein Array mit ISO-Zeitstempeln in UTC, etwa
 *   { "app_version": "…", "weight": [{ "kilograms": 72.3, "time": "2026-09-29T05:10:00Z" }],
 *     "resting_heart_rate": [{ "bpm": 52, "time": … }], "heart_rate_variability": [{ "rmssd_millis": 48, "time": … }],
 *     "sleep": [{ "session_end_time": …, "duration_seconds": 26100, "stages": [ … ] }],
 *     "exercise": [{ "type": "RUNNING", "start_time": …, "end_time": …, "duration_seconds": 3300, "distance_meters": 9200 }],
 *     "heart_rate": [{ "bpm": 142, "time": … }], "steps": [{ "count": 5400, "start_time": …, "end_time": … }] }
 * Tageswerte gehören zum Kalendertag in der Zeitzone der Instanz; die Ø-HF eines Trainings
 * kommt aus den Herzfrequenz-Werten in seinem Zeitfenster. Health Connect misst HRV als RMSSD.
 * ------------------------------------------------------------------------- */
const HI_HCW_KEYS = ['exercise', 'weight', 'body_fat', 'lean_body_mass', 'resting_heart_rate', 'heart_rate_variability',
    'sleep', 'steps', 'active_calories', 'vo2_max', 'heart_rate', 'menstruation_period', 'menstruation_flow'];

function hi_is_hcw(array $data): bool {
    if (isset($data['metrics']) || isset($data['workouts']) || isset($data['date']) || isset($data['days'])) return false;
    if (isset($data['app_version'])) return true;
    foreach (HI_HCW_KEYS as $k) if (is_array($data[$k] ?? null)) return true;
    return false;
}

/** ISO-Zeitpunkt → Unix-Zeit (null bei Unsinn). */
function hi_ts($s): ?int {
    if (!is_string($s) || $s === '') return null;
    $t = strtotime($s);
    return $t === false ? null : $t;
}
/** Unix-Zeit → Kalendertag in der Zeitzone der Instanz. */
function hi_day(int $ts, string $tz): string {
    return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone($tz))->format('Y-m-d');
}

function hi_parse_hcw(array $data, string $tz = 'Europe/Berlin'): array {
    // Nur bekannte Zonen – eine unbekannte ließe DateTimeZone mitten im Import scheitern.
    if (!in_array($tz, timezone_identifiers_list(), true)) $tz = 'Europe/Berlin';
    $list =fn (string $k) => array_values(array_filter(is_array($data[$k] ?? null) ? $data[$k] : [], 'is_array'));
    $health = [];      // date => [feld => wert]
    $at = [];          // date => [feld => Zeitpunkt des Wertes] (jüngster gewinnt)
    $warnings = [];
    $put = function (string $date, string $field, $v, int $ts) use (&$health, &$at) {
        if (isset($at[$date][$field]) && $at[$date][$field] > $ts) return;
        $health[$date][$field] = $v;
        $at[$date][$field] = $ts;
    };
    // Einzelwerte je Tag (jüngster Wert zählt), mit Plausibilitätsgrenzen wie im Tagesformat.
    $single = [
        ['weight', ['kilograms', 'weight', 'value'], 'weight', 20, 400, 2],
        ['body_fat', ['percentage', 'percent', 'value'], 'bodyFat', 1, 80, 1],
        ['lean_body_mass', ['kilograms', 'value'], 'leanMass', 10, 200, 2],
        ['resting_heart_rate', ['bpm', 'beats_per_minute', 'value'], 'restingHr', 25, 150, 0],
        ['vo2_max', ['vo2_milliliters_per_minute_kilogram', 'vo2_ml_per_kg_min', 'vo2max', 'value'], 'vo2max', 10, 100, 1],
    ];
    foreach ($single as [$key, $fields, $target, $min, $max, $dec]) {
        foreach ($list($key) as $r) {
            $ts = hi_ts($r['time'] ?? ($r['start_time'] ?? null));
            $v = hi_num($r, $fields);
            if ($ts === null || $v === null) continue;
            if ($v < $min || $v > $max) { if (count($warnings) < 8) $warnings[] = "{$target} unplausibel ({$v}) – verworfen"; continue; }
            $put(hi_day($ts, $tz), $target, $dec ? round($v, $dec) : (int) round($v), $ts);
        }
    }
    // HRV: Tagesmittel der RMSSD-Werte.
    $hrv = [];
    foreach ($list('heart_rate_variability') as $r) {
        $ts = hi_ts($r['time'] ?? null);
        $v = hi_num($r, ['rmssd_millis', 'avg', 'value']);
        if ($ts === null || $v === null || $v < 1 || $v > 400) continue;
        $hrv[hi_day($ts, $tz)][] = $v;
    }
    foreach ($hrv as $date => $vals) {
        $health[$date]['hrv'] = (int) round(array_sum($vals) / count($vals));
        $health[$date]['hrvMethod'] = 'rmssd';
    }
    // Summen je Tag: Schritte, aktive Energie.
    foreach ([['steps', ['count', 'value'], 'steps', 200000], ['active_calories', ['calories', 'kilocalories', 'value'], 'activeEnergyKcal', 20000]] as [$key, $fields, $target, $max]) {
        $sum = [];
        foreach ($list($key) as $r) {
            $ts = hi_ts($r['start_time'] ?? ($r['time'] ?? null));
            $v = hi_num($r, $fields);
            if ($ts === null || $v === null || $v < 0) continue;
            $d = hi_day($ts, $tz);
            $sum[$d] = ($sum[$d] ?? 0) + $v;
        }
        foreach ($sum as $d => $v) if ($v <= $max) $health[$d][$target] = (int) round($v);
    }
    // Schlaf: Stunden der Nacht am Tag des Aufwachens – Wach- und Außer-Bett-Phasen zählen nicht.
    $sleep = [];
    foreach ($list('sleep') as $r) {
        $end = hi_ts($r['session_end_time'] ?? ($r['end_time'] ?? null));
        if ($end === null) continue;
        $sec = null;
        if (is_array($r['stages'] ?? null) && $r['stages']) {
            $sec = 0;
            foreach ($r['stages'] as $st) {
                if (!is_array($st)) continue;
                $name = strtolower((string) ($st['stage'] ?? ''));
                if (str_contains($name, 'awake') || str_contains($name, 'out_of_bed') || str_contains($name, 'wach')) continue;
                $sec += (int) (hi_num($st, ['duration_seconds']) ?? 0);
            }
        }
        if (!$sec) $sec = (int) (hi_num($r, ['duration_seconds', 'duration']) ?? 0);
        if ($sec > 0) { $d = hi_day($end, $tz); $sleep[$d] = ($sleep[$d] ?? 0) + $sec; }
    }
    foreach ($sleep as $d => $sec) { $h = $sec / 3600; if ($h > 0 && $h <= 24) $health[$d]['sleepHours'] = round($h, 1); }

    // Trainings, Ø-/Max-HF aus den Herzfrequenz-Werten im Zeitfenster.
    $hr = [];
    foreach ($list('heart_rate') as $r) {
        $ts = hi_ts($r['time'] ?? null);
        $avg = hi_num($r, ['bpm', 'avg']);
        if ($ts !== null && $avg !== null && $avg >= 30 && $avg <= 240) $hr[] = [$ts, $avg, hi_num($r, ['max']) ?? $avg];
    }
    $sessions = [];
    $skipped = 0;
    foreach ($list('exercise') as $e) {
        $act = hi_norm_activity($e['type'] ?? ($e['exercise_type'] ?? ''));
        $type = hi_wtype($act);
        $start = hi_ts($e['start_time'] ?? null);
        $end = hi_ts($e['end_time'] ?? null);
        if ($type === null || $start === null) { $skipped++; if ($type === null && count($warnings) < 8) $warnings[] = "Trainingsart nicht zugeordnet: {$act}"; continue; }
        $dur = hi_num($e, ['duration_seconds', 'duration']);
        $durSec = $dur !== null ? (int) round($dur) : (($end !== null && $end > $start) ? $end - $start : null);
        $m = hi_num($e, ['distance_meters']);
        $km = $m !== null && $m > 0 ? round($m / 1000, 3) : null;
        $in = array_filter($hr, fn ($p) => $p[0] >= $start && $p[0] <= ($end ?? $start + (int) $durSec));
        $avgHr = $in ? (int) round(array_sum(array_column($in, 1)) / count($in)) : null;
        $maxHr = $in ? (int) round(max(array_column($in, 2))) : null;
        $date = hi_day($start, $tz);
        $meta = is_array($e['metadata'] ?? null) ? (string) ($e['metadata']['id'] ?? '') : '';
        $id = 'hc-' . ($meta !== '' ? preg_replace('/[^A-Za-z0-9_-]/', '', $meta) : ($date . '-' . $type . '-' . $start));
        $sessions[$id] = [
            'id' => $id, 'plannedId' => null, 'eventId' => null, 'date' => $date,
            'type' => $type, 'title' => preg_replace('/\(Apple Health\)$/', '(Health Connect)', hi_title($type)),
            'distanceKm' => $km, 'durationSec' => $durSec,
            'paceSecPerKm' => ($km && $durSec) ? (int) round($durSec / $km) : null,
            'avgHr' => $avgHr, 'maxHr' => $maxHr, 'kcal' => null,
            'splits' => [], 'source' => 'health-connect',
        ];
    }

    // Zyklus: Periodenzeiträume, sonst einzelne Blutungstage.
    $flowDays = [];
    foreach ($list('menstruation_period') as $r) {
        $a = hi_ts($r['start_time'] ?? null); $b = hi_ts($r['end_time'] ?? null);
        if ($a === null) continue;
        $b = ($b !== null && $b >= $a) ? min($b, $a + 13 * 86400) : $a;
        for ($t = $a; $t <= $b; $t += 86400) $flowDays[] = hi_day($t, $tz);
    }
    foreach ($list('menstruation_flow') as $r) {
        $ts = hi_ts($r['time'] ?? null);
        if ($ts !== null && hi_is_flow($r['flow'] ?? 1)) $flowDays[] = hi_day($ts, $tz);
    }

    $received = [];
    foreach (HI_HCW_KEYS as $k) if ($list($k)) $received[$k] = count($list($k));
    return [
        'healthByDate'        => $health,
        'newSessions'         => $sessions,
        'periods'             => hi_periods($flowDays),
        'ignoredMetrics'      => [],
        'skippedUnmappedType' => $skipped,
        'warnings'            => $warnings,
        'received'            => $received,
        'source'              => 'health-connect',
    ];
}

/**
 * REINE Umwandlung eines Auto-Export-`data`-Objekts in Tageswerte + Workouts.
 * Kein DB-Zugriff. Rückgabe:
 *   healthByDate: [ 'YYYY-MM-DD' => [feld=>wert] ]  (inkl. Schlaf-Plausibilitätsgrenze)
 *   newSessions:  [ 'hk-…' => record ]              (vor Dedup gegen bestehende Daten)
 *   ignoredMetrics, skippedUnmappedType, warnings, received
 */
function hi_parse(array $data): array {
    $metrics  = is_array($data['metrics']  ?? null) ? $data['metrics']  : [];
    $workouts = is_array($data['workouts'] ?? null) ? $data['workouts'] : [];

    $healthByDate = [];
    $sleepAgg = [];    // date => Stunden (aggregiert)
    $sleepSum = [];    // date => Stunden (Summe der Segmente, falls nicht aggregiert)
    $ignoredMetrics = [];
    $flowDays = [];    // Tage mit Blutung (Zyklus, privat)

    foreach ($metrics as $metric) {
        if (!is_array($metric)) continue;
        $name   = strtolower(trim((string) ($metric['name'] ?? '')));
        $units  = strtolower((string) ($metric['units'] ?? ''));
        $points = is_array($metric['data'] ?? null) ? $metric['data'] : [];

        if (str_contains($name, 'menstrua')) {
            foreach ($points as $p) {
                if (!is_array($p)) continue;
                $date = hi_date($p['date'] ?? '');
                if ($date !== null && hi_is_flow($p['value'] ?? ($p['qty'] ?? 1))) $flowDays[] = $date;
            }
            continue;
        }

        if (str_contains($name, 'sleep')) {
            foreach ($points as $p) {
                if (!is_array($p)) continue;
                $date = hi_date($p['date'] ?? ($p['sleepEnd'] ?? ''));
                if ($date === null) continue;
                // Aggregiert (Stunden): totalSleep bevorzugt, sonst asleep – nur PLAUSIBLE Werte
                // (0 < h ≤ 24). So verfälscht ein Müllwert wie „36" nicht den Schlaf-Trend.
                $ts = hi_num($p, ['totalSleep']);
                $as = hi_num($p, ['asleep']);
                $cand = ($ts !== null && $ts > 0 && $ts <= 24) ? $ts
                      : (($as !== null && $as > 0 && $as <= 24) ? $as : null);
                if ($cand !== null) $sleepAgg[$date] = max($sleepAgg[$date] ?? 0.0, $cand);
                else { $q = hi_num($p, ['qty', 'value']); if ($q !== null && $q > 0) $sleepSum[$date] = ($sleepSum[$date] ?? 0.0) + $q; }
            }
            continue;
        }

        $m = hi_map_metric($name);
        if ($m === null) {
            if ($name !== '' && count($ignoredMetrics) < 40 && !in_array($name, $ignoredMetrics, true)) $ignoredMetrics[] = $name;
            continue;
        }
        [$field, $tag] = $m;
        foreach ($points as $p) {
            if (!is_array($p)) continue;
            $date = hi_date($p['date'] ?? '');
            $v = hi_num($p, ['qty', 'Avg', 'avg', 'value', 'quantity']);
            if ($date === null || $v === null) continue;
            if ($field === 'activeEnergyKcal') $v = hi_kcal($v, $units);
            $healthByDate[$date][$field] = hi_apply($tag, $v, $units);
            // Apple speichert HRV als SDNN – viele Uhren zeigen RMSSD; die Messart gehört zum Wert.
            if ($field === 'hrv') $healthByDate[$date]['hrvMethod'] = 'sdnn';
        }
    }
    foreach (array_keys($sleepAgg + $sleepSum) as $date) {
        $hrs = $sleepAgg[$date] ?? $sleepSum[$date] ?? null;
        // Plausibilitätsgrenze: mehr als 24 h Schlaf/Tag ist unmöglich -> verwerfen (kaputte Quelle).
        if ($hrs !== null && $hrs > 0 && $hrs <= 24) $healthByDate[$date]['sleepHours'] = round($hrs, 1);
    }

    $newSessions = [];
    $skippedWorkouts = 0;
    $warnings = [];
    foreach ($workouts as $w) {
        if (!is_array($w)) continue;
        $act  = hi_norm_activity($w['name'] ?? ($w['type'] ?? ($w['activityType'] ?? ($w['workoutActivityType'] ?? ''))));
        $type = hi_wtype($act);
        if ($type === null) { $skippedWorkouts++; if (count($warnings) < 8) $warnings[] = "Workout-Typ nicht zugeordnet: {$act}"; continue; }

        $startStr = (string) ($w['start'] ?? ($w['startDate'] ?? ''));
        $endStr   = (string) ($w['end'] ?? ($w['endDate'] ?? ''));
        $date = hi_date($startStr);
        if ($date === null) { $skippedWorkouts++; continue; }

        // Dauer: primär aus start/end, sonst „duration" (laut Doku SEKUNDEN).
        $tsA = strtotime($startStr); $tsB = strtotime($endStr);
        $durSec = ($tsA && $tsB && $tsB > $tsA) ? ($tsB - $tsA) : null;
        if ($durSec === null) { $d = hi_num($w, ['duration', 'activeDuration']); if ($d !== null) $durSec = (int) round($d); }

        // Distanz (Objekt { qty, units }; mi -> km) + Pace.
        $distKm = hi_num($w, ['distance', 'totalDistance', 'distanceKm']);
        if ($distKm !== null && str_contains(hi_units($w, 'distance'), 'mi')) $distKm = $distKm * 1.60934;
        if ($distKm !== null) $distKm = round($distKm, 3);
        $paceSec = ($distKm && $durSec && $distKm > 0) ? (int) round($durSec / $distKm) : null;

        // HF: v2-Objekte avgHeartRate/maxHeartRate, sonst Fallback aus v1-heartRateData.
        $avgHr = hi_num($w, ['avgHeartRate', 'averageHeartRate']);
        $maxHr = hi_num($w, ['maxHeartRate']);
        if ($avgHr === null || $maxHr === null) {
            [$fa, $fm] = hi_hr_from_series($w);
            $avgHr ??= $fa; $maxHr ??= $fm;
        }
        $kcal  = hi_num($w, ['activeEnergyBurned', 'activeEnergy', 'totalEnergy']);
        $kcalUnits = hi_units($w, isset($w['activeEnergyBurned']) ? 'activeEnergyBurned' : (isset($w['activeEnergy']) ? 'activeEnergy' : 'totalEnergy'));
        $kcal  = hi_kcal($kcal, $kcalUnits);

        $uuid = (string) ($w['id'] ?? ($w['uuid'] ?? ''));
        $id = 'hk-' . ($uuid !== '' ? $uuid : ($date . '-' . $type . '-' . (int) $tsA));
        $newSessions[$id] = [
            'id' => $id, 'plannedId' => null, 'eventId' => null, 'date' => $date,
            'type' => $type, 'title' => hi_title($type),
            'distanceKm' => $distKm, 'durationSec' => $durSec, 'paceSecPerKm' => $paceSec,
            'avgHr' => $avgHr !== null ? (int) round($avgHr) : null,
            'maxHr' => $maxHr !== null ? (int) round($maxHr) : null,
            'kcal'  => $kcal  !== null ? (int) round($kcal)  : null,
            'splits' => [], 'source' => 'apple-health',
        ];
    }

    return [
        'healthByDate'        => $healthByDate,
        'newSessions'         => $newSessions,
        'ignoredMetrics'      => $ignoredMetrics,
        'skippedUnmappedType' => $skippedWorkouts,
        'warnings'            => $warnings,
        'periods'             => hi_periods($flowDays),
        'received'            => ['metrics' => count($metrics), 'workouts' => count($workouts)],
    ];
}

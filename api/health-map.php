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
        'body_fat_percentage' => ['bodyFat', 'pct'], 'lean_body_mass' => ['muscleMass', 'kg'],
        'resting_heart_rate' => ['restingHr', 'int'], 'heart_rate_variability' => ['hrv', 'int'],
        'vo2_max' => ['vo2max', 'vo2'], 'active_energy' => ['activeEnergyKcal', 'int'], 'step_count' => ['steps', 'int'],
    ];
    if (isset($EXACT[$name])) return $EXACT[$name];
    $h = fn (string $n): bool => str_contains($name, $n);
    if ($h('vo2')) return ['vo2max', 'vo2'];
    if ($h('variability') || $h('hrv')) return ['hrv', 'int'];
    if ($h('resting') && $h('heart')) return ['restingHr', 'int'];
    if ($h('body_fat')) return ['bodyFat', 'pct'];
    if ($h('lean_body')) return ['muscleMass', 'kg'];               // vor body_mass prüfen
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
/** Apple/HealthKit-Aktivität normalisieren („Trail Running" -> „trail_running"). */
function hi_norm_activity($s): string {
    return preg_replace('/^hkworkoutactivitytype/', '', preg_replace('/[\s\-]+/', '_', strtolower(trim((string) $s))));
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

    foreach ($metrics as $metric) {
        if (!is_array($metric)) continue;
        $name   = strtolower(trim((string) ($metric['name'] ?? '')));
        $units  = strtolower((string) ($metric['units'] ?? ''));
        $points = is_array($metric['data'] ?? null) ? $metric['data'] : [];

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
            $healthByDate[$date][$field] = hi_apply($tag, $v, $units);
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
        'received'            => ['metrics' => count($metrics), 'workouts' => count($workouts)],
    ];
}

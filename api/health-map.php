<?php
/**
 * health-map.php — PURE mapping logic for the Apple Health ingest.
 *
 * Contains only side-effect-free functions (no DB, no $_GET, no network),
 * so that they can be tested automatically (see tools/test-health-ingest.php).
 * `health-ingest.php` includes this and adds auth + merge/dedup + writing.
 *
 * Data format: help.healthyapps.dev (export format), **JSON v2** recommended:
 *   - Metric names in snake_case (weight "weight_&_body_mass"); data points "qty",
 *     heart rate "Min/Avg/Max".
 *   - Sleep in HOURS (totalSleep/asleep …); workout `duration` in SECONDS.
 *   - Distance/energy/HR are objects { qty, units } (distance mi or km);
 *     energy is called `activeEnergyBurned` in v2, `activeEnergy` in v1 (both mapped).
 *
 * Titles of imported sessions come in the language passed as $lang (locales/<lang>/server.json).
 */
declare(strict_types=1);

require_once __DIR__ . '/i18n.php';

/** Date (YYYY-MM-DD) from an auto-export date string – TZ-safe via the date part. */
function hi_date($s): ?string {
    $s = (string) $s;
    if (preg_match('/(\d{4})-(\d{2})-(\d{2})/', $s, $m)) return "{$m[1]}-{$m[2]}-{$m[3]}";
    $ts = strtotime($s);
    return $ts ? date('Y-m-d', $ts) : null;
}
/** Read the first available numeric value from several possible fields (also { qty } objects). */
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
/** Unit of a possible { qty, units } field or of a <field>Units field. */
function hi_units($w, string $field): string {
    if (is_array($w[$field] ?? null) && isset($w[$field]['units'])) return strtolower((string) $w[$field]['units']);
    return strtolower((string) ($w[$field . 'Units'] ?? ''));
}
/** Metric name -> [target field, type]. Exact first, then heuristic (robust against app versions). */
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
    if ($h('lean_body')) return ['leanMass', 'kg'];                 // lean mass – check before body_mass
    if ($h('body_mass') || $name === 'weight' || $h('weight_')) return ['weight', 'kg'];
    if ($h('step')) return ['steps', 'int'];
    if ($h('active_energy')) return ['activeEnergyKcal', 'int'];
    return null;
}
/** Normalise a value by type (units: kg from lb; body fat 0..1 -> %). */
function hi_apply(string $tag, float $v, string $units) {
    if ($tag === 'kg' && str_contains($units, 'lb')) $v = $v * 0.453592;
    return match ($tag) {
        'int' => (int) round($v),
        'pct' => round($v <= 1 ? $v * 100 : $v, 1),
        'vo2' => round($v, 1),
        default => round($v, 2),
    };
}
/** Normalise an activity ("Trail Running" -> "trail_running", strip HealthKit and Health Connect
    prefixes: "HKWorkoutActivityTypeRunning", "EXERCISE_TYPE_RUNNING" -> "running"). */
function hi_norm_activity($s): string {
    return preg_replace('/^(hkworkoutactivitytype|exercise_type_)/', '', preg_replace('/[\s\-]+/', '_', strtolower(trim((string) $s))));
}
/** Energy in kcal – Health Auto Export does not convert kJ (2100 kJ arrived as "2100 kcal"). */
function hi_kcal(?float $v, string $units): ?float {
    if ($v === null) return null;
    return str_contains($units, 'kj') ? $v / 4.184 : $v;
}
/** Apple/HealthKit activity -> app session type (exact, then heuristic). */
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
/** Title of an imported session, e.g. "Run (Apple Health)"; $source: appleHealth, healthConnect, healthImport. */
function hi_title(string $type, string $source = 'appleHealth', string $lang = SERVER_SOURCE_LANGUAGE): string {
    return server_text($lang, 'import.title', [
        'type' => server_lookup($lang, "import.type.{$type}") ?? server_text($lang, 'import.type.other'),
        'source' => server_text($lang, "import.source.{$source}"),
    ]);
}
/** Derive heart rate from the v1 `heartRateData` array (fallback when avg/max are missing). */
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
 * Lean daily format for a Shortcuts template (free route, without a third-party app):
 *   { "date": "2026-09-29", "weight": 72.4, "restingHr": 52, "hrv": 48, "sleepHours": 7.3 }
 * or several days as { "days": [ {…}, {…} ] }. Numbers may arrive as text with a comma
 * ("72,4" – this is how the Shortcuts app outputs them in German). Implausible values are
 * discarded and reported as a warning, unknown fields ignored.
 * ------------------------------------------------------------------------- */
const HI_SIMPLE_FIELDS = [
    // Field => [type, min, max]
    'weight' => ['kg', 20, 400], 'bodyFat' => ['pct', 1, 80], 'leanMass' => ['kg', 10, 200],
    'restingHr' => ['int', 25, 150], 'hrv' => ['int', 1, 400], 'vo2max' => ['vo2', 10, 100],
    'sleepHours' => ['sleep', 0.1, 24], 'steps' => ['int', 0, 200000], 'activeEnergyKcal' => ['int', 0, 20000],
];

/** Is this a day object (or a list of them) rather than a Health Auto Export payload? */
function hi_is_simple(array $data): bool {
    if (isset($data['metrics'])) return false;
    return isset($data['date']) || (isset($data['days']) && is_array($data['days']));
}

/** Number from a number or text ("72,4", "7.3 h"). */
function hi_simple_num($v): ?float {
    if (is_int($v) || is_float($v)) return (float) $v;
    if (!is_string($v)) return null;
    if (!preg_match('/-?\d+(?:[.,]\d+)?/', $v, $m)) return null;
    return (float) str_replace(',', '.', $m[0]);
}

function hi_parse_simple(array $data, string $lang = SERVER_SOURCE_LANGUAGE): array {
    $days = isset($data['days']) && is_array($data['days']) ? $data['days'] : [$data];
    $healthByDate = [];
    $warnings = [];
    $ignored = [];
    foreach ($days as $day) {
        if (!is_array($day)) continue;
        $date = hi_date($day['date'] ?? '');
        if ($date === null) { if (count($warnings) < 8) $warnings[] = 'Day without a valid date skipped'; continue; }
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
            if ($key === 'bodyFat' && $v > 0 && $v <= 1) $v *= 100;            // 0.185 → 18.5 %
            if ($v < $min || $v > $max) {
                if (count($warnings) < 8) $warnings[] = "{$key} on {$date} implausible ({$v}) – discarded";
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
            $healthByDate[$date]['hrvMethod'] = $method === 'rmssd' ? 'rmssd' : 'sdnn';   // Apple Health stores SDNN
        }
    }
    // Workouts may come in the same payload (fields as with Health Auto Export:
    // name, start, end or duration in seconds, distance in km, avgHeartRate …).
    $w = is_array($data['workouts'] ?? null) ? hi_parse(['workouts' => $data['workouts']], $lang) : null;
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
 * Periods from bleeding days (cycle from Apple Health or Health Connect):
 * consecutive days – one missing day in between still counts – form a period.
 * Returns [['start' => 'YYYY-MM-DD', 'length' => days], …], oldest first.
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
/** Bleeding according to the Apple/HealthKit value? ("none" or 5 means: none). */
function hi_is_flow($v): bool {
    if ($v === null || $v === '' || $v === false) return false;
    $s = strtolower(trim((string) $v));
    return !in_array($s, ['none', 'keine', '5', '0', 'hkcategoryvaluemenstrualflownone'], true);
}

/* -------------------------------------------------------------------------
 * Android: Health Connect via a bridge app (e.g. "HC Webhook", open source). It
 * sends one array per data type with ISO timestamps in UTC, for example
 *   { "app_version": "…", "weight": [{ "kilograms": 72.3, "time": "2026-09-29T05:10:00Z" }],
 *     "resting_heart_rate": [{ "bpm": 52, "time": … }], "heart_rate_variability": [{ "rmssd_millis": 48, "time": … }],
 *     "sleep": [{ "session_end_time": …, "duration_seconds": 26100, "stages": [ … ] }],
 *     "exercise": [{ "type": "RUNNING", "start_time": …, "end_time": …, "duration_seconds": 3300, "distance_meters": 9200 }],
 *     "heart_rate": [{ "bpm": 142, "time": … }], "steps": [{ "count": 5400, "start_time": …, "end_time": … }] }
 * Daily values belong to the calendar day in the instance's time zone; the avg HR of a workout
 * comes from the heart-rate values in its time window. Health Connect measures HRV as RMSSD.
 * ------------------------------------------------------------------------- */
const HI_HCW_KEYS = ['exercise', 'weight', 'body_fat', 'lean_body_mass', 'resting_heart_rate', 'heart_rate_variability',
    'sleep', 'steps', 'active_calories', 'vo2_max', 'heart_rate', 'menstruation_period', 'menstruation_flow'];

function hi_is_hcw(array $data): bool {
    if (isset($data['metrics']) || isset($data['workouts']) || isset($data['date']) || isset($data['days'])) return false;
    if (isset($data['app_version'])) return true;
    foreach (HI_HCW_KEYS as $k) if (is_array($data[$k] ?? null)) return true;
    return false;
}

/** ISO timestamp → Unix time (null for nonsense). */
function hi_ts($s): ?int {
    if (!is_string($s) || $s === '') return null;
    $t = strtotime($s);
    return $t === false ? null : $t;
}
/** Unix time → calendar day in the instance's time zone. */
function hi_day(int $ts, string $tz): string {
    return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone($tz))->format('Y-m-d');
}

function hi_parse_hcw(array $data, string $tz = 'Europe/Berlin', string $lang = SERVER_SOURCE_LANGUAGE): array {
    // Known zones only – an unknown one would make DateTimeZone fail in the middle of the import.
    if (!in_array($tz, timezone_identifiers_list(), true)) $tz = 'Europe/Berlin';
    $list =fn (string $k) => array_values(array_filter(is_array($data[$k] ?? null) ? $data[$k] : [], 'is_array'));
    $health = [];      // date => [field => value]
    $at = [];          // date => [field => time of the value] (most recent wins)
    $warnings = [];
    $put = function (string $date, string $field, $v, int $ts) use (&$health, &$at) {
        if (isset($at[$date][$field]) && $at[$date][$field] > $ts) return;
        $health[$date][$field] = $v;
        $at[$date][$field] = $ts;
    };
    // Single values per day (most recent value counts), with plausibility limits as in the daily format.
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
            if ($v < $min || $v > $max) { if (count($warnings) < 8) $warnings[] = "{$target} implausible ({$v}) – discarded"; continue; }
            $put(hi_day($ts, $tz), $target, $dec ? round($v, $dec) : (int) round($v), $ts);
        }
    }
    // HRV: daily mean of the RMSSD values.
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
    // Sums per day: steps, active energy.
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
    // Sleep: hours of the night, attributed to the day of waking – awake and out-of-bed phases do not count.
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

    // Workouts, avg/max HR from the heart-rate values in the time window.
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
        if ($type === null || $start === null) { $skipped++; if ($type === null && count($warnings) < 8) $warnings[] = "Exercise type not mapped: {$act}"; continue; }
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
            'type' => $type, 'title' => hi_title($type, 'healthConnect', $lang),
            'distanceKm' => $km, 'durationSec' => $durSec,
            'paceSecPerKm' => ($km && $durSec) ? (int) round($durSec / $km) : null,
            'avgHr' => $avgHr, 'maxHr' => $maxHr, 'kcal' => null,
            'splits' => [], 'source' => 'health-connect',
        ];
    }

    // Cycle: period date ranges, otherwise single bleeding days.
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
 * PURE conversion of an auto-export `data` object into daily values + workouts.
 * No DB access. Returns:
 *   healthByDate: [ 'YYYY-MM-DD' => [field=>value] ]  (incl. sleep plausibility limit)
 *   newSessions:  [ 'hk-…' => record ]              (before dedup against existing data)
 *   ignoredMetrics, skippedUnmappedType, warnings, received
 */
function hi_parse(array $data, string $lang = SERVER_SOURCE_LANGUAGE): array {
    $metrics  = is_array($data['metrics']  ?? null) ? $data['metrics']  : [];
    $workouts = is_array($data['workouts'] ?? null) ? $data['workouts'] : [];

    $healthByDate = [];
    $sleepAgg = [];    // date => hours (aggregated)
    $sleepSum = [];    // date => hours (sum of the segments, if not aggregated)
    $ignoredMetrics = [];
    $flowDays = [];    // days with bleeding (cycle, private)

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
                // Aggregated (hours): totalSleep preferred, otherwise asleep – only PLAUSIBLE values
                // (0 < h ≤ 24). That way a junk value such as "36" does not distort the sleep trend.
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
            // Apple stores HRV as SDNN – many watches show RMSSD; the measurement method belongs to the value.
            if ($field === 'hrv') $healthByDate[$date]['hrvMethod'] = 'sdnn';
        }
    }
    foreach (array_keys($sleepAgg + $sleepSum) as $date) {
        $hrs = $sleepAgg[$date] ?? $sleepSum[$date] ?? null;
        // Plausibility limit: more than 24 h of sleep per day is impossible -> discard (broken source).
        if ($hrs !== null && $hrs > 0 && $hrs <= 24) $healthByDate[$date]['sleepHours'] = round($hrs, 1);
    }

    $newSessions = [];
    $skippedWorkouts = 0;
    $warnings = [];
    foreach ($workouts as $w) {
        if (!is_array($w)) continue;
        $act  = hi_norm_activity($w['name'] ?? ($w['type'] ?? ($w['activityType'] ?? ($w['workoutActivityType'] ?? ''))));
        $type = hi_wtype($act);
        if ($type === null) { $skippedWorkouts++; if (count($warnings) < 8) $warnings[] = "Workout type not mapped: {$act}"; continue; }

        $startStr = (string) ($w['start'] ?? ($w['startDate'] ?? ''));
        $endStr   = (string) ($w['end'] ?? ($w['endDate'] ?? ''));
        $date = hi_date($startStr);
        if ($date === null) { $skippedWorkouts++; continue; }

        // Duration: primarily from start/end, otherwise "duration" (SECONDS according to the docs).
        $tsA = strtotime($startStr); $tsB = strtotime($endStr);
        $durSec = ($tsA && $tsB && $tsB > $tsA) ? ($tsB - $tsA) : null;
        if ($durSec === null) { $d = hi_num($w, ['duration', 'activeDuration']); if ($d !== null) $durSec = (int) round($d); }

        // Distance (object { qty, units }; mi -> km) + pace.
        $distKm = hi_num($w, ['distance', 'totalDistance', 'distanceKm']);
        if ($distKm !== null && str_contains(hi_units($w, 'distance'), 'mi')) $distKm = $distKm * 1.60934;
        if ($distKm !== null) $distKm = round($distKm, 3);
        $paceSec = ($distKm && $durSec && $distKm > 0) ? (int) round($durSec / $distKm) : null;

        // HR: v2 objects avgHeartRate/maxHeartRate, otherwise fallback from the v1 heartRateData.
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
            'type' => $type, 'title' => hi_title($type, 'appleHealth', $lang),
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

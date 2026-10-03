/* =========================================================================
   sollist.js — Soll-Ist-Vergleich einer erledigten Einheit. Rein und testbar.

   - Lockere Einheiten (Easy, Regeneration, Long Run ohne Tempoblock) werden
     zweiseitig geprüft: Zu schnell ist KEIN „Ziel erreicht“ – gerade lockere Läufe
     wirken nur, wenn sie locker bleiben (80/20, Seiler 2010).
   - Strukturierte Einheiten (Intervalle, Tempo, Long Run mit Renntempo-Block)
     bekommen kein Pace- und kein HF-Urteil über den Gesamtschnitt: Der mittelt
     Ein-/Auslaufen und Trabpausen mit hinein und würde sauber gelaufene
     Intervalle als „Abweichung“ werten.
   - Wettkampf: einseitig – schneller ist gut.
   ========================================================================= */

const EASY_TYPES = ['easy', 'recovery', 'long', 'run'];

/** Hat die Einheit Belastungsabschnitte (Intervalle, Tempoblöcke, Renntempo-Block)? */
export function isStructured(unit) {
  if (!unit) return false;
  if (['tempo', 'interval'].includes(unit.type)) return true;
  if (unit.raceBlockKm) return true;
  const iv = unit.intervals;
  return !!(iv && ((Array.isArray(iv.segments) && iv.segments.length) || iv.rounds));
}

/**
 * Vergleicht Soll und Ist.
 * @returns {{rows:Array<{key,label,plan,real,ok,verdict?}>, hit:boolean|null, tooFast:boolean, structured:boolean, note:string|null}}
 */
export function compareToPlan(unit, ex, { hrZones = [] } = {}) {
  const rows = [];
  let note = null, tooFast = false;
  if (!unit || !ex) return { rows, hit: null, tooFast, structured: false, note };
  const structured = isStructured(unit);
  const easy = !structured && EASY_TYPES.includes(unit.type);

  if (unit.targetDistanceKm && ex.distanceKm != null) {
    rows.push({ key: 'distance', label: 'Distanz', plan: unit.targetDistanceKm, real: ex.distanceKm, ok: ex.distanceKm >= unit.targetDistanceKm * 0.97 });
  } else if (unit.targetDurationMin && ex.durationSec) {
    rows.push({ key: 'duration', label: 'Dauer', plan: unit.targetDurationMin * 60, real: ex.durationSec, ok: ex.durationSec >= unit.targetDurationMin * 60 * 0.9 });
  }

  if (unit.targetPaceSecPerKm && ex.paceSecPerKm) {
    const min = unit.targetPaceSecPerKm, max = unit.targetPaceMaxSecPerKm || min;
    if (structured) {
      note = 'Bei Intervallen und Tempoblöcken zählt das Tempo der Belastungsabschnitte. Der Schnitt über die ganze Einheit – mit Ein-/Auslaufen und Trabpausen – sagt darüber nichts, deshalb gibt es hier kein Pace-Urteil.';
    } else if (easy) {
      tooFast = ex.paceSecPerKm < min - 10;
      const tooSlow = ex.paceSecPerKm > max + 20;
      rows.push({ key: 'pace', label: 'Pace', plan: [min, max], real: ex.paceSecPerKm, ok: !tooFast && !tooSlow, verdict: tooFast ? 'zu schnell' : tooSlow ? 'langsamer als geplant' : 'im Zielbereich' });
      if (tooFast) note = 'Zu schnell für eine lockere Einheit. Lockere Läufe bringen am meisten, wenn sie wirklich locker sind (Plaudertempo) – das Tempo gehört in die Schlüsseleinheiten.';
    } else {
      const ok = ex.paceSecPerKm <= max + 8;
      rows.push({ key: 'pace', label: 'Pace', plan: [min, max], real: ex.paceSecPerKm, ok, verdict: ok ? 'im Ziel' : 'langsamer als geplant' });
    }
  }

  if (unit.targetHrZone && ex.avgHr && !structured) {
    const z = (hrZones || []).find((x) => x.zone === unit.targetHrZone);
    if (z) {
      const tooHigh = ex.avgHr > z.max + 5, tooLow = ex.avgHr < z.min - 5;
      const ok = easy ? !tooHigh : (!tooHigh && !tooLow);
      rows.push({ key: 'hr', label: 'HF-Zone', plan: unit.targetHrZone, real: ex.avgHr, ok, verdict: tooHigh ? 'zu hoch' : tooLow ? (easy ? 'schön locker' : 'niedriger') : 'in der Zone' });
      if (easy && tooHigh && !note) note = 'Die Herzfrequenz lag über der Zielzone – lockere Einheiten bewusst langsamer angehen.';
    }
  }

  // Beim Wettkampf entscheidet das Tempo (die Distanz ist immer erfüllt).
  const paceRow = rows.find((r) => r.key === 'pace');
  const hit = !rows.length ? null
    : unit.type === 'race' && paceRow ? paceRow.ok
      : (!tooFast && rows.filter((r) => r.ok).length >= Math.ceil(rows.length / 2));
  return { rows, hit, tooFast, structured, note };
}

/** Balkenbreite (%) eines Kilometer-Splits auf fester Skala: ±30 s um den Median
    (schneller = länger). Früher wurde Min–Max auf 30–100 % gestreckt – 5:00 und
    5:01 min/km sahen dann aus wie ein riesiger Unterschied. */
export function splitBarPct(sec, splits = []) {
  const xs = splits.map((s) => s.sec).filter((v) => v > 0).sort((a, b) => a - b);
  if (!xs.length || !(sec > 0)) return 50;
  const m = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  return Math.round(Math.max(6, Math.min(100, 50 + ((median - sec) / 30) * 50)));
}

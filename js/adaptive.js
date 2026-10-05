/* =========================================================================
   adaptive.js — coach hints (information, no plan rewriting):
     - Readiness from HRV / resting heart rate / sleep
     - Form prediction vs. target time
     - Heart rate of the easy runs
   No judgement about the load is made here – that comes solely from load.js,
   the daily recommendation solely from coach.js (formerly this file held its own
   RPE load judgement and thus contradictory cards on "Today").
   All of it as guidance, without pressure and without promises.
   ========================================================================= */

import { diffDays, fmtDec, fmtDuration, parseHms } from './ui.js';
import { predictRace } from './suggestions.js';
import { hrvMethodOf } from './healthdata.js';

import { t } from './i18n.js';

/**
 * HRV status: ln(HRV) as 7-day mean against the normal range (mean ± 0.5 SD) of the daily values
 * of the last 28 days – only values of the same measurement type as the latest. Needs at least 3 values
 * in 7 days and 10 in 28 days, otherwise null.
 * @returns {{state:'low'|'normal'|'high', mean7:number, lo:number, hi:number}|null}
 */
export function hrvBand(health, last, today) {
  if (!last || last.hrv == null || !today) return null;
  const method = hrvMethodOf(last);
  const vals = (health || []).filter((h) => h && !h.deleted && h.hrv > 0 && hrvMethodOf(h) === method
    && diffDays(h.date, today) >= 0 && diffDays(h.date, today) < 28);
  const ln28 = vals.map((h) => Math.log(h.hrv));
  const ln7 = vals.filter((h) => diffDays(h.date, today) < 7).map((h) => Math.log(h.hrv));
  if (ln7.length < 3 || ln28.length < 10) return null;
  const mean = ln28.reduce((a, b) => a + b, 0) / ln28.length;
  const sd = Math.sqrt(ln28.reduce((a, b) => a + (b - mean) ** 2, 0) / (ln28.length - 1));
  const mean7 = ln7.reduce((a, b) => a + b, 0) / ln7.length;
  const lo = mean - 0.5 * sd, hi = mean + 0.5 * sd;
  return { state: mean7 < lo ? 'low' : mean7 > hi ? 'high' : 'normal', mean7, lo, hi };
}

/** Readiness score (0–100) from the latest recovery values. */
export function readinessScore(health, today) {
  const sorted = (health || [])
    .filter((h) => !h.deleted && (h.restingHr != null || h.hrv != null || h.sleepHours != null))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const last = sorted.at(-1);
  if (today && diffDays(last.date, today) > 4) return null; // too old

  const recent = sorted.slice(-14);
  const avg = (key) => {
    const v = recent.map((h) => h[key]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  let score = 68;
  const factors = [];
  const rhrAvg = avg('restingHr');
  if (last.restingHr != null && rhrAvg) {
    const d = last.restingHr - rhrAvg;
    score -= d * 3;
    factors.push(d <= 0 ? t('adaptive.rhrLow') : t('adaptive.rhrRaised'));
  }
  // HRV (TRAIN-48): not the single value against an average, but ln(HRV) as a 7-day mean
  // against one's own normal range of the last 28 days (mean ± 0.5 SD, after Plews/Buchheit).
  // Daily noise no longer tips anything; only a deviation over several days counts. Only values
  // of the SAME measurement type (SDNN ≠ RMSSD) – a change of watch would otherwise be an apparent jump.
  const hrv = hrvBand(sorted, last, today || last.date);
  if (hrv) {
    if (hrv.state === 'low') { score -= 10; factors.push(t('adaptive.hrvLow')); }
    else if (hrv.state === 'high') { score += 5; factors.push(t('adaptive.hrvHigh')); }
    else factors.push(t('adaptive.hrvNormal'));
  }
  if (last.sleepHours != null) {
    if (last.sleepHours >= 7.5) score += 8;
    else if (last.sleepHours < 6.5) score -= 10;
    factors.push(t('adaptive.sleep', { hours: fmtDec(last.sleepHours) }));
  }
  score = Math.max(5, Math.min(100, Math.round(score)));
  const label = score >= 75 ? t('adaptive.readyHigh') : score >= 55 ? t('adaptive.readySolid') : score >= 40 ? t('adaptive.readyModerate') : t('adaptive.readyLow');
  return { score, label, factors, date: last.date };
}

/** Compares the heart rate of easy runs with the base zone (pace vs. HR). */
export function paceHrFeedback(sessions, profile, today) {
  const hrZones = (profile && profile.hrZones) || [];
  const z2 = hrZones.find((z) => z.zone === 2);
  if (!z2) return null;
  const easy = (sessions || []).filter((s) => s && !s.deleted && ['easy', 'recovery', 'long'].includes(s.type)
    && s.avgHr && diffDays(s.date, today) >= 0 && diffDays(s.date, today) <= 21);
  if (easy.length < 3) return null;
  const hrs = easy.map((s) => s.avgHr).sort((a, b) => a - b);
  const median = hrs[Math.floor(hrs.length / 2)];
  if (median <= z2.max + 3) return null;
  return {
    icon: 'heart', tone: 'warn',
    title: t('adaptive.easyTooHighTitle'),
    text: t('adaptive.easyTooHighText', { median, max: z2.max }),
  };
}

/**
 * Supplies the coach hints to display (information).
 * `coachWarning`: the daily recommendation (coach.js) is currently a warning signal (kind as
 * text, e.g. 'return', or true) – then the readiness card must not place
 * "a demanding session is fine today" next to it. `loadWarning`: the
 * "Load & form" card warns (raised load, clearly fatigued …) – then likewise not.
 * @returns {Array<{icon,title,text,tone}>}
 */
export function adaptiveInsights({ sessions = [], health = [], events = [], profile = {}, today, coachWarning = false, loadWarning = false }) {
  const out = [];

  const r = readinessScore(health, today);
  if (r) {
    const tone = r.score >= 70 ? 'good' : r.score >= 50 ? 'neutral' : 'warn';
    let rec;
    if (r.score < 50) rec = t('adaptive.recoveryLow');
    else if (coachWarning === 'return') rec = t('adaptive.recoveryOkReturn');
    else if (coachWarning) rec = t('adaptive.recoveryOkCoach');
    else if (loadWarning) rec = t('adaptive.recoveryOkLoad');
    else if (r.score >= 70) rec = t('adaptive.readinessGood');
    else rec = t('adaptive.readinessSolid');
    out.push({ icon: 'heart', title: t('adaptive.readinessToday', { label: r.label, score: r.score }), text: rec, tone, factors: r.factors });
  }

  const ev = events.filter((e) => e.status !== 'abgeschlossen' && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (ev) {
    const pred = predictRace(sessions, ev.distanceKm, { hrZones: profile.hrZones, today });
    if (pred) {
      const targetSec = parseHms(ev.targetTime);
      const ahead = targetSec && pred.seconds <= targetSec * 0.97;   // clearly faster than the target
      const onTrack = !targetSec || pred.seconds <= targetSec * 1.02;
      // The "sharpen target" hint only if the prediction holds: not from easy runs and
      // not while volume/long run for marathon or half marathon are still missing.
      const solid = !pred.onlyEasy && !pred.caveat;
      out.push({
        icon: 'target',
        title: t('adaptive.formForecast', { time: fmtDuration(pred.seconds) }),
        text: ahead && solid
          ? t('adaptive.fasterThanGoal', { target: ev.targetTime })
          : ahead
            ? t('adaptive.belowGoal', { target: ev.targetTime, note: pred.note || t('adaptive.noteDefault') })
            : onTrack
              ? t('adaptive.onTrack', { target: ev.targetTime || t('adaptive.goalWord') })
              : t('adaptive.aboveGoal', { target: ev.targetTime }),
        tone: onTrack ? 'good' : 'neutral',
      });
    }
  }

  const ph = paceHrFeedback(sessions, profile, today);
  if (ph) out.push(ph);

  return out;
}

/* =========================================================================
   adaptive.js — „Coach": reagiert auf das tatsächliche Verhalten.
   Liefert Empfehlungen (keine automatische Plan-Umschreibung):
     - Readiness aus HRV / Ruhepuls / Schlaf
     - Belastungs-Feedback aus RPE der letzten Einheiten
     - Formprognose vs. Zielzeit (Riegel)
   Alles als Orientierung, ohne Druck und ohne Versprechen.
   ========================================================================= */

import { diffDays, fmtDuration, parseHms } from './ui.js';
import { predictRace } from './suggestions.js';

/** Bereitschafts-Score (0–100) aus den jüngsten Erholungswerten. */
export function readinessScore(health, today) {
  const sorted = (health || [])
    .filter((h) => !h.deleted && (h.restingHr != null || h.hrv != null || h.sleepHours != null))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const last = sorted.at(-1);
  if (today && diffDays(last.date, today) > 4) return null; // zu alt

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
    factors.push(d <= 0 ? 'Ruhepuls niedrig' : 'Ruhepuls erhöht');
  }
  const hrvAvg = avg('hrv');
  if (last.hrv != null && hrvAvg) {
    const d = last.hrv - hrvAvg;
    score += d * 0.8;
    factors.push(d >= 0 ? 'HRV gut' : 'HRV gedämpft');
  }
  if (last.sleepHours != null) {
    if (last.sleepHours >= 7.5) score += 8;
    else if (last.sleepHours < 6.5) score -= 10;
    factors.push(`Schlaf ${last.sleepHours} h`);
  }
  score = Math.max(5, Math.min(100, Math.round(score)));
  const label = score >= 75 ? 'hoch' : score >= 55 ? 'solide' : score >= 40 ? 'mäßig' : 'niedrig';
  return { score, label, factors, date: last.date };
}

/** Belastungs-Feedback aus dem RPE der letzten 14 Tage. */
export function recentLoadFeedback(sessions, today) {
  const recent = (sessions || []).filter((s) => !s.deleted && s.rpe && diffDays(s.date, today) >= 0 && diffDays(s.date, today) <= 14);
  if (recent.length < 3) return null;
  const avgRpe = recent.reduce((a, s) => a + s.rpe, 0) / recent.length;
  if (avgRpe >= 7.5) return { level: 'hoch', tone: 'warn', message: 'Die letzten Einheiten waren im Schnitt fordernd. Plane bewusst lockere Tage ein – Erholung macht dich schneller.' };
  if (avgRpe <= 4) return { level: 'niedrig', tone: 'neutral', message: 'Da ist noch Luft nach oben – du könntest die nächsten Schlüsseleinheiten etwas fordernder angehen.' };
  return { level: 'ausgewogen', tone: 'good', message: 'Deine Belastung wirkt gut ausbalanciert. Weiter so!' };
}

/**
 * Liefert die anzuzeigenden Coach-Hinweise.
 * @returns {Array<{icon,title,text,tone}>}
 */
/** Gleicht die Herzfrequenz lockerer Läufe mit der Grundlagenzone ab (Pace vs. HF). */
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
    title: 'Locker läuft zu hoch',
    text: `Bei deinen lockeren Läufen liegt die Herzfrequenz im Schnitt bei ~${median} – über der Grundlagenzone Z2 (≤ ${z2.max}). Sehr häufig: Geh die lockeren Einheiten bewusst langsamer an – das Tempo ist egal, die HF zählt. Wirken die Zonen unrealistisch, prüfe Max-HF und Ruhepuls in den Einstellungen.`,
  };
}

export function adaptiveInsights({ sessions = [], health = [], events = [], profile = {}, today }) {
  const out = [];

  const r = readinessScore(health, today);
  if (r) {
    const tone = r.score >= 70 ? 'good' : r.score >= 50 ? 'neutral' : 'warn';
    const rec = r.score >= 70
      ? 'Gute Bereitschaft – ein anspruchsvolles Training ist heute gut drin.'
      : r.score >= 50
        ? 'Solide Bereitschaft – trainiere wie geplant und hör auf deinen Körper.'
        : 'Deine Erholung zeigt sich gedämpft – heute lieber locker oder eine Pause.';
    out.push({ icon: 'heart', title: `Bereitschaft heute: ${r.label} (${r.score})`, text: rec, tone, factors: r.factors });
  }

  const lf = recentLoadFeedback(sessions, today);
  if (lf) out.push({ icon: 'activity', title: `Belastung: ${lf.level}`, text: lf.message, tone: lf.tone });

  const ev = events.filter((e) => e.status !== 'abgeschlossen' && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (ev) {
    const pred = predictRace(sessions, ev.distanceKm);
    if (pred) {
      const targetSec = parseHms(ev.targetTime);
      const ahead = targetSec && pred.seconds <= targetSec * 0.97;   // deutlich schneller als das Ziel
      const onTrack = !targetSec || pred.seconds <= targetSec * 1.02;
      out.push({
        icon: 'target',
        title: `Formprognose: ${fmtDuration(pred.seconds)}`,
        text: ahead
          ? `Du bist aktuell schneller unterwegs als dein Ziel ${ev.targetTime}! Überlege, die Zielzeit zu schärfen – dann ziehen auch deine Trainingspaces automatisch mit.`
          : onTrack
            ? `Du bist auf Kurs Richtung ${ev.targetTime || 'Ziel'} – dranbleiben!`
            : `Aktuell noch über dem Ziel ${ev.targetTime} – die nächsten Tempo-/Intervalleinheiten zahlen darauf ein.`,
        tone: onTrack ? 'good' : 'neutral',
      });
    }
  }

  const ph = paceHrFeedback(sessions, profile, today);
  if (ph) out.push(ph);

  return out;
}

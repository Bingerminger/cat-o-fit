/* =========================================================================
   triage.js — Wochen-Kollisionen erkennen und TRANSPARENT priorisieren.
   Reine, DOM-freie Logik → per node:test abgedeckt.

   Leitsatz: „Wenn es eine Priorisierung der Ziele benötigt, ist immer transparent
   darzustellen, wie du triagierst zwischen Kollisionen." Dieses Modul liefert
   die Fakten (harte Back-to-Backs, zu viele harte Einheiten, kein Ruhetag,
   doppelt belegte Tage) plus eine nachvollziehbare Prioritätsordnung – die UI
   formuliert daraus die Hinweise.

   Prioritätsordnung (fix > Sicherheit/Erholung ist implizit; hier: was bei
   Kollision Vorrang behält): feste Termine > Schlüssel-Laufeinheiten fürs
   Zeitziel > Kraft > lockerer Umfang > Erholung. Erholung steht bewusst NICHT
   ganz oben – sie ist der Puffer, der bei Kollision zuerst schrumpft; Sicherheit
   entsteht dadurch, dass harte Reize entzerrt werden (siehe rolling.js).
   ========================================================================= */

import { weekStartMonday, addDays, isoDow } from './ui.js';
import { loadClass, isHard, findMakeupDay } from './planflow.js';

const DOW = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export function dowShort(dateStr) { return DOW[isoDow(dateStr)] || ''; }

/** Lastrelevante, nicht verpasste Einheiten der Mo–So-Woche von dateStr. */
export function weekUnits(units = [], dateStr) {
  const ws = weekStartMonday(dateStr), we = addDays(ws, 6);
  return (units || []).filter((u) => u && !u.deleted && u.date >= ws && u.date <= we
    && u.type !== 'rest' && u.status !== 'verpasst' && u.status !== 'verschoben');
}

/** Prioritätsklasse einer Einheit (höher = behält bei Kollision Vorrang). */
export const PRIORITY_RANK = { fixed: 5, key: 4, strength: 3, endurance: 2, recovery: 1, other: 0 };
export function unitPriority(u) {
  if (u && u.fixed) return 'fixed';
  const c = loadClass(u ? u.type : 'other');
  if (c === 'quality' || (u && (u.type === 'long' || u.type === 'race'))) return 'key';
  if (c === 'strength') return 'strength';
  if (c === 'endurance') return 'endurance';
  if (c === 'recovery') return 'recovery';
  return 'other';
}

/**
 * Erkennt Kollisionen/Risiken einer Woche. Jede Kollision trägt einen Vorschlag,
 * der die niedriger priorisierte Einheit anfasst (Schlüssel/feste Termine bleiben).
 * @returns {Array<{kind, severity, text, suggest, date?}>}
 */
export function weekCollisions(units = [], dateStr) {
  const list = weekUnits(units, dateStr).slice().sort((a, b) => a.date.localeCompare(b.date));
  const out = [];

  // 1) Harte Einheiten an aufeinanderfolgenden Tagen (Erholung fehlt zwischen den Reizen)
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[j].date === addDays(list[i].date, 1) && isHard(list[i]) && isHard(list[j])) {
        const lower = PRIORITY_RANK[unitPriority(list[i])] <= PRIORITY_RANK[unitPriority(list[j])] ? list[i] : list[j];
        out.push({
          kind: 'hard-b2b', severity: 'warn', date: list[j].date,
          text: `Harte Einheiten an aufeinanderfolgenden Tagen: „${list[i].title}" (${dowShort(list[i].date)}) → „${list[j].title}" (${dowShort(list[j].date)}).`,
          suggest: lower.fixed
            ? `„${lower.title}" ist ein fester Termin – mach stattdessen die andere Einheit lockerer oder verschiebe sie.`
            : `Verschiebe „${lower.title}" oder mach sie lockerer – zwischen zwei harte Reize gehört Erholung.`,
        });
      }
    }
  }

  // 2) Zu viele harte Einheiten in der Woche
  const hard = list.filter(isHard);
  if (hard.length > 3) {
    const softest = hard.filter((u) => !u.fixed).sort((a, b) => PRIORITY_RANK[unitPriority(a)] - PRIORITY_RANK[unitPriority(b)])[0];
    out.push({
      kind: 'too-many-hard', severity: 'warn',
      text: `${hard.length} fordernde Einheiten in einer Woche – 2–3 reichen meist, um sich zwischen den Reizen zu erholen.`,
      suggest: softest ? `Wandle die am wenigsten wichtige („${softest.title}") in einen lockeren Lauf – Qualität vor Quantität.`
        : 'Die harten Einheiten sind feste Termine – plane die lockeren Tage bewusst sehr ruhig.',
    });
  }

  // 3) Kein Ruhetag (jeder Wochentag belegt)
  const days = new Set(list.map((u) => u.date));
  if (days.size >= 7) {
    out.push({
      kind: 'no-rest', severity: 'warn',
      text: 'Kein trainingsfreier Tag in dieser Woche.',
      suggest: 'Plane mindestens einen Ruhetag ein – Erholung ist der Moment, in dem die Anpassung passiert.',
    });
  }

  // 4) Zwei harte Einheiten am selben Tag
  const byDate = new Map();
  list.forEach((u) => { if (!byDate.has(u.date)) byDate.set(u.date, []); byDate.get(u.date).push(u); });
  byDate.forEach((us, date) => {
    if (us.filter(isHard).length >= 2) {
      out.push({
        kind: 'double-hard', severity: 'warn', date,
        text: `Zwei fordernde Einheiten am selben Tag (${dowShort(date)}).`,
        suggest: 'Verteile sie auf zwei Tage – so wirkt jeder Reiz besser und die Erholung stimmt.',
      });
    }
  });

  return out;
}

/**
 * Kompakte Wochen-Triage: Kollisionen + nach Priorität geordnete Einheiten
 * (transparent, wie die App im Konfliktfall abwägt).
 */
export function weekTriage(units = [], dateStr) {
  const list = weekUnits(units, dateStr);
  const collisions = weekCollisions(units, dateStr);
  const ranked = list.slice().sort((a, b) =>
    PRIORITY_RANK[unitPriority(b)] - PRIORITY_RANK[unitPriority(a)] || a.date.localeCompare(b.date));
  return { collisions, ranked, ok: collisions.length === 0, hardCount: list.filter(isHard).length };
}

/**
 * „Entstapeln" bei zwei Zielen (#4): sucht den nächsten Tag in [today, today+horizon]
 * mit ≥2 offenen, lastrelevanten Einheiten (typisch: zwei Ziele überlagern sich) und
 * schlägt vor, die am niedrigsten priorisierte, verschiebbare davon auf einen freien
 * Tag zu legen – so entsteht echte Erholung statt zwei halber Einheiten am selben Tag.
 * Reine Funktion. @returns {{date, move, keep, target}|null}
 */
export function destackSuggestion(units = [], today, horizon = 10) {
  const open = (u) => u && u.date >= today && u.type !== 'rest'
    && (u.status === 'geplant' || u.status == null);
  const byDate = new Map();
  (units || []).forEach((u) => {
    if (!open(u) || addDays(today, horizon) < u.date) return;
    if (!byDate.has(u.date)) byDate.set(u.date, []);
    byDate.get(u.date).push(u);
  });
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date);
    if (day.length < 2) continue;
    if (!day.some(isHard)) continue;  // nur echte Last-Stapel entzerren, nicht zwei lockere Einheiten
    // Die am niedrigsten priorisierte, NICHT feste Einheit ist der Verschiebe-Kandidat.
    const movable = day.filter((u) => !u.fixed)
      .sort((a, b) => PRIORITY_RANK[unitPriority(a)] - PRIORITY_RANK[unitPriority(b)]);
    if (!movable.length) continue;
    const move = movable[0];
    const target = findMakeupDay(units, move, today, horizon);
    if (!target) continue;
    const keep = day.find((u) => u.id !== move.id) || null;
    return { date, move, keep, target };
  }
  return null;
}

/* =========================================================================
   redflags.js — Sicherheitsschranken für das Labor-/Supplement-Modul.
   Reine, DOM-freie Logik → per node:test abgedeckt.

   Cat-O-Fit richtet sich an GESUNDE Sportlerinnen und Sportler. Dieses Modul
   hält diese Abgrenzung technisch fest, statt sie nur in einen Hinweistext zu
   schreiben:

   1) GATE: Wer eine behandlungsbedürftige Erkrankung, Dauermedikation, eine
      Schwangerschaft/Stillzeit oder eine Essstörung angibt (oder minderjährig
      ist), bekommt das Modul im reinen DOKUMENTATIONSMODUS: Werte erfassen und
      im Verlauf sehen ja – Einnahme-Empfehlungen nein. Dokumentieren ist harmlos,
      Empfehlen wäre es nicht.
   2) ROTE FLAGGEN: Bestimmte Konstellationen gehören ärztlich abgeklärt und
      nicht in eine App-Empfehlung. Sie setzen die Empfehlungen aus.
   3) ENERGIEVERFÜGBARKEIT (RED-S): Das häufigste ernsthafte Problem im
      Ausdauersport ist nicht ein fehlendes Präparat, sondern zu wenig Energie
      für die geleistete Arbeit. Cat-O-Fit kann das aus vorhandenen Daten
      (Ernährung, Training, Körperwerte, Zyklus) abschätzen.

   Kein Diagnose-Anspruch: Alle Hinweise sind Anlässe für ein Arztgespräch.
   ========================================================================= */

import { addDays } from './ui.js';
import { freshLatest } from './labs.js';
import { trainingKcal, measuredActiveKcal } from './energy.js';
import { GATE_QUESTIONS } from './eligibility.js';
import { periodStarts, periodSignal } from './cyclecalc.js';
import { migrateHealth } from './healthdata.js';

/* --------------------------------- Gate ---------------------------------- */

// Die Fragen gelten seit v3.20.0 für die ganze App (eligibility.js).
export { GATE_QUESTIONS };

/**
 * Betriebsmodus aus den reinen Gate-Antworten (Kurzform; die App nutzt
 * `eligibilityFor` aus eligibility.js, das zusätzlich das Alter kennt).
 * @param {object} gate  Antworten aus den Einstellungen ({key: true|false})
 * @returns {{mode:'full'|'documentation', reasons:string[], answered:boolean}}
 */
export function eligibility(gate = {}) {
  const reasons = GATE_QUESTIONS.filter((q) => gate[q.key] === true).map((q) => q.label);
  const answered = GATE_QUESTIONS.some((q) => typeof gate[q.key] === 'boolean');
  return { mode: reasons.length ? 'documentation' : 'full', reasons, answered };
}

/* ------------------------------ Rote Flaggen ------------------------------ */

/** Werte, bei denen die App keine Empfehlung gibt, sondern zum Arzt schickt. */
const CRITICAL = [
  { key: 'hb', below: 11, text: 'Der Hämoglobin-Wert ist deutlich zu niedrig.' },
  { key: 'sodium', below: 130, text: 'Der Natrium-Wert ist deutlich zu niedrig (Hyponatriämie).' },
  { key: 'ck', above: 5000, text: 'Die Kreatinkinase ist extrem hoch – das kann auf eine erhebliche Muskelschädigung hinweisen.' },
  { key: 'crp', above: 50, text: 'Das CRP ist stark erhöht – das spricht für eine relevante Entzündung.' },
  { key: 'ferritin', above: 400, text: 'Das Ferritin ist deutlich erhöht – bitte abklären lassen, bevor irgendein eisenhaltiges Präparat genommen wird.' },
  { key: 'tsh', above: 10, text: 'Der TSH-Wert ist deutlich erhöht.' },
];

/**
 * Prüft auf Konstellationen, die ärztlich gehören.
 * `gate` (Schwangerschaft) und `cycleCheck` (Antwort auf „Periode ausgeblieben?“)
 * verhindern Fehlalarme bei ausbleibender Periode.
 * @returns {Array<{severity:'stop', text:string, advice:string}>}
 */
export function redFlags({ labs = [], cycle = [], today = null, gate = {}, cycleCheck = null, avgLen = null } = {}) {
  const out = [];
  for (const c of CRITICAL) {
    const l = freshLatest(labs, c.key, today);   // ein Wert von vor Jahren ist kein aktueller Arztfall
    if (!l) continue;
    const v = Number(l.value);
    if ((c.below != null && v < c.below) || (c.above != null && v > c.above)) {
      out.push({
        severity: 'stop', text: c.text,
        advice: 'Bitte ärztlich abklären. Cat-O-Fit gibt dazu bewusst keine Empfehlung.',
      });
    }
  }

  // Ausbleibende Periode: klassisches Warnzeichen für zu wenig Energie (RED-S) –
  // aber nur, wenn sie wirklich ausgeblieben ist (nicht bei Schwangerschaft,
  // hormoneller Verhütung oder beendeter Erfassung).
  const signal = periodSignal({ starts: periodStarts(cycle), today, avgLen, gate, check: cycleCheck });
  if (signal && signal.flag) out.push(periodFlag(signal));
  return out;
}

/** Arzthinweis zu einer ausgebliebenen Periode (gemeinsam für Zyklus, Labor und „Heute“). */
export function periodFlag(signal) {
  return {
    severity: 'stop',
    text: signal.state === 'missed'
      ? `Deine Periode ist seit ${Math.round(signal.days / 7)} Wochen ausgeblieben.`
      : `Seit ${Math.round(signal.days / 30)} Monaten ist keine Periode erfasst.`,
    advice: 'Bleibt die Periode über Monate aus, kann ein Energiemangel dahinterstecken (RED-S). Das gehört ärztlich abgeklärt – und ist kein Fall für Nahrungsergänzung.',
  };
}

/* -------------------- Energieverfügbarkeit (RED-S/LEA) -------------------- */

/**
 * Verlauf der Energieverfügbarkeit: ein Punkt je Woche über `weeks` Wochen.
 * Sportlerinnen und Sportler denken in Kurven – eine einzelne Momentaufnahme
 * sagt wenig, der Verlauf zeigt, ob sich das Verhältnis von Essen und Training
 * verschiebt (typisch: sinkt in Aufbauphasen, weil die Last steigt).
 * @returns {Array<{label:string, value:number|null, date:string}>}
 */
export function energyAvailabilitySeries(args = {}, { weeks = 10 } = {}) {
  const { today } = args;
  if (!today) return [];
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const ref = addDays(today, -w * 7);
    const ea = energyAvailability({ ...args, today: ref, days: 7, minDays: 3 });
    out.push({
      date: ref,
      label: `${String(ref).slice(8, 10)}.${String(ref).slice(5, 7)}.`,
      value: ea && ea.level !== 'unklar' ? ea.ea : null,
    });
  }
  return out;
}

/** Schwellen nach gängiger sportmedizinischer Einordnung (kcal/kg fettfreie Masse/Tag).
    Die 30 ist ein Richtwert, kein Diagnosepunkt; bei Männern liegt die Grenze nach dem
    IOC-Konsens 2023 eher niedriger (hier: 25). */
export const EA_LOW = 30;
export const EA_LOW_MALE = 25;
export const EA_OPTIMAL = 45;

/** Niedrige Schwelle je Geschlecht. */
export function eaLowFor(sex) { return sex === 'm' ? EA_LOW_MALE : EA_LOW; }

/** Fettfreie Masse (kg) aus Gewicht und Körperfettanteil. */
export function leanMass(weightKg, bodyFatPct) {
  const kg = Number(weightKg);
  const bf = Number(bodyFatPct);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  if (!Number.isFinite(bf) || bf <= 0 || bf >= 70) return null;
  return Math.round(kg * (1 - bf / 100) * 10) / 10;
}

/**
 * Fettfreie Masse zum Stichtag: jüngstes Gewicht mit einem Körperfettwert der letzten
 * 120 Tage (sonst aus dem Profil). `missing` nennt, was fehlt (für den Hinweis in der
 * Oberfläche statt einer still verschwundenen Karte).
 * @returns {{ffm:number|null, kg:number|null, missing:null|'weight'|'bodyFat'}}
 */
export function leanMassNow({ profile = {}, health = [], today } = {}) {
  const list = migrateHealth(health);
  const recent = (h) => h && !h.deleted && h.date <= today && h.date >= addDays(today, -120);
  const bf = list.filter((h) => recent(h) && h.bodyFat != null)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const weight = list.filter((h) => h && !h.deleted && h.weight != null && h.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const kg = (weight && Number(weight.weight)) || Number(profile.weightKg) || null;
  if (!kg) return { ffm: null, kg: null, missing: 'weight' };
  // Gemessene fettfreie Masse (z. B. Apple Health „Lean Body Mass“) hat Vorrang vor der
  // Rechnung aus Gewicht und Körperfettanteil.
  const lm = list.filter((h) => recent(h) && Number(h.leanMass) > 0 && Number(h.leanMass) < kg * 1.05)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (lm) return { ffm: Math.round(Number(lm.leanMass) * 10) / 10, kg, missing: null, measured: true };
  const ffm = leanMass(kg, bf ? bf.bodyFat : profile.bodyFatPct);
  return { ffm, kg, missing: ffm ? null : 'bodyFat' };
}

/** Tage, die im Ess-Tagebuch als „vollständig erfasst“ bestätigt sind (Datensatz `_kind: 'day'`). */
export function completeDays(diary = []) {
  return new Set((diary || [])
    .filter((d) => d && !d.deleted && d._kind === 'day' && d.complete === true && d.date)
    .map((d) => d.date));
}

/**
 * Schätzt die Energieverfügbarkeit der letzten `days` Tage:
 *   EA = (Aufnahme − Trainingsverbrauch) / fettfreie Masse
 *
 * Bewertet wird NUR über Tage, die als vollständig erfasst bestätigt sind. Früher
 * galt „Ø-Aufnahme unter 1,2 × Grundumsatz ⇒ vermutlich lückenhaft“ – das machte
 * genau die ernstesten Fälle (wenig essen, sorgfältig protokollieren) dauerhaft
 * unsichtbar. Jetzt fragt die App nach, statt zu unterstellen: Ohne genug
 * bestätigte Tage bleibt es „unklar“ – mit Zählung.
 * Unter `minDays` Tagen mit Mahlzeiten gibt es bewusst kein Ergebnis.
 *
 * @param {object} p  `lossGoal`: Abnehmziel aktiv (30–45 ist dann ein vertretbarer Abnehmbereich)
 * @returns {{ea, eaRounded, range, days, confirmedDays, intakeAvg, trainingAvg, ffm,
 *   level:'kritisch'|'niedrig'|'gut'|'unklar', hint, lossBand:boolean}|null}
 */
export function energyAvailability({
  profile = {}, health = [], sessions = [], diary = [], today, days = 14, minDays = 5, lossGoal = false,
} = {}) {
  if (!today) return null;
  const from = addDays(today, -(days - 1));
  const { ffm, kg, measured } = leanMassNow({ profile, health, today });
  if (!ffm) return null;

  // Tage mit erfasster Nahrungsaufnahme.
  const byDay = new Map();
  (diary || []).forEach((m) => {
    if (!m || m.deleted || m._kind || !m.date || !m.kcal) return;
    if (m.date < from || m.date > today) return;
    byDay.set(m.date, (byDay.get(m.date) || 0) + Number(m.kcal));
  });
  if (byDay.size < minDays) return null;

  let trainN = 0, trainMeasured = 0;
  const trainOn = (date) => (sessions || [])
    .filter((s) => s && !s.deleted && s.date === date)
    .reduce((a, s) => { trainN++; if (measuredActiveKcal(s) != null) trainMeasured++; return a + trainingKcal(s, kg, { net: true, activityFactor: profile.activityFactor || 1.35 }); }, 0);
  // Herkunft des Trainingsverbrauchs für die Karte: gemessen (Uhr), teils oder geschätzt.
  const trainingSource = () => (!trainN ? null : trainMeasured === trainN ? 'gemessen' : trainMeasured ? 'teils' : 'geschätzt');
  const complete = completeDays(diary);
  const confirmed = [...byDay.keys()].filter((d) => complete.has(d));

  if (confirmed.length < minDays) {
    let iSum = 0, tSum = 0;
    for (const [date, kcal] of byDay) { iSum += kcal; tSum += trainOn(date); }
    return {
      ea: null, eaRounded: null, range: null, days: byDay.size, confirmedDays: confirmed.length, ffmMeasured: !!measured, trainingSource: trainingSource(),
      intakeAvg: Math.round(iSum / byDay.size), trainingAvg: Math.round(tSum / byDay.size), ffm,
      level: 'unklar', lossBand: false,
      hint: `Vollständig bestätigt: ${confirmed.length} von ${byDay.size} Tagen mit Mahlzeiten. Tippe in der Ernährung bei „Heute gegessen“ auf „Tag vollständig“, wenn du alles erfasst hast – ab ${minDays} bestätigten Tagen schätzt Cat-O-Fit deine Energieversorgung. Aus unvollständigen Tagen würde sie zu niedrig ausfallen.`,
    };
  }

  let intakeSum = 0, trainSum = 0;
  for (const date of confirmed) { intakeSum += byDay.get(date); trainSum += trainOn(date); }
  const n = confirmed.length;
  const intakeAvg = Math.round(intakeSum / n);
  const trainingAvg = Math.round(trainSum / n);
  const ea = Math.round(((intakeSum - trainSum) / n / ffm) * 10) / 10;
  // Aufnahme, Trainingsverbrauch und fettfreie Masse sind Schätzungen – die Zahl ist
  // nicht auf die Nachkommastelle genau. Daher gerundet und als Spanne (± 15 %).
  const eaRounded = Math.round(ea);
  const range = [Math.round(ea * 0.85), Math.round(ea * 1.15)];
  const approx = `≈ ${range[0]}–${range[1]}`;
  const low = eaLowFor(profile.sex);

  const level = ea < low ? 'kritisch' : ea < EA_OPTIMAL ? 'niedrig' : 'gut';
  const lossBand = level === 'niedrig' && lossGoal;
  const hint = level === 'kritisch'
    ? `Hinweis: Rechnerisch bleiben dir rund ${eaRounded} kcal je kg fettfreier Masse (${approx}) – wenig für dein Training. Dauerhaft kann das zu Leistungsabfall, Verletzungen, Hormon- und Zyklusstörungen führen. Iss mehr, statt ein Präparat zu suchen – und sprich mit einer Ärztin oder einem Arzt.`
    : lossBand
      ? `Rund ${eaRounded} kcal je kg fettfreier Masse (${approx}) – im Bereich, der beim Abnehmen vorübergehend vertretbar ist (${low}–${EA_OPTIMAL}). Achte auf Schlaf und Regeneration; darunter wird es riskant.`
      : level === 'niedrig'
        ? `Rund ${eaRounded} kcal je kg fettfreier Masse (${approx}) – unter dem Richtwert von ${EA_OPTIMAL}. In harten Trainingsphasen solltest du bewusst mehr essen, sonst leiden Regeneration und Qualität der Einheiten.`
        : `Rund ${eaRounded} kcal je kg fettfreier Masse (${approx}) – deine Energieversorgung passt zum Training.`;

  return { ea, eaRounded, range, days: byDay.size, confirmedDays: n, intakeAvg, trainingAvg, ffm, ffmMeasured: !!measured, trainingSource: trainingSource(), level, hint, lossBand };
}

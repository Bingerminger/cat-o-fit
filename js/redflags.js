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

import { addDays, diffDays } from './ui.js';
import { latest } from './labs.js';
import { trainingKcal, bmr } from './energy.js';

/* --------------------------------- Gate ---------------------------------- */

/** Abfragepunkte der Ersteinrichtung des Moduls (alle „ja" schränken ein). */
export const GATE_QUESTIONS = [
  { key: 'chronicCondition', label: 'Behandlungsbedürftige Erkrankung (z. B. Niere, Leber, Herz, Schilddrüse, Diabetes)' },
  { key: 'medication', label: 'Regelmäßige Einnahme von Medikamenten' },
  { key: 'pregnancy', label: 'Schwangerschaft oder Stillzeit' },
  { key: 'eatingDisorder', label: 'Aktuelle oder frühere Essstörung' },
  { key: 'minor', label: 'Unter 18 Jahre alt' },
];

/**
 * Betriebsmodus des Moduls.
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
 * @returns {Array<{severity:'stop', text:string, advice:string}>}
 */
export function redFlags({ labs = [], cycle = [], today = null } = {}) {
  const out = [];
  for (const c of CRITICAL) {
    const l = latest(labs, c.key, today);
    if (!l) continue;
    const v = Number(l.value);
    if ((c.below != null && v < c.below) || (c.above != null && v > c.above)) {
      out.push({
        severity: 'stop', text: c.text,
        advice: 'Bitte ärztlich abklären. Cat-O-Fit gibt dazu bewusst keine Empfehlung.',
      });
    }
  }

  // Ausbleibende Periode: klassisches Warnzeichen für zu wenig Energie (RED-S).
  const starts = (cycle || []).filter((c) => c && !c.deleted && c.startDate).map((c) => c.startDate).sort();
  if (starts.length && today) {
    const gap = diffDays(starts.at(-1), today);
    if (gap > 90) {
      out.push({
        severity: 'stop',
        text: `Seit ${Math.round(gap / 30)} Monaten ist keine Periode erfasst.`,
        advice: 'Bleibt die Periode über Monate aus, steckt oft ein Energiemangel dahinter (RED-S). Das gehört ärztlich abgeklärt – und ist kein Fall für Nahrungsergänzung.',
      });
    }
  }
  return out;
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

/** Schwellen nach gängiger sportmedizinischer Einordnung (kcal/kg fettfreie Masse/Tag). */
export const EA_LOW = 30;
export const EA_OPTIMAL = 45;

/** Fettfreie Masse (kg) aus Gewicht und Körperfettanteil. */
export function leanMass(weightKg, bodyFatPct) {
  const kg = Number(weightKg);
  const bf = Number(bodyFatPct);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  if (!Number.isFinite(bf) || bf <= 0 || bf >= 70) return null;
  return Math.round(kg * (1 - bf / 100) * 10) / 10;
}

/**
 * Schätzt die Energieverfügbarkeit der letzten `days` Tage:
 *   EA = (Aufnahme − Trainingsverbrauch) / fettfreie Masse
 *
 * Wichtig: Gerechnet wird NUR über Tage mit erfassten Mahlzeiten – sonst würde
 * jede Erfassungslücke wie ein Hungertag aussehen und einen Fehlalarm auslösen.
 * Unter `minDays` erfassten Tagen gibt es bewusst kein Ergebnis.
 *
 * @returns {{ea, days, intakeAvg, trainingAvg, ffm, level:'kritisch'|'niedrig'|'gut', hint}|null}
 */
export function energyAvailability({
  profile = {}, health = [], sessions = [], diary = [], today, days = 14, minDays = 5,
} = {}) {
  if (!today) return null;
  const from = addDays(today, -(days - 1));

  // Fettfreie Masse: aus dem jüngsten Körperfettwert, sonst aus dem Profil.
  const bf = [...(health || [])]
    .filter((h) => h && !h.deleted && h.bodyFat != null && h.date <= today && h.date >= addDays(today, -120))
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const weight = [...(health || [])]
    .filter((h) => h && !h.deleted && h.weight != null && h.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const kg = (weight && Number(weight.weight)) || Number(profile.weightKg) || null;
  const ffm = leanMass(kg, bf ? bf.bodyFat : profile.bodyFatPct);
  if (!ffm) return null;

  // Tage mit erfasster Nahrungsaufnahme.
  const byDay = new Map();
  (diary || []).forEach((m) => {
    if (!m || m.deleted || !m.date || !m.kcal) return;
    if (m.date < from || m.date > today) return;
    byDay.set(m.date, (byDay.get(m.date) || 0) + Number(m.kcal));
  });
  if (byDay.size < minDays) return null;

  let intakeSum = 0, trainSum = 0;
  for (const [date, kcal] of byDay) {
    intakeSum += kcal;
    trainSum += (sessions || [])
      .filter((s) => s && !s.deleted && s.date === date)
      .reduce((a, s) => a + trainingKcal(s, kg, { net: true, activityFactor: profile.activityFactor || 1.35 }), 0);
  }
  const n = byDay.size;
  const intakeAvg = Math.round(intakeSum / n);
  const trainingAvg = Math.round(trainSum / n);
  const ea = Math.round(((intakeSum - trainSum) / n / ffm) * 10) / 10;

  // PLAUSIBILITÄT: Wer trainiert und dabei im Schnitt kaum mehr als seinen
  // Grundumsatz erfasst, hat meistens ein lückenhaftes Tagebuch – nicht wochenlang
  // gehungert. „Wenig erfasst" darf nicht als „zu wenig gegessen" durchgehen: Eine
  // falsche Mangel-Ansage verunsichert, und bei niemandem soll ein Erfassungsloch
  // wie eine Diagnose aussehen. Statt zu bewerten sagt die App hier ehrlich, dass
  // die Datenbasis nicht trägt – und benennt beide möglichen Ursachen.
  const base = bmr(profile, today);
  const PLAUSIBLE_MIN = base ? base * 1.2 : null;
  if (PLAUSIBLE_MIN && intakeAvg < PLAUSIBLE_MIN) {
    return {
      ea, days: n, intakeAvg, trainingAvg, ffm, level: 'unklar',
      hint: `Im Schnitt sind nur ${intakeAvg} kcal pro Tag erfasst – wenig für jemanden, der trainiert (dein Grundumsatz allein liegt bei rund ${base} kcal). Meistens fehlen dann einfach Mahlzeiten im Tagebuch. Erfasse ein paar Tage möglichst vollständig; zeigt sich das Bild dann weiterhin, isst du tatsächlich zu wenig für dein Trainingspensum – und das gehört besprochen.`,
    };
  }

  const level = ea < EA_LOW ? 'kritisch' : ea < EA_OPTIMAL ? 'niedrig' : 'gut';
  const hint = level === 'kritisch'
    ? `Rechnerisch bleiben dir rund ${ea} kcal je kg fettfreier Masse – deutlich unter dem, was Körperfunktionen und Regeneration brauchen (Richtwert 45). Dauerhaft führt das zu Leistungsabfall, Verletzungen, Hormon- und Zyklusstörungen. Iss mehr, statt ein Präparat zu suchen – und sprich mit einer Ärztin oder einem Arzt.`
    : level === 'niedrig'
      ? `Rund ${ea} kcal je kg fettfreier Masse – unter dem Richtwert von 45. In harten Trainingsphasen solltest du bewusst mehr essen, sonst leiden Regeneration und Qualität der Einheiten.`
      : `Rund ${ea} kcal je kg fettfreier Masse – deine Energieversorgung passt zum Training.`;

  return { ea, days: n, intakeAvg, trainingAvg, ffm, level, hint };
}

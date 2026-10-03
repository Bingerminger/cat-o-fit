/* =========================================================================
   healthdata.js — Körperwerte: Lese-Migration und Messart-Hilfen.
   Reine, DOM-freie Logik → per node:test abgedeckt.

   - Fettfreie Masse: Apple Health „Lean Body Mass“ landete bis v3.19.0 im Feld
     `muscleMass` und stand dann als „Muskelmasse“ (≈ 55 kg) neben Waagenwerten
     (≈ 28 kg). Seit v3.20.0 gibt es das eigene Feld `leanMass`; ältere Apple-Werte
     werden beim Lesen dorthin umgedeutet (gespeichert wird nichts). Von Hand
     eingetragene Muskelmasse (`muscleMassManual`) bleibt Muskelmasse – auch an Tagen,
     die zusätzlich Apple-Werte tragen; sonst rechnete die Energieversorgung mit ihr
     als fettfreier Masse.
   - HRV: Apple speichert SDNN, viele Uhren und Ringe zeigen RMSSD. Die Zahlen sind
     nicht vergleichbar – deshalb trägt jeder Wert seine Messart (`hrvMethod`), und
     Trends, Ziele und Bereitschaft vergleichen nur innerhalb einer Messart.
   ========================================================================= */

import { todayStr, addDays } from './ui.js';

/** Quellen, die aus Apple Health stammen (Auto-Export und Voll-Import). */
export const APPLE_SOURCES = ['apple-health', 'health'];
export const HRV_METHODS = { sdnn: 'SDNN', rmssd: 'RMSSD' };

const memo = new WeakMap();
const isApple = (h) => APPLE_SOURCES.includes(h && h.source);

/** Deutet einen älteren Körperwert-Datensatz beim Lesen um (idempotent, ohne Schreiben). */
export function migrateHealthRecord(h) {
  if (!h || typeof h !== 'object' || !isApple(h)) return h;
  const needsLean = h.muscleMass != null && !h.muscleMassManual;
  const needsHrv = h.hrv != null && !h.hrvMethod;
  if (!needsLean && !needsHrv) return h;
  const cached = memo.get(h);
  if (cached) return cached;
  const out = { ...h };
  if (needsLean) {
    if (out.leanMass == null) out.leanMass = h.muscleMass;
    delete out.muscleMass;              // Apple kennt keine Muskelmasse – das war die fettfreie Masse
  }
  if (needsHrv) out.hrvMethod = 'sdnn';
  memo.set(h, out);
  return out;
}

/** Ganze Liste lesend umdeuten. */
export function migrateHealth(list = []) {
  return (list || []).map(migrateHealthRecord);
}

/** Messart eines HRV-Werts ('sdnn' | 'rmssd' | 'unbekannt'). */
export function hrvMethodOf(h) {
  if (!h || h.hrv == null) return null;
  if (h.hrvMethod === 'sdnn' || h.hrvMethod === 'rmssd') return h.hrvMethod;
  return isApple(h) ? 'sdnn' : 'unbekannt';
}

/** Messart des jüngsten HRV-Werts – danach richten sich Anzeige und Vergleich. */
export function currentHrvMethod(health = []) {
  let best = null;
  for (const h of health || []) {
    if (!h || h.deleted || h.hrv == null || !h.date) continue;
    if (!best || h.date > best.date) best = h;
  }
  return best ? hrvMethodOf(best) : null;
}

/** Nur die HRV-Werte einer Messart (Datensätze ohne HRV bleiben erhalten, ihr HRV entfällt). */
export function withHrvMethod(health = [], method) {
  return (health || []).map((h) => {
    if (!h || h.hrv == null || hrvMethodOf(h) === method) return h;
    const { hrv, ...rest } = h;
    return rest;
  });
}

/** Beschriftung „HRV (SDNN)“ o. ä. */
export function hrvLabel(method) {
  return method && HRV_METHODS[method] ? `HRV (${HRV_METHODS[method]})` : 'HRV';
}

/* (aus badges.js hierher, damit health.js nicht badges.js importieren muss – FE-18) */
/** Alkoholfreie Tage in Folge bis heute (null, wenn nie ein Alkohol-Tag erfasst wurde). */
export function alcoholFreeStreak(health, today = todayStr()) {
  const drinkDays = new Set((health || []).filter((h) => h && !h.deleted && h.alcohol === true).map((h) => h.date));
  if (!drinkDays.size) return null;
  let streak = 0; let d = today;
  while (!drinkDays.has(d) && streak <= 3650) { streak++; d = addDays(d, -1); }
  return streak;
}

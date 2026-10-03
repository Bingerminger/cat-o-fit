/* =========================================================================
   activity-import.js — Trainingsdateien einlesen: einzelne GPX/TCX/FIT, gepackte
   Dateien (.gz) und ganze Exporte als ZIP (auch ZIP im ZIP, wie im Garmin-
   Datenexport). DOM-frei; health-import.js zeigt Vorschau und speichert.
   ========================================================================= */

import { parseActivityFile } from './gpx.js';
import { parseFit, isFit } from './fit.js';
import { unzip, gunzip, isZip, isGzip } from './zip.js';

/** Dateien, die in einem Archiv als Aktivität gelten (auch gepackt). */
const ACTIVITY_RE = /\.(gpx|tcx|fit)(\.gz)?$/i;
/** Strecken speichert der Massenimport nur für jüngere Einheiten – das spart Gerätespeicher. */
export const ROUTE_DAYS = 90;

/** Eine Datei (Name + Bytes) → Aktivität oder null. */
export function parseActivityBytes(name, bytes, { hrZones = null } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isFit(b)) return parseFit(b, { hrZones });
  return parseActivityFile(new TextDecoder().decode(b), { hrZones });
}

/**
 * Liest Dateien (je `{ name, data: Uint8Array }`) samt Archiven und liefert die erkannten
 * Aktivitäten, älteste zuerst. `skipped` zählt Dateien ohne brauchbare Aufzeichnung.
 * @returns {Promise<{activities: Array<{name:string, act:object}>, skipped:number}>}
 */
export async function activitiesFrom(inputs = [], { hrZones = null, onProgress = null } = {}) {
  const activities = [];
  let skipped = 0;
  const tick = () => { if (onProgress) onProgress(activities.length + skipped); };
  async function handle(name, bytes, level) {
    if (isZip(bytes)) {
      if (level > 1) { skipped++; return; }   // ZIP im ZIP im ZIP: nicht weiter
      let entries;
      try { entries = await unzip(bytes, (n) => ACTIVITY_RE.test(n) || /\.zip$/i.test(n)); } catch { skipped++; return; }
      for (const e of entries) await handle(e.name, e.data, level + 1);
      return;
    }
    let data = bytes;
    let fname = name;
    if (isGzip(data)) {
      try { data = await gunzip(data); fname = name.replace(/\.gz$/i, ''); } catch { skipped++; tick(); return; }
    }
    let act = null;
    try { act = parseActivityBytes(fname, data, { hrZones }); } catch { act = null; }
    if (act && act.durationSec) activities.push({ name: fname, act }); else skipped++;
    tick();
  }
  for (const f of inputs) await handle(f.name || '', f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data), 0);
  activities.sort((a, b) => a.act.date.localeCompare(b.act.date));
  return { activities, skipped };
}

/** Gleiche Einheit? Selber Tag, Strecke ± 400 m, Dauer ± 90 s (wie beim Einzelimport). */
export function sameActivity(a, b) {
  return !!a && !!b && a.date === b.date
    && Math.abs((a.distanceKm || 0) - (b.distanceKm || 0)) < 0.4
    && Math.abs((a.durationSec || 0) - (b.durationSec || 0)) < 90;
}

/** Sportart ohne Angabe in der Datei: ab 18 km/h eher Rad, sonst Lauf. */
export function guessType(act) {
  if (act.sportKnown) return act.type;
  const kmh = act.distanceKm && act.durationSec ? act.distanceKm / (act.durationSec / 3600) : 0;
  return kmh >= 18 ? 'cross_bike' : 'run';
}

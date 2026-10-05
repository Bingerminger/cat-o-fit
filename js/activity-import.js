/* =========================================================================
   activity-import.js — reading training files: single GPX/TCX/FIT, compressed
   files (.gz) and whole exports as ZIP (also ZIP in ZIP, as in the Garmin
   data export). DOM-free; health-import.js shows the preview and saves.
   ========================================================================= */

import { parseActivityFile } from './gpx.js';
import { parseFit, isFit } from './fit.js';
import { unzip, gunzip, isZip, isGzip } from './zip.js';

/** Files that count as an activity in an archive (also compressed). */
const ACTIVITY_RE = /\.(gpx|tcx|fit)(\.gz)?$/i;
/** The bulk import stores routes only for more recent sessions – that saves device storage. */
export const ROUTE_DAYS = 90;

/** One file (name + bytes) → activity or null. */
export function parseActivityBytes(name, bytes, { hrZones = null } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isFit(b)) return parseFit(b, { hrZones });
  return parseActivityFile(new TextDecoder().decode(b), { hrZones });
}

/**
 * Reads files (each `{ name, data: Uint8Array }`) including archives and returns the
 * recognised activities, oldest first. `skipped` counts files without a usable recording.
 * @returns {Promise<{activities: Array<{name:string, act:object}>, skipped:number}>}
 */
export async function activitiesFrom(inputs = [], { hrZones = null, onProgress = null } = {}) {
  const activities = [];
  let skipped = 0;
  const tick = () => { if (onProgress) onProgress(activities.length + skipped); };
  async function handle(name, bytes, level) {
    if (isZip(bytes)) {
      if (level > 1) { skipped++; return; }   // ZIP in ZIP in ZIP: no further
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

/** Same session? Same day, distance ± 400 m, duration ± 90 s (as with the single import). */
export function sameActivity(a, b) {
  return !!a && !!b && a.date === b.date
    && Math.abs((a.distanceKm || 0) - (b.distanceKm || 0)) < 0.4
    && Math.abs((a.durationSec || 0) - (b.durationSec || 0)) < 90;
}

/** Sport without an entry in the file: from 18 km/h more likely cycling, otherwise running. */
export function guessType(act) {
  if (act.sportKnown) return act.type;
  const kmh = act.distanceKm && act.durationSec ? act.distanceKm / (act.durationSec / 3600) : 0;
  return kmh >= 18 ? 'cross_bike' : 'run';
}

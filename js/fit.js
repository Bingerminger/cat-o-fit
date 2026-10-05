/* =========================================================================
   fit.js — read FIT files (Garmin, COROS, Polar, Suunto, Wahoo …) without a library.
   Pure, DOM-free logic → covered by node:test.

   FIT is a binary format: after the header come definition and data messages;
   a definition specifies for each "local type" which fields follow and at what size.
   Only the messages a training session needs are read:
     - session (18): sport, start, timer time, distance, avg/max HR, calories, elevation gain
     - record  (20): time, position, elevation, heart rate, distance per data point
     - activity (34): local time → offset to UTC (for the correct calendar day)
   Everything else (laps, device info, developer fields) is skipped. The evaluation
   itself (splits, HR zones, route) shares the file with GPX/TCX (gpx.js).
   ========================================================================= */

import { buildActivity } from './gpx.js';

/** FIT counts seconds from 31 Dec 1989 00:00 UTC. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
/** Degrees per "semicircle" (positions are signed 32-bit values). */
const SEMI = 180 / 2 ** 31;

/** Sport (FIT profile `sport`) → session type; sub-sport for treadmill, strength, yoga … */
const SPORT = { 1: 'run', 2: 'cross_bike', 5: 'swim', 11: 'walk', 17: 'hike', 15: 'rowing', 7: 'cross_football', 8: 'tennis' };
const SUB_SPORT = {
  20: 'strength', 26: 'gym', 19: 'mobility', 43: 'mobility', 44: 'mobility',
  15: 'elliptical', 14: 'rowing', 5: 'spinning', 6: 'spinning',
};

/** Size per base type (lower 5 bits) and "invalid" values. */
const BASE = {
  0: [1, 0xff], 1: [1, 0x7f], 2: [1, 0xff], 3: [2, 0x7fff], 4: [2, 0xffff], 5: [4, 0x7fffffff], 6: [4, 0xffffffff],
  7: [1, null], 8: [4, null], 9: [8, null], 10: [1, 0], 11: [2, 0], 12: [4, 0], 13: [1, 0xff], 14: [8, null], 15: [8, null], 16: [8, null],
};

function readValue(view, off, baseType, size, little) {
  const t = baseType & 0x1f;
  const [unit, invalid] = BASE[t] || [1, null];
  if (size < unit || t === 7 || t === 13 || t >= 14) return null;   // strings, bytes, 64 bit: not needed
  let v;
  switch (t) {
    case 0: case 2: case 10: v = view.getUint8(off); break;
    case 1: v = view.getInt8(off); break;
    case 3: v = view.getInt16(off, little); break;
    case 4: case 11: v = view.getUint16(off, little); break;
    case 5: v = view.getInt32(off, little); break;
    case 6: case 12: v = view.getUint32(off, little); break;
    case 8: v = view.getFloat32(off, little); break;
    case 9: v = view.getFloat64(off, little); break;
    default: return null;
  }
  if (invalid != null && v === invalid) return null;
  return v;
}

/**
 * Reads the messages of a FIT file. Returns { sessions, records, activity } with
 * raw field numbers → values; throws on a broken header.
 * @param {ArrayBuffer|Uint8Array} input
 */
export function readFit(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 14) throw new Error('not a FIT file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  if (headerSize < 12 || String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== '.FIT') throw new Error('not a FIT file');
  const dataSize = view.getUint32(4, true);
  const end = Math.min(bytes.length, headerSize + dataSize);

  const defs = new Map();          // local type → { global, little, fields, devSize }
  const out = { sessions: [], records: [], activity: null };
  let lastTs = null;
  let off = headerSize;
  while (off < end) {
    const h = bytes[off++];
    if (h & 0x80) {
      // Compressed timestamp: local type in bits 5–6, offset in bits 0–4.
      const def = defs.get((h >> 5) & 0x03);
      if (!def) break;
      const offset = h & 0x1f;
      if (lastTs != null) {
        let ts = (lastTs & ~0x1f) + offset;
        if (offset < (lastTs & 0x1f)) ts += 0x20;
        lastTs = ts;
      }
      const msg = readData(view, off, def);
      off += def.size;
      if (msg && msg[253] == null && lastTs != null) msg[253] = lastTs;
      collect(out, def.global, msg);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      // Definition: reserved, architecture, global number, fields (+ developer fields).
      const little = bytes[off + 1] === 0;
      const global = view.getUint16(off + 2, little);
      const n = bytes[off + 4];
      off += 5;
      const fields = [];
      let size = 0;
      for (let i = 0; i < n; i++) {
        fields.push({ num: bytes[off], size: bytes[off + 1], type: bytes[off + 2] });
        size += bytes[off + 1];
        off += 3;
      }
      if (h & 0x20) {
        const nd = bytes[off++];
        for (let i = 0; i < nd; i++) { size += bytes[off + 1]; off += 3; }
      }
      defs.set(local, { global, little, fields, size });
      continue;
    }
    const def = defs.get(local);
    if (!def) break;   // Data without a definition: file broken – carry on with what has been read
    const msg = readData(view, off, def);
    off += def.size;
    if (msg && msg[253] != null) lastTs = msg[253];
    collect(out, def.global, msg);
  }
  return out;
}

function readData(view, off, def) {
  if (off + def.size > view.byteLength) return null;
  const msg = {};
  let o = off;
  for (const f of def.fields) {
    msg[f.num] = readValue(view, o, f.type, f.size, def.little);
    o += f.size;
  }
  return msg;
}

function collect(out, global, msg) {
  if (!msg) return;
  if (global === 20) out.records.push(msg);
  else if (global === 18) out.sessions.push(msg);
  else if (global === 34) out.activity = msg;
}

const tsMs = (v) => (v == null ? null : FIT_EPOCH_MS + v * 1000);

/**
 * FIT file → session (same shape as `parseActivityFile`), null without a usable session.
 * @param {ArrayBuffer|Uint8Array} input
 * @param {{hrZones?: Array<{zone,min,max}>}} [opts]
 */
export function parseFit(input, { hrZones = null } = {}) {
  let fit;
  try { fit = readFit(input); } catch { return null; }
  const pts = fit.records
    .filter((r) => r[253] != null)
    .map((r) => {
      const eleRaw = r[78] != null ? r[78] : r[2];
      return {
        t: tsMs(r[253]),
        lat: r[0] != null ? r[0] * SEMI : null,
        lon: r[1] != null ? r[1] * SEMI : null,
        d: r[5] != null ? r[5] / 100 : null,
        hr: r[3] != null && r[3] > 0 ? r[3] : null,
        ele: eleRaw != null ? eleRaw / 5 - 500 : null,
      };
    })
    .sort((a, b) => a.t - b.t);

  // Multisport files have several sessions: the longest counts.
  const s = fit.sessions.slice().sort((a, b) => (b[8] || b[7] || 0) - (a[8] || a[7] || 0))[0] || null;
  const totals = {};
  let type = null;
  if (s) {
    if (s[2] != null) totals.start = tsMs(s[2]);
    if (s[2] != null && (s[7] != null || s[8] != null)) totals.end = totals.start + (s[7] != null ? s[7] : s[8]);
    if (s[8] != null) totals.durationSec = s[8] / 1000;
    if (s[9] != null) totals.distanceM = s[9] / 100;
    if (s[16] != null) totals.avgHr = s[16];
    if (s[17] != null) totals.maxHr = s[17];
    if (s[11] != null) totals.kcal = s[11];
    if (s[22] != null) totals.ascentM = s[22];
    type = SUB_SPORT[s[6]] || SPORT[s[5]] || null;
  }
  // Without a session time span: from the data points.
  if (totals.start == null && pts.length) totals.start = pts[0].t;
  if (totals.end == null && pts.length) totals.end = pts[pts.length - 1].t;
  // Local time of the recording → calendar day where the training took place.
  const a = fit.activity;
  const utcOffsetMin = a && a[253] != null && a[5] != null ? Math.round((a[5] - a[253]) / 60) : null;
  const act = buildActivity(pts, { type, totals, hrZones, utcOffsetMin: utcOffsetMin != null && Math.abs(utcOffsetMin) <= 14 * 60 ? utcOffsetMin : null });
  if (!act || !act.durationSec) return null;
  return act;
}

/** Does the content look like FIT (header with ".FIT")? */
export function isFit(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length >= 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54;
}

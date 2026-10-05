/* =========================================================================
   zip.js — reading ZIP and GZ archives in the browser, without a library: the central
   directory says where each file is; unpacking uses the built-in
   DecompressionStream ('deflate-raw' or 'gzip'). Intended for bulk exports
   (Garmin data export, Strava archive) – everything stays on the device.
   Limits against huge and bomb archives: 64 MB per file, 512 MB together,
   at most 5,000 entries. ZIP64 and encrypted entries are skipped.
   ========================================================================= */

import { t } from './i18n.js';

const MAX_ENTRY = 64 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const MAX_ENTRIES = 5000;

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
export const isZip = (b) => { const x = u8(b); return x.length >= 4 && x[0] === 0x50 && x[1] === 0x4b && x[2] === 0x03 && x[3] === 0x04; };
export const isGzip = (b) => { const x = u8(b); return x.length >= 2 && x[0] === 0x1f && x[1] === 0x8b; };

async function inflate(bytes, format, limit = MAX_ENTRY) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error(t('zip.tooLarge')); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Unpack a GZ file (e.g. "12345.fit.gz" from the Strava archive). */
export function gunzip(bytes) { return inflate(u8(bytes), 'gzip'); }

/**
 * Entries of a ZIP archive as [{ name, data: Uint8Array }] – without folders and only those
 * for which `filter(name)` returns true. Throws if no ZIP directory can be found.
 */
export async function unzip(bytes, filter = () => true) {
  const b = u8(bytes);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Search backwards for the end of the central directory (at most 64 KB of comment behind it).
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(t('zip.notZip'));
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (p === 0xffffffff || p >= b.length) throw new Error(t('zip.zip64'));
  const names = new TextDecoder();
  const out = [];
  let total = 0;
  for (let n = 0; n < count && n < MAX_ENTRIES; n++) {
    if (p + 46 > b.length || view.getUint32(p, true) !== 0x02014b50) break;
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true), xlen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true);
    const lho = view.getUint32(p + 42, true);
    const name = names.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || (flags & 1) || !filter(name)) continue;
    if (usize > MAX_ENTRY || total + usize > MAX_TOTAL || lho + 30 > b.length) continue;
    const start = lho + 30 + view.getUint16(lho + 26, true) + view.getUint16(lho + 28, true);
    const comp = b.subarray(start, start + csize);
    let data;
    try {
      if (method === 0) data = comp.slice();
      else if (method === 8) data = await inflate(comp, 'deflate-raw', Math.min(MAX_ENTRY, MAX_TOTAL - total));
      else continue;   // other compression methods do not occur in training exports
    } catch { continue; }
    total += data.length;
    out.push({ name, data });
  }
  return out;
}

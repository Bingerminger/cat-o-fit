/* =========================================================================
   store-merge.js — merging records and operations: the higher server rev wins, op ids, compacting
   the queue, field-wise profile patches. Layer 1.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { uid } from './ui.js';
import { adopted, retired } from './store-state.js';

export function stripRev(r) { const c = { ...r }; delete c.rev; return c; }

/** Content of a record without the fields the server sets on saving
    (rev, updatedAt) – keys sorted so that the order does not matter. */
export function contentKey(r) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {})
      : v);
  const c = { ...(r || {}) };
  delete c.rev; delete c.updatedAt;
  return JSON.stringify(canon(c));
}

/**
 * Merge server records into a local record list: the higher rev wins.
 * `changed`: at least one version was adopted (must be saved);
 * `visible`: content really changed in the process. If only our own, already
 * known records come back with a new rev, no view needs to redraw (FE-12).
 */
export function mergeRecords(arr, serverRecords) {
  const byId = new Map((arr || []).map((r) => [r.id, r]));
  let changed = false;
  let visible = false;
  for (const sr of serverRecords) {
    const l = byId.get(sr.id);
    if (!l || (sr.rev || 0) > (l.rev || 0)) {
      if (!visible && (!l || contentKey(l) !== contentKey(sr))) visible = true;
      byId.set(sr.id, sr);
      changed = true;
    }
  }
  return { records: [...byId.values()], changed, visible };
}

// Every op carries a unique `opId`. After a push exactly the ops that were sent are
// removed – not "the first n" –, even if the queue has changed in the meantime
// (user switch, second tab, compaction). The server ignores the field.
export function withOpId(op) { return op && op.opId ? op : { ...op, opId: uid('op') }; }
export function normalizeOps(opsByArea) {
  const out = {};
  for (const a in (opsByArea || {})) out[a] = (Array.isArray(opsByArea[a]) ? opsByArea[a] : []).map(withOpId);
  return out;
}
export function retire(ops) {
  for (const o of ops) if (o && o.opId) { retired.add(o.opId); adopted.delete(o.opId); }
  if (retired.size > 20000) { const keep = [...retired].slice(-10000); retired.clear(); keep.forEach((id) => retired.add(id)); }
}
export function opRecordId(o) { return o.op === 'upsert' ? (o.record && o.record.id) : (o.op === 'delete' ? o.id : null); }

/** Compacts on append: a replace op supersedes everything before it; an upsert/
    delete op supersedes older ops on the same record (after the last replace op). */
export function compactAppend(list, newOps) {
  let base = list;
  let adds = newOps;
  const lastRep = newOps.map((o) => o.op).lastIndexOf('replace');
  if (lastRep >= 0) { retire(base); base = []; adds = newOps.slice(lastRep); }
  let lastReplace = -1;
  base.forEach((o, i) => { if (o.op === 'replace') lastReplace = i; });
  const ids = new Set(adds.map(opRecordId).filter((x) => x != null));
  const kept = []; const dropped = [];
  base.forEach((o, i) => { if (i > lastReplace && ids.has(opRecordId(o))) dropped.push(o); else kept.push(o); });
  // Among the new ops, too, keep only the last one per record.
  const lastIdx = new Map();
  adds.forEach((o, i) => { const id = opRecordId(o); if (id != null) lastIdx.set(id, i); });
  const addsKept = adds.filter((o, i) => { const id = opRecordId(o); return id == null || lastIdx.get(id) === i || o.op === 'replace'; });
  retire(dropped);
  return foldMerges([...kept, ...addsKept]);
}

/** Field-wise profile writes (`merge`, v4.2) of one record that follow each other without another
    op on that record become one op – the newer value of a field wins, `settings` per key. The
    combined op gets a new opId: an op already on its way to the server stays untouched. */
export function foldMerges(list) {
  const out = []; const at = new Map(); const dropped = [];
  for (const o of list) {
    const id = o.op === 'merge' ? (o.record && o.record.id) : opRecordId(o);
    if (o.op === 'merge' && id != null && at.has(id)) {
      const i = at.get(id);
      dropped.push(out[i], o);
      out[i] = withOpId({ op: 'merge', record: mergePatch(out[i].record, o.record) });
      continue;
    }
    if (o.op === 'replace') at.clear(); else if (id != null) at.delete(id);
    if (o.op === 'merge' && id != null) at.set(id, out.length);
    out.push(o);
  }
  retire(dropped);
  return out;
}
/** Two profile patches as one: fields of `b` win, `settings` are combined per key. */
export function mergePatch(a, b) {
  const out = { ...a, ...b };
  if (a.settings || b.settings) out.settings = { ...(a.settings || {}), ...(b.settings || {}) };
  return out;
}

/**
 * Careful merging for the full sync (rev lines are not comparable after a restore):
 * the server version wins if its server timestamp is not older than the local one.
 * Otherwise the local version stays, but gets rev 0 so that every future server
 * change wins. NOTHING is deleted locally: if the server lost data (instead of
 * being deliberately restored), the copies on the devices are kept.
 */
export function mergeConservative(local, server) {
  if (!local) return server;
  if (!server) return { ...local, rev: 0 };
  return String(server.updatedAt || '') >= String(local.updatedAt || '') ? server : { ...local, rev: 0 };
}

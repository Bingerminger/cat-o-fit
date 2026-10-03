/* XSS-Sweep: Ein präparierter Text landet in (fast) allen Feldern der Demodaten – so wie
   er per API oder über eine fremde Backup-Datei hereinkommen könnte. Danach werden alle
   Ansichten gerendert. Kein innerHTML, kein Attribut und kein Stil darf den Text als
   Markup bzw. als nachladbare Adresse enthalten (Regel: Nutzertext nur per textContent).
   Vor v3.20.0 fand der Sweep die Zielgewicht-Zeile auf „Heute“ (Gewicht als HTML). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { safeAccent } from '../js/ui.js';

const P ='"><img src=x onerror=alert(1)>XSS';
const KEEP = new Set(['id', 'date', 'type', 'status', 'planId', 'eventId', 'plannedId', 'unitId', 'kind', 'key', 'sex', 'role', '_kind', 'phase', 'priority', 'category', 'unit', 'dow', 'startDate', 'createdAt', 'updatedAt', 'feeling', 'sport', 'distance', 'metric', 'source', 'art', 'region', 'time', 'dueDate', 'repeat', 'flow', 'area', 'movedFrom', 'executedSessionId', 'goal', 'program', 'level', 'mode', 'tone', 'intensity', 'weekday', 'fromDate', 'toDate', 'rev', 'deleted', 'exerciseIds', 'memberIds', 'template', 'meal', 'slot', 'end', 'start']);
const NUMS = new Set(['weight', 'restingHr', 'value', 'amount', 'kcal', 'distanceKm', 'bodyFat', 'hrv', 'sleepHours']);

function taint(o, depth = 0) {
  if (Array.isArray(o)) return o.map((x) => taint(x, depth + 1));
  if (o && typeof o === 'object') {
    const c = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && !KEEP.has(k) && !/^#|^\d{4}-\d\d/.test(v)) c[k] = v + P;
      else if (typeof v === 'number' && NUMS.has(k) && depth < 2) c[k] = String(v) + P;
      else c[k] = taint(v, depth + 1);
    }
    return c;
  }
  return o;
}

test('Kein Nutzertext wird als HTML, Attribut-Markup oder Stil-Adresse ausgegeben', async () => {
  for (const id of ['view', 'header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root', 'toast-root', 'sync-indicator', 'manage-banner']) {
    const n = document.createElement('div'); n.setAttribute('id', id); document.body.appendChild(n);
  }
  globalThis.__fakeServer.install();
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [] });
  assert.ok(await store.createFirstAdmin({ name: 'Admin' + P, pin: '1234' }));
  await store.seedDemo();
  for (const a of ['events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'labs', 'supplements']) {
    for (const r of store.get(a)) store.upsert(a, taint(r));
  }
  store.setProfile({ ...taint({ ...store.profile(), settings: store.settings() }), targetWeightKg: 68 });
  store.setSetting('accent', 'url(https://evil.example/x)');
  for (const m of store.members()) store.updateMember(m.id, { name: m.name + P, emoji: '🙂' + P, color: 'red;background:url(https://evil.example/x)' });
  for (const t of store.teams()) store.updateTeam(t.id, { name: t.name + P });
  store.setFamilyPantry(store.familyPantry().map((p) => ({ ...p, name: p.name + P })));

  const view = document.getElementById('view');
  const hits = [];
  const scan = (node, route) => {
    if (!node || node.nodeType !== 1) return;
    const tag = String(node.tagName || '').toLowerCase();
    if (node._innerHTML && /onerror|XSS/.test(node._innerHTML)) hits.push(`${route} · innerHTML <${tag}>: ${node._innerHTML.slice(0, 100)}`);
    for (const [k, v] of Object.entries(node.attributes || {})) {
      if (/XSS|onerror|evil\.example/.test(v) && !['aria-label', 'title', 'placeholder', 'value'].includes(k)) hits.push(`${route} · Attribut ${k} <${tag}>`);
    }
    for (const [k, v] of Object.entries(node.style || {})) if (/XSS|evil\.example/.test(String(v))) hits.push(`${route} · style.${k} <${tag}>`);
    for (const c of node.childNodes || []) scan(c, route);
  };
  const ev = store.get('events')[0]; const ses = store.get('sessions')[0];
  const plan = store.get('plans')[0]; const unit = plan && (plan.units || [])[3];
  const routes = [['dashboard', 'render'], ['calendar', 'render'], ['events', 'renderList'], ['events', 'renderDetail', ev?.id],
    ['plans', 'render', ev?.id], ['session', 'render', ses?.id], ['session', 'render', unit?.id], ['health', 'render'],
    ['statistics', 'render'], ['nutrition', 'render'], ['shopping', 'render'], ['checklist', 'render'], ['settings', 'render'],
    ['badges', 'render'], ['reports', 'render'], ['cycle', 'render'], ['labs-view', 'render'], ['exercises', 'render'],
    ['family', 'render'], ['family-admin', 'render'], ['health-import', 'render'], ['help', 'render'], ['workout-mode', 'render', unit?.id]];
  for (const [mod, fn, arg] of routes) {
    while (view.firstChild) view.removeChild(view.firstChild);
    const m = await import(`../js/${mod}.js`);
    await m[fn](view, arg);
    await new Promise((r) => setTimeout(r, 20));
    scan(view, `${mod}.${fn}`);
    scan(document.getElementById('header-title'), mod);
    scan(document.getElementById('modal-root'), `${mod} (Dialog)`);
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

test('Akzentfarbe: nur Hex-Werte, sonst die Standardfarbe', () => {
  assert.equal(safeAccent('#3d8bff'), '#3d8bff');
  assert.equal(safeAccent('#abc'), '#abc');
  assert.equal(safeAccent('url(https://evil.example/x)'), '#18b48a');
  assert.equal(safeAccent('red;background:url(x)'), '#18b48a');
  assert.equal(safeAccent(undefined), '#18b48a');
});

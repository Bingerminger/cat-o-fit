/* =========================================================================
   demo-server.js — the PHP API emulated in JavaScript, in memory.

   Two users: the tests (test-setup.js installs it as fetch, see
   `__fakeServer`) and the public demo build (tools/build-demo.mjs), which has
   no PHP: `installDemoServer()` answers every request to api/api.php in the
   browser, everything else goes to the network as usual.

   Emulates api/storage.php: global rev per area, tombstones, replace with
   optional baseRev, at most 2000 ops per request (otherwise 413). The push response
   carries – like the real server – the GLOBAL area rev, but only the caller's own
   records. Also api/auth.php: login/logout/session/set-pin/ics-token with ONE
   simulated browser session (`auth.session`), locking of the private areas, family
   rules (admin session, PIN hash never in responses).
   Test knobs: opts.latencyMs (number or (url, init) => ms), opts.offline,
   opts.failStatus, opts.failWhen, opts.opLimit, opts.features (['changes-all', 'ops-since']
   = bulk fetch and "since" in the ops response) and store(area, {user, scope}).
   ========================================================================= */

export function createFakeServer() {
  const stores = {};
  const requests = [];
  const DEFAULTS = { latencyMs: 0, offline: false, failStatus: null, failWhen: null, opLimit: 2000, features: [] };
  const opts = { ...DEFAULTS };
  const key = (area, scope, user) => `${scope}|${user || ''}|${area}`;
  const srv = (k) => (stores[k] ||= { rev: 0, records: {} });
  const resp = (o, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => o });
  const stripRev = (r) => { const c = { ...r }; delete c.rev; return c; };
  function applyOps(s, ops) {
    const now = new Date().toISOString();
    const applied = [];
    for (const op of ops) {
      if (op.op === 'upsert' && op.record && op.record.id) {
        const rec = { ...op.record, updatedAt: now, rev: ++s.rev }; delete rec.deleted;
        s.records[rec.id] = rec; applied.push(rec);
      } else if (op.op === 'delete' && op.id) {
        const prev = s.records[op.id] || {};
        const t = { id: op.id, deleted: true, updatedAt: now, rev: ++s.rev, ...(prev._kind ? { _kind: prev._kind } : {}) };
        s.records[op.id] = t; applied.push(t);
      } else if (op.op === 'replace' && Array.isArray(op.records)) {
        const base = typeof op.baseRev === 'number' ? op.baseRev : null;
        const newer = (r) => base !== null && (r.rev || 0) > base;
        const keep = new Set();
        for (const r of op.records) {
          if (!r || !r.id) continue;
          if (s.records[r.id] && newer(s.records[r.id])) { keep.add(r.id); continue; }
          const rec = { ...r, updatedAt: now, rev: ++s.rev }; delete rec.deleted;
          s.records[rec.id] = rec; applied.push(rec); keep.add(rec.id);
        }
        for (const id in s.records) {
          const r = s.records[id];
          if (!keep.has(id) && !r.deleted && !newer(r)) {
            const t = { id, deleted: true, updatedAt: now, rev: ++s.rev, ...(r._kind ? { _kind: r._kind } : {}) };
            s.records[id] = t; applied.push(t);
          }
        }
      }
    }
    return applied;
  }
  /* --- Sign-in like api/auth.php (one simulated browser with one session cookie) --- */
  const PRIVATE = ['cycle', 'labs', 'supplements'];
  const auth = { session: null, fails: {}, icsTokens: {} };
  const fam = () => srv(key('family', 'family', null));
  const member = (id) => { const r = fam().records[id]; return r && !r.deleted && (r._kind || 'member') === 'member' ? r : null; };
  const isHash = (h) => typeof h === 'string' && (/^[0-9a-f]{64}$/.test(h) || /^fb[0-9a-f]{1,8}$/.test(h));
  const legacy = (id, pin) => { const t = `catofit:${id}:${pin}`; let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return 'fb' + h.toString(16); };
  async function pinOk(m, id, pin) {
    if (!isHash(m.pinHash)) return true;
    const { sha256Hex } = await import('./sha256.js');
    return m.pinHash === sha256Hex(`catofit:${id}:${pin}`) || m.pinHash === legacy(id, pin);
  }
  const sessionRole = () => { const m = auth.session && member(auth.session); return m ? (m.role === 'admin' ? 'admin' : 'user') : null; };
  const publicRec = (r) => {
    if ((r._kind || 'member') !== 'member' || r.deleted) { const c = { ...r }; delete c.pinHash; return c; }
    const c = { ...r, hasPin: isHash(r.pinHash) }; delete c.pinHash;
    if (c.hasPin) c.pinHash = 'server';
    return c;
  };
  const hasAdmin = (s) => Object.values(s.records).some((r) => r && !r.deleted && (r._kind || 'member') === 'member' && r.role === 'admin');
  /** Check a family op like family_guard() in api/auth.php. */
  function familyGuard(op, s) {
    const admin = sessionRole() === 'admin';
    const trusted = admin || !hasAdmin(s);
    const clean = (rec) => {
      const c = { ...rec }; const incoming = c.pinHash; delete c.pinHash; delete c.hasPin;
      if ((c._kind || 'member') !== 'member') return c;
      const prev = s.records[c.id];
      if (trusted && isHash(incoming)) c.pinHash = incoming;
      else if (prev && !prev.deleted && isHash(prev.pinHash)) c.pinHash = prev.pinHash;
      return c;
    };
    if (op.op === 'upsert') {
      const rec = op.record || {}; const prev = s.records[rec.id]; const exists = !!(prev && !prev.deleted);
      const kind = rec._kind || (exists ? (prev._kind || 'member') : 'member');
      if (kind === 'member') {
        if (!exists && !trusted) return 'admin_add_member';
        const oldRole = exists ? (prev.role === 'admin' ? 'admin' : 'user') : null;
        const newRole = (rec.role ?? oldRole ?? 'user') === 'admin' ? 'admin' : 'user';
        if (exists && oldRole !== newRole && !trusted) return 'admin_change_role';
      }
      return { ...op, record: clean(rec) };
    }
    if (op.op === 'delete') {
      const prev = s.records[op.id];
      if (prev && !prev.deleted && (prev._kind || 'member') === 'member' && !admin) return 'admin_remove_member';
      return op;
    }
    if (op.op === 'replace') {
      if (!trusted) return 'admin_replace_family';
      return { ...op, records: (op.records || []).map(clean) };
    }
    return op;
  }
  async function authAction(action, u, init) {
    const body = init.body ? JSON.parse(init.body) : {};
    if (action === 'session') return resp({ ok: true, user: auth.session, role: sessionRole() });
    if (action === 'logout') { auth.session = null; return resp({ ok: true }); }
    if (action === 'login') {
      const m = member(body.user);
      if (!m) return resp({ ok: false, error: 'This profile does not exist (any more).', code: 'unknown' }, 404);
      if (isHash(m.pinHash)) {
        if ((auth.fails[body.user] || 0) >= 5) return resp({ ok: false, error: 'Too many failed attempts – please wait a moment.', code: 'locked', retryAfter: 900 }, 429);
        if (!(await pinOk(m, body.user, String(body.pin ?? '')))) {
          auth.fails[body.user] = (auth.fails[body.user] || 0) + 1;
          const left = 5 - auth.fails[body.user];
          return left > 0 ? resp({ ok: false, error: 'Wrong PIN.', code: 'pin', left }, 401)
            : resp({ ok: false, error: 'Too many failed attempts – please wait a moment.', code: 'locked', retryAfter: 900 }, 429);
        }
        delete auth.fails[body.user];
      }
      auth.session = body.user;
      return resp({ ok: true, user: body.user, role: m.role === 'admin' ? 'admin' : 'user', weakPin: !isHash(m.pinHash) || body.pin === '0000' });
    }
    if (!auth.session || !member(auth.session)) return resp({ ok: false, error: 'Please sign in – the sign-in at the server is missing or has expired.', code: 'session' }, 401);
    if (action === 'set-pin') {
      const m = member(body.user);
      if (!m) return resp({ ok: false, error: 'This profile does not exist (any more).', code: 'unknown' }, 404);
      if (auth.session === body.user) {
        if (isHash(m.pinHash) && !(await pinOk(m, body.user, String(body.old ?? '')))) return resp({ ok: false, error: 'The current PIN is wrong.', code: 'pin', left: 4 }, 401);
      } else if (sessionRole() !== 'admin') return resp({ ok: false, error: "Only an admin can set another person's PIN.", code: 'admin' }, 403);
      if (!/^\d{4,8}$/.test(String(body.pin)) || body.pin === '0000') return resp({ ok: false, error: 'The PIN needs 4 to 8 digits and must not be 0000.', code: 'weak' }, 400);
      const { sha256Hex } = await import('./sha256.js');
      const s = fam();
      s.records[body.user] = { ...m, pinHash: sha256Hex(`catofit:${body.user}:${body.pin}`), updatedAt: new Date().toISOString(), rev: ++s.rev };
      return resp({ ok: true });
    }
    if (action === 'ics-token') {
      if (auth.session !== body.user && sessionRole() !== 'admin') return resp({ ok: false, error: 'Only an admin can create calendar links for other people.', code: 'admin' }, 403);
      auth.icsTokens[body.user] ||= 'a'.repeat(48);
      return resp({ ok: true, token: auth.icsTokens[body.user] });
    }
    return null;
  }

  async function handler(url, init = {}) {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    const area = u.searchParams.get('area');
    const scope = u.searchParams.get('scope') === 'family' ? 'family' : 'user';
    const user = u.searchParams.get('user');
    const entry = { action, area, scope, user, ops: null, status: null, url: String(url), body: init.body || null };
    requests.push(entry);
    const delay = typeof opts.latencyMs === 'function' ? opts.latencyMs(u, init) : opts.latencyMs;
    // As in a real browser: an aborted request (timeout in the client) ends immediately.
    if (delay) {
      await new Promise((r, reject) => {
        const t = setTimeout(r, delay);
        if (init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('Aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
      });
    }
    if (opts.offline) { entry.status = 0; throw new TypeError('fetch failed (test server offline)'); }
    const failing = opts.failStatus || (typeof opts.failWhen === 'function' ? opts.failWhen(u, init) : null);
    if (failing) { entry.status = failing; return resp({ ok: false, error: 'Test failure' }, failing); }
    if (action === 'ping') return resp({ ok: true, pong: true, apiVersion: 1, features: opts.features });
    // Bulk fetch like api.php: only the named areas, private ones only with the person's own session.
    if (action === 'changes-all' && opts.features.includes('changes-all')) {
      const revs = {}, changes = {}, locked = [];
      for (const pair of (u.searchParams.get('since') || '').split(',')) {
        const m = /^([a-z]+):(\d+)$/.exec(pair.trim());
        if (!m) continue;
        const [, a, since] = m;
        if (PRIVATE.includes(a) && auth.session !== user) { locked.push(a); continue; }
        const st = srv(key(a, 'user', user));
        revs[a] = st.rev;
        const recs = Object.values(st.records).filter((r) => (r.rev || 0) > Number(since)).sort((x, y) => x.rev - y.rev);
        if (recs.length) changes[a] = recs;
      }
      return resp({ ok: true, revs, changes, locked });
    }
    if (['session', 'login', 'logout', 'set-pin', 'ics-token'].includes(action)) {
      const r = await authAction(action, u, init);
      entry.status = r.status;
      return r;
    }
    if (action === 'delete-user') {
      if (sessionRole() !== 'admin') { entry.status = 401; return resp({ ok: false, error: auth.session ? 'Only an admin can delete members.' : 'Please sign in – the sign-in at the server is missing or has expired.', code: auth.session ? 'admin' : 'session' }, auth.session ? 403 : 401); }
      for (const k of Object.keys(stores)) if (k.startsWith(`user|${user}|`)) delete stores[k];
      return resp({ ok: true, deleted: user });
    }
    // Private areas: only the signed-in person themself (like api.php).
    if (scope === 'user' && PRIVATE.includes(area) && (!auth.session || auth.session !== user)) {
      entry.status = auth.session ? 403 : 401;
      return resp({ ok: false, error: auth.session ? 'This area is private.' : 'Please sign in – the sign-in at the server is missing or has expired.', code: auth.session ? 'private' : 'session' }, entry.status);
    }
    const s = srv(key(area, scope, user));
    const out = (recs) => (scope === 'family' ? recs.map(publicRec) : recs);
    if (action === 'changes') {
      const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
      const records = Object.values(s.records).filter((r) => (r.rev || 0) > since).sort((a, b) => a.rev - b.rev);
      return resp({ ok: true, area, rev: s.rev, records: out(records) });
    }
    if (action === 'ops') {
      const body = JSON.parse(init.body || '{}');
      const ops = Array.isArray(body.ops) ? body.ops : [];
      entry.ops = ops.length;
      if (ops.length > opts.opLimit) { entry.status = 413; return resp({ ok: false, error: 'Too many operations in one batch.' }, 413); }
      if (scope === 'family') {
        // Like apply_ops with guard: check every op against the current state, then apply it.
        const rejected = []; const applied = [];
        for (const op of ops) {
          const checked = familyGuard(op, s);
          // Like api.php: a code (the app translates it) plus an English reason as fallback.
          if (typeof checked === 'string') rejected.push({ op: op.op, id: (op.record && op.record.id) || op.id || '', code: checked, reason: 'Only an admin with a server connection can do this.' });
          else applied.push(...applyOps(s, [checked]));
        }
        return resp({ ok: true, area, rev: s.rev, records: out(applied), ...(rejected.length ? { rejected } : {}) });
      }
      const applied = applyOps(s, ops);
      const extra = opts.features.includes('ops-since') && Number.isInteger(body.since)
        ? { changes: { rev: s.rev, records: Object.values(s.records).filter((r) => (r.rev || 0) > body.since).sort((a, b) => a.rev - b.rev) } }
        : {};
      return resp({ ok: true, area, rev: s.rev, records: applied, ...extra });
    }
    const data = Object.values(s.records).filter((r) => !r.deleted).map(stripRev);
    return resp({ ok: true, area, data: area === 'profile' ? (data[0] || {}) : out(data) });
  }
  return {
    opts, requests, handler, auth,
    store(area, { scope = 'user', user = null } = {}) { return srv(key(area, scope, user)); },
    reset() {
      for (const k of Object.keys(stores)) delete stores[k];
      requests.length = 0;
      Object.assign(opts, DEFAULTS);
      auth.session = null; auth.fails = {}; auth.icsTokens = {};
    },
  };
}

/** Server features the demo can offer; the rest answers "not available in the demo". */
const DEMO_UNAVAILABLE = ['foodfacts', 'health-import', 'health-ingest', 'ics', 'read'];

/** Demo build: every request to api/api.php is answered in the browser, from memory – a reload
    starts over. Requests elsewhere (weather, fonts) go to the network unchanged. */
export function installDemoServer() {
  const server = createFakeServer();
  server.opts.features = ['changes-all', 'ops-since'];
  const network = globalThis.fetch.bind(globalThis);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input && typeof input === 'object' && 'url' in input ? input.url : String(input), location.href);   // string, URL or Request
    if (!url.pathname.endsWith('/api/api.php')) return network(input, init);
    if (DEMO_UNAVAILABLE.includes(url.searchParams.get('action'))) return json({ ok: false, error: 'Not available in the demo.', code: 'demo' }, 501);
    const res = await server.handler(url.href, init);
    return json(await res.json(), res.status);
  };
  return server;
}

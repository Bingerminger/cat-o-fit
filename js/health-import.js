/* =========================================================================
   health-import.js — Apple-Health-Daten in die App bringen.
   Zwei Wege: (1) AUTOMATISCH & inkrementell über die App „Health Auto Export“
   (REST-Automation -> api/health-ingest.php), Aktivierung/Token hier in der
   Ansicht; (2) MANUELLER Voll-Import (Export-ZIP/export.xml) als Fallback.
   Kein direkter HealthKit-Zugriff (Web-App auf der Synology).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, navigate, typeMeta, fmtKm, fmtDuration, sectionHead, toast, todayStr, addDays,
  input, select, openSheet, closeSheet, confirmDialog, fmtDate, fmtNum, toggle,
} from './ui.js';
import { setHeader } from './router.js';
import { uploadHealthExport } from './api-client.js';
import { completeUnit } from './unit-actions.js';
import { activitiesFrom, parseActivityBytes, sameActivity, guessType, ROUTE_DAYS } from './activity-import.js';
import { isZip, isGzip } from './zip.js';
import { findPlannedMatch } from './planflow.js';

import { t, tp } from './i18n.js';

/** Herkunft automatisch empfangener Werte: Apple Health bzw. Health Connect (Android). */
const AUTO_SOURCES = ['apple-health', 'health-connect'];

/** Strecken aus Dateien mitspeichern? Standard ja; sie zeigen, wo jemand unterwegs war. */
export function routesWanted() { return store.settings().activityRoutes !== false; }

/** Sportarten zur Auswahl beim Datei-Import. */
const FILE_SPORTS = [
  { value: 'run', get label() { return t('sessionTypes.run.label'); } },
  { value: 'cross_bike', get label() { return t('healthImport.sportBike'); } },
  { value: 'walk', get label() { return t('healthImport.sportWalk'); } },
  { value: 'hike', get label() { return t('sessionTypes.hike.label'); } },
  { value: 'swim', get label() { return t('sessionTypes.swim.label'); } },
  { value: 'other', get label() { return t('healthImport.sportOther'); } },
];

export function render(view) {
  setHeader({ title: t('healthImport.title'), back: '#/health' });

  // Automatischer, inkrementeller Import (empfohlen) – über „Health Auto Export“.
  view.appendChild(sectionHead(t('healthImport.autoHeading'), null, { help: 'apple-health' }));
  // Kosten offen nennen (MKT-01/DOC-06): Die REST-Automation ist Premium; der Kurzbefehl ist gratis.
  view.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.84rem' }, text: t('healthImport.autoIntro') }));
  view.appendChild(healthIngestCard());
  // Android: Health Connect hat keine Web-Schnittstelle – eine Brücken-App schickt die Werte
  // an dieselbe Adresse (MKT-02).
  view.appendChild(el('div', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '20px', flex: '0 0 auto' } }),
    el('div', { class: 'grow' }, [
      el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: 'Android (Health Connect)' }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('healthImport.androidText') }),
      el('button', { class: 'btn btn--ghost mt-1', style: { fontSize: '.84rem', padding: '6px 10px' }, onclick: () => openHealthConnectHelp() }, [icon('info'), t('healthImport.setUp')]),
    ]),
  ]));
  view.appendChild(healthIngestRecent());

  // Manueller Voll-Import (Fallback)
  view.appendChild(sectionHead(t('healthImport.fullHeading')));
  view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '20px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.86rem' } },
      t('healthImport.fullText')),
  ]));

  // Anleitung
  view.appendChild(sectionHead(t('healthImport.howItWorks')));
  const steps = [
    t('healthImport.step1'),
    t('healthImport.step2'),
    t('healthImport.step3'),
    t('healthImport.step4'),
  ];
  const ol = el('div', { class: 'list-card' });
  steps.forEach((s, i) => ol.appendChild(el('div', { class: 'list-item' }, [
    el('span', { class: 'type-icon type-icon--sm', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)', fontWeight: '800' }, text: String(i + 1) }),
    el('div', { class: 'list-item__body' }, el('div', { class: 'list-item__title', style: { whiteSpace: 'normal' }, text: s })),
  ])));
  view.appendChild(ol);

  // Upload-Bereich
  view.appendChild(sectionHead(t('healthImport.uploadHeading')));
  const status = el('div', { class: 'card', hidden: true });
  const fileInput = el('input', { type: 'file', accept: '.zip,.xml,application/zip,text/xml', style: { display: 'none' } });
  const pickBtn = el('button', { class: 'btn btn--primary btn--block', onclick: () => fileInput.click() }, [icon('upload'), t('healthImport.pickExport')]);

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    runUpload(f, status);
  });

  view.appendChild(pickBtn);
  view.appendChild(fileInput);
  view.appendChild(status);

  // Einzelne Aktivität aus GPX/TCX (clientseitig, ohne Server)
  view.appendChild(sectionHead(t('healthImport.activitiesHeading')));
  view.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.84rem' }, text: t('healthImport.activitiesIntro', { days: ROUTE_DAYS }) }));
  view.appendChild(el('div', { class: 'row row--between mb-2', style: { alignItems: 'center', gap: '12px' } }, [
    el('div', { class: 'grow' }, [
      el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: t('healthImport.saveRoute') }),
      el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: t('healthImport.saveRouteHint') }),
    ]),
    toggle(routesWanted(), (v) => store.setSetting('activityRoutes', v), t('healthImport.saveRoute')),
  ]));
  const actStatus = el('div', { class: 'card', hidden: true });
  const actInput = el('input', { type: 'file', multiple: '', accept: '.gpx,.tcx,.fit,.zip,.gz,application/gpx+xml,application/xml,text/xml,application/zip,application/gzip', style: { display: 'none' } });
  const actBtn = el('button', { class: 'btn btn--soft btn--block', onclick: () => actInput.click() }, [icon('upload'), t('healthImport.pickActivities')]);
  actInput.addEventListener('change', () => {
    const files = [...(actInput.files || [])];
    actInput.value = '';
    if (!files.length) return;
    const single = files.length === 1 && !/\.(zip|gz)$/i.test(files[0].name);
    if (single) importActivity(files[0], actStatus); else batchImport(files, actStatus);
  });
  view.appendChild(actBtn);
  view.appendChild(actInput);
  view.appendChild(actStatus);

  // Hinweis
  view.appendChild(el('div', { class: 'dim mt-6', style: { fontSize: '.78rem' }, text: t('healthImport.bottomNote') }));
}

/** Zufalls-Token (hex) für den per-Nutzer-Health-Ingest-Endpunkt. */
function genToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Karte „Apple Health · Auto-Import“: Token erzeugen, Endpunkt-URL, Status, Anleitung. */
function healthIngestCard() {
  const wrap = el('div', {});
  const draw = () => {
    wrap.innerHTML = '';
    const token = store.profile().healthToken;
    if (!token) {
      wrap.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('healthImport.ingestIntro') }),
        el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => { store.setProfile({ healthToken: genToken() }); toast(t('healthImport.enabledToast'), 'good'); draw(); } }, [icon('plus'), t('healthImport.enable')]),
      ]));
      return;
    }
    const base = new URL('api/api.php', location.href.split('#')[0]).href;
    // Den Schlüssel als Header senden (X-Catofit-Token) statt in der URL – URLs landen in
    // Server- und Proxy-Protokollen. Die frühere URL mit &token= funktioniert weiter.
    const url = `${base}?action=health-ingest&user=${encodeURIComponent(store.activeUserId())}`;
    const recs = [...store.get('health'), ...store.get('sessions')].filter((x) => AUTO_SOURCES.includes(x.source));
    const last = recs.reduce((m, x) => ((x.updatedAt || '') > m ? (x.updatedAt || '') : m), '');
    const urlI = input({ value: url }); urlI.readOnly = true; urlI.onclick = (e) => e.target.select();
    const tokI = input({ value: token, type: 'password' }); tokI.readOnly = true; tokI.onclick = (e) => e.target.select();
    const copy = async (text, field, done) => {
      try { await navigator.clipboard.writeText(text); toast(done, 'good'); } catch { field.type = 'text'; field.select(); toast(t('healthImport.copyManually')); }
    };
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
        el('div', { class: 'card__title', text: t('healthImport.active') }),
        el('span', { class: 'chip chip--accent', text: last ? t('healthImport.receiving') : t('healthImport.waiting') }),
      ]),
      el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: last ? t('healthImport.lastReceived', { date: fmtDate(last.slice(0, 10)) }) : t('healthImport.noneReceived') }),
      el('div', { class: 'field__label mt-3', text: t('healthImport.endpointLabel') }),
      el('div', { class: 'row gap-2' }, [urlI,
        el('button', { class: 'btn btn--soft', 'aria-label': t('healthImport.copyUrl'), onclick: () => copy(url, urlI, t('healthImport.urlCopied')) }, icon('link')),
      ]),
      el('div', { class: 'field__label mt-3', text: t('healthImport.keyLabel') }),
      el('div', { class: 'row gap-2' }, [tokI,
        el('button', { class: 'btn btn--soft', 'aria-label': t('healthImport.copyKey'), onclick: () => copy(token, tokI, t('healthImport.keyCopied')) }, icon('link')),
      ]),
      el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: t('healthImport.keyNote') }),
      el('div', { class: 'row gap-2 mt-3' }, [
        el('button', { class: 'btn btn--ghost grow', onclick: () => openHealthAutoExportHelp() }, [icon('info'), t('healthImport.setUp')]),
        el('button', { class: 'btn btn--ghost', 'aria-label': t('healthImport.newToken'), onclick: async () => { if (await confirmDialog({ title: t('healthImport.newTokenTitle'), message: t('healthImport.newTokenText'), confirmLabel: t('healthImport.newTokenConfirm'), danger: true })) { store.setProfile({ healthToken: genToken() }); toast(t('healthImport.newTokenDone'), 'good'); draw(); } } }, icon('refresh')),
      ]),
    ]));
  };
  draw();
  return wrap;
}

/** Übersicht der zuletzt automatisch importierten Apple-Health-Werte (Kontrolle für den Nutzer). */
function healthIngestRecent() {
  const wrap = el('div', {});
  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));
  const health = store.get('health').filter((h) => AUTO_SOURCES.includes(h.source)).sort(byDateDesc).slice(0, 8);
  const sess = store.get('sessions').filter((s) => AUTO_SOURCES.includes(s.source)).sort(byDateDesc).slice(0, 6);
  if (!health.length && !sess.length) return wrap;   // noch nichts importiert -> nichts zeigen

  wrap.appendChild(sectionHead(t('healthImport.recentHeading')));

  if (health.length) {
    const list = el('div', { class: 'list-card' });
    health.forEach((h) => {
      const parts = [];
      if (h.weight != null) parts.push(`${fmtNum(h.weight, 1)} kg`);
      if (h.bodyFat != null) parts.push(t('healthImport.recentBodyFat', { value: fmtNum(h.bodyFat, 1) }));
      if (h.restingHr != null) parts.push(t('healthImport.recentResting', { value: h.restingHr }));
      if (h.leanMass != null) parts.push(t('healthImport.recentLean', { value: fmtNum(h.leanMass, 1) }));
      if (h.hrv != null) parts.push(`HRV ${h.hrv}`);
      if (h.vo2max != null) parts.push(`VO₂ ${fmtNum(h.vo2max, 1)}`);
      if (h.sleepHours != null) parts.push(t('healthImport.recentSleep', { value: fmtNum(h.sleepHours, 1) }));
      if (h.steps != null) parts.push(t('healthImport.recentSteps', { value: h.steps }));
      list.appendChild(el('div', { class: 'list-item' }, [
        el('div', { class: 'list-item__body' }, [
          el('div', { class: 'list-item__title', text: fmtDate(h.date) }),
          el('div', { class: 'muted', style: { fontSize: '.78rem', whiteSpace: 'normal' }, text: parts.join(' · ') || '—' }),
        ]),
      ]));
    });
    wrap.appendChild(list);
  }

  if (sess.length) {
    wrap.appendChild(el('div', { class: 'field__label mt-3', text: t('healthImport.workouts') }));
    const list = el('div', { class: 'list-card' });
    sess.forEach((s) => {
      const parts = [];
      if (s.distanceKm) parts.push(fmtKm(s.distanceKm, s.distanceKm % 1 ? 1 : 0));
      if (s.durationSec) parts.push(fmtDuration(s.durationSec));
      if (s.avgHr) parts.push(`Ø${s.avgHr}`);
      list.appendChild(el('div', { class: 'list-item' }, [
        el('div', { class: 'list-item__body' }, [
          el('div', { class: 'list-item__title', text: `${fmtDate(s.date)} · ${(typeMeta(s.type) || {}).label || s.type}` }),
          el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: parts.join(' · ') || '—' }),
        ]),
      ]));
    });
    wrap.appendChild(list);
  }
  return wrap;
}

function openHealthConnectHelp() {
  const steps = [
    t('healthImport.hcStep1'),
    t('healthImport.hcStep2'),
    t('healthImport.hcStep3'),
    t('healthImport.hcStep4'),
    t('healthImport.hcStep5'),
  ];
  openSheet({
    title: 'Android: Health Connect',
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.86rem' }, text: t('healthImport.hcIntro') }),
      el('ol', { class: 'mt-2', style: { paddingLeft: '18px', display: 'grid', gap: '8px', fontSize: '.86rem' } }, steps.map((step) => el('li', { text: step }))),
      el('div', { class: 'dim mt-3', style: { fontSize: '.74rem' }, text: t('healthImport.hcNote') }),
    ]),
    footer: [el('button', { class: 'btn btn--primary btn--block', text: t('healthImport.gotIt'), onclick: () => closeSheet() })],
  });
}

function openHealthAutoExportHelp() {
  const steps = [
    t('healthImport.aeStep1'),
    t('healthImport.aeStep2'),
    t('healthImport.aeStep3'),
    t('healthImport.aeStep4'),
    t('healthImport.aeStep5'),
    t('healthImport.aeStep6'),
    t('healthImport.aeStep7'),
    t('healthImport.aeStep8'),
  ];
  openSheet({
    title: t('healthImport.aeTitle'),
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.86rem' }, text: t('healthImport.aeIntro') }),
      el('ol', { class: 'mt-2', style: { paddingLeft: '18px', display: 'grid', gap: '8px', fontSize: '.86rem' } }, steps.map((step) => el('li', { text: step }))),
      el('div', { class: 'dim mt-3', style: { fontSize: '.74rem' }, text: t('healthImport.aeHistory') }),
      el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('healthImport.aeShortcut') }),
    ]),
    footer: [el('button', { class: 'btn btn--primary btn--block', text: t('healthImport.gotIt'), onclick: () => closeSheet() })],
  });
}

/** Session-Felder aus einer geparsten GPX/TCX-Datei für eine Sportart. */
export function activityData(data, type, { route = true } = {}) {
  const isRun = typeMeta(type).cat === 'run';
  return {
    distanceKm: data.distanceKm, durationSec: data.durationSec,
    paceSecPerKm: isRun && data.distanceKm && data.durationSec ? Math.round(data.durationSec / data.distanceKm) : null,
    avgHr: data.avgHr, maxHr: data.maxHr ?? null,
    splits: isRun || type === 'walk' || type === 'hike' ? (data.splits || []) : [],
    timeInZones: data.timeInZones || null,
    // Uhrenwerte, wo die Datei sie hat: Kalorien (aktiv), Höhenmeter, vereinfachte Strecke.
    kcal: data.kcal ?? null,
    ascentM: data.ascentM ?? null,
    route: route ? (data.route || null) : null,
    source: 'gpx',
  };
}

/**
 * Speichert viele Aktivitäten auf einmal (Massenimport): Doppelte – schon vorhanden oder
 * doppelt im Archiv – überspringen, passende geplante Einheiten erledigen, der Rest als freie
 * Trainings in EINEM Schreibvorgang. Strecken nur für die letzten ROUTE_DAYS Tage – und nur,
 * wenn „Strecke mitspeichern“ an ist.
 * @returns {{added:number, matched:number, dup:number}}
 */
export function importActivities(items = [], today = todayStr()) {
  const existing = store.get('sessions');
  const seen = [];
  const fresh = [];
  const routeFrom = addDays(today, -ROUTE_DAYS);
  const withRoute = routesWanted();
  let added = 0, matched = 0, dup = 0;
  for (const { act } of items) {
    if (!act || existing.some((x) => sameActivity(x, act)) || seen.some((x) => sameActivity(x, act))) { dup++; continue; }
    seen.push(act);
    const type = guessType(act);
    const fields = activityData(act, type, { route: withRoute && act.date >= routeFrom });
    const m = findPlannedMatch(store.get('plans'), { date: act.date, type });
    if (m) { completeUnit(m.plan, m.unit, fields); matched++; added++; continue; }
    fresh.push({ id: uid('ses'), plannedId: null, eventId: null, date: act.date, type, title: t('healthImport.fileImportTitle', { type: typeMeta(type).label }), rpe: null, feeling: null, notes: '', ...fields });
  }
  if (fresh.length && store.upsertMany('sessions', fresh).length) added += fresh.length;
  return { added, matched, dup };
}

/** Größer lesen wir ein Archiv nicht am Stück – der Browser hielte alles im Speicher. */
const MAX_ARCHIVE = 800 * 1024 * 1024;

/** Mehrere Dateien oder ein Archiv: lesen, Überblick zeigen, auf Wunsch alles übernehmen. */
async function batchImport(files, status) {
  status.hidden = false; status.innerHTML = '';
  if (files.some((f) => f.size > MAX_ARCHIVE)) {
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: t('healthImport.archiveTooBig') }));
    return;
  }
  const line = el('div', { class: 'row gap-2' }, [el('span', { class: 'spin', html: iconSvg('refresh'), style: { width: '18px' } }), el('span', { text: files.length === 1 ? t('healthImport.reading', { name: files[0].name }) : t('healthImport.readingMany', { n: files.length }) })]);
  status.appendChild(line);
  let result;
  try {
    const inputs = [];
    for (const f of files) inputs.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    result = await activitiesFrom(inputs, { hrZones: store.profile().hrZones || null, onProgress: (n) => { line.lastChild.textContent = tp('healthImport.filesRead', n); } });
  } catch {
    status.innerHTML = '';
    status.appendChild(el('div', { class: 'muted', text: t('healthImport.filesUnreadable') }));
    return;
  }
  status.innerHTML = '';
  const acts = result.activities;
  if (!acts.length) {
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: result.skipped ? tp('healthImport.noneRecognisedSkipped', result.skipped) : t('healthImport.noneRecognised') }));
    return;
  }
  const sessions = store.get('sessions');
  const dups = acts.filter(({ act }) => sessions.some((x) => sameActivity(x, act))).length;
  const byType = new Map();
  acts.forEach(({ act }) => { const l = typeMeta(guessType(act)).label; byType.set(l, (byType.get(l) || 0) + 1); });
  const first = acts[0].act.date, last = acts[acts.length - 1].act.date;
  status.appendChild(el('div', { class: 'col gap-2' }, [
    el('div', { style: { fontWeight: '700' }, text: tp('healthImport.activitiesFound', acts.length) }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${first === last ? fmtDate(first) : t('healthImport.dateRange', { from: fmtDate(first), to: fmtDate(last) })} · ${[...byType].map(([l, n]) => n + '× ' + l).join(', ')}` }),
    dups || result.skipped ? el('div', { class: 'dim', style: { fontSize: '.8rem' }, text: [dups ? tp('healthImport.alreadyThere', dups) : null, result.skipped ? tp('healthImport.filesWithoutRecording', result.skipped) : null].filter(Boolean).join(' · ') }) : null,
    el('div', { class: 'dim', style: { fontSize: '.78rem' }, text: t('healthImport.matchHint') }),
    el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      const r = importActivities(acts);
      status.innerHTML = '';
      status.appendChild(el('div', {}, [
        el('div', { style: { fontWeight: '700' }, text: `${tp('healthImport.imported', r.added)} ✓` }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: [r.matched ? tp('healthImport.matchedToPlanned', r.matched) : null, r.dup ? tp('healthImport.duplicatesSkipped', r.dup) : null].filter(Boolean).join(' · ') || t('healthImport.seeCalendar') }),
      ]));
      toast(tp('healthImport.imported', r.added), r.added ? 'good' : '');
    } }, [icon('check'), acts.length - dups > 0 ? t('healthImport.importN', { n: acts.length - dups }) : t('healthImport.takeOver')]),
  ]));
}

/**
 * Speichert eine importierte Aktivität: passt eine offene geplante Einheit desselben
 * Tages und derselben Sportart, wird sie ihr zugeordnet (die Einheit gilt dann als
 * erledigt); sonst entsteht ein freies Training. Liefert { session, matched }.
 */
export function saveImportedActivity(data, type, { link = true } = {}) {
  const match = link ? findPlannedMatch(store.get('plans'), { date: data.date, type }) : null;
  const fields = activityData(data, type, { route: routesWanted() });
  if (match) return { session: completeUnit(match.plan, match.unit, fields), matched: match.unit };
  const session = {
    id: uid('ses'), plannedId: null, eventId: null, date: data.date, type,
    title: t('healthImport.fileImportTitle', { type: typeMeta(type).label }), rpe: null, feeling: null, notes: '', ...fields,
  };
  store.upsert('sessions', session);
  return { session, matched: null };
}

/** Liest eine GPX-, TCX- oder FIT-Datei clientseitig, zeigt sie zur Bestätigung (Sportart,
    Zuordnung zur geplanten Einheit) und legt dann die Session an (mit Dedup). */
async function importActivity(file, status) {
  status.hidden = false; status.innerHTML = '';
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { status.textContent = t('healthImport.fileUnreadable'); return; }
  if (isZip(bytes) || isGzip(bytes)) { batchImport([file], status); return; }
  const data = parseActivityBytes(file.name, bytes, { hrZones: store.profile().hrZones || null });
  if (!data || !data.durationSec) {
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: t('healthImport.notRecognised') }));
    return;
  }
  if (store.get('sessions').some((sx) => sameActivity(sx, data))) {
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: t('healthImport.alreadyLogged') }));
    return;
  }
  // Sportart: aus der Datei; unbekannt → nach dem Tempo vorschlagen (ab 18 km/h eher Rad).
  let type = guessType(data);
  const options = FILE_SPORTS.some((o) => o.value === type) ? FILE_SPORTS : [{ value: type, label: typeMeta(type).label }, ...FILE_SPORTS];
  const sportSel = select(options, type, { 'aria-label': t('healthImport.sportLabel') });
  const matchLine = el('div', { class: 'muted', style: { fontSize: '.82rem' } });
  const showMatch = () => {
    const m = findPlannedMatch(store.get('plans'), { date: data.date, type });
    matchLine.textContent = m ? t('healthImport.willMatch', { title: m.unit.title }) : t('healthImport.noMatch');
  };
  sportSel.addEventListener('change', () => { type = sportSel.value; showMatch(); });
  showMatch();
  const extras = [
    data.splits && data.splits.length ? t('healthImport.kmSplits', { n: data.splits.length }) : null,
    data.timeInZones ? t('healthImport.timeInZones') : null,
    data.ascentM ? t('healthImport.ascent', { m: data.ascentM }) : null,
    data.route ? t('healthImport.route') : null,
  ].filter(Boolean);
  status.appendChild(el('div', { class: 'col gap-2' }, [
    el('div', { style: { fontWeight: '700' }, text: t('healthImport.activityRecognised') }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${fmtDate(data.date)} · ${data.distanceKm ? fmtKm(data.distanceKm, 1) + ' · ' : ''}${t('healthImport.movingTime', { time: fmtDuration(data.durationSec) })}${data.elapsedSec > data.durationSec + 60 ? ` (${t('healthImport.totalTime', { time: fmtDuration(data.elapsedSec) })})` : ''}${data.avgHr ? ' · Ø ' + data.avgHr + ' bpm' : ''}${extras.length ? ' · ' + extras.join(', ') : ''}` }),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: data.sportKnown ? t('healthImport.sportFromFile') : t('healthImport.sportCheck') }), sportSel]),
    matchLine,
    el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      const r = saveImportedActivity(data, type);
      status.innerHTML = '';
      status.appendChild(el('div', {}, [
        el('div', { style: { fontWeight: '700' }, text: t('healthImport.activityImportedCheck') }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: r.matched ? t('healthImport.matchedTo', { title: r.matched.title }) : t('healthImport.savedFree') }),
      ]));
      toast(t('healthImport.activityImported'), 'good');
    } }, [icon('check'), t('healthImport.takeOver')]),
  ]));
}

async function runUpload(file, status) {
  status.hidden = false;
  status.innerHTML = '';
  const bar = el('div', { class: 'progress mt-2' }, el('div', { class: 'progress__fill', style: { width: '8%' } }));
  status.appendChild(el('div', { class: 'row gap-2' }, [el('span', { class: 'spin', html: iconSvg('refresh'), style: { width: '18px' } }), el('span', { text: t('healthImport.processing', { name: file.name }) })]));
  status.appendChild(bar);

  try {
    const result = await uploadHealthExport(file, (p) => { bar.firstChild.style.width = `${Math.max(8, Math.round(p * 80))}%`; });
    bar.firstChild.style.width = '100%';
    showPreview(status, result);
  } catch (e) {
    status.innerHTML = '';
    status.appendChild(el('div', { class: 'row gap-2', style: { color: 'var(--bad-text)' } }, [icon('info'), el('span', { text: e.message || t('errors.importFailed') })]));
  }
}

function showPreview(status, result) {
  status.innerHTML = '';
  const s = result.summary || {};
  status.appendChild(el('div', { class: 'row gap-3 mb-3' }, [
    el('span', { class: 'type-icon', style: { background: 'var(--good)' }, html: iconSvg('check') }),
    el('div', {}, [el('div', { style: { fontWeight: '750' }, text: t('healthImport.fileRead') }), el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: [tp('healthImport.nWorkouts', s.workouts || 0), tp('healthImport.nHealthDays', s.healthDays || 0), s.periods ? tp('healthImport.nPeriods', s.periods) : null].filter(Boolean).join(' · ') })]),
  ]));

  if (!(result.workouts?.length) && !(result.health?.length) && !(result.periods?.length)) {
    status.appendChild(el('div', { class: 'muted', text: t('healthImport.nothingToImport') }));
    return;
  }

  // Zyklusdaten nur auf Wunsch – sie bleiben privat (nie für Admins, nicht im Familien-Backup).
  let withCycle = false;
  if (result.periods?.length) {
    withCycle = store.settings().modules?.cycle !== false;
    status.appendChild(el('div', { class: 'row row--between mt-2', style: { alignItems: 'center', gap: '12px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: tp('healthImport.takeCycleCount', result.periods.length) }),
        el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: t('healthImport.cyclePrivate') }),
      ]),
      toggle(withCycle, (v) => { withCycle = v; }, t('healthImport.takeCycle')),
    ]));
  }

  status.appendChild(el('button', {
    class: 'btn btn--primary btn--block mt-2', text: t('healthImport.takeData'),
    onclick: () => {
      const r = importResult(result, { cycle: withCycle });
      toast(r.pImp ? t('healthImport.doneWithCycle', { w: r.wImp, m: r.matched, h: r.hImp, p: r.pImp }) : t('healthImport.done', { w: r.wImp, m: r.matched, h: r.hImp }), 'good', 4000);
      setTimeout(() => navigate('#/health'), 400);
    },
  }));
  status.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.78rem' }, text: t('healthImport.skipNote') }));
}

export function importResult(result, { cycle = false } = {}) {
  let hImp = 0, wImp = 0, wSkip = 0, matched = 0, pImp = 0;
  // `leanMass` = Apple „Lean Body Mass“ (fettfreie Masse); `muscleMass` bleibt für ältere Server,
  // die sie noch so liefern (wird beim Lesen umgedeutet). `hrvMethod` gehört zum HRV-Wert.
  const HKEYS = ['weight', 'bodyFat', 'muscleMass', 'leanMass', 'visceralFat', 'restingHr', 'hrv', 'hrvMethod', 'vo2max', 'sleepHours'];

  // Einmal nachschlagen statt je Tag das ganze Array zu durchsuchen, und alles in EINEM
  // Schreibvorgang speichern: Ein 10-Jahres-Export sind ~3 650 Tage – je Tag einzeln zu
  // schreiben ließ die Oberfläche sekundenlang einfrieren und verdoppelte den Speicherbedarf.
  const byDate = new Map(store.get('health').map((x) => [x.date, x]));
  const healthRecs = [];
  (result.health || []).forEach((h) => {
    const existing = byDate.get(h.date);
    if (existing) {
      const patch = {};
      HKEYS.forEach((k) => { if (h[k] != null && existing[k] == null) patch[k] = h[k]; });
      // Die Herkunft des bestehenden Eintrags bleibt: Ein manuell angelegter Tag wird nicht
      // plötzlich zum Import (sonst würde seine Muskelmasse beim Lesen als Apple-Wert gedeutet).
      if (patch.hrv != null && h.hrvMethod) patch.hrvMethod = h.hrvMethod;
      if (Object.keys(patch).length) { const merged = { ...existing, ...patch, source: existing.source || 'health' }; byDate.set(h.date, merged); healthRecs.push(merged); hImp++; }
    } else {
      const rec = { id: uid('h'), date: h.date, source: 'health' };
      HKEYS.forEach((k) => { if (h[k] != null) rec[k] = h[k]; });
      byDate.set(h.date, rec);
      healthRecs.push(rec);
      hImp++;
    }
  });
  if (healthRecs.length && !store.upsertMany('health', healthRecs).length) hImp = 0;   // Speicher voll: nichts übernommen

  const sessionsByDate = new Map();
  const remember = (sx) => { (sessionsByDate.get(sx.date) || sessionsByDate.set(sx.date, []).get(sx.date)).push(sx); };
  store.get('sessions').forEach(remember);
  const newSessions = [];
  (result.workouts || []).forEach((w) => {
    const sameDay = sessionsByDate.get(w.date) || [];
    const dup = sameDay.find((sx) => Math.abs((sx.distanceKm || 0) - (w.distanceKm || 0)) < 0.4 && Math.abs((sx.durationSec || 0) - (w.durationSec || 0)) < 90);
    if (dup) { wSkip++; return; }

    // Dieselbe Zuordnungsregel wie beim Datei-Import und auf „Heute“: offene geplante
    // Einheit desselben Tages und derselben Sportart. Ältere Server liefern nur Läufe ohne Typ.
    const type = w.type || 'easy';
    const match = findPlannedMatch(store.get('plans'), { date: w.date, type });

    const data = { distanceKm: w.distanceKm, durationSec: w.durationSec, paceSecPerKm: w.paceSecPerKm, avgHr: w.avgHr, maxHr: w.maxHr, kcal: w.kcal, source: 'health' };
    // Auch zugeordnete Trainings merken, damit ein doppelt exportiertes übersprungen wird.
    if (match) { remember(completeUnit(match.plan, match.unit, data)); matched++; wImp++; }
    else {
      const rec = { id: uid('ses'), plannedId: null, eventId: null, date: w.date, type, title: w.title || t('healthImport.importTitle', { type: typeMeta(type).label }), splits: [], ...data };
      newSessions.push(rec);
      remember(rec);
      wImp++;
    }
  });
  if (newSessions.length && !store.upsertMany('sessions', newSessions).length) wImp -= newSessions.length;

  // Zyklus (privat) nur auf Wunsch: Periodenbeginne, die noch nicht erfasst sind (± 3 Tage).
  if (cycle && Array.isArray(result.periods) && result.periods.length) {
    const known = store.get('cycle').filter((c) => c && !c._kind && c.startDate).map((c) => c.startDate);
    const near = (a, b) => Math.abs(new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) <= 3 * 86400000;
    const recs = [];
    result.periods.forEach((p) => {
      if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.start) || known.some((k) => near(k, p.start))) return;
      known.push(p.start);
      recs.push({ id: uid('cyc'), startDate: p.start, periodLength: Math.max(1, Math.min(10, p.length | 0 || 5)), source: 'health', createdAt: new Date().toISOString() });
    });
    if (recs.length && store.upsertMany('cycle', recs).length) pImp = recs.length;
  }

  return { hImp, wImp, wSkip, matched, pImp };
}

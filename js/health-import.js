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

/** Herkunft automatisch empfangener Werte: Apple Health bzw. Health Connect (Android). */
const AUTO_SOURCES = ['apple-health', 'health-connect'];

/** Strecken aus Dateien mitspeichern? Standard ja; sie zeigen, wo jemand unterwegs war. */
export function routesWanted() { return store.settings().activityRoutes !== false; }

/** Sportarten zur Auswahl beim Datei-Import. */
const FILE_SPORTS = [
  { value: 'run', label: 'Lauf' }, { value: 'cross_bike', label: 'Radfahren' },
  { value: 'walk', label: 'Gehen' }, { value: 'hike', label: 'Wandern' },
  { value: 'swim', label: 'Schwimmen' }, { value: 'other', label: 'Sonstiges' },
];

export function render(view) {
  setHeader({ title: 'Health-Import', back: '#/health' });

  // Automatischer, inkrementeller Import (empfohlen) – über „Health Auto Export“.
  view.appendChild(sectionHead('Automatisch aus Apple Health', null, { help: 'apple-health' }));
  // Kosten offen nennen (MKT-01/DOC-06): Die REST-Automation ist Premium; der Kurzbefehl ist gratis.
  view.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.84rem' }, text: 'Lass dein iPhone täglich Gewicht, Puls, HRV, VO₂max, Schlaf und Workouts automatisch schicken. Zwei Wege: die App „Health Auto Export“ (automatische Übertragung nur mit Premium, laut App Store etwa 8 € im Jahr oder 30 € einmalig) oder kostenlos ein Kurzbefehl der Apple-App „Kurzbefehle“ (Tageswerte ohne Workouts). Beide nutzen die Adresse unten.' }));
  view.appendChild(healthIngestCard());
  // Android: Health Connect hat keine Web-Schnittstelle – eine Brücken-App schickt die Werte
  // an dieselbe Adresse (MKT-02).
  view.appendChild(el('div', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '20px', flex: '0 0 auto' } }),
    el('div', { class: 'grow' }, [
      el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: 'Android (Health Connect)' }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Eine Brücken-App wie das quelloffene „HC Webhook“ schickt Gewicht, Ruhepuls, HRV, Schlaf, Schritte und Trainings aus Health Connect an dieselbe Adresse – mit demselben Schlüssel.' }),
      el('button', { class: 'btn btn--ghost mt-1', style: { fontSize: '.84rem', padding: '6px 10px' }, onclick: () => openHealthConnectHelp() }, [icon('info'), 'So einrichten']),
    ]),
  ]));
  view.appendChild(healthIngestRecent());

  // Manueller Voll-Import (Fallback)
  view.appendChild(sectionHead('Manueller Voll-Import'));
  view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '20px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.86rem' } },
      'Alternativ den kompletten Verlauf als Datei: am iPhone exportieren und hier hochladen – so oft du möchtest. Doppelte Einträge werden automatisch erkannt.'),
  ]));

  // Anleitung
  view.appendChild(sectionHead('So geht\'s'));
  const steps = [
    'iPhone: Health-App öffnen → oben aufs Profilbild tippen.',
    '„Alle Gesundheitsdaten exportieren“ wählen – es entsteht eine ZIP-Datei.',
    'ZIP per AirDrop/Dateien auf iPad/Rechner legen oder direkt hier hochladen.',
    'Unten Datei auswählen (ZIP oder die enthaltene export.xml).',
  ];
  const ol = el('div', { class: 'list-card' });
  steps.forEach((s, i) => ol.appendChild(el('div', { class: 'list-item' }, [
    el('span', { class: 'type-icon type-icon--sm', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)', fontWeight: '800' }, text: String(i + 1) }),
    el('div', { class: 'list-item__body' }, el('div', { class: 'list-item__title', style: { whiteSpace: 'normal' }, text: s })),
  ])));
  view.appendChild(ol);

  // Upload-Bereich
  view.appendChild(sectionHead('Datei hochladen'));
  const status = el('div', { class: 'card', hidden: true });
  const fileInput = el('input', { type: 'file', accept: '.zip,.xml,application/zip,text/xml', style: { display: 'none' } });
  const pickBtn = el('button', { class: 'btn btn--primary btn--block', onclick: () => fileInput.click() }, [icon('upload'), 'Health-Export auswählen']);

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    runUpload(f, status);
  });

  view.appendChild(pickBtn);
  view.appendChild(fileInput);
  view.appendChild(status);

  // Einzelne Aktivität aus GPX/TCX (clientseitig, ohne Server)
  view.appendChild(sectionHead('Aktivitäten aus Dateien'));
  view.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.84rem' }, text: 'Aufzeichnungen deiner Uhr als GPX, TCX oder FIT – einzeln oder als ganzer Export im ZIP (Garmin-Datenexport, Strava-Archiv mit .fit.gz). Alles wird auf deinem Gerät gelesen; Sportart, Strecke, Höhenmeter und Herzfrequenz kommen mit. Strecken speichert der Massenimport für die letzten ' + ROUTE_DAYS + ' Tage.' }));
  view.appendChild(el('div', { class: 'row row--between mb-2', style: { alignItems: 'center', gap: '12px' } }, [
    el('div', { class: 'grow' }, [
      el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: 'Strecke mitspeichern' }),
      el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: 'Die Linie zeigt, wo du unterwegs warst – oft auch, wo du startest. Sie liegt bei deinen Trainings, die Admins beim Verwalten sehen.' }),
    ]),
    toggle(routesWanted(), (v) => store.setSetting('activityRoutes', v), 'Strecke mitspeichern'),
  ]));
  const actStatus = el('div', { class: 'card', hidden: true });
  const actInput = el('input', { type: 'file', multiple: '', accept: '.gpx,.tcx,.fit,.zip,.gz,application/gpx+xml,application/xml,text/xml,application/zip,application/gzip', style: { display: 'none' } });
  const actBtn = el('button', { class: 'btn btn--soft btn--block', onclick: () => actInput.click() }, [icon('upload'), 'Dateien auswählen (GPX, TCX, FIT, ZIP)']);
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
  view.appendChild(el('div', { class: 'dim mt-6', style: { fontSize: '.78rem' }, text: 'Der automatische Weg oben nutzt „Health Auto Export“ oder einen Kurzbefehl (täglich, nur Neues). Eine direkte HealthKit-Anbindung ohne Zusatz-App bräuchte eine native App – bewusst nicht umgesetzt. Anleitung für beide Wege: Doku „Apple Health“.' }));
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
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Gewicht, Ruhepuls, HRV, VO₂max, Schlaf & Workouts automatisch aus Apple Health – täglich und inkrementell über die App „Health Auto Export“. Kein 300-MB-Upload. Zum Aktivieren wird ein persönlicher Zugangs-Token erzeugt.' }),
        el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => { store.setProfile({ healthToken: genToken() }); toast('Auto-Import aktiviert', 'good'); draw(); } }, [icon('plus'), 'Auto-Import aktivieren']),
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
    const copy = async (text, field, what) => {
      try { await navigator.clipboard.writeText(text); toast(`${what} kopiert`, 'good'); } catch { field.type = 'text'; field.select(); toast('Manuell kopieren (⌘/Strg+C)'); }
    };
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
        el('div', { class: 'card__title', text: 'Auto-Import aktiv' }),
        el('span', { class: 'chip chip--accent', text: last ? 'Empfängt Daten' : 'Wartet auf Daten' }),
      ]),
      el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: last ? `Zuletzt empfangen: ${fmtDate(last.slice(0, 10))}` : 'Noch keine Daten empfangen – richte „Health Auto Export“ ein.' }),
      el('div', { class: 'field__label mt-3', text: 'Endpunkt-URL (in „Health Auto Export“ einfügen)' }),
      el('div', { class: 'row gap-2' }, [urlI,
        el('button', { class: 'btn btn--soft', 'aria-label': 'URL kopieren', onclick: () => copy(url, urlI, 'URL') }, icon('link')),
      ]),
      el('div', { class: 'field__label mt-3', text: 'Schlüssel (als Header „X-Catofit-Token“)' }),
      el('div', { class: 'row gap-2' }, [tokI,
        el('button', { class: 'btn btn--soft', 'aria-label': 'Schlüssel kopieren', onclick: () => copy(token, tokI, 'Schlüssel') }, icon('link')),
      ]),
      el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: 'Schlüssel und URL gehören zusammen – nicht weitergeben. Bereits eingerichtete Automationen mit „&token=“ in der URL funktionieren weiter.' }),
      el('div', { class: 'row gap-2 mt-3' }, [
        el('button', { class: 'btn btn--ghost grow', onclick: () => openHealthAutoExportHelp() }, [icon('info'), 'So einrichten']),
        el('button', { class: 'btn btn--ghost', 'aria-label': 'Token neu erzeugen', onclick: async () => { if (await confirmDialog({ title: 'Token neu erzeugen?', message: 'Der bisherige Schlüssel wird ungültig – du musst ihn in „Health Auto Export“ ersetzen.', confirmLabel: 'Neu erzeugen', danger: true })) { store.setProfile({ healthToken: genToken() }); toast('Neues Token erzeugt', 'good'); draw(); } } }, icon('refresh')),
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

  wrap.appendChild(sectionHead('Zuletzt importiert (automatisch)'));

  if (health.length) {
    const list = el('div', { class: 'list-card' });
    health.forEach((h) => {
      const parts = [];
      if (h.weight != null) parts.push(`${fmtNum(h.weight, 1)} kg`);
      if (h.bodyFat != null) parts.push(`${fmtNum(h.bodyFat, 1)} % KF`);
      if (h.restingHr != null) parts.push(`Ruhe ${h.restingHr}`);
      if (h.leanMass != null) parts.push(`FFM ${fmtNum(h.leanMass, 1)} kg`);
      if (h.hrv != null) parts.push(`HRV ${h.hrv}`);
      if (h.vo2max != null) parts.push(`VO₂ ${fmtNum(h.vo2max, 1)}`);
      if (h.sleepHours != null) parts.push(`${fmtNum(h.sleepHours, 1)} h Schlaf`);
      if (h.steps != null) parts.push(`${h.steps} Schr.`);
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
    wrap.appendChild(el('div', { class: 'field__label mt-3', text: 'Workouts' }));
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
    'Auf dem Android-Gerät eine Brücken-App installieren, die Health Connect per Webhook als JSON sendet – etwa „HC Webhook“ (quelloffen).',
    'Oben „Auto-Import aktivieren“ tippen, dann die Endpunkt-URL als Webhook-Adresse eintragen.',
    'Den Schlüssel als Header „X-Catofit-Token“ mitschicken. Kann die App keine Header setzen, hänge ihn an die Adresse an: …&token=<Schlüssel>.',
    'In der App die Datentypen freigeben: Gewicht, Körperfett, fettfreie Masse, Ruhepuls, HRV, Schlaf, Schritte, aktive Kalorien, Trainings und Herzfrequenz (für die Ø-HF der Trainings). Den Zyklus nur, wenn du ihn übernehmen möchtest – er bleibt privat.',
    'Synchronisation einschalten. Die Werte erscheinen beim nächsten Abgleich; doppelt geschickte Tage und Trainings erkennt Cat-O-Fit.',
  ];
  openSheet({
    title: 'Android: Health Connect',
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Health Connect ist nur für Apps auf dem Gerät erreichbar, nicht für Webseiten. Deshalb übernimmt eine kleine Brücken-App die Übertragung:' }),
      el('ol', { class: 'mt-2', style: { paddingLeft: '18px', display: 'grid', gap: '8px', fontSize: '.86rem' } }, steps.map((t) => el('li', { text: t }))),
      el('div', { class: 'dim mt-3', style: { fontSize: '.74rem' }, text: 'Tageswerte gehören zum Kalendertag in der Zeitzone deines Servers; die HRV aus Health Connect ist RMSSD und wird getrennt von Apple-Werten (SDNN) ausgewertet.' }),
    ]),
    footer: [el('button', { class: 'btn btn--primary btn--block', text: 'Alles klar', onclick: () => closeSheet() })],
  });
}

function openHealthAutoExportHelp() {
  const steps = [
    'App „Health Auto Export – JSON+CSV“ aus dem App Store installieren und öffnen. Die automatische Übertragung braucht Premium (laut App Store etwa 8 € im Jahr oder 30 € einmalig).',
    'Unten „Automations“ → „+“ → als Typ „REST API“ wählen.',
    'Bei „URL“ die kopierte Endpunkt-URL einfügen; Methode „POST“, Format „JSON“ (Export-Version 2).',
    'Unter „Headers“ hinzufügen: Schlüssel „X-Catofit-Token“, Wert = dein kopierter Schlüssel. (So taucht er in keinem Server-Protokoll auf.)',
    'Nur falls vor eurer Seite zusätzlich eine Anmeldung liegt (Reverse-Proxy mit Basic Auth): unter „Headers“ außerdem „Authorization: Basic …“. Ohne solche Anmeldung – etwa mit der eingebauten Basic-Auth des Containers – entfällt das.',
    'Metriken wählen: Gewicht, Körperfett, fettfreie Masse (Lean Body Mass), Ruhepuls, HRV, VO₂max, Schlaf, Schritte, aktive Energie – dazu „Workouts“.',
    'Aggregation „täglich“, Zeitplan „täglich“, Zeitraum „Since last sync“ (schickt nur Neues) – bei großen Backfills „Batch requests“ aktivieren.',
    'Speichern → „Run now“ zum Testen. Die Werte erscheinen nach dem nächsten Sync in Cat-O-Fit.',
  ];
  openSheet({
    title: 'Apple Health automatisch importieren',
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Dein iPhone schickt damit täglich die wichtigsten Werte an Cat-O-Fit – klein und automatisch. Einmal einrichten:' }),
      el('ol', { class: 'mt-2', style: { paddingLeft: '18px', display: 'grid', gap: '8px', fontSize: '.86rem' } }, steps.map((t) => el('li', { text: t }))),
      el('div', { class: 'dim mt-3', style: { fontSize: '.74rem' }, text: 'Für die 10-Jahre-Historie einmalig größere Zeiträume senden (z. B. je Monat) – Gewicht kann komplett rein, dichtere Werte 1–2 Jahre.' }),
      el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'Kostenlos geht es mit einem Kurzbefehl („Health-Samples suchen“ → „Inhalte von URL abrufen“, JSON wie { "date": "2026-09-29", "weight": "72,4" }) an dieselbe Adresse mit demselben Header – Schritt für Schritt in der Doku „Apple Health“.' }),
    ]),
    footer: [el('button', { class: 'btn btn--primary btn--block', text: 'Alles klar', onclick: () => closeSheet() })],
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
    fresh.push({ id: uid('ses'), plannedId: null, eventId: null, date: act.date, type, title: `${typeMeta(type).label} (Datei-Import)`, rpe: null, feeling: null, notes: '', ...fields });
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
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Das Archiv ist sehr groß. Entpacke es und wähle die Dateien mit den Aktivitäten direkt aus – beim Garmin-Export liegen sie in „DI_CONNECT/DI-Connect-Uploaded-Files“, beim Strava-Archiv im Ordner „activities“.' }));
    return;
  }
  const line = el('div', { class: 'row gap-2' }, [el('span', { class: 'spin', html: iconSvg('refresh'), style: { width: '18px' } }), el('span', { text: `Lese ${files.length === 1 ? files[0].name : files.length + ' Dateien'} …` })]);
  status.appendChild(line);
  let result;
  try {
    const inputs = [];
    for (const f of files) inputs.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    result = await activitiesFrom(inputs, { hrZones: store.profile().hrZones || null, onProgress: (n) => { line.lastChild.textContent = `${n} Dateien gelesen …`; } });
  } catch {
    status.innerHTML = '';
    status.appendChild(el('div', { class: 'muted', text: 'Die Dateien konnten nicht gelesen werden.' }));
    return;
  }
  status.innerHTML = '';
  const acts = result.activities;
  if (!acts.length) {
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: `Keine Aktivitäten erkannt${result.skipped ? ` (${result.skipped} Dateien ohne Aufzeichnung)` : ''}.` }));
    return;
  }
  const sessions = store.get('sessions');
  const dups = acts.filter(({ act }) => sessions.some((x) => sameActivity(x, act))).length;
  const byType = new Map();
  acts.forEach(({ act }) => { const l = typeMeta(guessType(act)).label; byType.set(l, (byType.get(l) || 0) + 1); });
  const first = acts[0].act.date, last = acts[acts.length - 1].act.date;
  status.appendChild(el('div', { class: 'col gap-2' }, [
    el('div', { style: { fontWeight: '700' }, text: `${acts.length} Aktivitäten erkannt` }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${first === last ? fmtDate(first) : fmtDate(first) + ' bis ' + fmtDate(last)} · ${[...byType].map(([l, n]) => n + '× ' + l).join(', ')}` }),
    dups || result.skipped ? el('div', { class: 'dim', style: { fontSize: '.8rem' }, text: [dups ? `${dups} schon vorhanden – werden übersprungen` : null, result.skipped ? `${result.skipped} Dateien ohne Aufzeichnung` : null].filter(Boolean).join(' · ') }) : null,
    el('div', { class: 'dim', style: { fontSize: '.78rem' }, text: 'Passt eine Aktivität zu einer geplanten Einheit desselben Tages, gilt diese als erledigt. Ohne Angabe in der Datei wird die Sportart nach dem Tempo geschätzt (ab 18 km/h Rad).' }),
    el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      const r = importActivities(acts);
      status.innerHTML = '';
      status.appendChild(el('div', {}, [
        el('div', { style: { fontWeight: '700' }, text: `${r.added} Aktivitäten übernommen ✓` }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: [r.matched ? `${r.matched} geplanten Einheiten zugeordnet` : null, r.dup ? `${r.dup} Doppelte übersprungen` : null].filter(Boolean).join(' · ') || 'Du findest sie im Kalender.' }),
      ]));
      toast(`${r.added} Aktivitäten übernommen`, r.added ? 'good' : '');
    } }, [icon('check'), acts.length - dups > 0 ? `${acts.length - dups} übernehmen` : 'Übernehmen']),
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
    title: `${typeMeta(type).label} (Datei-Import)`, rpe: null, feeling: null, notes: '', ...fields,
  };
  store.upsert('sessions', session);
  return { session, matched: null };
}

/** Liest eine GPX-, TCX- oder FIT-Datei clientseitig, zeigt sie zur Bestätigung (Sportart,
    Zuordnung zur geplanten Einheit) und legt dann die Session an (mit Dedup). */
async function importActivity(file, status) {
  status.hidden = false; status.innerHTML = '';
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { status.textContent = 'Datei konnte nicht gelesen werden.'; return; }
  if (isZip(bytes) || isGzip(bytes)) { batchImport([file], status); return; }
  const data = parseActivityBytes(file.name, bytes, { hrZones: store.profile().hrZones || null });
  if (!data || !data.durationSec) {
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Keine gültige Aktivität erkannt (GPX, TCX oder FIT mit Datum und Zeit).' }));
    return;
  }
  if (store.get('sessions').some((sx) => sameActivity(sx, data))) {
    status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Diese Aktivität ist bereits erfasst – Duplikat übersprungen.' }));
    return;
  }
  // Sportart: aus der Datei; unbekannt → nach dem Tempo vorschlagen (ab 18 km/h eher Rad).
  let type = guessType(data);
  const options = FILE_SPORTS.some((o) => o.value === type) ? FILE_SPORTS : [{ value: type, label: typeMeta(type).label }, ...FILE_SPORTS];
  const sportSel = select(options, type, { 'aria-label': 'Sportart' });
  const matchLine = el('div', { class: 'muted', style: { fontSize: '.82rem' } });
  const showMatch = () => {
    const m = findPlannedMatch(store.get('plans'), { date: data.date, type });
    matchLine.textContent = m ? `Wird der geplanten Einheit „${m.unit.title}“ zugeordnet.` : 'Keine passende geplante Einheit an diesem Tag – wird als freies Training gespeichert.';
  };
  sportSel.addEventListener('change', () => { type = sportSel.value; showMatch(); });
  showMatch();
  const extras = [
    data.splits && data.splits.length ? `${data.splits.length} km-Splits` : null,
    data.timeInZones ? 'Zeit in HF-Zonen' : null,
    data.ascentM ? `${data.ascentM} Hm` : null,
    data.route ? 'Strecke' : null,
  ].filter(Boolean);
  status.appendChild(el('div', { class: 'col gap-2' }, [
    el('div', { style: { fontWeight: '700' }, text: 'Aktivität erkannt' }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${fmtDate(data.date)} · ${data.distanceKm ? fmtKm(data.distanceKm, 1) + ' · ' : ''}${fmtDuration(data.durationSec)} in Bewegung${data.elapsedSec > data.durationSec + 60 ? ` (gesamt ${fmtDuration(data.elapsedSec)})` : ''}${data.avgHr ? ' · Ø ' + data.avgHr + ' bpm' : ''}${extras.length ? ' · ' + extras.join(', ') : ''}` }),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: data.sportKnown ? 'Sportart (aus der Datei)' : 'Sportart (bitte prüfen)' }), sportSel]),
    matchLine,
    el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      const r = saveImportedActivity(data, type);
      status.innerHTML = '';
      status.appendChild(el('div', {}, [
        el('div', { style: { fontWeight: '700' }, text: 'Aktivität importiert ✓' }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: r.matched ? `Der geplanten Einheit „${r.matched.title}“ zugeordnet.` : 'Als freies Training gespeichert – du findest es im Kalender.' }),
      ]));
      toast('Aktivität importiert', 'good');
    } }, [icon('check'), 'Übernehmen']),
  ]));
}

async function runUpload(file, status) {
  status.hidden = false;
  status.innerHTML = '';
  const bar = el('div', { class: 'progress mt-2' }, el('div', { class: 'progress__fill', style: { width: '8%' } }));
  status.appendChild(el('div', { class: 'row gap-2' }, [el('span', { class: 'spin', html: iconSvg('refresh'), style: { width: '18px' } }), el('span', { text: `Verarbeite ${file.name} …` })]));
  status.appendChild(bar);

  try {
    const result = await uploadHealthExport(file, (p) => { bar.firstChild.style.width = `${Math.max(8, Math.round(p * 80))}%`; });
    bar.firstChild.style.width = '100%';
    showPreview(status, result);
  } catch (e) {
    status.innerHTML = '';
    status.appendChild(el('div', { class: 'row gap-2', style: { color: 'var(--bad-text)' } }, [icon('info'), el('span', { text: e.message || 'Import fehlgeschlagen' })]));
  }
}

function showPreview(status, result) {
  status.innerHTML = '';
  const s = result.summary || {};
  status.appendChild(el('div', { class: 'row gap-3 mb-3' }, [
    el('span', { class: 'type-icon', style: { background: 'var(--good)' }, html: iconSvg('check') }),
    el('div', {}, [el('div', { style: { fontWeight: '750' }, text: 'Datei gelesen' }), el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${s.workouts || 0} Trainings · ${s.healthDays || 0} Tage mit Körperwerten${s.periods ? ` · ${s.periods} Perioden` : ''}` })]),
  ]));

  if (!(result.workouts?.length) && !(result.health?.length) && !(result.periods?.length)) {
    status.appendChild(el('div', { class: 'muted', text: 'Keine übernehmbaren Trainings oder Körperdaten gefunden.' }));
    return;
  }

  // Zyklusdaten nur auf Wunsch – sie bleiben privat (nie für Admins, nicht im Familien-Backup).
  let withCycle = false;
  if (result.periods?.length) {
    withCycle = store.settings().modules?.cycle !== false;
    status.appendChild(el('div', { class: 'row row--between mt-2', style: { alignItems: 'center', gap: '12px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: `Zyklus übernehmen (${result.periods.length} Perioden)` }),
        el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: 'Bleibt privat: nur du siehst ihn, auch am Server.' }),
      ]),
      toggle(withCycle, (v) => { withCycle = v; }, 'Zyklus übernehmen'),
    ]));
  }

  status.appendChild(el('button', {
    class: 'btn btn--primary btn--block mt-2', text: 'Daten übernehmen',
    onclick: () => {
      const r = importResult(result, { cycle: withCycle });
      toast(`${r.wImp} Trainings (${r.matched} zugeordnet), ${r.hImp} Körperwert-Tage${r.pImp ? `, ${r.pImp} Perioden` : ''} übernommen`, 'good', 4000);
      setTimeout(() => navigate('#/health'), 400);
    },
  }));
  status.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.78rem' }, text: 'Bereits vorhandene Einträge werden übersprungen oder ergänzt – nichts wird doppelt angelegt.' }));
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
      const rec = { id: uid('ses'), plannedId: null, eventId: null, date: w.date, type, title: w.title || `${typeMeta(type).label} (Import)`, splits: [], ...data };
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

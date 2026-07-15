/* =========================================================================
   health-import.js — Apple-Health-Daten in die App bringen.
   Zwei Wege: (1) AUTOMATISCH & inkrementell über die App „Health Auto Export"
   (REST-Automation -> api/health-ingest.php), Aktivierung/Token hier in der
   Ansicht; (2) MANUELLER Voll-Import (Export-ZIP/export.xml) als Fallback.
   Kein direkter HealthKit-Zugriff (Web-App auf der Synology).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, navigate, typeMeta, fmtKm, fmtDuration, sectionHead, toast,
  input, openSheet, closeSheet, confirmDialog, fmtDate, fmtNum,
} from './ui.js';
import { setHeader } from './router.js';
import { uploadHealthExport } from './api-client.js';
import { completeUnit } from './session.js';
import { parseActivityFile } from './gpx.js';

export function render(view) {
  setHeader({ title: 'Health-Import', back: '#/health' });

  // Automatischer, inkrementeller Import (empfohlen) – über „Health Auto Export".
  view.appendChild(sectionHead('Automatisch aus Apple Health (empfohlen)'));
  view.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.84rem' }, text: 'Lass dein iPhone täglich Gewicht, Puls, HRV, VO₂max, Schlaf & Workouts automatisch schicken – über die App „Health Auto Export". Kein großer Upload nötig.' }));
  view.appendChild(healthIngestCard());
  view.appendChild(healthIngestRecent());

  // Manueller Voll-Import (Fallback)
  view.appendChild(sectionHead('Manueller Voll-Import'));
  view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent)', width: '20px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.86rem' } },
      'Alternativ den kompletten Verlauf als Datei: am iPhone exportieren und hier hochladen – so oft du möchtest. Doppelte Einträge werden automatisch erkannt.'),
  ]));

  // Anleitung
  view.appendChild(sectionHead('So geht\'s'));
  const steps = [
    'iPhone: Health-App öffnen → oben aufs Profilbild tippen.',
    '„Alle Gesundheitsdaten exportieren" wählen – es entsteht eine ZIP-Datei.',
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
  view.appendChild(sectionHead('Einzelne Aktivität (GPX/TCX)'));
  view.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.84rem' }, text: 'Hast du eine einzelne Aufzeichnung als GPX- oder TCX-Datei (z. B. aus Garmin Connect, Strava-Export oder einer Uhren-App)? Lade sie direkt hier hoch – sie wird als absolvierter Lauf erfasst.' }));
  const actStatus = el('div', { class: 'card', hidden: true });
  const actInput = el('input', { type: 'file', accept: '.gpx,.tcx,application/gpx+xml,application/xml,text/xml', style: { display: 'none' } });
  const actBtn = el('button', { class: 'btn btn--soft btn--block', onclick: () => actInput.click() }, [icon('upload'), 'GPX-/TCX-Datei auswählen']);
  actInput.addEventListener('change', () => { const f = actInput.files[0]; if (f) importActivity(f, actStatus); });
  view.appendChild(actBtn);
  view.appendChild(actInput);
  view.appendChild(actStatus);

  // Hinweis
  view.appendChild(el('div', { class: 'dim mt-6', style: { fontSize: '.78rem' }, text: 'Der automatische Weg oben nutzt die App „Health Auto Export" (REST-Automation, täglich inkrementell). Eine direkte HealthKit-Anbindung ohne Zusatz-App bräuchte eine native App – bewusst nicht umgesetzt.' }));
}

/** Zufalls-Token (hex) für den per-Nutzer-Health-Ingest-Endpunkt. */
function genToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Karte „Apple Health · Auto-Import": Token erzeugen, Endpunkt-URL, Status, Anleitung. */
function healthIngestCard() {
  const wrap = el('div', {});
  const draw = () => {
    wrap.innerHTML = '';
    const token = store.profile().healthToken;
    if (!token) {
      wrap.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Gewicht, Ruhepuls, HRV, VO₂max, Schlaf & Workouts automatisch aus Apple Health – täglich und inkrementell über die App „Health Auto Export". Kein 300-MB-Upload. Zum Aktivieren wird ein persönlicher Zugangs-Token erzeugt.' }),
        el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => { store.setProfile({ healthToken: genToken() }); toast('Auto-Import aktiviert', 'good'); draw(); } }, [icon('plus'), 'Auto-Import aktivieren']),
      ]));
      return;
    }
    const base = new URL('api/api.php', location.href.split('#')[0]).href;
    const url = `${base}?action=health-ingest&user=${encodeURIComponent(store.activeUserId())}&token=${token}`;
    const recs = [...store.get('health'), ...store.get('sessions')].filter((x) => x.source === 'apple-health');
    const last = recs.reduce((m, x) => ((x.updatedAt || '') > m ? (x.updatedAt || '') : m), '');
    const urlI = input({ value: url }); urlI.readOnly = true; urlI.onclick = (e) => e.target.select();
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
        el('div', { class: 'card__title', text: 'Auto-Import aktiv' }),
        el('span', { class: 'chip chip--accent', text: last ? 'Empfängt Daten' : 'Wartet auf Daten' }),
      ]),
      el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: last ? `Zuletzt empfangen: ${fmtDate(last.slice(0, 10))}` : 'Noch keine Daten empfangen – richte „Health Auto Export" ein.' }),
      el('div', { class: 'field__label mt-3', text: 'Endpunkt-URL (in „Health Auto Export" einfügen)' }),
      el('div', { class: 'row gap-2' }, [urlI,
        el('button', { class: 'btn btn--soft', 'aria-label': 'URL kopieren', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('URL kopiert', 'good'); } catch { urlI.select(); toast('Manuell kopieren (⌘/Strg+C)'); } } }, icon('link')),
      ]),
      el('div', { class: 'row gap-2 mt-3' }, [
        el('button', { class: 'btn btn--ghost grow', onclick: () => openHealthAutoExportHelp() }, [icon('info'), 'So einrichten']),
        el('button', { class: 'btn btn--ghost', 'aria-label': 'Token neu erzeugen', onclick: async () => { if (await confirmDialog({ title: 'Token neu erzeugen?', message: 'Die bisherige URL wird ungültig – du musst sie in „Health Auto Export" ersetzen.', confirmLabel: 'Neu erzeugen', danger: true })) { store.setProfile({ healthToken: genToken() }); toast('Neues Token erzeugt', 'good'); draw(); } } }, icon('refresh')),
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
  const health = store.get('health').filter((h) => h.source === 'apple-health').sort(byDateDesc).slice(0, 8);
  const sess = store.get('sessions').filter((s) => s.source === 'apple-health').sort(byDateDesc).slice(0, 6);
  if (!health.length && !sess.length) return wrap;   // noch nichts importiert -> nichts zeigen

  wrap.appendChild(sectionHead('Zuletzt importiert (Apple Health)'));

  if (health.length) {
    const list = el('div', { class: 'list-card' });
    health.forEach((h) => {
      const parts = [];
      if (h.weight != null) parts.push(`${fmtNum(h.weight, 1)} kg`);
      if (h.bodyFat != null) parts.push(`${fmtNum(h.bodyFat, 1)} % KF`);
      if (h.restingHr != null) parts.push(`Ruhe ${h.restingHr}`);
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

function openHealthAutoExportHelp() {
  const steps = [
    'App „Health Auto Export – JSON+CSV" aus dem App Store installieren und öffnen.',
    'Unten „Automations" → „+" → als Typ „REST API" wählen.',
    'Bei „URL" die kopierte Endpunkt-URL einfügen; Methode „POST", Format „JSON (Health Metrics)".',
    'Unter „Headers" hinzufügen: „Authorization: Basic …" mit euren Web-Zugangsdaten (die Anmeldung der Seite).',
    'Metriken wählen: Gewicht, Körperfett, Muskelmasse, Ruhepuls, HRV, VO₂max, Schlaf, Schritte, aktive Energie – dazu „Workouts".',
    'Aggregation „täglich", Zeitplan „täglich", Zeitraum „Since last sync" (schickt nur Neues) – bei großen Backfills „Batch requests" aktivieren.',
    'Speichern → „Run now" zum Testen. Die Werte erscheinen nach dem nächsten Sync in Cat-O-Fit.',
  ];
  openSheet({
    title: 'Apple Health automatisch importieren',
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Dein iPhone schickt damit täglich die wichtigsten Werte an Cat-O-Fit – klein und automatisch. Einmal einrichten:' }),
      el('ol', { class: 'mt-2', style: { paddingLeft: '18px', display: 'grid', gap: '8px', fontSize: '.86rem' } }, steps.map((t) => el('li', { text: t }))),
      el('div', { class: 'dim mt-3', style: { fontSize: '.74rem' }, text: 'Für die 10-Jahre-Historie einmalig größere Zeiträume senden (z. B. je Monat) – Gewicht kann komplett rein, dichtere Werte 1–2 Jahre.' }),
    ]),
    footer: [el('button', { class: 'btn btn--primary btn--block', text: 'Alles klar', onclick: () => closeSheet() })],
  });
}

/** Liest eine GPX/TCX-Datei clientseitig und legt daraus eine Session an (mit Dedup). */
function importActivity(file, status) {
  const reader = new FileReader();
  reader.onload = () => {
    status.hidden = false; status.innerHTML = '';
    const data = parseActivityFile(String(reader.result || ''));
    if (!data || !data.durationSec) {
      status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Keine gültige GPX/TCX-Aktivität erkannt (Datum/Zeit fehlt?).' }));
      return;
    }
    const dup = store.get('sessions').find((sx) => sx.date === data.date
      && Math.abs((sx.distanceKm || 0) - (data.distanceKm || 0)) < 0.4
      && Math.abs((sx.durationSec || 0) - (data.durationSec || 0)) < 90);
    if (dup) {
      status.appendChild(el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Diese Aktivität ist bereits erfasst – Duplikat übersprungen.' }));
      return;
    }
    store.upsert('sessions', {
      id: uid('ses'), plannedId: null, eventId: null, type: data.type || 'run',
      title: 'Lauf (GPX/TCX-Import)', splits: [], date: data.date,
      distanceKm: data.distanceKm, durationSec: data.durationSec, avgHr: data.avgHr, status: 'erledigt',
    });
    status.appendChild(el('div', {}, [
      el('div', { style: { fontWeight: '700' }, text: 'Aktivität importiert ✓' }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${data.date} · ${data.distanceKm ? fmtKm(data.distanceKm, 1) + ' · ' : ''}${fmtDuration(data.durationSec)}${data.avgHr ? ' · ' + data.avgHr + ' bpm' : ''}` }),
    ]));
    toast('Aktivität importiert', 'good');
  };
  reader.onerror = () => { status.hidden = false; status.textContent = 'Datei konnte nicht gelesen werden.'; };
  reader.readAsText(file);
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
    status.appendChild(el('div', { class: 'row gap-2', style: { color: 'var(--bad)' } }, [icon('info'), el('span', { text: e.message || 'Import fehlgeschlagen' })]));
  }
}

function showPreview(status, result) {
  status.innerHTML = '';
  const s = result.summary || {};
  status.appendChild(el('div', { class: 'row gap-3 mb-3' }, [
    el('span', { class: 'type-icon', style: { background: 'var(--good)' }, html: iconSvg('check') }),
    el('div', {}, [el('div', { style: { fontWeight: '750' }, text: 'Datei gelesen' }), el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${s.workouts || 0} Lauf-Workouts · ${s.healthDays || 0} Tage mit Körperwerten` })]),
  ]));

  if (!(result.workouts?.length) && !(result.health?.length)) {
    status.appendChild(el('div', { class: 'muted', text: 'Keine übernehmbaren Lauf- oder Körperdaten gefunden.' }));
    return;
  }

  status.appendChild(el('button', {
    class: 'btn btn--primary btn--block mt-2', text: 'Daten übernehmen',
    onclick: () => {
      const r = importResult(result);
      toast(`${r.wImp} Läufe (${r.matched} zugeordnet), ${r.hImp} Körperwert-Tage übernommen`, 'good', 4000);
      setTimeout(() => navigate('#/health'), 400);
    },
  }));
  status.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.78rem' }, text: 'Bereits vorhandene Einträge werden übersprungen oder ergänzt – nichts wird doppelt angelegt.' }));
}

function importResult(result) {
  let hImp = 0, wImp = 0, wSkip = 0, matched = 0;
  const HKEYS = ['weight', 'bodyFat', 'muscleMass', 'visceralFat', 'restingHr', 'hrv', 'vo2max', 'sleepHours'];

  (result.health || []).forEach((h) => {
    const existing = store.get('health').find((x) => x.date === h.date);
    if (existing) {
      const patch = {};
      HKEYS.forEach((k) => { if (h[k] != null && existing[k] == null) patch[k] = h[k]; });
      if (Object.keys(patch).length) { store.patch('health', existing.id, { ...patch, source: 'health' }); hImp++; }
    } else {
      const rec = { id: uid('h'), date: h.date, source: 'health' };
      HKEYS.forEach((k) => { if (h[k] != null) rec[k] = h[k]; });
      store.upsert('health', rec);
      hImp++;
    }
  });

  (result.workouts || []).forEach((w) => {
    const dup = store.get('sessions').find((sx) => sx.date === w.date && Math.abs((sx.distanceKm || 0) - (w.distanceKm || 0)) < 0.4 && Math.abs((sx.durationSec || 0) - (w.durationSec || 0)) < 90);
    if (dup) { wSkip++; return; }

    let match = null;
    store.get('plans').forEach((p) => (p.units || []).forEach((u) => {
      if (!match && u.date === w.date && typeMeta(u.type).cat === 'run' && u.status !== 'erledigt') match = { plan: p, unit: u };
    }));

    const data = { distanceKm: w.distanceKm, durationSec: w.durationSec, paceSecPerKm: w.paceSecPerKm, avgHr: w.avgHr, maxHr: w.maxHr, kcal: w.kcal, source: 'health' };
    if (match) { completeUnit(match.plan, match.unit, data); matched++; wImp++; }
    else {
      store.upsert('sessions', { id: uid('ses'), plannedId: null, eventId: null, date: w.date, type: 'easy', title: 'Lauf (Import)', splits: [], ...data });
      wImp++;
    }
  });

  return { hImp, wImp, wSkip, matched };
}

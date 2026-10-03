/* =========================================================================
   reports.js — Berichte & Urkunden (Ansicht).

   Zeigt die abgelegten, versiegelten Reports und erzeugt neue (Monatsbericht,
   Wettkampf-Bericht, Urkunde). Reports sind unveränderlich (Store-seitig
   versiegelt) und werden hier nur dargestellt bzw. gedruckt (window.print,
   lokal – keine externen Dienste).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, toast, openSheet, closeSheet, sectionHead, emptyState,
  field, input, select, segmented, fmtDate, fmtDateLong, todayStr,
} from './ui.js';
import { setHeader } from './router.js';
import { progressTabs } from './nav.js';
import { buildMonthReport, buildEventReport, buildGoalReport, monthRange } from './report.js';
import { currentEligibility } from './wellness.js';
import { isProtectedDay } from './cycle.js';

const TYPE_META = {
  month: { label: 'Monatsbericht', icon: 'chart', color: '#3d8bff' },
  event: { label: 'Wettkampf-Bericht', icon: 'trophy', color: '#f5a623' },
  goal:  { label: 'Urkunde', icon: 'flag', color: '#18b48a' },
};
function tMeta(t) { return TYPE_META[t] || TYPE_META.month; }

export function render(view) {
  setHeader({
    title: 'Fortschritt',
    actions: [{ icon: 'plus', label: 'Bericht erstellen', onClick: () => openCreate() }],
  });
  view.appendChild(progressTabs('#/reports'));

  const reports = store.get('reports').slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  view.appendChild(el('div', { class: 'card card--flat' }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', flex: '0 0 auto', width: '20px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' } },
        'Berichte sind Momentaufnahmen: einmal erstellt, bleiben sie unverändert erhalten – als Beleg deiner Entwicklung. Sie lassen sich ansehen und ausdrucken (auch als PDF).'),
    ]),
  ]));

  if (!reports.length) {
    view.appendChild(emptyState('trophy', 'Noch keine Berichte', 'Erstelle deinen ersten Monatsbericht, einen Wettkampf-Bericht oder eine Urkunde.'));
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openCreate() }, [icon('plus'), 'Bericht erstellen']));
    return;
  }

  const list = el('div', { class: 'list-card mt-4' });
  reports.forEach((r) => {
    const m = tMeta(r.type);
    list.appendChild(el('button', { class: 'list-item', style: { width: '100%', textAlign: 'left' }, onclick: () => navigate(`#/report/${r.id}`) }, [
      el('span', { class: 'type-icon type-icon--sm', style: { background: 'var(--accent-soft)', color: m.color }, html: iconSvg(m.icon) }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: r.title }),
        el('div', { class: 'list-item__sub', text: `${m.label}${r.subtitle ? ' · ' + r.subtitle : ''} · erstellt ${fmtDate((r.createdAt || '').slice(0, 10))}` }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]));
  });
  view.appendChild(list);
}

/* ----------------------------- Erstellen -------------------------------- */
function openCreate() {
  let type = 'month';
  const bodyHost = el('div');
  const formWrap = el('div');
  const previewHost = el('div', { hidden: true });
  // Erst ansehen, dann versiegeln (UI-39): „Ändern“ kehrt zum Formular zurück, die Eingaben bleiben.
  const toPreview = (report) => {
    formWrap.hidden = true;
    previewHost.hidden = false;
    previewHost.innerHTML = '';
    previewHost.appendChild(reportPreview(report, {
      onEdit: () => { previewHost.hidden = true; formWrap.hidden = false; },
      onSave: () => seal(report),
    }));
  };
  const renderBody = () => {
    bodyHost.innerHTML = '';
    if (type === 'month') bodyHost.appendChild(monthForm(toPreview));
    else if (type === 'event') bodyHost.appendChild(eventForm(toPreview));
    else bodyHost.appendChild(goalForm(toPreview));
  };
  const typeCtl = segmented(
    [{ value: 'month', label: 'Monat' }, { value: 'event', label: 'Wettkampf' }, { value: 'goal', label: 'Urkunde' }],
    type, (v) => { type = v; renderBody(); },
  );
  renderBody();
  formWrap.appendChild(field('Art', typeCtl));
  formWrap.appendChild(bodyHost);
  openSheet({ title: 'Bericht erstellen', body: el('div', {}, [formWrap, previewHost]) });
}

/** Vorschau eines noch nicht gespeicherten Berichts – so, wie er danach aussieht. */
export function reportPreview(report, { onEdit, onSave }) {
  const m = tMeta(report.type);
  const isCert = report.type === 'goal' || report.certificate;
  const sheet = el('div', { class: `report-sheet ${isCert ? 'report-sheet--cert' : 'report-sheet--report'}`, style: { '--report-accent': m.color } });
  const shown = { ...report, createdAt: report.createdAt || new Date().toISOString() };
  if (isCert) buildCertificate(sheet, shown);
  else buildReport(sheet, shown, m);
  return el('div', {}, [
    el('div', { class: 'dim', style: { fontSize: '.8rem' }, text: 'Vorschau – nach dem Speichern bleibt der Bericht unverändert erhalten, als Beleg.' }),
    sheet,
    el('div', { class: 'row gap-2 mt-3' }, [
      el('button', { class: 'btn btn--ghost grow', type: 'button', onclick: onEdit }, 'Ändern'),
      el('button', { class: 'btn btn--primary grow', type: 'button', onclick: onSave }, [icon('check'), isCert ? 'Urkunde speichern' : 'Bericht speichern']),
    ]),
  ]);
}

function seal(report) {
  const rec = store.addReport(report);
  closeSheet();
  toast('Bericht erstellt', 'good');
  navigate(`#/report/${rec.id}`);
}

function monthForm(done) {
  // letzte 12 Monate als Auswahl
  const today = todayStr();
  const opts = [];
  const d = new Date(today + 'T00:00:00');
  for (let i = 0; i < 12; i++) {
    const ms = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push({ value: ms, label: monthRange(ms).label });
    d.setMonth(d.getMonth() - 1);
  }
  // Vorgewählt ist der letzte ABGESCHLOSSENE Monat; der laufende bleibt wählbar, mit Hinweis –
  // ein Bericht wird versiegelt und lässt sich nicht mehr ergänzen (UI-39).
  let month = opts[1].value;
  const note = el('div', { class: 'dim mt-1', style: { fontSize: '.78rem' } });
  const setNote = () => {
    note.textContent = month === opts[0].value
      ? `Der Monat läuft noch – der Bericht zeigt den Stand vom ${fmtDate(today)} und bleibt danach unverändert.`
      : '';
  };
  const sel = select(opts, month, { onchange: (e) => { month = e.target.value; setNote(); } });
  setNote();
  return el('div', {}, [
    field('Monat', sel),
    note,
    el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => done(buildMonthReport({
      profile: store.profile(), sessions: store.get('sessions'), plans: store.get('plans'),
      health: store.get('health'), events: store.get('events'), monthStr: month, today: todayStr(),
      // Kinder, Schwangerschaft/Stillzeit, Essstörung: kein Gewichtsverlauf im Bericht.
      showWeight: !currentEligibility().noWeightGoals,
      // Geschützte Zyklustage zählen wie in Statistik und Erfolgen nicht als verpasst.
      isProtectedDay,
    })) }, [icon('check'), 'Monatsbericht erstellen']),
  ]);
}

function eventForm(done) {
  const events = store.get('events').filter((e) => e.kind !== 'program');
  if (!events.length) return el('div', { class: 'muted', text: 'Noch kein Wettkampf angelegt.' });
  let eid = events[0].id;
  const sel = select(events.map((e) => ({ value: e.id, label: e.name })), eid, { onchange: (e) => { eid = e.target.value; } });
  return el('div', {}, [
    field('Wettkampf', sel),
    el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: 'Enthält Vorbereitung und – falls erfasst – das Ergebnis.' }),
    el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => {
      const ev = store.find('events', eid);
      const plan = store.get('plans').find((p) => p.eventId === eid) || null;
      done(buildEventReport({ profile: store.profile(), event: ev, plan, sessions: store.get('sessions'), health: store.get('health'), today: todayStr(), isProtectedDay }));
    } }, [icon('check'), 'Wettkampf-Bericht erstellen']),
  ]);
}

function goalForm(done) {
  const titleI = input({ placeholder: 'z. B. Zielgewicht erreicht' });
  const detailI = input({ placeholder: 'z. B. von 72 auf 65 kg (optional)' });
  return el('div', {}, [
    field('Titel des Ziels', titleI),
    field('Details (optional)', detailI),
    el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => {
      const t = titleI.value.trim(); if (!t) { toast('Bitte einen Titel eingeben', 'bad'); return; }
      done(buildGoalReport({ profile: store.profile(), goalTitle: t, goalDetail: detailI.value.trim(), date: todayStr() }));
    } }, [icon('check'), 'Urkunde erstellen']),
  ]);
}

/* ------------------------------- Detail --------------------------------- */
export function renderDetail(view, id) {
  const r = store.find('reports', id);
  if (!r) { navigate('#/reports'); return; }
  const m = tMeta(r.type);
  setHeader({
    title: m.label, back: '#/reports',
    actions: [{ icon: 'download', label: 'Drucken / PDF', onClick: () => window.print() }],
  });

  const isCert = r.type === 'goal' || r.certificate;
  const sheet = el('div', {
    class: `report-sheet ${isCert ? 'report-sheet--cert' : 'report-sheet--report'}`,
    id: 'report-print', style: { '--report-accent': m.color },
  });
  if (isCert) buildCertificate(sheet, r);
  else buildReport(sheet, r, m);

  view.appendChild(sheet);
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-4 no-print', onclick: () => window.print() }, [icon('download'), 'Drucken oder als PDF speichern']));
}

/** „🌱 Name“ -> { emoji, name } für schöne Badge-Kacheln. */
function splitBadge(h) {
  const sp = h.indexOf(' ');
  return sp < 0 ? { emoji: '🏅', name: h } : { emoji: h.slice(0, sp), name: h.slice(sp + 1) };
}
function badgeTiles(highlights) {
  return el('div', { class: 'report-badges' }, highlights.map((h) => {
    const { emoji, name } = splitBadge(h);
    return el('div', { class: 'report-badge' }, [
      el('span', { class: 'report-badge__emoji', text: emoji }),
      el('span', { class: 'report-badge__name', text: name }),
    ]);
  }));
}

/* ----------------------------- Urkunde ---------------------------------- */
function buildCertificate(sheet, r) {
  sheet.appendChild(el('div', { class: 'cert__corner cert__corner--tl' }));
  sheet.appendChild(el('div', { class: 'cert__corner cert__corner--tr' }));
  sheet.appendChild(el('div', { class: 'cert__corner cert__corner--bl' }));
  sheet.appendChild(el('div', { class: 'cert__corner cert__corner--br' }));

  sheet.appendChild(el('div', { class: 'cert__brand' }, [
    el('span', { class: 'cert__brand-logo', html: iconSvg('activity') }), 'Cat-O-Fit',
  ]));
  sheet.appendChild(el('div', { class: 'cert__seal' }, [el('span', { text: '★' })]));
  sheet.appendChild(el('div', { class: 'cert__kicker', text: 'Urkunde' }));
  if (r.subtitle) sheet.appendChild(el('div', { class: 'cert__award', text: r.subtitle }));
  sheet.appendChild(el('div', { class: 'cert__presented', text: 'verliehen an' }));
  sheet.appendChild(el('div', { class: 'cert__name', text: r.subject?.name || '—' }));
  sheet.appendChild(el('div', { class: 'cert__rule' }));
  if (r.verdict) sheet.appendChild(el('div', { class: 'cert__verdict', text: r.verdict }));
  (r.sections || []).forEach((sec) => sec.items.forEach((it) => {
    sheet.appendChild(el('div', { class: 'cert__detail' }, [
      el('span', { class: 'cert__detail-label', text: it.label }), el('span', { class: 'cert__detail-value', text: it.value }),
    ]));
  }));
  if (r.highlights?.length) sheet.appendChild(badgeTiles(r.highlights));
  sheet.appendChild(el('div', { class: 'cert__foot', text: `Verliehen am ${fmtDateLong((r.createdAt || '').slice(0, 10))}` }));
  sheet.appendChild(el('div', { class: 'cert__seal-note', text: 'Unveränderlicher Beleg · Cat-O-Fit' }));
}

/* ----------------------------- Bericht ---------------------------------- */
function buildReport(sheet, r, m) {
  // farbige Kopfleiste
  sheet.appendChild(el('div', { class: 'report-head' }, [
    el('div', { class: 'report-head__row' }, [
      el('span', { class: 'report-head__brand' }, [el('span', { class: 'report-head__logo', html: iconSvg('activity') }), 'Cat-O-Fit']),
      el('span', { class: 'report-head__badge', html: iconSvg(m.icon) }),
    ]),
    el('div', { class: 'report-head__title', text: r.title }),
    el('div', { class: 'report-head__meta', text: [r.subject?.name && `für ${r.subject.name}`, r.period?.label, r.period?.asOf && `Stand ${fmtDate(r.period.asOf)}`].filter(Boolean).join(' · ') }),
  ]));

  const body = el('div', { class: 'report-body' });

  if (r.verdict) body.appendChild(el('div', { class: 'report-verdict' }, [
    el('span', { class: 'report-verdict__mark', text: '“' }),
    el('span', { text: r.verdict }),
  ]));

  (r.sections || []).forEach((sec) => {
    body.appendChild(el('div', { class: 'report-section-head' }, [el('span', { class: 'report-section-bar' }), sec.heading]));
    body.appendChild(el('div', { class: 'report-stat-grid' }, sec.items.map((it) => el('div', { class: 'report-stat' }, [
      el('div', { class: 'report-stat__value', text: it.value }),
      el('div', { class: 'report-stat__label', text: it.label }),
    ]))));
  });

  if (r.highlights?.length) {
    body.appendChild(el('div', { class: 'report-section-head' }, [el('span', { class: 'report-section-bar' }), 'Erfolge in diesem Zeitraum']));
    body.appendChild(badgeTiles(r.highlights));
  }

  body.appendChild(el('div', { class: 'report-foot', text: `Erstellt am ${fmtDateLong((r.createdAt || '').slice(0, 10))} · unveränderlicher Beleg` }));
  sheet.appendChild(body);
}

/* =========================================================================
   labs-view.js — Ansicht „Labor & Ergänzung".

   Aufbau von oben nach unten, bewusst in dieser Reihenfolge:
     1. Rote Flaggen (falls vorhanden) – alles andere tritt dann zurück
     2. Energieversorgung (RED-S/LEA) – das häufigste echte Problem
     3. Laborwerte mit Einordnung und Verlauf
     4. Vorschläge zur Ergänzung (nur im Vollmodus, immer „food first")
     5. Eigener Einnahmeplan mit Abhaken

   Die gesamte Fachlogik liegt in labs.js / supplements.js / redflags.js; hier
   wird nur dargestellt und erfasst.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, todayStr, fmtDate, sectionHead, emptyState,
  toast, openSheet, closeSheet, field, input, select, confirmDialog, segmented,
} from './ui.js';
import { setHeader } from './router.js';
import { lineChart } from './charts.js';
import { moduleOff } from './nutrition.js';
import {
  ANALYTES, ANALYTE_GROUPS, unitsFor, toCanonical, overview, series, refRange,
} from './labs.js';
import { recommend, activePlans, takenOn, adherence, SUPPLEMENTS } from './supplements.js';
import { eligibility, redFlags, energyAvailability, GATE_QUESTIONS, EA_OPTIMAL } from './redflags.js';

const TONE_COLOR = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', neutral: 'var(--text-3)' };

export function labsEnabled() {
  return !store.isManaging() && store.settings().modules?.labs !== false;
}

/* --------------------------------- View ---------------------------------- */

export function render(view) {
  setHeader({ title: 'Labor & Ergänzung' });

  // Datenschutz: wie Zyklusdaten ausschließlich für die Person selbst sichtbar.
  if (store.isManaging()) {
    const who = store.activeMember();
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('heart') }),
      el('div', { class: 'empty__title', text: 'Privat' }),
      el('div', { class: 'muted', style: { maxWidth: '340px', margin: '0 auto' }, text: `Laborwerte und Ergänzungen sind private Gesundheitsdaten – nur für ${who ? who.name : 'das Mitglied'} selbst sichtbar, auch für Admins.` }),
    ]));
    return;
  }
  if (!labsEnabled()) { view.appendChild(moduleOff('Labor & Ergänzung')); return; }

  const today = todayStr();
  const profile = store.profile();
  const s = store.settings();
  const labs = store.get('labs');
  const supps = store.get('supplements');
  const gate = s.labsGate || {};
  const elig = eligibility(gate);

  /* --- Ersteinrichtung: Abgrenzung klären ------------------------------- */
  if (!elig.answered) {
    view.appendChild(introCard());
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-3', onclick: openGateSheet }, [icon('check'), 'Einrichten']));
    return;
  }

  /* --- 1. Rote Flaggen --------------------------------------------------- */
  const flags = redFlags({ labs, cycle: store.get('cycle'), today });
  flags.forEach((f) => view.appendChild(el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--bad)' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--bad)', width: '18px', flex: '0 0 auto', marginTop: '2px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.9rem' }, text: f.text }),
        el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: f.advice }),
      ]),
    ]),
  ])));

  /* --- 2. Energieversorgung (RED-S) -------------------------------------- */
  const ea = energyAvailability({
    profile, health: store.get('health'), sessions: store.get('sessions'),
    diary: store.get('diary'), today,
  });
  if (ea) {
    const tone = ea.level === 'kritisch' ? 'bad' : ea.level === 'niedrig' ? 'warn' : ea.level === 'unklar' ? 'neutral' : 'good';
    view.appendChild(el('div', { class: 'card mt-2', style: { borderLeft: `4px solid ${TONE_COLOR[tone]}` } }, [
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: 'Energieversorgung' }),
      // Bei unklarer Datenlage keine Zahl in den Vordergrund stellen – sie wäre
      // aus lückenhaften Tagebuch-Einträgen gerechnet und damit irreführend.
      ea.level === 'unklar' ? null : el('div', { class: 'row gap-3 mt-2', style: { alignItems: 'baseline' } }, [
        el('div', { class: 'num', style: { fontSize: '1.6rem', fontWeight: '800', color: TONE_COLOR[tone] }, text: String(ea.ea).replace('.', ',') }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: `kcal je kg fettfreier Masse · Richtwert ${EA_OPTIMAL}` }),
      ]),
      el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text: ea.hint }),
      el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: `Aus ${ea.days} Tagen mit erfassten Mahlzeiten: Ø ${ea.intakeAvg} kcal gegessen, Ø ${ea.trainingAvg} kcal fürs Training, ${ea.ffm} kg fettfreie Masse.` }),
      ea.level === 'unklar' ? el('button', {
        class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
        onclick: () => { location.hash = '#/nutrition'; },
      }, [icon('utensils'), 'Zum Ess-Tagebuch']) : null,
    ]));
  }

  /* --- 3. Laborwerte ----------------------------------------------------- */
  view.appendChild(sectionHead('Deine Werte', { label: '+ Wert erfassen', onClick: () => openValueSheet() }));

  const rows = overview(labs, { sex: profile.sex, today });
  if (!rows.length) {
    view.appendChild(emptyState('heart', 'Noch keine Werte',
      'Trage Werte aus deinem Laborbefund ein – Cat-O-Fit ordnet sie sportbezogen ein und zeigt dir den Verlauf.'));
  } else {
    const list = el('div', { class: 'list-card' });
    rows.forEach((r, i) => list.appendChild(valueRow(r, i)));
    view.appendChild(list);
  }

  /* --- 4. Vorschläge ----------------------------------------------------- */
  view.appendChild(sectionHead('Ergänzung'));
  if (elig.mode === 'documentation') {
    view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: 'Dokumentationsmodus' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: `Du hast angegeben: ${elig.reasons.join(' · ')}. Cat-O-Fit richtet sich an gesunde Sportlerinnen und Sportler und gibt in diesem Fall bewusst keine Einnahme-Empfehlungen. Erfassen und Verlauf ansehen kannst du weiterhin alles – besprich die Werte mit deiner Ärztin oder deinem Arzt.` }),
        el('button', { class: 'btn btn--ghost mt-2', style: { fontSize: '.8rem' }, onclick: openGateSheet }, 'Angaben ändern'),
      ]),
    ]));
  } else if (flags.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: 'Solange ein Wert ärztlich abzuklären ist, gibt Cat-O-Fit keine Empfehlungen zur Ergänzung.' }));
  } else {
    const rec = recommend({ labs, profile, sessions: store.get('sessions'), today, diet: s.diet || null, cycle: store.get('cycle') });
    view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('utensils'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: rec.foodFirst }),
    ]));
    if (!rec.items.length) {
      view.appendChild(el('div', { class: 'card card--flat mt-2', text: 'Aus deinen Werten ergibt sich derzeit kein Anlass für eine Ergänzung. Das ist eine gute Nachricht.' }));
    }
    rec.items.forEach((it) => view.appendChild(suggestionCard(it)));
    rec.interactions.forEach((t) => view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--warn)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t }),
    ])));
  }

  /* --- 5. Eigener Einnahmeplan ------------------------------------------ */
  view.appendChild(sectionHead('Dein Plan', { label: '+ Hinzufügen', onClick: () => openPlanSheet() }));
  const plans = activePlans(supps, today);
  if (!plans.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: 'Noch nichts eingeplant. Was du regelmäßig nimmst, kannst du hier eintragen und täglich abhaken.' }));
  } else {
    const list = el('div', { class: 'list-card' });
    plans.forEach((p, i) => list.appendChild(planRow(p, today, i)));
    view.appendChild(list);
    const ad = adherence(supps, today);
    if (ad) view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: `Zuletzt ${ad.pct} % eingehalten (${ad.taken} von ${ad.expected} Einnahmen in 14 Tagen).` }));
  }

  view.appendChild(el('div', { class: 'card card--flat mt-4 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: 'Alle Angaben sind Orientierung für gesunde Sportlerinnen und Sportler – keine Diagnose und keine Therapie. Bei Beschwerden oder auffälligen Werten gehört die Beurteilung in ärztliche Hände. Deine Daten bleiben lokal und sind für niemanden sonst sichtbar.' }),
  ]));
}

/* ------------------------------- Bausteine -------------------------------- */

function introCard() {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: 'Labor & Ergänzung' }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.86rem' }, text: 'Erfasse Werte aus deinem Laborbefund, sieh ihren Verlauf und bekomme sportbezogene Einordnung – zum Beispiel, dass ein Ferritin von 25 zwar „normal" ist, für Ausdauertraining aber knapp.' }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.86rem' }, text: 'Vorher eine kurze Frage zur Abgrenzung: Cat-O-Fit ist für gesunde Sportlerinnen und Sportler gedacht. Wer in ärztlicher Behandlung ist, Medikamente nimmt, schwanger ist oder eine Essstörung hat, nutzt das Modul nur zum Dokumentieren – Empfehlungen gibt die App dann bewusst nicht.' }),
  ]);
}

function valueRow(r, i) {
  const a = r.assessment;
  const t = r.trend;
  const arrow = t ? (t.dir === 'up' ? '↑' : t.dir === 'down' ? '↓' : '→') : '';
  const sub = [fmtDate(r.date), a.label];
  if (t && t.dir !== 'flat') sub.push(`${arrow} ${String(Math.abs(t.perMonth)).replace('.', ',')} ${r.unit}/Monat`);

  const detail = el('div', { hidden: true, style: { padding: '4px 0 10px' } });
  const row = el('button', {
    class: 'list-item', style: { width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: i ? '1px solid var(--border)' : 'none' },
    onclick: () => { detail.hidden = !detail.hidden; if (!detail.childElementCount) fillDetail(detail, r); },
  }, [
    el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: TONE_COLOR[a.tone], flex: '0 0 auto' } }),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: r.label }),
      el('div', { class: 'list-item__sub', text: sub.join(' · ') }),
    ]),
    el('span', { class: 'num', style: { fontWeight: '700' }, text: `${String(r.value).replace('.', ',')} ${r.unit}` }),
  ]);
  return el('div', {}, [row, detail]);
}

function fillDetail(box, r) {
  const labs = store.get('labs');
  const pts = series(labs, r.key).map((l) => ({ label: fmtDate(l.date), value: Number(l.value) }));
  const a = r.assessment;
  if (pts.length >= 2) {
    box.appendChild(lineChart(pts, {
      unit: r.unit, height: 130,
      target: a.sport ? a.sport[0] : (a.ref ? a.ref[0] : null),
      targetLabel: a.sport ? 'Sport-Ziel' : 'Referenz',
      color: TONE_COLOR[a.tone],
    }));
  }
  const ranges = [];
  if (a.ref) ranges.push(`Referenz ${a.ref[0]}–${a.ref[1]} ${r.unit}`);
  if (a.sport) ranges.push(`Sport-Zielbereich ${a.sport[0]}–${a.sport[1]} ${r.unit}`);
  if (ranges.length) box.appendChild(el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: ranges.join(' · ') }));
  if (a.blocked) box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: a.blocked }));
  if (r.hint) box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: r.hint }));
  if (r.trend && r.trend.daysToLimit != null) {
    box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem', color: 'var(--warn)' }, text: `Bei gleichbleibendem Verlauf wird der günstige Bereich in etwa ${Math.round(r.trend.daysToLimit / 30)} Monaten unterschritten – gutes Datum für die nächste Kontrolle.` }));
  }
  if (r.note) box.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: `Notiz: ${r.note}` }));
}

function suggestionCard(it) {
  const badge = { stark: 'gut belegt', mittel: 'belegt', situativ: 'situativ' }[it.evidence] || '';
  return el('div', { class: 'card mt-2' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('div', { style: { fontWeight: '700' }, text: it.label }),
      badge ? el('span', { class: 'chip', style: { fontSize: '.66rem' }, text: badge }) : null,
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: 'Warum: ' }), it.reason,
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: 'Zuerst über das Essen: ' }), it.food,
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: 'Vorgehen: ' }), it.action,
    ]),
    it.holdOnly ? null : el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: `Übliche Menge: ${it.typical} · ${it.timing} · ${it.ul}` }),
    it.note ? el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: it.note }) : null,
    it.holdOnly ? null : el('button', {
      class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
      onclick: () => openPlanSheet(it.key),
    }, [icon('plus'), 'In meinen Plan']),
  ]);
}

function planRow(p, today, i) {
  const done = takenOn(store.get('supplements'), p.id, today);
  return el('div', { class: 'list-item', style: { borderTop: i ? '1px solid var(--border)' : 'none' } }, [
    el('button', {
      class: 'icon-btn', 'aria-label': done ? 'Einnahme zurücknehmen' : 'Als eingenommen markieren',
      style: { color: done ? 'var(--good)' : 'var(--text-3)' },
      onclick: () => { toggleIntake(p, today, done); },
    }, icon(done ? 'check' : 'circle')),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: p.name }),
      el('div', { class: 'list-item__sub', text: [p.dose, p.timing].filter(Boolean).join(' · ') || 'täglich' }),
    ]),
    el('button', { class: 'icon-btn', 'aria-label': 'Entfernen', onclick: async () => {
      if (await confirmDialog({ title: `„${p.name}" entfernen?`, confirmLabel: 'Entfernen', danger: true })) {
        store.remove('supplements', p.id); rerender();
      }
    } }, icon('trash')),
  ]);
}

/* -------------------------------- Aktionen -------------------------------- */

function toggleIntake(plan, date, done) {
  const supps = store.get('supplements');
  if (done) {
    const rec = supps.find((s) => s._kind === 'intake' && s.planId === plan.id && s.date === date);
    if (rec) store.remove('supplements', rec.id);
  } else {
    store.upsert('supplements', {
      id: uid('int'), _kind: 'intake', planId: plan.id, date, createdAt: nowIso(),
    });
  }
  rerender();
}

function openGateSheet() {
  const s = store.settings();
  const cur = { ...(s.labsGate || {}) };
  const body = el('div', {}, [
    el('div', { class: 'muted mb-3', style: { fontSize: '.84rem' }, text: 'Trifft eines davon auf dich zu? Dann bleibt das Modul bei der reinen Dokumentation – Werte erfassen und Verlauf sehen, aber keine Empfehlungen.' }),
    ...GATE_QUESTIONS.map((q) => el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)', gap: '12px' } }, [
      el('span', { style: { fontSize: '.86rem' }, text: q.label }),
      segmented([{ value: 'nein', label: 'Nein' }, { value: 'ja', label: 'Ja' }],
        cur[q.key] === true ? 'ja' : 'nein', (v) => { cur[q.key] = (v === 'ja'); }),
    ])),
  ]);
  openSheet({
    title: 'Abgrenzung', body,
    footer: el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      GATE_QUESTIONS.forEach((q) => { if (typeof cur[q.key] !== 'boolean') cur[q.key] = false; });
      store.setSetting('labsGate', cur);
      closeSheet(); rerender();
    } }, [icon('check'), 'Speichern']),
  });
}

function openValueSheet() {
  let key = 'ferritin';
  let unit = ANALYTES[key].unit;
  const dateI = input({ type: 'date', value: todayStr() });
  const valueI = input({ type: 'number', step: '0.01', inputmode: 'decimal', placeholder: 'Wert' });
  const noteI = input({ type: 'text', placeholder: 'Notiz (optional), z. B. Labor oder Anlass' });

  const unitWrap = el('div', {});
  const drawUnits = () => {
    unitWrap.innerHTML = '';
    const opts = unitsFor(key).map((u) => ({ value: u, label: u }));
    unit = opts[0].value;
    const sel = select(opts, unit);
    sel.addEventListener('change', () => { unit = sel.value; });
    unitWrap.appendChild(field('Einheit', sel));
  };

  const groups = ANALYTE_GROUPS.map((g) => ({
    label: g,
    keys: Object.entries(ANALYTES).filter(([, a]) => a.group === g).map(([k, a]) => ({ value: k, label: a.label })),
  })).filter((g) => g.keys.length);
  const analyteSel = select(groups.flatMap((g) => g.keys), key);
  analyteSel.addEventListener('change', () => { key = analyteSel.value; drawUnits(); hintBox.textContent = ANALYTES[key].hint || ''; });
  const hintBox = el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '-4px' }, text: ANALYTES[key].hint || '' });
  drawUnits();

  openSheet({
    title: 'Laborwert erfassen',
    body: el('div', {}, [
      field('Wert', analyteSel), hintBox,
      field('Datum', dateI),
      field('Messwert', valueI),
      unitWrap,
      field('Notiz', noteI),
    ]),
    footer: el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      const v = toCanonical(key, valueI.value, unit);
      if (v == null) { toast('Bitte einen gültigen Wert eingeben', 'bad'); return; }
      store.upsert('labs', {
        id: uid('lab'), analyte: key, value: v, unit: ANALYTES[key].unit,
        date: dateI.value || todayStr(), note: noteI.value.trim() || null,
        createdAt: nowIso(), updatedAt: nowIso(),
      });
      closeSheet(); toast('Wert gespeichert', 'good'); rerender();
    } }, [icon('check'), 'Speichern']),
  });
}

function openPlanSheet(presetKey = null) {
  const opts = Object.entries(SUPPLEMENTS).map(([k, v]) => ({ value: k, label: v.label }));
  let key = presetKey && SUPPLEMENTS[presetKey] ? presetKey : opts[0].value;
  const sel = select(opts, key);
  const doseI = input({ type: 'text', value: SUPPLEMENTS[key].typical, placeholder: 'Menge' });
  const timingI = input({ type: 'text', value: SUPPLEMENTS[key].timing || '', placeholder: 'Wann' });
  sel.addEventListener('change', () => {
    key = sel.value;
    doseI.value = SUPPLEMENTS[key].typical;
    timingI.value = SUPPLEMENTS[key].timing || '';
  });
  openSheet({
    title: 'In den Plan aufnehmen',
    body: el('div', {}, [
      field('Mittel', sel),
      field('Menge', doseI),
      field('Zeitpunkt', timingI),
      el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: 'Nur was du wirklich nimmst – der Plan dient dir zum Abhaken und zeigt deine Einnahmetreue.' }),
    ]),
    footer: el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      store.upsert('supplements', {
        id: uid('sup'), _kind: 'plan', supplementKey: key, name: SUPPLEMENTS[key].label,
        dose: doseI.value.trim(), timing: timingI.value.trim(), active: true,
        from: todayStr(), to: null, createdAt: nowIso(), updatedAt: nowIso(),
      });
      closeSheet(); toast('Zum Plan hinzugefügt', 'good'); rerender();
    } }, [icon('check'), 'Übernehmen']),
  });
}

function rerender() { const v = document.getElementById('view'); v.innerHTML = ''; render(v); }

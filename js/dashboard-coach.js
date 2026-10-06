/* =========================================================================
   dashboard-coach.js — the coach cards on "Today": the one daily recommendation
   (coach.js) as a card including "Apply"/"Undo", plus the prompts
   (effort, imported workouts, free sessions). Moved out of dashboard.js
   (FE-18); the decision itself is made by coach.js.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, typeMeta, typeIcon, fmtKm, fmtDuration, fmtDate, nowIso, todayStr, isoDow,
  fmtWeekday, toast, fmtNum, refreshView, infoButton, fmtDec, localizeUnits as lu, fmtKmAuto,
} from './ui.js';
import { kmToShown } from './units.js';
import { easierVariant, deloadVariant, progressVariant, dayLoadUnits } from './planflow.js';
import { coachWhy } from './coach.js';
import { saveUnitPatch, linkSession } from './unit-actions.js';
import { sessionRpeInfo } from './load.js';
import { gentleVariant } from './rolling.js';
import { applyAdapt, undoAdapt as undoAdaptStore, canUndo } from './adapt.js';

import { t } from './i18n.js';

const dist = fmtKmAuto;

/** The one daily recommendation (coach.js) as a card – with the reason why exactly this one. */
export function coachCard(view, coach, today) {
  const p = coach.primary;
  if (!p) return null;
  let card = null;
  if (p.kind === 'return') card = returnCard(p);
  else if (p.kind === 'rest') card = restDayCard(p.rd);
  else if (p.kind === 'soften') card = readinessAdjustCard(p.soft);
  else if (p.kind === 'football') card = footballEaseCard(p.fb);
  else if (p.kind === 'deload') card = deloadCard(p.units, p.prog);
  else if (p.kind === 'destack') card = destackCard(p.ds);
  else if (p.kind === 'makeup') card = makeupCard(p.unit, p.day);
  else if (p.kind === 'volume') card = volumeBalanceCard(p.bal);
  else if (p.kind === 'boost') card = boostCard(p.units, p.prog);
  if (!card) return null;
  card.classList.add('coach-card', 'mt-4');
  const why = coachWhy(coach);
  if (why) {
    card.appendChild(el('details', { class: 'coach-why mt-2' }, [
      el('summary', { text: t('dashboardCoach.whyThis') }),
      el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '4px' }, text: why }),
    ]));
  }
  return card;
}

/** Return after illness/injury: easy first, then build up step by step. */
function returnCard(p) {
  const r = p.ret;
  const u = p.unit;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('heart'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: t('dashboardCoach.returnTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: r.reason === 'injured' ? t('dashboardCoach.returnTextInjured', { date: fmtDate(r.date) }) : t('dashboardCoach.returnTextIll', { date: fmtDate(r.date) }) }),
      ]),
    ]),
    u ? el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => makeEasier(u, t('dashboardCoach.log.returnReason')) }, [icon('feather'), t('dashboardCoach.makeEasier', { title: lu(u.title) })]) : null,
  ]);
}

/** Coach card: automatic weekly volume compensation (suggestion with "Apply"). */
function volumeBalanceCard(bal) {
  const s = bal.suggestion;
  const apply = el('button', { class: 'btn btn--soft mt-2', style: { fontSize: '.82rem' } }, [icon('check'), t('dashboardCoach.raiseTo', { title: lu(s.unit.title), km: dist(s.newKm) })]);
  apply.addEventListener('click', () => {
    saveUnitPatch(s.unit.planId, s.unit.id, { targetDistanceKm: s.newKm });
    toast(t('dashboardCoach.raised', { km: dist(s.newKm) }), 'good');
    refreshView();
  });
  return el('div', { class: 'card', style: { borderLeft: '3px solid #f5a623' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('route'), style: { color: '#f5a623', width: '20px', flex: '0 0 auto', marginTop: '1px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: t('dashboardCoach.volumeTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: t('dashboardCoach.volumeText', { missed: dist(bal.missedKm), done: Math.round(kmToShown(bal.done)), planned: fmtKm(bal.planned, 0) }) }),
        apply,
      ]),
    ]),
  ]);
}

/** Effort of the last sessions – pure information, no verdict on the load
    (that comes solely from "Load & form"). */
export function rpeInfoCard(prog) {
  if (!prog) return null;
  return el('div', { class: 'card', style: { borderLeft: '3px solid var(--accent)' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('gauge'), style: { color: 'var(--accent-text)', width: '20px', flex: '0 0 auto', marginTop: '1px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: t('dashboardCoach.rpeTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: t('dashboardCoach.rpeText', { rpe: fmtDec(prog.avgRpe), count: prog.count, weeks: Math.round(prog.days / 7) }) }),
      ]),
    ]),
  ]);
}

/** Compact card with HR zones and target paces (clickable to the settings). */

/* --- Rolling adjustments: apply centrally, log, undo --- */

// applyAdapt (apply + log + undo snapshot) now lives centrally in adapt.js,
// so that cycle.js also logs the cycle-aware automatic easing through it (#3).

/** Undoes a logged adjustment (store core) + UI (toast/reload).
    Completed or missed sessions stay as they are. */
function undoAdapt(planId, logId) {
  const res = undoAdaptStore(planId, logId);
  if (res) {
    toast(res.skipped ? t('dashboardCoach.undoneSkipped') : t('dashboardCoach.undone'), 'good', 3200);
    refreshView();
  }
}

/** Automatic recovery day (load-driven). If several sessions fall on that day
    (two goals), the WHOLE day is set to easy – not just one session (#4). */
function restDayCard(rd) {
  const u = rd.unit;
  const dayCount = store.get('plans').reduce((n, p) => n + dayLoadUnits(p.units || [], rd.date).length, 0);
  const whole = dayCount > 1;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('moon'), style: { color: '#e8a13a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: whole ? t('dashboardCoach.restWholeTitle') : t('dashboardCoach.restTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: whole
          ? t('dashboardCoach.restWholeText', { reason: rd.reason, date: fmtDate(rd.date), count: dayCount })
          : t('dashboardCoach.restText', { reason: rd.reason, title: lu(u.title), date: fmtDate(u.date) }) }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => restDayApply(rd.date) }, [icon('feather'), whole ? t('dashboardCoach.restWholeButton') : t('dashboardCoach.restButton')]),
  ]);
}
/** Sets ALL open, non-fixed sessions of a day to recovery – across plans (#4). */
function restDayApply(date) {
  let count = 0;
  store.get('plans').forEach((plan) => {
    const ids = dayLoadUnits(plan.units || [], date).map((u) => u.id);
    if (!ids.length) return;
    applyAdapt(plan.id, ids, (u) => gentleVariant(u, {
      title: t('dashboardCoach.log.autoRestTitle'),
      description: t('dashboardCoach.log.autoRestDescription'),
    }), { kind: 'rest', title: t('dashboardCoach.log.restTitle'), reason: t('dashboardCoach.log.restReason', { date: fmtDate(date) }) });
    count += ids.length;
  });
  toast(count > 1 ? t('dashboardCoach.restWholeToast', { count }) : t('dashboardCoach.restPlannedToast'), 'good', 3600);
  refreshView();
}

/** After demanding football: offer the next hard session in an easier form (#5). */
function footballEaseCard(fb) {
  const u = fb.unit;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5cc97a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#5cc97a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: t('dashboardCoach.footballTitle', { when: fb.when === 'heute' ? t('common.today') : t('common.yesterday') }) }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('dashboardCoach.footballText', { title: lu(u.title), date: fmtDate(u.date) }) }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => footballEaseApply(u) }, [icon('feather'), t('dashboardCoach.makeEasier', { title: lu(u.title) })]),
  ]);
}
function footballEaseApply(unit) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  const easyPace = (plan.paces || store.profile().paceZones || {}).easy;
  applyAdapt(plan.id, [unit.id], (u) => easierVariant(u, easyPace),
    { kind: 'easier', title: t('dashboardCoach.log.footballTitle'), reason: t('dashboardCoach.log.footballReason') });
  toast(t('dashboardCoach.footballToast'), 'good', 3600);
  refreshView();
}

/** Unstacking with two goals: move one of the two sessions of a day to a free day (#4). */
function destackCard(sug) {
  const m = sug.move, k = sug.keep;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('calendar'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: t('dashboardCoach.destackTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('dashboardCoach.destackText', { date: fmtDate(sug.date), keep: k ? lu(k.title) : t('dashboardCoach.session'), move: lu(m.title), weekday: fmtWeekday(sug.target, true), target: fmtDate(sug.target) }) }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => destackApply(m, sug.target) }, [icon('calendar'), t('dashboardCoach.moveTo', { title: lu(m.title), weekday: fmtWeekday(sug.target) })]),
  ]);
}
function destackApply(unit, target) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  applyAdapt(plan.id, [unit.id], () => ({ date: target, dow: isoDow(target) }),
    { kind: 'destack', title: t('dashboardCoach.log.destackTitle'), reason: t('dashboardCoach.log.destackReason', { title: unit.title }) });
  toast(t('dashboardCoach.destackToast'), 'good');
  refreshView();
}

/** Transparency log of the automatic adjustments (with undo). */
export function adaptLogCard() {
  const entries = [];
  // "Undo" only as long as at least one affected session is still open.
  store.get('plans').forEach((p) => (p.adaptLog || []).forEach((e) => entries.push({ ...e, planId: p.id, undoable: canUndo(p.units || [], e) })));
  if (!entries.length) return null;
  entries.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const KIND_ICON = { rest: 'moon', deload: 'feather', boost: 'zap', easier: 'feather', makeup: 'calendar', pace: 'refresh', cycle: 'heart', destack: 'calendar' };
  const wrap = el('div', { class: 'card' }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '4px' } }, [
      el('span', { html: iconSvg('activity'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: t('dashboardCoach.logTitle') }),
    ]),
  ]);
  entries.slice(0, 4).forEach((e) => {
    wrap.appendChild(el('div', { class: 'row row--between', style: { alignItems: 'flex-start', gap: '8px', padding: '6px 0 4px', borderTop: '1px solid var(--border)' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
        el('span', { html: iconSvg(KIND_ICON[e.kind] || 'activity'), style: { color: 'var(--text-3)', width: '15px', flex: '0 0 auto', marginTop: '2px' } }),
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.82rem' }, text: lu(e.title) || t('dashboardCoach.adjustment') }),
          el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: lu(e.reason) || '' }),
        ]),
      ]),
      e.undoable ? el('button', { class: 'btn btn--ghost', style: { fontSize: '.72rem', flex: '0 0 auto' }, onclick: () => undoAdapt(e.planId, e.id) }, t('common.undo')) : null,
    ]));
  });
  return wrap;
}

/** Adaptive daily hint: low readiness + demanding session -> make it easier. */
function readinessAdjustCard(soft) {
  const u = soft.unit;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('heart'), style: { color: '#e8a13a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row gap-1', style: { alignItems: 'center' } }, [
          el('div', { style: { fontWeight: '700' }, text: t('dashboardCoach.readinessLow', { score: soft.score }) }),
          infoButton('bereitschaft', t('dashboardCoach.readiness')),
        ]),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('dashboardCoach.readinessText', { title: lu(u.title) }) }),
      ]),
    ]),
    el('div', { class: 'row gap-2 mt-2' }, [
      el('button', { class: 'btn btn--soft grow', onclick: () => makeEasier(u) }, [icon('feather'), t('dashboardCoach.easierToday')]),
      el('a', { class: 'btn btn--ghost grow', href: `#/session/${u.id}`, style: { textAlign: 'center' } }, t('dashboardCoach.toSession')),
    ]),
  ]);
}
function makeEasier(unit, reason = t('dashboardCoach.log.lowReadinessReason')) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  const pz = plan.paces || store.profile().paceZones || {};
  applyAdapt(plan.id, [unit.id], (u) => easierVariant(u, pz.easy),
    { kind: 'easier', title: unit.date === todayStr() ? t('dashboardCoach.log.easierTodayTitle') : t('dashboardCoach.log.easierTitle'), reason });
  toast(t('dashboardCoach.easierToast'), 'good', 3600);
  refreshView();
}

/** Adaptive replanning: make up a missed key session on a free day. */
function makeupCard(unit, targetDay) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('refresh'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: t('dashboardCoach.makeupTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('dashboardCoach.makeupText', { title: lu(unit.title), date: fmtDate(unit.date), weekday: fmtWeekday(targetDay, true), target: fmtDate(targetDay) }) }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => makeupMove(unit, targetDay) }, [icon('calendar'), t('dashboardCoach.makeupButton', { weekday: fmtWeekday(targetDay) })]),
  ]);
}
function makeupMove(unit, targetDay) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  store.patch('plans', plan.id, { units: plan.units.map((x) => (x.id === unit.id ? { ...x, date: targetDay, dow: isoDow(targetDay), status: 'geplant', missedReason: null, updatedAt: nowIso() } : x)) });
  toast(t('dashboardCoach.makeupToast'), 'good');
  refreshView();
}

/** Adaptive deload: with persistently very demanding sessions (RPE), scale back the coming
    week – fixed commitments stay as they are. */
function deloadCard(cands, prog) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#e8a13a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: t('dashboardCoach.deloadTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: prog ? t('dashboardCoach.deloadTextRpe', { weeks: Math.round(prog.days / 7), rpe: fmtDec(prog.avgRpe), count: cands.length }) : t('dashboardCoach.deloadText', { weeks: 3, count: cands.length }) }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => applyDeload(cands) }, [icon('feather'), t('dashboardCoach.deloadButton')]),
  ]);
}
function applyDeload(cands) {
  const allIds = cands.map((u) => u.id);
  store.get('plans').forEach((plan) => {
    const ids = allIds.filter((id) => (plan.units || []).some((u) => u.id === id));
    if (!ids.length) return;
    applyAdapt(plan.id, ids, (u) => deloadVariant(u),
      { kind: 'deload', title: t('dashboardCoach.log.deloadTitle'), reason: t('dashboardCoach.log.deloadReason') });
  });
  toast(t('dashboardCoach.deloadToast'), 'good', 3600);
  refreshView();
}

/** Adaptive progression: only without a warning signal and with load in the usual range – make the
    coming week somewhat more demanding (fixed commitments stay as they are). */
function boostCard(cands, prog) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #2bb673' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('zap'), style: { color: '#2bb673', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: t('dashboardCoach.boostTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: prog ? t('dashboardCoach.boostTextRpe', { weeks: Math.round(prog.days / 7), rpe: fmtDec(prog.avgRpe), count: cands.length }) : t('dashboardCoach.boostText', { weeks: 3, count: cands.length }) }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => applyBoost(cands) }, [icon('zap'), t('dashboardCoach.boostButton')]),
  ]);
}
function applyBoost(cands) {
  const allIds = cands.map((u) => u.id);
  store.get('plans').forEach((plan) => {
    const ids = allIds.filter((id) => (plan.units || []).some((u) => u.id === id));
    if (!ids.length) return;
    applyAdapt(plan.id, ids, (u) => progressVariant(u),
      { kind: 'boost', title: t('dashboardCoach.log.boostTitle'), reason: t('dashboardCoach.log.boostReason') });
  });
  toast(t('dashboardCoach.boostToast'), 'good', 3600);
  refreshView();
}

/** Today's free training as a compact card (link to the analysis). */
export function freeSessionCard(s) {
  const meta = [typeMeta(s.type).label];
  if (s.distanceKm) meta.push(fmtKm(s.distanceKm, 1));
  if (s.durationSec) meta.push(fmtDuration(s.durationSec));
  return el('a', { class: 'card card--link mt-2', href: `#/session/${s.id}` }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      typeIcon(s.type),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: `✓ ${lu(s.title) || typeMeta(s.type).label}` }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: meta.join(' · ') }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]),
  ]);
}

/** Imported workouts that match open planned sessions – assign them after
    asking. Once assigned, the session counts as done; no second session is created. */
/** Answers to "How hard was it?" – one tap sets the effort (RPE 1–10). */
const RPE_CHOICES = [[3, 'light'], [5, 'medium'], [7, 'hard'], [9, 'veryHard']];   // rpe.<key> in the catalog

export function rpeAskCard(list) {
  const rows = list.slice(0, 2).map((s) => {
    const est = sessionRpeInfo(s);
    const set = (rpe) => { store.patch('sessions', s.id, { rpe }); toast(t('dashboardCoach.rpeSaved'), 'good'); refreshView(); };
    return el('div', { style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
        typeIcon(s.type, 'type-icon--sm'),
        el('div', { class: 'grow', style: { minWidth: '0' } }, [
          el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: `${fmtDate(s.date)} · ${lu(s.title) || typeMeta(s.type).label}${s.distanceKm ? ' · ' + fmtKm(s.distanceKm, 1) : ''}` }),
          el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: est.source === 'herzfrequenz'
            ? t('dashboardCoach.rpeFromHr', { rpe: fmtNum(est.rpe, est.rpe % 1 ? 1 : 0) })
            : t('dashboardCoach.rpeFromType', { rpe: fmtNum(est.rpe, est.rpe % 1 ? 1 : 0) }) }),
        ]),
        el('button', { class: 'icon-btn', 'aria-label': t('dashboardCoach.dontAsk'), title: t('dashboardCoach.dontAsk'), onclick: () => { store.patch('sessions', s.id, { rpeDismissed: true }); refreshView(); } }, icon('x')),
      ]),
      el('div', { class: 'row gap-1 mt-1', role: 'group', 'aria-label': t('dashboardCoach.rpeGroup'), style: { flexWrap: 'wrap' } },
        RPE_CHOICES.map(([v, key]) => { const label = t(`rpe.${key}`); return el('button', { class: 'chip chip--btn', type: 'button', text: label, 'aria-label': t('dashboardCoach.rpeChoiceAria', { label, value: v }), onclick: () => set(v) }); })),
    ]);
  });
  return el('div', { class: 'card mt-2' }, [
    el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: t('dashboardCoach.rpeAskTitle') }),
    el('div', { class: 'muted', style: { fontSize: '.8rem', margin: '2px 0 4px' }, text: t('dashboardCoach.rpeAskText') }),
    ...rows,
  ]);
}

export function importMatchCard(matches) {
  const link = (list) => {
    list.forEach(({ session, plan, unit }) => linkSession(plan, unit, session));
    toast(list.length > 1 ? t('dashboardCoach.matchedMany', { count: list.length }) : t('dashboardCoach.matchedOne'), 'good');
    refreshView();
  };
  const rows = matches.slice(0, 4).map((m) => el('div', { class: 'row gap-2', style: { alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' } }, [
    typeIcon(m.session.type, 'type-icon--sm'),
    el('div', { class: 'grow', style: { minWidth: '0' } }, [
      el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: `${fmtDate(m.session.date)} · ${lu(m.session.title) || typeMeta(m.session.type).label}${m.session.distanceKm ? ' · ' + fmtKm(m.session.distanceKm, 1) : ''}` }),
      el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: t('dashboardCoach.fitsUnit', { title: lu(m.unit.title) }) }),
    ]),
    el('button', { class: 'btn btn--soft', style: { fontSize: '.8rem', padding: '6px 10px', flex: '0 0 auto' }, onclick: () => link([m]) }, t('dashboardCoach.match')),
    el('button', { class: 'icon-btn', 'aria-label': t('dashboardCoach.dontMatch'), title: t('dashboardCoach.dontMatch'), onclick: () => { store.patch('sessions', m.session.id, { matchDismissed: true }); refreshView(); } }, icon('x')),
  ]));
  return el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--accent)' } }, [
    el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: t('dashboardCoach.matchTitle') }),
    el('div', { class: 'muted', style: { fontSize: '.8rem', margin: '2px 0 4px' }, text: t('dashboardCoach.matchText') }),
    ...rows,
    matches.length > 1 ? el('button', { class: 'btn btn--ghost btn--block mt-2', style: { fontSize: '.84rem' }, onclick: () => link(matches) }, [icon('check'), t('dashboardCoach.matchAll', { count: matches.length })]) : null,
  ]);
}

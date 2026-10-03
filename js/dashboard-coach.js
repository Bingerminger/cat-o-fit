/* =========================================================================
   dashboard-coach.js — die Coach-Karten auf „Heute“: die eine Tagesempfehlung
   (coach.js) als Karte samt „Übernehmen“/„Rückgängig“, dazu die Nachfragen
   (Anstrengung, importierte Trainings, freie Einheiten). Aus dashboard.js
   ausgelagert (FE-18); die Entscheidung selbst trifft coach.js.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, typeMeta, typeIcon, fmtKm, fmtDuration, fmtDate, nowIso, todayStr, isoDow,
  fmtWeekday, toast, fmtNum, refreshView, infoButton, fmtDec,
} from './ui.js';
import { easierVariant, deloadVariant, progressVariant, dayLoadUnits } from './planflow.js';
import { coachWhy } from './coach.js';
import { saveUnitPatch, linkSession } from './unit-actions.js';
import { sessionRpeInfo } from './load.js';
import { gentleVariant } from './rolling.js';
import { applyAdapt, undoAdapt as undoAdaptStore, canUndo } from './adapt.js';

/** Die eine Tagesempfehlung (coach.js) als Karte – mit Begründung, warum genau diese. */
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
      el('summary', { text: 'Warum diese Empfehlung?' }),
      el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '4px' }, text: why }),
    ]));
  }
  return card;
}

/** Wiedereinstieg nach Krankheit/Verletzung: erst locker, stufenweise steigern. */
function returnCard(p) {
  const r = p.ret;
  const u = p.unit;
  const what = r.reason === 'injured' ? 'verletzungsbedingt' : 'krankheitsbedingt';
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('heart'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Behutsam wieder einsteigen' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Am ${fmtDate(r.date)} ist eine Einheit ${what} ausgefallen. Starte mit lockeren Einheiten und steigere stufenweise – harte Einheiten erst, wenn du dich wieder ganz fit fühlst. Nachholen musst du nichts.${r.reason === 'injured' ? ' Bei anhaltenden Schmerzen lass es ärztlich abklären.' : ''}` }),
      ]),
    ]),
    u ? el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => makeEasier(u, 'Wiedereinstieg nach Ausfall.') }, [icon('feather'), `„${u.title}“ lockerer machen`]) : null,
  ]);
}

/** Coach-Karte: automatischer Wochenumfang-Ausgleich (Vorschlag mit „Übernehmen“). */
function volumeBalanceCard(bal) {
  const s = bal.suggestion;
  const apply = el('button', { class: 'btn btn--soft mt-2', style: { fontSize: '.82rem' } }, [icon('check'), `„${s.unit.title}“ auf ${s.newKm} km erhöhen`]);
  apply.addEventListener('click', () => {
    saveUnitPatch(s.unit.planId, s.unit.id, { targetDistanceKm: s.newKm });
    toast(`Auf ${s.newKm} km erhöht`, 'good');
    refreshView();
  });
  return el('div', { class: 'card', style: { borderLeft: '3px solid #f5a623' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('route'), style: { color: '#f5a623', width: '20px', flex: '0 0 auto', marginTop: '1px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: 'Wochenumfang ausgleichen' }),
        el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: `Diese Woche sind ${bal.missedKm} km liegen geblieben (${bal.done}/${bal.planned} km erledigt). Lege einen Teil behutsam auf die nächste lockere Einheit – ohne Doppelbelastung.` }),
        apply,
      ]),
    ]),
  ]);
}

/** Anstrengung der letzten Einheiten – reine Information, kein Belastungsurteil
    (das kommt allein aus „Belastung & Form“). */
export function rpeInfoCard(prog) {
  if (!prog) return null;
  return el('div', { class: 'card', style: { borderLeft: '3px solid var(--accent)' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('gauge'), style: { color: 'var(--accent-text)', width: '20px', flex: '0 0 auto', marginTop: '1px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: 'Anstrengung der letzten Einheiten' }),
        el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: `Ø RPE ${fmtDec(prog.avgRpe)} von 10 aus ${prog.count} bewerteten Einheiten der letzten ${Math.round(prog.days / 7)} Wochen.` }),
      ]),
    ]),
  ]);
}

/** Kompakte Karte mit HF-Zonen und Zielpaces (klickbar zu den Einstellungen). */

/* --- Rollierende Anpassungen: zentral anwenden, protokollieren, rückgängig --- */

// applyAdapt (Anwenden + Log + Rückgängig-Snapshot) lebt jetzt zentral in adapt.js,
// damit auch cycle.js die zyklusbewusste Auto-Entschärfung darüber protokolliert (#3).

/** Macht eine protokollierte Anpassung rückgängig (Store-Kern) + UI (Toast/Reload).
    Erledigte oder verpasste Einheiten bleiben dabei, wie sie sind. */
function undoAdapt(planId, logId) {
  const res = undoAdaptStore(planId, logId);
  if (res) {
    toast(res.skipped ? 'Rückgängig gemacht – bereits erledigte Einheiten bleiben unverändert' : 'Anpassung rückgängig gemacht', 'good', 3200);
    refreshView();
  }
}

/** Automatischer Erholungstag (load-getrieben). Liegen an dem Tag mehrere Einheiten
    (zwei Ziele), wird der GANZE Tag ruhig gestellt – nicht nur eine Einheit (#4). */
function restDayCard(rd) {
  const u = rd.unit;
  const dayCount = store.get('plans').reduce((n, p) => n + dayLoadUnits(p.units || [], rd.date).length, 0);
  const whole = dayCount > 1;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('moon'), style: { color: '#e8a13a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: whole ? 'Ganzer Erholungstag empfohlen' : 'Erholungstag empfohlen' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: whole
          ? `${rd.reason} An dem Tag (${fmtDate(rd.date)}) liegen ${dayCount} Einheiten aus deinen Zielen – der ganze Tag wird ruhig, damit die Erholung wirklich greift.`
          : `${rd.reason} Vorschlag: „${u.title}“ am ${fmtDate(u.date)} zu einem Erholungstag machen.` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => restDayApply(rd.date) }, [icon('feather'), whole ? 'Ganzen Tag entlasten' : 'Erholungstag einplanen']),
  ]);
}
/** Stellt ALLE offenen, nicht-fixen Einheiten eines Tages auf Erholung – planübergreifend (#4). */
function restDayApply(date) {
  let count = 0;
  store.get('plans').forEach((plan) => {
    const ids = dayLoadUnits(plan.units || [], date).map((u) => u.id);
    if (!ids.length) return;
    applyAdapt(plan.id, ids, (u) => gentleVariant(u, {
      title: 'Erholungstag (automatisch)',
      description: 'Bewusst ruhig – der ganze Tag ist auf Erholung gestellt (auch eine zweite Einheit aus deinen Zielen). Die ursprüngliche Belastung holst du erholter nach. Rückgängig über „Zuletzt automatisch angepasst“.',
    }), { kind: 'rest', title: 'Erholungstag eingefügt', reason: `Belastungssteuerung: Tag ${fmtDate(date)} entlastet.` });
    count += ids.length;
  });
  toast(count > 1 ? `Ganzer Tag entlastet – ${count} Einheiten ruhig gestellt` : 'Erholungstag eingeplant – die Einheit holst du erholter nach', 'good', 3600);
  refreshView();
}

/** Nach forderndem Fußball: die nächste harte Einheit lockerer anbieten (#5). */
function footballEaseCard(fb) {
  const u = fb.unit;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5cc97a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#5cc97a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: `Fußball ${fb.when} war fordernd` }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Fußball kostet viel Körner. „${u.title}“ am ${fmtDate(u.date)} gehst du besser etwas lockerer an – frischer für die Schlüsseleinheiten.` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => footballEaseApply(u) }, [icon('feather'), `„${u.title}“ lockerer machen`]),
  ]);
}
function footballEaseApply(unit) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  const easyPace = (plan.paces || store.profile().paceZones || {}).easy;
  applyAdapt(plan.id, [unit.id], (u) => easierVariant(u, easyPace),
    { kind: 'easier', title: 'Nach Fußball lockerer', reason: 'Fußball war fordernd – Folgeeinheit entlastet.' });
  toast('Lockerer angesetzt – die Schlüsseleinheit holst du frischer nach', 'good', 3600);
  refreshView();
}

/** Entstapeln bei zwei Zielen: eine der zwei Einheiten eines Tages auf einen freien Tag (#4). */
function destackCard(sug) {
  const m = sug.move, k = sug.keep;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('calendar'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Zwei Einheiten an einem Tag' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `${fmtDate(sug.date)}: „${k ? k.title : 'Einheit'}“ und „${m.title}“ aus deinen Zielen liegen zusammen. „${m.title}“ auf ${fmtWeekday(sug.target, true)} (${fmtDate(sug.target)}) zu verschieben entzerrt den Tag – jede Einheit bekommt ihren Reiz und die Erholung stimmt.` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => destackApply(m, sug.target) }, [icon('calendar'), `„${m.title}“ auf ${fmtWeekday(sug.target)} verschieben`]),
  ]);
}
function destackApply(unit, target) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  applyAdapt(plan.id, [unit.id], () => ({ date: target, dow: isoDow(target) }),
    { kind: 'destack', title: 'Tag entzerrt', reason: `„${unit.title}“ auf einen freien Tag verschoben – nicht mehr zwei Einheiten am selben Tag.` });
  toast('Tag entzerrt – die Einheit steht jetzt an einem freien Tag', 'good');
  refreshView();
}

/** Transparenz-Log der automatischen Anpassungen (mit Rückgängig). */
export function adaptLogCard() {
  const entries = [];
  // „Rückgängig“ nur, solange mindestens eine betroffene Einheit noch offen ist.
  store.get('plans').forEach((p) => (p.adaptLog || []).forEach((e) => entries.push({ ...e, planId: p.id, undoable: canUndo(p.units || [], e) })));
  if (!entries.length) return null;
  entries.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const KIND_ICON = { rest: 'moon', deload: 'feather', boost: 'zap', easier: 'feather', makeup: 'calendar', pace: 'refresh', cycle: 'heart', destack: 'calendar' };
  const wrap = el('div', { class: 'card' }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '4px' } }, [
      el('span', { html: iconSvg('activity'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: 'Zuletzt automatisch angepasst' }),
    ]),
  ]);
  entries.slice(0, 4).forEach((e) => {
    wrap.appendChild(el('div', { class: 'row row--between', style: { alignItems: 'flex-start', gap: '8px', padding: '6px 0 4px', borderTop: '1px solid var(--border)' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
        el('span', { html: iconSvg(KIND_ICON[e.kind] || 'activity'), style: { color: 'var(--text-3)', width: '15px', flex: '0 0 auto', marginTop: '2px' } }),
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.82rem' }, text: e.title || 'Anpassung' }),
          el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: e.reason || '' }),
        ]),
      ]),
      e.undoable ? el('button', { class: 'btn btn--ghost', style: { fontSize: '.72rem', flex: '0 0 auto' }, onclick: () => undoAdapt(e.planId, e.id) }, 'Rückgängig') : null,
    ]));
  });
  return wrap;
}

/** Adaptiver Tageshinweis: niedrige Bereitschaft + fordernde Einheit -> lockerer machen. */
function readinessAdjustCard(soft) {
  const u = soft.unit;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('heart'), style: { color: '#e8a13a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row gap-1', style: { alignItems: 'center' } }, [
          el('div', { style: { fontWeight: '700' }, text: `Bereitschaft heute niedrig (${soft.score})` }),
          infoButton('bereitschaft', 'Bereitschaft'),
        ]),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Heute steht „${u.title}“ an – fordernd. Bei niedriger Bereitschaft bringt eine lockere Einheit oft mehr als eine erzwungene harte.` }),
      ]),
    ]),
    el('div', { class: 'row gap-2 mt-2' }, [
      el('button', { class: 'btn btn--soft grow', onclick: () => makeEasier(u) }, [icon('feather'), 'Heute lockerer machen']),
      el('a', { class: 'btn btn--ghost grow', href: `#/session/${u.id}`, style: { textAlign: 'center' } }, 'Zur Einheit'),
    ]),
  ]);
}
function makeEasier(unit, reason = 'Niedrige Bereitschaft heute.') {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  const pz = plan.paces || store.profile().paceZones || {};
  applyAdapt(plan.id, [unit.id], (u) => easierVariant(u, pz.easy),
    { kind: 'easier', title: unit.date === todayStr() ? 'Heute lockerer gemacht' : 'Lockerer gemacht', reason });
  toast('Lockerer angesetzt – Schlüsseleinheiten kommen, wenn du wieder erholt bist', 'good', 3600);
  refreshView();
}

/** Adaptive Umplanung: verpasste Schlüsseleinheit auf einen freien Tag nachholen. */
function makeupCard(unit, targetDay) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('refresh'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Schlüsseleinheit nachholen?' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `„${unit.title}“ vom ${fmtDate(unit.date)} ist ausgefallen. ${fmtWeekday(targetDay, true)} (${fmtDate(targetDay)}) ist frei – dorthin verschieben?` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => makeupMove(unit, targetDay) }, [icon('calendar'), `Auf ${fmtWeekday(targetDay)} nachholen`]),
  ]);
}
function makeupMove(unit, targetDay) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  store.patch('plans', plan.id, { units: plan.units.map((x) => (x.id === unit.id ? { ...x, date: targetDay, dow: isoDow(targetDay), status: 'geplant', missedReason: null, updatedAt: nowIso() } : x)) });
  toast('Schlüsseleinheit nachgeholt – steht jetzt im Plan', 'good');
  refreshView();
}

/** Adaptive Entlastung: bei dauerhaft sehr fordernden Einheiten (RPE) die kommende
    Woche zurücknehmen – feste Termine bleiben, wie sie sind. */
function deloadCard(cands, prog) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#e8a13a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Seit Wochen sehr fordernd' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Deine Einheiten der letzten ${prog ? Math.round(prog.days / 7) : 3} Wochen waren im Schnitt sehr anstrengend${prog ? ` (Ø RPE ${fmtDec(prog.avgRpe)})` : ''}. Eine Entlastungswoche (${cands.length} Einheiten mit weniger Umfang, Intensität bleibt) hilft, gestärkt zurückzukommen. Feste Termine bleiben unverändert.` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => applyDeload(cands) }, [icon('feather'), 'Kommende Woche entlasten']),
  ]);
}
function applyDeload(cands) {
  const allIds = cands.map((u) => u.id);
  store.get('plans').forEach((plan) => {
    const ids = allIds.filter((id) => (plan.units || []).some((u) => u.id === id));
    if (!ids.length) return;
    applyAdapt(plan.id, ids, (u) => deloadVariant(u),
      { kind: 'deload', title: 'Entlastung eingeplant', reason: 'Belastung zuletzt dauerhaft hoch.' });
  });
  toast('Entlastungswoche aktiv – weniger Umfang, mehr Erholung', 'good', 3600);
  refreshView();
}

/** Adaptive Steigerung: nur ohne Warnsignal, mit Last im üblichen Rahmen – die
    kommende Woche etwas fordernder machen (feste Termine bleiben, wie sie sind). */
function boostCard(cands, prog) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #2bb673' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('zap'), style: { color: '#2bb673', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Noch Reserven' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Deine Einheiten der letzten ${prog ? Math.round(prog.days / 7) : 3} Wochen waren eher locker${prog ? ` (Ø RPE ${fmtDec(prog.avgRpe)})` : ''}, und deine Belastung liegt im üblichen Rahmen. Wenn du willst, legst du in der kommenden Woche (${cands.length} Einheiten) etwas drauf – rund 12 % mehr Umfang.` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => applyBoost(cands) }, [icon('zap'), 'Kommende Woche steigern']),
  ]);
}
function applyBoost(cands) {
  const allIds = cands.map((u) => u.id);
  store.get('plans').forEach((plan) => {
    const ids = allIds.filter((id) => (plan.units || []).some((u) => u.id === id));
    if (!ids.length) return;
    applyAdapt(plan.id, ids, (u) => progressVariant(u),
      { kind: 'boost', title: 'Steigerung eingeplant', reason: 'Zuletzt Reserven – etwas mehr Umfang.' });
  });
  toast('Kommende Woche etwas fordernder – viel Erfolg!', 'good', 3600);
  refreshView();
}

/** Freies Training von heute als kompakte Karte (Link zur Auswertung). */
export function freeSessionCard(s) {
  const meta = [typeMeta(s.type).label];
  if (s.distanceKm) meta.push(fmtKm(s.distanceKm, 1));
  if (s.durationSec) meta.push(fmtDuration(s.durationSec));
  return el('a', { class: 'card card--link mt-2', href: `#/session/${s.id}` }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      typeIcon(s.type),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: `✓ ${s.title || typeMeta(s.type).label}` }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: meta.join(' · ') }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]),
  ]);
}

/** Importierte Trainings, die zu offenen geplanten Einheiten passen – mit Rückfrage
    zuordnen. Zugeordnet gilt die Einheit als erledigt; es entsteht keine zweite Session. */
/** Antworten auf „Wie hart war's?“ – ein Tipp setzt die Anstrengung (RPE 1–10). */
const RPE_CHOICES = [[3, 'leicht'], [5, 'mittel'], [7, 'hart'], [9, 'sehr hart']];

export function rpeAskCard(list) {
  const rows = list.slice(0, 2).map((s) => {
    const est = sessionRpeInfo(s);
    const set = (rpe) => { store.patch('sessions', s.id, { rpe }); toast('Anstrengung gespeichert', 'good'); refreshView(); };
    return el('div', { style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
        typeIcon(s.type, 'type-icon--sm'),
        el('div', { class: 'grow', style: { minWidth: '0' } }, [
          el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: `${fmtDate(s.date)} · ${s.title || typeMeta(s.type).label}${s.distanceKm ? ' · ' + fmtKm(s.distanceKm, 1) : ''}` }),
          el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: est.source === 'herzfrequenz'
            ? `Bis dahin aus der Herzfrequenz geschätzt: ${fmtNum(est.rpe, est.rpe % 1 ? 1 : 0)} von 10`
            : `Bis dahin zählt der Standardwert der Sportart: ${fmtNum(est.rpe, est.rpe % 1 ? 1 : 0)} von 10` }),
        ]),
        el('button', { class: 'icon-btn', 'aria-label': 'Nicht nachfragen', title: 'Nicht nachfragen', onclick: () => { store.patch('sessions', s.id, { rpeDismissed: true }); refreshView(); } }, icon('x')),
      ]),
      el('div', { class: 'row gap-1 mt-1', role: 'group', 'aria-label': 'Wie anstrengend war das Training?', style: { flexWrap: 'wrap' } },
        RPE_CHOICES.map(([v, label]) => el('button', { class: 'chip chip--btn', type: 'button', text: label, 'aria-label': `${label} (${v} von 10)`, onclick: () => set(v) }))),
    ]);
  });
  return el('div', { class: 'card mt-2' }, [
    el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: 'Wie hart war’s?' }),
    el('div', { class: 'muted', style: { fontSize: '.8rem', margin: '2px 0 4px' }, text: 'Dein Empfinden macht die Belastung genauer als jede Uhr – ein Tipp genügt.' }),
    ...rows,
  ]);
}

export function importMatchCard(matches) {
  const link = (list) => {
    list.forEach(({ session, plan, unit }) => linkSession(plan, unit, session));
    toast(list.length > 1 ? `${list.length} Trainings zugeordnet` : 'Zugeordnet – Einheit erledigt', 'good');
    refreshView();
  };
  const rows = matches.slice(0, 4).map((m) => el('div', { class: 'row gap-2', style: { alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' } }, [
    typeIcon(m.session.type, 'type-icon--sm'),
    el('div', { class: 'grow', style: { minWidth: '0' } }, [
      el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: `${fmtDate(m.session.date)} · ${m.session.title || typeMeta(m.session.type).label}${m.session.distanceKm ? ' · ' + fmtKm(m.session.distanceKm, 1) : ''}` }),
      el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: `passt zu „${m.unit.title}“` }),
    ]),
    el('button', { class: 'btn btn--soft', style: { fontSize: '.8rem', padding: '6px 10px', flex: '0 0 auto' }, onclick: () => link([m]) }, 'Zuordnen'),
    el('button', { class: 'icon-btn', 'aria-label': 'Nicht zuordnen', title: 'Nicht zuordnen', onclick: () => { store.patch('sessions', m.session.id, { matchDismissed: true }); refreshView(); } }, icon('x')),
  ]));
  return el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--accent)' } }, [
    el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: 'Importierte Trainings zuordnen' }),
    el('div', { class: 'muted', style: { fontSize: '.8rem', margin: '2px 0 4px' }, text: 'Diese Trainings kamen aus Apple Health oder einer Datei und passen zu geplanten Einheiten desselben Tages. Zugeordnet gelten die Einheiten als erledigt – ohne doppelte Belastung.' }),
    ...rows,
    matches.length > 1 ? el('button', { class: 'btn btn--ghost btn--block mt-2', style: { fontSize: '.84rem' }, onclick: () => link(matches) }, [icon('check'), `Alle ${matches.length} zuordnen`]) : null,
  ]);
}

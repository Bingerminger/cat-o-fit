/* =========================================================================
   dashboard.js — Tagesübersicht: heutiges Training, Countdown, Woche, Quick-Actions.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, typeMeta, typeIcon, fmtKm, fmtPace, fmtPaceRange, fmtDuration, fmtDate, nowIso,
  todayStr, addDays, diffDays, isoDow, weekStartMonday, fmtWeekday, sectionHead, isOverdue, toast, parseHms,
} from './ui.js';
import { momentum, newlyUnlocked, markSeen } from './badges.js';
import { isProtectedDay } from './cycle.js';
import { setHeader } from './router.js';
import { trainingTip, predictRace } from './suggestions.js';
import { adaptiveInsights, readinessScore, recentLoadFeedback } from './adaptive.js';
import { openHealthEntry } from './health.js';
import { estimateVdot, pacesFromVdot, paceAdjustment } from './vdot.js';
import { softenSuggestion, easierVariant, missedKeyUnits, findMakeupDay, weekDeloadCandidates, deloadVariant, progressVariant, weekVolumeBalance, rpeProgression, dayLoadUnits } from './planflow.js';
import { destackSuggestion } from './triage.js';
import { saveUnitPatch } from './session.js';
import { goalProgress, latestWeight } from './healthgoals.js';
import { goalsProgress } from './goals.js';
import { phaseEmphasis, recommendedDeficit, stimulusCheck } from './dualgoal.js';
import { progressRing, multiLineChart } from './charts.js';
import { loadSummary, fmtRatio } from './load.js';
import { restDaySuggestion, footballFollowupEase, gentleVariant } from './rolling.js';
import { applyAdapt, undoAdapt as undoAdaptStore } from './adapt.js';

/** Alle geplanten Einheiten (über alle Pläne) an einem Datum. */
function unitsOn(dateStr) {
  const out = [];
  store.get('plans').forEach((p) => (p.units || []).forEach((u) => { if (u.date === dateStr) out.push(u); }));
  return out.sort((a, b) => (a.dow - b.dow) || a.title.localeCompare(b.title));
}

export function render(view) {
  setHeader({ title: 'Cat-O-Fit', actions: [{ icon: 'settings', label: 'Einstellungen', onClick: () => navigate('#/settings') }] });
  const today = todayStr();
  // Mitglieder tragen ihren Namen im Familienrecord, nicht zwingend im eigenen Profil
  // -> erst Profilname, dann Mitgliedsname, sonst neutral.
  const name = store.profile().name || store.activeMember()?.name || 'Athlet:in';
  const h = new Date().getHours();
  const greet = h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';

  view.appendChild(el('div', { class: 'greeting' }, [
    el('div', { class: 'greeting__hi', text: `${greet}, ${name} 👋` }),
    el('div', { class: 'greeting__sub', text: fmtDate(today) }),
  ]));

  // Momentum / Erfolge – immer sichtbar, klickbar zur Erfolgsseite
  const bdata = { sessions: store.get('sessions'), plans: store.get('plans'), health: store.get('health'), events: store.get('events'), profile: store.profile() };
  const mom = momentum(bdata, today);
  const fresh = newlyUnlocked(bdata, today);
  if (fresh.length) {
    markSeen(fresh.map((b) => b.id));
    setTimeout(() => fresh.slice(0, 3).forEach((b, i) => setTimeout(() => toast(`${b.emoji}  Abzeichen freigeschaltet: ${b.name}`, 'good', 3600), i * 800)), 500);
  }
  view.appendChild(el('a', { class: 'card card--link', href: '#/badges' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('div', { style: { fontSize: '1.8rem', lineHeight: '1' }, text: mom.flames }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
          el('span', { style: { fontWeight: '750' }, text: `Momentum ${mom.score}` }),
          el('span', { class: 'chip chip--accent', text: mom.level }),
        ]),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: mom.message }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]),
  ]));

  // Countdown-Hero zum nächsten Wettkampf
  const nextEvent = store.get('events')
    .filter((e) => e.status !== 'abgeschlossen' && e.date >= today)
    .sort((a, b) => (a.priority || 'Z').localeCompare(b.priority || 'Z') || a.date.localeCompare(b.date))[0];
  if (nextEvent) {
    const days = diffDays(today, nextEvent.date);
    view.appendChild(el('a', { class: 'hero card--link mt-3', href: `#/event/${nextEvent.id}` }, [
      el('div', { class: 'hero__eyebrow', text: 'Nächster Wettkampf' }),
      el('div', { class: 'hero__title', text: nextEvent.name }),
      el('div', { class: 'hero__row' }, [
        el('div', { class: 'countdown' }, [
          el('div', { class: 'countdown__unit' }, [el('div', { class: 'countdown__num num', text: String(days) }), el('div', { class: 'countdown__cap', text: 'Tage' })]),
          el('div', { class: 'countdown__unit' }, [el('div', { class: 'countdown__num num', text: Math.ceil(days / 7) }), el('div', { class: 'countdown__cap', text: 'Wochen' })]),
        ]),
        nextEvent.targetTime ? el('div', { style: { textAlign: 'right' } }, [el('div', { class: 'num', style: { fontWeight: '800', fontSize: '1.2rem' }, text: nextEvent.targetTime }), el('div', { style: { opacity: '.85', fontSize: '.72rem' }, text: 'Zielzeit' })]) : null,
      ]),
    ]));
  }

  // Überfällige Einheiten zum Nachholen
  const overdue = [];
  store.get('plans').forEach((p) => (p.units || []).forEach((u) => { if (isOverdue(u, today) && !isProtectedDay(u.date)) overdue.push(u); }));
  if (overdue.length) {
    view.appendChild(el('a', { class: 'card card--link mt-4', href: `#/plan/${overdue[0].eventId}`, style: { borderLeft: '4px solid #f5a623' } }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { class: 'type-icon', style: { background: 'color-mix(in srgb, #f5a623 18%, transparent)', color: '#f5a623' }, html: iconSvg('bell') }),
        el('div', { class: 'grow' }, [
          el('div', { style: { fontWeight: '700' }, text: `${overdue.length} ${overdue.length === 1 ? 'Einheit wartet' : 'Einheiten warten'} aufs Nachholen` }),
          el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: 'Verschieben, nachtragen oder als verpasst markieren.' }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
    ]));
  }

  // Verpasste Schlüsseleinheit auf einen freien Tag nachholen (adaptiv)
  const missedKey = missedKeyUnits(store.get('plans'), today)[0];
  if (missedKey && !isProtectedDay(missedKey.date)) {
    const makeupDay = findMakeupDay(store.get('plans').flatMap((p) => p.units || []), missedKey, today);
    if (makeupDay) view.appendChild(makeupCard(missedKey, makeupDay));
  }

  // Belastung dauerhaft hoch -> Entlastung; dauerhaft niedrig -> Steigerung anbieten (adaptiv)
  const loadFb = recentLoadFeedback(store.get('sessions'), today);
  if (loadFb && (loadFb.level === 'hoch' || loadFb.level === 'niedrig')) {
    const cands = weekDeloadCandidates(store.get('plans').flatMap((p) => p.units || []), today).filter((u) => !isProtectedDay(u.date));
    if (cands.length >= 2) view.appendChild(loadFb.level === 'hoch' ? deloadCard(cands) : boostCard(cands));
  }

  // Automatischer Erholungstag, wenn die Belastung es nahelegt (rollierend, R2)
  for (const plan of store.get('plans')) {
    if (plan.kind === 'program') continue;
    const rd = restDaySuggestion({ plan, sessions: store.get('sessions'), today });
    if (rd && !isProtectedDay(rd.date)) { view.appendChild(restDayCard(plan, rd)); break; }
  }

  // Nach einem fordernden Fußballtag die nächste harte Einheit lockerer anbieten (#5)
  const allUnits = store.get('plans').flatMap((p) => p.units || []);
  const fbEase = footballFollowupEase({ units: allUnits, sessions: store.get('sessions'), today });
  if (fbEase && !isProtectedDay(fbEase.date)) view.appendChild(footballEaseCard(fbEase));

  // Zwei Ziele stapeln zwei Einheiten auf einen Tag? Entzerren anbieten (#4)
  const destack = destackSuggestion(allUnits, today);
  if (destack && !isProtectedDay(destack.date)) view.appendChild(destackCard(destack));

  // Heutiges Training
  const todays = unitsOn(today);
  view.appendChild(sectionHead('Heute'));
  // Bei niedriger Bereitschaft + fordernder Einheit: lockerer angehen anbieten (adaptiv)
  const soft = softenSuggestion(todays, readinessScore(store.get('health'), today));
  if (soft && !isProtectedDay(soft.unit.date)) view.appendChild(readinessAdjustCard(soft));
  if (todays.length) {
    todays.forEach((u) => view.appendChild(todayCard(u)));
  } else {
    view.appendChild(el('div', { class: 'card today-card__none' }, [
      el('span', { class: 'type-icon', style: { background: 'var(--surface-3)', color: 'var(--text-2)' }, html: iconSvg('moon') }),
      el('div', {}, [el('div', { style: { fontWeight: '700' }, text: 'Ruhetag' }), el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: 'Keine Einheit geplant – genieß die Erholung.' })]),
    ]));
  }

  // Trainingstipp
  view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('sparkles'), style: { color: 'var(--accent)', width: '20px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: trainingTip({ todaysUnits: todays, streak: calcStreak(), weekKm: 0 }) }),
  ]));

  // Coach – adaptive Hinweise aus deinem Verhalten
  const insights = adaptiveInsights({ sessions: store.get('sessions'), health: store.get('health'), events: store.get('events'), profile: store.profile(), today });
  const volCard = volumeBalanceCard(view, today);   // automatischer Wochenumfang-Ausgleich
  const rpeCard = rpeProgressionCard(today);        // automatische Progressionssteuerung (RPE)
  if (insights.length || volCard || rpeCard) {
    view.appendChild(sectionHead('Dein Coach'));
    const wrap = el('div', { class: 'col gap-2' });
    insights.forEach((ins) => {
      const color = ins.tone === 'good' ? 'var(--good)' : ins.tone === 'warn' ? '#f5a623' : 'var(--accent)';
      wrap.appendChild(el('div', { class: 'card', style: { borderLeft: `3px solid ${color}` } }, [
        el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
          el('span', { html: iconSvg(ins.icon), style: { color, width: '20px', flex: '0 0 auto', marginTop: '1px' } }),
          el('div', {}, [
            el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: ins.title }),
            el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: ins.text }),
          ]),
        ]),
      ]));
    });
    if (volCard) wrap.appendChild(volCard);
    if (rpeCard) wrap.appendChild(rpeCard);
    view.appendChild(wrap);
  }

  // Zuletzt automatisch angepasst (Transparenz-Log, R2)
  const alCard = adaptLogCard();
  if (alCard) view.appendChild(alCard);

  // Belastung & Form – Profisport-Steuerung (ACWR + Fitness/Ermüdung/Form)
  const lfCard = loadFormCard(today);
  if (lfCard) {
    view.appendChild(sectionHead('Belastung & Form'));
    view.appendChild(lfCard);
  }

  // Wochenstreifen
  view.appendChild(sectionHead('Diese Woche', { label: 'Kalender', onClick: () => navigate('#/calendar') }));
  view.appendChild(weekStrip(today));

  // Wochen-Kennzahlen (Soll/Ist)
  view.appendChild(weekStats(today));

  // Ziel-Cockpit: Status aller Ziele + Phasen-Schwerpunkt + Ernährungskopplung (R4)
  const gc = goalCockpitCard(today);
  if (gc) { view.appendChild(sectionHead('Deine Ziele')); view.appendChild(gc); }

  // Wochen-Gesundheitsziele (Aktivität & Gewicht) – plan-unabhängig
  view.appendChild(weekGoalsCard(today));

  // Dedizierte Gesundheits-/Gewichtsziele mit Fortschritt (nur wenn definiert).
  const hgc = healthGoalsCard(today);
  if (hgc) view.appendChild(hgc);

  // Trainingsbereiche (HF-Zonen & Zielpaces) – zentral statt versteckt in den Einstellungen.
  const zc = zonesCard();
  if (zc) view.appendChild(zc);

  const fc = formCard(today);
  if (fc) view.appendChild(fc);

  // Schnellaktionen
  view.appendChild(sectionHead('Schnellzugriff'));
  view.appendChild(el('div', { class: 'quick-actions' }, [
    quickAction('heart', 'Werte', () => openHealthEntry({})),
    quickAction('calendar', 'Kalender', () => navigate('#/calendar')),
    quickAction('chart', 'Statistik', () => navigate('#/stats')),
    quickAction('list', 'Checkliste', () => navigate('#/checklist')),
  ]));
}

/** Belastung & Form: ACWR-Ampel + Fitness/Ermüdung/Form-Kurve (Banister/PMC). */
function loadFormCard(today) {
  const sum = loadSummary(store.get('sessions'), today);
  if (!sum.hasData) return null;   // erst zeigen, wenn eine 28-Tage-Basis existiert
  const toneColor = { good: 'var(--good)', warn: '#f5a623', bad: '#e5484d', neutral: 'var(--accent)' }[sum.tone] || 'var(--accent)';
  const CTL = '#3d8bff', ATL = '#f5a623', FORM = '#43c59e';
  const lbl = (d) => `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}.`;
  const chart = multiLineChart([
    { name: 'Fitness', color: CTL, points: sum.series.map((d) => ({ label: lbl(d), value: d.ctl })) },
    { name: 'Ermüdung', color: ATL, points: sum.series.map((d) => ({ label: lbl(d), value: d.atl })) },
    { name: 'Form', color: FORM, width: 2.8, points: sum.series.map((d) => ({ label: lbl(d), value: d.form })) },
  ], { height: 156, zeroLine: true });

  const legendItem = (color, label, val) => el('span', { class: 'row gap-1', style: { alignItems: 'center', fontSize: '.74rem' } }, [
    el('span', { style: { width: '9px', height: '9px', borderRadius: '2px', background: color, flex: '0 0 auto' } }),
    el('span', { class: 'muted', text: label }),
    el('span', { style: { fontWeight: '700' }, text: String(val) }),
  ]);
  const formVal = (sum.form.form > 0 ? '+' : '') + Math.round(sum.form.form);

  return el('div', { class: 'card', style: { borderLeft: `3px solid ${toneColor}` } }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center', marginBottom: '6px' } }, [
      el('div', { class: 'card__title', text: sum.headline }),
      el('span', { class: 'chip', style: { background: toneColor, color: '#fff', fontSize: '.68rem' }, text: `ACWR ${fmtRatio(sum.acwr.ratio)} · ${sum.acwr.zone}` }),
    ]),
    chart,
    el('div', { class: 'row', style: { gap: '14px', flexWrap: 'wrap', margin: '6px 0 2px' } }, [
      legendItem(CTL, 'Fitness', Math.round(sum.form.ctl)),
      legendItem(ATL, 'Ermüdung', Math.round(sum.form.atl)),
      legendItem(FORM, 'Form', formVal),
    ]),
    el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '4px' }, text: sum.advice }),
  ]);
}

function todayCard(u) {
  const m = typeMeta(u.type);
  const meta = [];
  if (u.targetDistanceKm) meta.push(fmtKm(u.targetDistanceKm, u.targetDistanceKm % 1 ? 1 : 0));
  if (u.targetDurationMin && !u.targetDistanceKm) meta.push(`${u.targetDurationMin} min`);
  if (u.targetPaceSecPerKm) meta.push(`${fmtPace(u.targetPaceSecPerKm)}/km`);
  const done = u.status === 'erledigt';
  return el('a', { class: 'card card--link', href: `#/session/${u.id}` }, [
    el('div', { class: 'row gap-3' }, [
      typeIcon(u.type, 'type-icon--lg'),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
          el('div', { class: 'card__title', text: u.title }),
          done ? el('span', { class: 'chip chip--good', text: '✓ erledigt' }) : null,
        ]),
        el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: meta.join(' · ') || m.label }),
      ]),
      !done && u.type !== 'rest' ? el('span', { class: 'btn btn--primary', style: { minHeight: '40px', padding: '0 14px' } }, [icon('play')]) : el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]),
  ]);
}

function weekStrip(today) {
  const start = weekStartMonday(today);
  const strip = el('div', { class: 'week-strip' });
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const units = unitsOn(date).filter((u) => u.type !== 'rest');
    const isToday = date === today;
    const allDone = units.length > 0 && units.every((u) => u.status === 'erledigt');
    const main = units[0];
    const dot = main
      ? el('span', { class: `week-strip__dot ${allDone ? 'week-strip__done' : ''}`, style: { background: typeMeta(main.type).color }, html: iconSvg(typeMeta(main.type).icon) })
      : el('span', { class: 'week-strip__rest' });
    strip.appendChild(el('a', { class: `week-strip__day ${isToday ? 'is-today' : ''}`, href: '#/calendar' }, [
      el('span', { class: 'week-strip__dow', text: fmtWeekday(date) }),
      dot,
      el('span', { class: 'week-strip__date num', text: String(parseInt(date.slice(-2))) }),
    ]));
  }
  return strip;
}

function weekStats(today) {
  const start = weekStartMonday(today);
  const end = addDays(start, 6);
  let planKm = 0, doneCount = 0, planCount = 0, realKm = 0;
  store.get('plans').forEach((p) => (p.units || []).forEach((u) => {
    if (u.date < start || u.date > end || u.type === 'rest') return;
    planCount++;
    if (typeMeta(u.type).cat === 'run') planKm += u.targetDistanceKm || 0;
    if (u.status === 'erledigt') doneCount++;
  }));
  store.get('sessions').forEach((s) => { if (s.date >= start && s.date <= end && s.distanceKm) realKm += s.distanceKm; });

  return el('div', { class: 'week-stats mt-3' }, [
    statTile(fmtKm(realKm, 0), `von ${fmtKm(planKm, 0)} geplant`, 'Lauf-km'),
    statTile(`${doneCount}/${planCount}`, 'Einheiten', 'erledigt'),
  ]);
}

function statTile(big, sub, label) {
  return el('div', { class: 'card', style: { padding: '14px 16px' } }, [
    el('div', { class: 'dim', style: { fontSize: '.72rem', fontWeight: '650' }, text: label }),
    el('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: '800' }, text: big }),
    el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: sub }),
  ]);
}

/** Ziel-Cockpit (R4): Status aller Ziele (Lauf + Gewicht), Phasen-Schwerpunkt,
    phasenabhängige Ernährungskopplung und der ehrliche Trainingsreiz-Check. */
function goalCockpitCard(today) {
  const plans = store.get('plans'), events = store.get('events');
  const sessions = store.get('sessions'), health = store.get('health'), profile = store.profile();
  let plan = null, event = null;
  for (const p of plans) {
    if (p.kind === 'program') continue;
    const ev = events.find((e) => e.id === p.eventId);
    if (ev && ev.date >= today) { plan = p; event = ev; break; }
  }
  const targetKg = profile.targetWeightKg;
  const currentKg = latestWeight(health) ?? (Number.isFinite(profile.weightKg) ? profile.weightKg : null);
  const hasWeight = Number.isFinite(targetKg) && currentKg != null;
  if (!plan && !hasWeight) return null;
  const dual = !!plan && hasWeight;

  const rows = [];
  if (plan && event) {
    const pred = predictRace(sessions, event.distanceKm);
    const targetSec = parseHms(event.targetTime);
    let tone = 'neutral', detail;
    if (pred) {
      const onTrack = !targetSec || pred.seconds <= targetSec * 1.02;
      tone = onTrack ? 'good' : 'warn';
      detail = `Prognose ${fmtDuration(pred.seconds)}${event.targetTime ? ` · Ziel ${event.targetTime}` : ''} – ${onTrack ? 'auf Kurs' : 'da ist noch was zu tun'}.`;
    } else detail = 'Noch zu wenige Läufe für eine Formprognose.';
    rows.push(goalRow('flag', event.name, detail, tone));
  }
  if (hasWeight) {
    const delta = Math.round((currentKg - targetKg) * 10) / 10;
    const reached = delta <= 0.05;
    rows.push(goalRow('activity', 'Gewicht', reached ? `Ziel erreicht (${fmtKm(currentKg, 1)} kg)` : `${fmtKm(currentKg, 1)} kg → Ziel ${fmtKm(targetKg, 1)} kg (noch ${fmtKm(Math.abs(delta), 1)} kg)`, reached ? 'good' : 'neutral'));
  }

  const children = [
    el('div', { class: 'card__title', style: { marginBottom: '4px' }, text: dual ? 'Ziel-Cockpit · Halbmarathon + Abnehmen' : 'Ziel-Cockpit' }),
    ...rows,
  ];
  if (plan) {
    const emph = phaseEmphasis(plan, today);
    children.push(el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '4px' }, text: `Phase „${emph.phaseName}": ${emph.note}` }));
    if (dual) {
      const rec = recommendedDeficit(plan, today, { currentKg, targetKg });
      children.push(el('a', { class: 'card card--flat row row--between mt-2', href: '#/nutrition', style: { alignItems: 'center' } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.82rem' }, text: rec.reached ? 'Zielgewicht erreicht – jetzt halten' : `Empfohlenes Defizit: ${rec.kcal === 0 ? 'aktuell keins (Wettkampf-Fokus)' : Math.abs(rec.kcal) + ' kcal/Tag'}` }),
          el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: 'Phasenabhängig · zur Ernährung' }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]));
    }
  }
  const stim = stimulusCheck(sessions, today);
  children.push(el('div', { class: 'row gap-2', style: { alignItems: 'flex-start', marginTop: '6px' } }, [
    el('span', { html: iconSvg(stim.enough ? 'check' : 'info'), style: { color: stim.enough ? 'var(--good)' : '#e8a13a', width: '16px', flex: '0 0 auto', marginTop: '1px' } }),
    el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: stim.message }),
  ]));
  return el('div', { class: 'card' }, children);
}
function goalRow(ico, title, detail, tone) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? '#e8a13a' : 'var(--accent)';
  return el('div', { class: 'row gap-2', style: { alignItems: 'flex-start', padding: '4px 0' } }, [
    el('span', { html: iconSvg(ico), style: { color, width: '17px', flex: '0 0 auto', marginTop: '1px' } }),
    el('div', {}, [
      el('div', { style: { fontWeight: '650', fontSize: '.84rem' }, text: title }),
      el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: detail }),
    ]),
  ]);
}

/** Wochen-Gesundheitsziele: Aktivitätsminuten & Trainingstage als Ringe, plus Gewicht. */
function weekGoalsCard(today) {
  const prog = goalProgress({ profile: store.profile(), sessions: store.get('sessions'), health: store.get('health'), today });
  const ring = (p, label, color) => el('div', { class: 'col center', style: { flex: '1', gap: '6px' } }, [
    el('div', { style: { position: 'relative', width: '92px', height: '92px' } }, [
      progressRing(p.pct / 100, { size: 92, stroke: 9, color }),
      el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } }, [
        el('div', { class: 'num', style: { fontSize: '1.1rem', fontWeight: '800', lineHeight: '1' }, text: `${p.value}` }),
        el('div', { class: 'dim', style: { fontSize: '.62rem' }, text: `/ ${p.goal}` }),
      ]),
    ]),
    el('div', { style: { fontSize: '.78rem', fontWeight: '650', textAlign: 'center' }, text: label }),
  ]);

  const children = [
    el('div', { class: 'row row--between mb-2' }, [
      el('div', { class: 'card__title', text: 'Wochenziele' }),
      el('button', { style: { fontSize: '.78rem', color: 'var(--accent-strong)', background: 'none', border: 'none', fontWeight: '650', cursor: 'pointer' }, onclick: () => navigate('#/settings'), text: 'Anpassen' }),
    ]),
    el('div', { class: 'row', style: { gap: '12px' } }, [
      ring(prog.minutes, 'Aktive Minuten', 'var(--accent)'),
      ring(prog.days, 'Trainingstage', '#3d8bff'),
    ]),
  ];
  if (prog.weight) {
    const w = prog.weight;
    const txt = w.reached
      ? 'Zielgewicht erreicht 🎉'
      : `noch ${Math.abs(w.deltaKg)} kg ${w.direction === 'down' ? 'bis' : 'bis'} ${w.target} kg`;
    children.push(el('div', { class: 'row gap-2 mt-3', style: { alignItems: 'center', justifyContent: 'center', fontSize: '.8rem' } }, [
      el('span', { style: { width: '18px', height: '18px', flexShrink: '0', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
      el('span', { html: `<strong>${w.current} kg</strong> · ${txt}` }),
    ]));
  }
  if (prog.allMet) children.push(el('div', { class: 'center mt-2', style: { fontSize: '.76rem', color: 'var(--accent-strong)', fontWeight: '650' }, text: '✅ Wochenziel erreicht – stark!' }));

  return el('div', { class: 'card mt-3' }, children);
}

/** Dedizierte Gesundheits-/Gewichtsziele (Zielwert je Metrik) mit Fortschrittsbalken. */
function healthGoalsCard(today) {
  const items = goalsProgress({ profile: store.profile(), health: store.get('health'), today });
  if (!items.length) return null;
  const fmt = (n, d) => (n == null ? '—' : (d ? Number(n).toFixed(d).replace('.', ',') : String(Math.round(n))));
  const rows = items.map((it) => {
    const m = it.metric; const unit = m.unit ? ' ' + m.unit : '';
    const status = it.reached ? 'erreicht 🎉'
      : (it.current == null ? 'noch kein Messwert' : `noch ${fmt(it.remaining, m.digits)}${unit}`);
    const dl = it.daysLeft != null ? (it.daysLeft >= 0 ? ` · ${it.daysLeft} T` : ' · Frist vorbei') : '';
    return el('div', { style: { marginBottom: '11px' } }, [
      el('div', { class: 'row row--between', style: { fontSize: '.84rem', marginBottom: '3px' } }, [
        el('span', { style: { fontWeight: '650' }, text: m.label }),
        el('span', { style: { fontSize: '.76rem', color: it.reached ? 'var(--good)' : 'var(--text-2)' }, text: status + dl }),
      ]),
      el('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--surface-3)', overflow: 'hidden' } }, [
        el('div', { style: { height: '100%', width: Math.round(it.pct * 100) + '%', background: it.reached ? 'var(--good)' : 'var(--accent)', borderRadius: '999px', transition: 'width .3s ease' } }),
      ]),
      el('div', { class: 'dim', style: { fontSize: '.72rem', marginTop: '2px' }, text: `${fmt(it.current, m.digits)}${it.current == null ? '' : unit} → Ziel ${fmt(it.target, m.digits)}${unit}` }),
    ]);
  });
  return el('div', { class: 'card mt-3' }, [
    el('div', { class: 'row row--between mb-2' }, [
      el('div', { class: 'card__title', text: 'Gesundheitsziele' }),
      el('button', { style: { fontSize: '.78rem', color: 'var(--accent-strong)', background: 'none', border: 'none', fontWeight: '650', cursor: 'pointer' }, onclick: () => navigate('#/settings'), text: 'Verwalten' }),
    ]),
    ...rows,
  ]);
}

/** Coach-Karte: automatischer Wochenumfang-Ausgleich (Vorschlag mit „Übernehmen"). */
function volumeBalanceCard(view, today) {
  const units = store.get('plans').flatMap((p) => p.units || []);
  const bal = weekVolumeBalance(units, today);
  if (!bal || !bal.suggestion || bal.suggestion.kind !== 'add') return null;
  const s = bal.suggestion;
  const apply = el('button', { class: 'btn btn--soft mt-2', style: { fontSize: '.82rem' } }, [icon('check'), `„${s.unit.title}" auf ${s.newKm} km erhöhen`]);
  apply.addEventListener('click', () => {
    saveUnitPatch(s.unit.planId, s.unit.id, { targetDistanceKm: s.newKm });
    toast(`Auf ${s.newKm} km erhöht`, 'good');
    render(view);
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

/** Coach-Karte: automatische Progressionssteuerung aus dem RPE-Trend. */
function rpeProgressionCard(today) {
  const prog = rpeProgression(store.get('sessions'), today);
  if (!prog) return null;
  const tone = prog.trend === 'ease' ? '#f5a623' : prog.trend === 'progress' ? 'var(--good)' : 'var(--accent)';
  const title = prog.trend === 'progress' ? 'Bereit für mehr' : prog.trend === 'ease' ? 'Zeit für eine lockere Phase' : 'Belastung im grünen Bereich';
  return el('div', { class: 'card', style: { borderLeft: `3px solid ${tone}` } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('gauge'), style: { color: tone, width: '20px', flex: '0 0 auto', marginTop: '1px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: title }),
        el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: `Ø Anstrengung der letzten ${prog.count} Einheiten: RPE ${prog.avgRpe}/10. ${prog.advice}` }),
      ]),
    ]),
  ]);
}

/** Kompakte Karte mit HF-Zonen und Zielpaces (klickbar zu den Einstellungen). */
function zonesCard() {
  const p = store.profile();
  const hz = p.hrZones || [];
  const pz = p.paceZones || {};
  if (!hz.length && !Object.keys(pz).length) return null;
  const paceLine = (key, label) => { const z = pz[key]; return z ? `${label} ${fmtPace(z.min)}–${fmtPace(z.max)}` : null; };
  const paces = [paceLine('easy', 'Locker'), paceLine('threshold', 'Schwelle'), paceLine('race_hm', 'Wettkampf')].filter(Boolean);
  return el('a', { class: 'card card--link mt-2', href: '#/settings' }, [
    el('div', { class: 'row row--between mb-2' }, [
      el('div', { class: 'card__title', text: 'Deine Trainingsbereiche' }),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]),
    hz.length ? el('div', { class: 'row gap-1', style: { marginBottom: paces.length ? '8px' : '0' } }, hz.map((z) => el('div', { style: { flex: '1', textAlign: 'center' } }, [
      el('div', { style: { height: '6px', borderRadius: '3px', background: z.color || 'var(--accent)' } }),
      el('div', { class: 'dim', style: { fontSize: '.62rem', marginTop: '3px' }, text: `Z${z.zone}` }),
      el('div', { class: 'num', style: { fontSize: '.64rem' }, text: `${z.min}–${z.max}` }),
    ]))) : null,
    paces.length ? el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: paces.join(' · ') + ' min/km' }) : null,
  ]);
}

/** Formbasierte Zielpace: schätzt die aktuelle Form (VDOT) und gleicht sie mit
    den Plan-Zielpaces ab – mit Option, die Trainingsbereiche nachzuführen. */
function formCard(today) {
  const est = estimateVdot(store.get('sessions'), today);
  if (!est) return null;
  const adj = paceAdjustment(store.profile().paceZones || {}, est.vdot);
  const fresh = adj.fresh;
  const paceRow = (label, z) => el('div', { class: 'row row--between', style: { padding: '2px 0' } }, [
    el('span', { class: 'muted', text: label }), el('span', { class: 'num', text: fmtPaceRange(z.min, z.max) }),
  ]);
  const card = el('div', { class: 'card mt-2' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'baseline' } }, [
      el('div', { class: 'card__title', text: 'Aktuelle Form' }),
      el('span', { class: 'chip chip--accent', text: `VDOT ${est.vdot}` }),
    ]),
    est.basis ? el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: (est.weeks >= 3)
      ? `geglättet über ${est.weeks} Wochen · zuletzt ${fmtKm(est.basis.distanceKm, 1)} in ${fmtDuration(est.basis.durationSec)} am ${fmtDate(est.basis.date)}`
      : `geschätzt aus ${fmtKm(est.basis.distanceKm, 1)} in ${fmtDuration(est.basis.durationSec)} · ${fmtDate(est.basis.date)}` }) : null,
    el('div', { class: 'mt-2' }, [paceRow('Locker', fresh.easy), paceRow('Schwelle', fresh.threshold), paceRow('Intervalle', fresh.vo2)]),
  ]);
  if (adj.deltaSec != null && Math.abs(adj.deltaSec) >= 6) {
    const faster = adj.deltaSec > 0;
    card.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.8rem' }, text: faster
      ? `Deine Form ist rund ${adj.deltaSec} s/km schneller als deine Plan-Zielpaces – Zeit, sie zu schärfen.`
      : `Deine Plan-Zielpaces sind rund ${-adj.deltaSec} s/km schneller als deine jüngste Form – evtl. konservativer ansetzen.` }));
    card.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => applyFormPaces(est.vdot) }, [icon('refresh'), 'Trainingsbereiche an deine Form anpassen']));
  } else if (adj.deltaSec != null) {
    card.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: 'Deine Plan-Zielpaces passen gut zu deiner aktuellen Form.' }));
  }
  return card;
}
function applyFormPaces(vdot) {
  const zones = pacesFromVdot(vdot);
  store.setProfile({ paceZones: zones });
  // Offene, zukünftige Lauf-Einheiten gleich mit anpassen (Zielpace anhand der HF-Zone),
  // damit die neue Form SOFORT im Plan steht – nicht erst nach „neu berechnen".
  const byHr = { 1: zones.recovery, 2: zones.easy, 3: zones.race_hm, 4: zones.threshold, 5: zones.vo2 };
  const today = todayStr();
  store.get('plans').forEach((plan) => {
    let changed = false;
    const units = (plan.units || []).map((u) => {
      if (u.date < today || u.status === 'erledigt' || !u.targetPaceSecPerKm) return u;
      const z = byHr[u.targetHrZone];
      if (!z) return u;
      changed = true;
      return { ...u, targetPaceSecPerKm: z.min, targetPaceMaxSecPerKm: z.max, updatedAt: nowIso() };
    });
    if (changed) store.patch('plans', plan.id, { units });
  });
  toast('Trainingsbereiche & offene Plan-Paces an deine Form angepasst', 'good', 3600);
  setTimeout(() => location.reload(), 60);
}

/* --- Rollierende Anpassungen: zentral anwenden, protokollieren, rückgängig --- */

// applyAdapt (Anwenden + Log + Rückgängig-Snapshot) lebt jetzt zentral in adapt.js,
// damit auch cycle.js die zyklusbewusste Auto-Entschärfung darüber protokolliert (#3).

/** Macht eine protokollierte Anpassung rückgängig (Store-Kern) + UI (Toast/Reload). */
function undoAdapt(planId, logId) {
  if (undoAdaptStore(planId, logId)) {
    toast('Anpassung rückgängig gemacht', 'good');
    setTimeout(() => location.reload(), 60);
  }
}

/** Automatischer Erholungstag (load-getrieben). Liegen an dem Tag mehrere Einheiten
    (zwei Ziele), wird der GANZE Tag ruhig gestellt – nicht nur eine Einheit (#4). */
function restDayCard(plan, rd) {
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
          : `${rd.reason} Vorschlag: „${u.title}" am ${fmtDate(u.date)} zu einem Erholungstag machen.` }),
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
      description: 'Bewusst ruhig – der ganze Tag ist auf Erholung gestellt (auch eine zweite Einheit aus deinen Zielen). Die ursprüngliche Belastung holst du erholter nach. Rückgängig über „Zuletzt automatisch angepasst".',
    }), { kind: 'rest', title: 'Erholungstag eingefügt', reason: `Belastungssteuerung: Tag ${fmtDate(date)} entlastet.` });
    count += ids.length;
  });
  toast(count > 1 ? `Ganzer Tag entlastet – ${count} Einheiten ruhig gestellt` : 'Erholungstag eingeplant – die Einheit holst du erholter nach', 'good', 3600);
  setTimeout(() => location.reload(), 60);
}

/** Nach forderndem Fußball: die nächste harte Einheit lockerer anbieten (#5). */
function footballEaseCard(fb) {
  const u = fb.unit;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5cc97a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#5cc97a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: `Fußball ${fb.when} war fordernd` }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Fußball kostet viel Körner. „${u.title}" am ${fmtDate(u.date)} gehst du besser etwas lockerer an – frischer für die Schlüsseleinheiten.` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => footballEaseApply(u) }, [icon('feather'), `„${u.title}" lockerer machen`]),
  ]);
}
function footballEaseApply(unit) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  const easyPace = (store.profile().paceZones || {}).easy;
  applyAdapt(plan.id, [unit.id], (u) => easierVariant(u, easyPace),
    { kind: 'easier', title: 'Nach Fußball lockerer', reason: 'Fußball war fordernd – Folgeeinheit entlastet.' });
  toast('Lockerer angesetzt – die Schlüsseleinheit holst du frischer nach', 'good', 3600);
  setTimeout(() => location.reload(), 60);
}

/** Entstapeln bei zwei Zielen: eine der zwei Einheiten eines Tages auf einen freien Tag (#4). */
function destackCard(sug) {
  const m = sug.move, k = sug.keep;
  return el('div', { class: 'card', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('calendar'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Zwei Einheiten an einem Tag' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `${fmtDate(sug.date)}: „${k ? k.title : 'Einheit'}" und „${m.title}" aus deinen Zielen liegen zusammen. „${m.title}" auf ${fmtWeekday(sug.target, true)} (${fmtDate(sug.target)}) zu verschieben entzerrt den Tag – jede Einheit bekommt ihren Reiz und die Erholung stimmt.` }),
      ]),
    ]),
    el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => destackApply(m, sug.target) }, [icon('calendar'), `„${m.title}" auf ${fmtWeekday(sug.target)} verschieben`]),
  ]);
}
function destackApply(unit, target) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  applyAdapt(plan.id, [unit.id], () => ({ date: target, dow: isoDow(target) }),
    { kind: 'destack', title: 'Tag entzerrt', reason: `„${unit.title}" auf einen freien Tag verschoben – nicht mehr zwei Einheiten am selben Tag.` });
  toast('Tag entzerrt – die Einheit steht jetzt an einem freien Tag', 'good');
  setTimeout(() => location.reload(), 60);
}

/** Transparenz-Log der automatischen Anpassungen (mit Rückgängig). */
function adaptLogCard() {
  const entries = [];
  store.get('plans').forEach((p) => (p.adaptLog || []).forEach((e) => entries.push({ ...e, planId: p.id })));
  if (!entries.length) return null;
  entries.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const KIND_ICON = { rest: 'moon', deload: 'feather', boost: 'zap', easier: 'feather', makeup: 'calendar', pace: 'refresh', cycle: 'heart', destack: 'calendar' };
  const wrap = el('div', { class: 'card' }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '4px' } }, [
      el('span', { html: iconSvg('activity'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
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
      e.undo ? el('button', { class: 'btn btn--ghost', style: { fontSize: '.72rem', flex: '0 0 auto' }, onclick: () => undoAdapt(e.planId, e.id) }, 'Rückgängig') : null,
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
        el('div', { style: { fontWeight: '700' }, text: `Bereitschaft heute niedrig (${soft.score})` }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Heute steht „${u.title}" an – fordernd. Bei niedriger Bereitschaft bringt eine lockere Einheit oft mehr als eine erzwungene harte.` }),
      ]),
    ]),
    el('div', { class: 'row gap-2 mt-2' }, [
      el('button', { class: 'btn btn--soft grow', onclick: () => makeEasier(u) }, [icon('feather'), 'Heute lockerer machen']),
      el('a', { class: 'btn btn--ghost grow', href: `#/session/${u.id}`, style: { textAlign: 'center' } }, 'Zur Einheit'),
    ]),
  ]);
}
function makeEasier(unit) {
  const plan = store.get('plans').find((p) => (p.units || []).some((x) => x.id === unit.id));
  if (!plan) return;
  const easyPace = (store.profile().paceZones || {}).easy;
  applyAdapt(plan.id, [unit.id], (u) => easierVariant(u, easyPace),
    { kind: 'easier', title: 'Heute lockerer gemacht', reason: 'Niedrige Bereitschaft heute.' });
  toast('Heute lockerer – die Schlüsseleinheit holst du erholt nach', 'good', 3600);
  setTimeout(() => location.reload(), 60);
}

/** Adaptive Umplanung: verpasste Schlüsseleinheit auf einen freien Tag nachholen. */
function makeupCard(unit, targetDay) {
  return el('div', { class: 'card mt-4', style: { borderLeft: '5px solid #5b8def' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('refresh'), style: { color: '#5b8def', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Schlüsseleinheit nachholen?' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `„${unit.title}" vom ${fmtDate(unit.date)} ist ausgefallen. ${fmtWeekday(targetDay, true)} (${fmtDate(targetDay)}) ist frei – dorthin verschieben?` }),
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
  setTimeout(() => location.reload(), 60);
}

/** Adaptive Entlastung: bei dauerhaft hoher Belastung die kommende Woche zurücknehmen. */
function deloadCard(cands) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#e8a13a', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Belastung zuletzt hoch' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Deine letzten Einheiten waren im Schnitt fordernd. Eine Entlastungswoche (${cands.length} Einheiten mit weniger Umfang) hilft, gestärkt zurückzukommen.` }),
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
  setTimeout(() => location.reload(), 60);
}

/** Adaptive Steigerung: bei dauerhaft niedriger Belastung die kommende Woche etwas fordernder machen. */
function boostCard(cands) {
  return el('div', { class: 'card', style: { borderLeft: '5px solid #2bb673' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('zap'), style: { color: '#2bb673', width: '20px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: 'Noch Reserven' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `Deine letzten Einheiten waren eher locker. Wenn du willst, legst du in der kommenden Woche (${cands.length} Einheiten) etwas drauf – rund 12 % mehr Umfang.` }),
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
  setTimeout(() => location.reload(), 60);
}

function quickAction(ico, label, onClick) {
  return el('button', { class: 'quick-action', onclick: onClick }, [
    el('span', { class: 'quick-action__ico', html: iconSvg(ico) }),
    el('span', { text: label }),
  ]);
}

/** Aktuelle Aktiv-Streak (aufeinanderfolgende Tage mit erledigter Einheit oder Session). */
function calcStreak() {
  const activeDates = new Set();
  store.get('sessions').forEach((s) => activeDates.add(s.date));
  store.get('plans').forEach((p) => (p.units || []).forEach((u) => { if (u.status === 'erledigt') activeDates.add(u.date); }));
  let streak = 0;
  let d = todayStr();
  // Heute darf noch „leer" sein, ohne die Serie zu brechen.
  if (!activeDates.has(d)) d = addDays(d, -1);
  while (activeDates.has(d)) { streak++; d = addDays(d, -1); }
  return streak;
}

/* =========================================================================
   dashboard.js — Tagesübersicht: heutiges Training, Countdown, Woche, Quick-Actions.
   Ziel-Karten: dashboard-goals.js · Coach-Karten: dashboard-coach.js.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, typeMeta, typeIcon, fmtKm, fmtPace, fmtDate, todayStr, addDays,
  diffDays, weekStartMonday, fmtWeekday, sectionHead, isOverdue, toast, infoButton,
} from './ui.js';
import { momentum, newlyUnlocked, markSeen, badgeData } from './badges.js';
import { isProtectedDay } from './cycle.js';
import { setHeader } from './router.js';
import { trainingTip } from './suggestions.js';
import { adaptiveInsights, readinessScore } from './adaptive.js';
import { importedMatches, rpeAskList } from './planflow.js';
import { coachDecision } from './coach.js';
import { openActivitySheet } from './session.js';
import { periodState, periodFlagCard } from './cycle.js';
import { periodFlag } from './redflags.js';
import { multiLineChart } from './charts.js';
import { loadSummary, fmtRatio } from './load.js';
import { runKm } from './fitness.js';
import { formCard } from './formcards.js';
import { goalCockpitCard, weekGoalsCard, healthGoalsCard } from './dashboard-goals.js';
import { coachCard, rpeInfoCard, adaptLogCard, freeSessionCard, rpeAskCard, importMatchCard } from './dashboard-coach.js';

import { t, tp } from './i18n.js';

/** Alle geplanten Einheiten (über alle Pläne) an einem Datum. */
function unitsOn(dateStr) {
  const out = [];
  store.get('plans').forEach((p) => (p.units || []).forEach((u) => { if (u.date === dateStr) out.push(u); }));
  return out.sort((a, b) => (a.dow - b.dow) || a.title.localeCompare(b.title));
}

export function render(view) {
  setHeader({ title: t('nav.today'), actions: [{ icon: 'settings', label: t('nav.settings'), onClick: () => navigate('#/settings') }] });
  const today = todayStr();
  // Mitglieder tragen ihren Namen im Familienrecord, nicht zwingend im eigenen Profil
  // -> erst Profilname, dann Mitgliedsname, sonst neutral.
  const name = store.profile().name || store.activeMember()?.name || t('dashboard.athlete');
  const h = new Date().getHours();
  const greet = h < 11 ? t('dashboard.greetMorning', { name }) : h < 18 ? t('dashboard.greetAfternoon', { name }) : t('dashboard.greetEvening', { name });

  // Beim Verwalten eines anderen Profils NICHT „Guten Abend, Lea“ – das las sich, als
  // sei Lea angemeldet (UI-02). Stattdessen klar: Leas Übersicht.
  view.appendChild(el('div', { class: 'greeting' }, [
    el('div', { class: 'greeting__hi', text: store.isManaging() ? (/[sßxz]$/i.test(name.trim()) ? t('dashboard.overviewOfSibilant', { name: name.trim() }) : t('dashboard.overviewOf', { name: name.trim() })) : greet }),
    el('div', { class: 'greeting__sub', text: fmtDate(today) }),
  ]));

  // Standard-PIN (0000) oder gar keine: unübersehbar erinnern, bis eine eigene gesetzt ist.
  if (store.isViewingSelf() && store.pinIsWeak()) {
    view.appendChild(el('a', { class: 'card card--link mb-3', href: '#/settings', style: { borderLeft: '3px solid var(--warn)' } }, [
      el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
        el('span', { style: { fontSize: '1.5rem', lineHeight: '1' }, text: '🔒' }),
        el('div', { class: 'grow' }, [
          el('div', { style: { fontWeight: '700' }, text: t('dashboard.pinTitle') }),
          el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('dashboard.pinText') }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
    ]));
  }

  // Ausgebliebene Periode: Warnsignal auch hier, nicht nur im Labor (Zyklus-Modul aktiv,
  // eigene Sicht). Ist die Frage noch offen, führt der Hinweis zum Zyklus.
  const ps = periodState(today);
  if (ps && ps.flag) {
    const card = periodFlagCard(periodFlag(ps));
    card.appendChild(el('a', { class: 'btn btn--ghost mt-2', href: '#/zyklus', style: { fontSize: '.8rem' } }, t('dashboard.toCycle')));
    view.appendChild(card);
  } else if (ps && ps.state === 'ask') {
    view.appendChild(el('a', { class: 'card card--link mb-3', href: '#/zyklus', style: { borderLeft: '3px solid var(--warn)' } }, [
      el('div', { style: { fontWeight: '700' }, text: t('dashboard.periodOverdue') }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('dashboard.periodOverdueText', { days: ps.days }) }),
    ]));
  }

  // Momentum / Erfolge – klickbar zur Erfolgsseite, aber erst ab der ersten Einheit:
  // „Momentum 42 · Der Funke ist da“ ohne jede Aktivität war eine leere Behauptung (UI-13).
  const bdata = badgeData();
  const mom = momentum(bdata, today);
  const fresh = newlyUnlocked(bdata, today);
  if (fresh.length) {
    markSeen(fresh.map((b) => b.id));
    setTimeout(() => fresh.slice(0, 3).forEach((b, i) => setTimeout(() => toast(t('dashboard.badgeUnlocked', { emoji: b.emoji, name: b.name }), 'good', 3600), i * 800)), 500);
  }
  const hasPlan = store.get('plans').length > 0;
  const hasTraining = store.get('sessions').length > 0;
  if (!hasPlan && !hasTraining) view.appendChild(startCard());
  if (hasTraining) view.appendChild(el('a', { class: 'card card--link', href: '#/badges' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('div', { style: { fontSize: '1.8rem', lineHeight: '1', whiteSpace: 'nowrap', flex: '0 0 auto' }, 'aria-hidden': 'true', text: mom.flames }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
          el('span', { style: { fontWeight: '750' }, text: t('dashboard.momentum', { score: mom.score }) }),
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
      el('div', { class: 'hero__eyebrow', text: t('dashboard.nextRace') }),
      el('div', { class: 'hero__title', text: nextEvent.name }),
      el('div', { class: 'hero__row' }, [
        el('div', { class: 'countdown' }, [
          el('div', { class: 'countdown__unit' }, [el('div', { class: 'countdown__num num', text: String(days) }), el('div', { class: 'countdown__cap', text: tp('dashboard.countdownDays', days) })]),
          el('div', { class: 'countdown__unit' }, [el('div', { class: 'countdown__num num', text: Math.ceil(days / 7) }), el('div', { class: 'countdown__cap', text: tp('dashboard.countdownWeeks', Math.ceil(days / 7)) })]),
        ]),
        nextEvent.targetTime ? el('div', { style: { textAlign: 'right' } }, [el('div', { class: 'num', style: { fontWeight: '800', fontSize: '1.2rem' }, text: nextEvent.targetTime }), el('div', { style: { opacity: '.85', fontSize: '.72rem' }, text: t('dashboard.targetTime') })]) : null,
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
          el('div', { style: { fontWeight: '700' }, text: tp('dashboard.overdue', overdue.length) }),
          el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('dashboard.overdueHint') }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
    ]));
  }

  // Die EINE Tagesempfehlung des Coaches (feste Priorität: Warnsignale → Plan-Pflege →
  // Steigerung). Früher entschieden sieben Stellen unabhängig voneinander – mit
  // widersprüchlichen Karten am selben Morgen.
  const coach = coachDecision({
    plans: store.get('plans'), sessions: store.get('sessions'), today, isProtectedDay,
    readiness: readinessScore(store.get('health'), today),
  });
  const cCard = coachCard(view, coach, today);
  if (cCard) view.appendChild(cCard);

  // Heutiges Training
  const todays = unitsOn(today);
  view.appendChild(sectionHead(t('nav.today')));
  // Freie Trainings von heute (ohne Plan: spontan erfasst oder importiert).
  const freeToday = store.get('sessions').filter((s) => s && s.date === today && !s.plannedId);
  if (todays.length) {
    todays.forEach((u) => view.appendChild(todayCard(u)));
  } else if (!freeToday.length) {
    // Ohne Plan ist heute kein „Ruhetag“ – es gibt einfach noch nichts zu tun (UI-13).
    view.appendChild(el('div', { class: 'card today-card__none' }, [
      el('span', { class: 'type-icon', 'aria-hidden': 'true', style: { background: 'var(--surface-3)', color: 'var(--text-2)' }, html: iconSvg(hasPlan ? 'moon' : 'flag') }),
      hasPlan
        ? el('div', {}, [el('div', { style: { fontWeight: '700' }, text: t('dashboard.restDay') }), el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('dashboard.restDayText') })])
        : el('div', {}, [el('div', { style: { fontWeight: '700' }, text: t('dashboard.noPlan') }), el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('dashboard.noPlanText') })]),
    ]));
  }
  freeToday.forEach((s) => view.appendChild(freeSessionCard(s)));
  // Training erfassen – auch ohne Plan (Radtour, Lauf am Ruhetag, Training ohne Ziel).
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => openActivitySheet({ date: today }) }, [icon('plus'), t('dashboard.logActivity')]));
  // Importierte Trainings (Apple Health, Datei) passenden geplanten Einheiten zuordnen.
  const matches = importedMatches(store.get('plans'), store.get('sessions'), today);
  if (matches.length) view.appendChild(importMatchCard(matches));
  // Importierte Trainings ohne Anstrengung: kurz nachfragen statt still zu schätzen.
  const askRpe = rpeAskList(store.get('sessions'), today);
  if (askRpe.length) view.appendChild(rpeAskCard(askRpe));

  // Trainingstipp
  view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('sparkles'), style: { color: 'var(--accent-text)', width: '20px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: trainingTip({ todaysUnits: todays.length ? todays : freeToday, streak: mom.streak, weekKm: 0, hasPlan }) }),
  ]));
  // Bis hier „der Tag“ – ab 1180 px Breite die linke Spalte (UI-17).
  const splitAt = view.childNodes.length;

  // Coach – Informationen aus deinem Verhalten (kein zweites Belastungsurteil: das
  // kommt allein aus „Belastung & Form“, die Empfehlung allein aus der Karte oben).
  const lsum = loadSummary(store.get('sessions'), today);
  const insights = adaptiveInsights({
    sessions: store.get('sessions'), health: store.get('health'), events: store.get('events'), profile: store.profile(), today,
    coachWarning: coach.warning ? coach.primary.kind : false, loadWarning: lsum.hasData && ['warn', 'bad'].includes(lsum.tone),
  });
  const rpeCard = rpeInfoCard(coach.rpe);           // Anstrengung der letzten Einheiten (ohne Urteil)
  if (insights.length || rpeCard) {
    view.appendChild(sectionHead(t('dashboard.yourCoach')));
    const wrap = el('div', { class: 'col gap-2' });
    const insightCard = (ins) => {
      const color = ins.tone === 'good' ? 'var(--good)' : ins.tone === 'warn' ? '#f5a623' : 'var(--accent)';
      return el('div', { class: 'card', style: { borderLeft: `3px solid ${color}` } }, [
        el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
          el('span', { html: iconSvg(ins.icon), 'aria-hidden': 'true', style: { color, width: '20px', flex: '0 0 auto', marginTop: '1px' } }),
          el('div', {}, [
            el('div', { style: { fontWeight: '700', fontSize: '.92rem' }, text: ins.title }),
            el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: ins.text }),
          ]),
        ]),
      ]);
    };
    // Der wichtigste Hinweis offen, die übrigen gebündelt – vorher standen bis zu fünf
    // Coach-Karten untereinander (UI-15).
    if (insights.length) wrap.appendChild(insightCard(insights[0]));
    const more = [...insights.slice(1).map(insightCard), rpeCard].filter(Boolean);
    if (more.length) {
      wrap.appendChild(el('details', { class: 'coach-more' }, [
        el('summary', { text: t('dashboard.moreHints', { count: more.length }) }),
        el('div', { class: 'col gap-2 mt-2' }, more),
      ]));
    }
    view.appendChild(wrap);
  }

  // Zuletzt automatisch angepasst (Transparenz-Log, R2)
  const alCard = adaptLogCard();
  if (alCard) view.appendChild(alCard);

  // Belastung & Form – Lastverhältnis + Fitness/Ermüdung/Form (eine Quelle: load.js)
  const lfCard = loadFormCard(lsum);
  if (lfCard) {
    view.appendChild(sectionHead(t('dashboard.loadForm')));
    view.appendChild(lfCard);
  }

  // Wochenstreifen
  view.appendChild(sectionHead(t('dashboard.thisWeek'), { label: t('nav.calendar'), onClick: () => navigate('#/calendar') }));
  view.appendChild(weekStrip(today));

  // Wochen-Kennzahlen (Soll/Ist)
  view.appendChild(weekStats(today));

  // Ziel-Cockpit: Status aller Ziele + Phasen-Schwerpunkt + Ernährungskopplung (R4)
  const gc = goalCockpitCard(today);
  if (gc) { view.appendChild(sectionHead(t('dashboard.yourGoals'))); view.appendChild(gc); }

  // Wochen-Gesundheitsziele (Aktivität & Gewicht) – plan-unabhängig
  view.appendChild(weekGoalsCard(today));

  // Dedizierte Gesundheits-/Gewichtsziele mit Fortschritt (nur wenn definiert).
  const hgc = healthGoalsCard(today);
  if (hgc) view.appendChild(hgc);

  // Form nur mit Handlungsbedarf (Paces passen nicht mehr); Form und Trainingsbereiche
  // stehen sonst unter „Fortschritt → Training“. Der Schnellzugriff entfällt – Tab-Leiste
  // und ＋ Erfassen decken ihn ab (UI-15: „Heute“ war 4,4 Bildschirme lang).
  const fc = formCard(today, { actionableOnly: true });
  if (fc) view.appendChild(fc);

  // iPad quer und Mac (≥ 1180 px): zwei Spalten – links der Tag, rechts Coach, Belastung,
  // Woche und Ziele. Schmaler bleibt es eine Spalte in derselben Reihenfolge (UI-17).
  const kids = [...view.childNodes];
  const colA = el('div', { class: 'dash-col' });
  const colB = el('div', { class: 'dash-col' });
  view.innerHTML = '';
  kids.forEach((k, i) => (i < splitAt ? colA : colB).appendChild(k));
  view.appendChild(el('div', { class: 'dash-cols' }, [colA, colB]));
}

/** Belastung & Form: Lastverhältnis + Fitness/Ermüdung/Form-Kurve (Banister/PMC). */
function loadFormCard(sum) {
  if (!sum.hasData) return null;   // erst zeigen, wenn eine 28-Tage-Basis existiert
  const toneColor = { good: 'var(--good)', warn: '#f5a623', bad: '#e5484d', neutral: 'var(--accent)' }[sum.tone] || 'var(--accent)';
  // Chip mit Tonfläche und lesbarer Textfarbe – Weiß auf Orange hatte nur 2,0:1 (UI-12).
  const toneText = { good: 'var(--good-text)', warn: 'var(--warn-text)', bad: 'var(--bad-text)', neutral: 'var(--accent-text)' }[sum.tone] || 'var(--accent-text)';
  const CTL = '#3d8bff', ATL = '#f5a623', FORM = '#43c59e';
  const lbl = (d) => `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}.`;
  const chart = multiLineChart([
    { name: t('dashboard.fitness'), color: CTL, points: sum.series.map((d) => ({ label: lbl(d), value: d.ctl })) },
    { name: t('dashboard.fatigue'), color: ATL, points: sum.series.map((d) => ({ label: lbl(d), value: d.atl })) },
    { name: t('dashboard.form'), color: FORM, width: 2.8, points: sum.series.map((d) => ({ label: lbl(d), value: d.form })) },
  ], { height: 156, zeroLine: true, label: t('dashboard.chartLabel') });

  const legendItem = (color, label, val) => el('span', { class: 'row gap-1', style: { alignItems: 'center', fontSize: '.74rem' } }, [
    el('span', { style: { width: '9px', height: '9px', borderRadius: '2px', background: color, flex: '0 0 auto' } }),
    el('span', { class: 'muted', text: label }),
    el('span', { style: { fontWeight: '700' }, text: String(val) }),
  ]);
  const formVal = (sum.form.form > 0 ? '+' : '') + Math.round(sum.form.form);
  // Form in Worten (relativ zur Fitness) – „Form −88“ allein sagte niemandem etwas.
  const fs = sum.formState;
  const formWords = fs.reliable ? t('dashboard.formRelative', { label: fs.label, pct: `${fs.rel > 0 ? '+' : ''}${Math.round(fs.rel * 100)}` }) : fs.label;

  return el('div', { class: 'card', style: { borderLeft: `3px solid ${toneColor}` } }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center', marginBottom: '6px', gap: '8px' } }, [
      el('div', { class: 'card__title', text: sum.headline }),
      el('div', { class: 'row gap-1', style: { alignItems: 'center', flex: '0 0 auto' } }, [
        el('span', { class: 'chip', style: { background: `color-mix(in srgb, ${toneColor} 16%, transparent)`, color: toneText, fontSize: '.68rem' }, text: t('dashboard.ratio', { ratio: fmtRatio(sum.acwr.ratio) }) }),
        infoButton('belastung-form', t('dashboard.loadForm')),
      ]),
    ]),
    chart,
    el('div', { class: 'row', style: { gap: '14px', flexWrap: 'wrap', margin: '6px 0 2px' } }, [
      legendItem(CTL, t('dashboard.fitness'), Math.round(sum.form.ctl)),
      legendItem(ATL, t('dashboard.fatigue'), Math.round(sum.form.atl)),
      legendItem(FORM, t('dashboard.form'), formVal),
    ]),
    el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: t('dashboard.formFootnote', { form: formWords }) }),
    el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '4px' }, text: sum.advice }),
    sum.formNote ? el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '4px' }, text: sum.formNote }) : null,
  ]);
}

/** Einstieg nach „Leer starten“: drei Schritte statt eines leeren Dashboards (UI-13).
    Erledigte Schritte sind abgehakt; die Karte verschwindet mit dem ersten Plan/Training. */
function startCard() {
  const p = store.profile();
  const steps = [
    { done: !!(p.weightKg && p.birthYear), label: t('dashboard.stepProfile'), hint: t('dashboard.stepProfileHint'), href: '#/settings' },
    { done: store.get('events').length > 0, label: t('dashboard.stepGoal'), hint: t('dashboard.stepGoalHint'), href: '#/events' },
    store.isAdmin() ? { done: store.members().length > 1, label: t('dashboard.stepMembers'), hint: t('dashboard.stepMembersHint'), href: '#/familie-verwalten' } : null,
  ].filter(Boolean);
  return el('div', { class: 'card start-card' }, [
    el('div', { class: 'card__title', text: t('dashboard.letsGo') }),
    el('div', { class: 'muted', style: { fontSize: '.84rem', marginBottom: '8px' }, text: t('dashboard.startIntro') }),
    el('ol', { class: 'start-steps' }, steps.map((s, i) => el('li', {}, [
      el('a', { class: `start-step ${s.done ? 'is-done' : ''}`, href: s.href }, [
        el('span', { class: 'start-step__num', 'aria-hidden': 'true', text: s.done ? '✓' : String(i + 1) }),
        el('span', { class: 'grow' }, [
          el('span', { class: 'start-step__label', text: s.done ? t('dashboard.stepDone', { label: s.label }) : s.label }),
          el('span', { class: 'start-step__hint', text: s.hint }),
        ]),
        el('span', { class: 'list-item__chev', 'aria-hidden': 'true', html: iconSvg('chevronRight') }),
      ]),
    ]))),
  ]);
}

function todayCard(u) {
  const m = typeMeta(u.type);
  const meta = [];
  if (u.targetDistanceKm) meta.push(fmtKm(u.targetDistanceKm, u.targetDistanceKm % 1 ? 1 : 0));
  if (u.targetDurationMin && !u.targetDistanceKm) meta.push(`${u.targetDurationMin} min`);
  if (u.targetPaceSecPerKm) meta.push(`${fmtPace(u.targetPaceSecPerKm)}/km`);
  const done = u.status === 'erledigt';
  // Karte = Link zur Einheit; der ▶ daneben ist ein eigener Link, der das Training
  // direkt startet. Vorher war er eine Attrappe innerhalb des Kartenlinks (UI-09).
  const link = el('a', { class: 'today-unit__link', href: `#/session/${u.id}` }, [
    typeIcon(u.type, 'type-icon--lg'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
        el('div', { class: 'card__title', text: u.title }),
        done ? el('span', { class: 'chip chip--good', text: t('dashboard.doneChip') }) : null,
      ]),
      el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: meta.join(' · ') || m.label }),
    ]),
  ]);
  const side = !done && u.type !== 'rest'
    ? el('a', { class: 'btn btn--primary today-unit__play', href: `#/workout/${u.id}`, 'aria-label': t('dashboard.startWorkoutFor', { title: u.title }), title: t('dashboard.startWorkout') }, [icon('play')])
    : el('span', { class: 'list-item__chev', 'aria-hidden': 'true', html: iconSvg('chevronRight') });
  return el('div', { class: 'card today-unit' }, [link, side]);
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
  let planKm = 0, doneCount = 0, planCount = 0;
  store.get('plans').forEach((p) => (p.units || []).forEach((u) => {
    if (u.date < start || u.date > end || u.type === 'rest') return;
    planCount++;
    if (typeMeta(u.type).cat === 'run') planKm += u.targetDistanceKm || 0;
    if (u.status === 'erledigt') doneCount++;
  }));
  // Soll und Ist zählen beide nur Laufen (Rad, Gehen, Schwimmen haben eigene km).
  const realKm = runKm(store.get('sessions'), start, end);

  return el('div', { class: 'week-stats mt-3' }, [
    statTile(fmtKm(realKm, 0), t('dashboard.ofPlanned', { km: fmtKm(planKm, 0) }), t('dashboard.runKm')),
    statTile(`${doneCount}/${planCount}`, t('dashboard.statSessions'), t('dashboard.statDone')),
  ]);
}

function statTile(big, sub, label) {
  return el('div', { class: 'card', style: { padding: '14px 16px' } }, [
    el('div', { class: 'dim', style: { fontSize: '.72rem', fontWeight: '650' }, text: label }),
    el('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: '800' }, text: big }),
    el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: sub }),
  ]);
}

/* =========================================================================
   dashboard-goals.js — goal cards on "Today": goal cockpit (running + weight),
   weekly goals and health goals. Extracted from dashboard.js (FE-18).
   ========================================================================= */

import * as store from './storage.js';
import { el, iconSvg, navigate, fmtDuration, parseHms, fmtNum, fmtKmAuto, fmtWeight } from './ui.js';
import { distanceUnit } from './units.js';
import { predictRace } from './suggestions.js';
import { goalProgress } from './healthgoals.js';
import { currentEnergyTargets, currentEligibility } from './wellness.js';
import { goalsProgress, shownMetric } from './goals.js';
import { phaseEmphasis, stimulusCheck } from './dualgoal.js';
import { progressRing } from './charts.js';

import { t } from './i18n.js';

/** Goal cockpit (R4): status of all goals (running + weight), phase focus,
    phase-dependent nutrition coupling and the honest training-stimulus check. */
export function goalCockpitCard(today) {
  const sessions = store.get('sessions');
  // Same source as the nutrition card: plan for the next race, smoothed
  // weight, one definition of "goal reached", the same deficit.
  const energy = currentEnergyTargets(today);
  const plan = energy.plan, event = energy.event;
  // Children, pregnancy/breastfeeding, eating disorder: no weight goal, no weight-loss cockpit.
  const gs = energy.elig.noWeightGoals ? null : energy.goalStatus;
  const hasWeight = !!gs;
  if (!plan && !hasWeight) return null;
  const dual = !!plan && hasWeight;
  const weightLabel = gs ? (gs.direction === 'up' ? t('dashboardGoals.gainWeight') : gs.direction === 'down' ? t('dashboardGoals.loseWeight') : t('dashboardGoals.weight')) : '';

  const rows = [];
  if (plan && event) {
    const pred = predictRace(sessions, event.distanceKm, { hrZones: store.profile().hrZones, today });
    const targetSec = parseHms(event.targetTime);
    let tone = 'neutral', detail;
    if (pred) {
      const onTrack = !targetSec || pred.seconds <= targetSec * 1.02;
      tone = onTrack ? 'good' : 'warn';
      const time = fmtDuration(pred.seconds), target = event.targetTime;
      if (target) detail = onTrack ? t('dashboardGoals.forecastTargetOnTrack', { time, target }) : t('dashboardGoals.forecastTargetBehind', { time, target });
      else detail = onTrack ? t('dashboardGoals.forecastOnTrack', { time }) : t('dashboardGoals.forecastBehind', { time });
      if (pred.caveat) detail += ` ${t('dashboardGoals.forecastNeedsVolume')}`;
      else if (pred.onlyEasy) detail += ` ${t('dashboardGoals.forecastFromEasy')}`;
    } else detail = t('dashboardGoals.noForecast');
    rows.push(goalRow('flag', event.name, detail, tone));
  }
  if (hasWeight) {
    const kg = (v) => fmtWeight(v);
    const detail = gs.reached
      ? (gs.beyond ? t('dashboardGoals.weightReachedBeyond', { weight: kg(gs.current) }) : t('dashboardGoals.weightReached', { weight: kg(gs.current) }))
      : gs.status === 'halten'
        ? t('dashboardGoals.weightAlmost', { current: kg(gs.current), target: kg(gs.target) })
        : t('dashboardGoals.weightProgress', { current: kg(gs.current), target: kg(gs.target), remaining: kg(gs.remaining) });
    rows.push(goalRow('activity', t('dashboardGoals.weight'), detail, gs.reached ? 'good' : 'neutral'));
  }

  const children = [
    el('div', { class: 'card__title', style: { marginBottom: '4px' }, text: dual ? t('dashboardGoals.cockpitDual', { race: raceLabel(event), weight: weightLabel }) : t('dashboardGoals.cockpit') }),
    ...rows,
  ];
  if (plan) {
    const emph = phaseEmphasis(plan, today);
    // The phase text talks about losing weight – show only if there is a weight-loss goal.
    if (dual && gs.direction === 'down') children.push(el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '4px' }, text: t('dashboardGoals.phaseNote', { phase: emph.phaseName, note: emph.note }) }));
    if (dual) {
      let head;
      if (energy.block === 'eligibility' || energy.block === 'bmi') head = t('dashboardGoals.noDeficit');
      else if (gs.status !== 'abnehmen') head = gs.status === 'zunehmen' ? t('dashboardGoals.gainGoal') : t('dashboardGoals.weightGoalReached');
      else if (!energy.elig.answered) head = t('dashboardGoals.answerScreening');
      else if (energy.elig.hideNumbers) head = t('dashboardGoals.lossGoalActive');
      else head = energy.deficitKcal === 0 ? t('dashboardGoals.deficitNone') : t('dashboardGoals.deficitKcal', { kcal: Math.abs(energy.deficitKcal) });
      children.push(el('a', { class: 'card card--flat row row--between mt-2', href: '#/nutrition', style: { alignItems: 'center' } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.82rem' }, text: head }),
          el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: energy.balance && energy.balance.floored ? t('dashboardGoals.phaseFloored') : t('dashboardGoals.phaseBased') }),
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
/** Short name of the race for the cockpit ("Half marathon", "10 km" …). 5 and 10 km keep their race
    name for a person on miles ("5K", as races are called there), other distances are converted. */
const RACE_LABELS = {
  get '5k'() { return distanceUnit() === 'mi' ? '5K' : '5 km'; },
  get '10k'() { return distanceUnit() === 'mi' ? '10K' : '10 km'; },
  hyrox: 'Hyrox',
  get HM() { return t('dashboardGoals.halfMarathon'); },
  get M() { return t('dashboardGoals.marathon'); },
};
function raceLabel(event) {
  if (!event) return t('dashboardGoals.race');
  if (RACE_LABELS[event.distanceType]) return RACE_LABELS[event.distanceType];
  const km = Number(event.distanceKm);
  if (Math.abs(km - 21.0975) < 0.3) return t('dashboardGoals.halfMarathon');
  if (Math.abs(km - 42.195) < 0.5) return t('dashboardGoals.marathon');
  return Number.isFinite(km) && km > 0 ? fmtKmAuto(km) : t('dashboardGoals.race');
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

/** Weekly health goals: activity minutes & training days as rings, plus weight. */
export function weekGoalsCard(today) {
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
      el('div', { class: 'card__title', text: t('dashboardGoals.weekGoals') }),
      el('button', { style: { fontSize: '.78rem', color: 'var(--accent-strong)', background: 'none', border: 'none', fontWeight: '650', cursor: 'pointer' }, onclick: () => navigate('#/settings'), text: t('dashboardGoals.adjust') }),
    ]),
    el('div', { class: 'row', style: { gap: '12px' } }, [
      ring(prog.minutes, t('dashboardGoals.activeMinutes'), 'var(--accent)'),
      ring(prog.days, t('dashboardGoals.trainingDays'), '#3d8bff'),
    ]),
  ];
  if (prog.weight && !currentEligibility(today).noWeightGoals) {
    const w = prog.weight;
    const txt = w.reached
      ? t('dashboardGoals.goalWeightReached')
      : w.status === 'halten'
        ? t('dashboardGoals.weekAlmost', { target: fmtWeight(w.target) })
        : t('dashboardGoals.weekRemaining', { remaining: fmtWeight(w.remaining), target: fmtWeight(w.target) });
    children.push(el('div', { class: 'row gap-2 mt-3', style: { alignItems: 'center', justifyContent: 'center', fontSize: '.8rem' } }, [
      el('span', { style: { width: '18px', height: '18px', flexShrink: '0', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
      // Always set values as text (never as HTML) – they come from user data.
      el('span', {}, [el('strong', { text: fmtWeight(w.current) }), ` · ${txt}`]),
    ]));
  }
  if (prog.allMet) children.push(el('div', { class: 'center mt-2', style: { fontSize: '.76rem', color: 'var(--accent-strong)', fontWeight: '650' }, text: t('dashboardGoals.weekGoalMet') }));

  return el('div', { class: 'card mt-3' }, children);
}

/** Dedicated health/weight goals (target value per metric) with progress bars. */
export function healthGoalsCard(today) {
  const items = goalsProgress({ profile: store.profile(), health: store.get('health'), today, noWeightGoals: currentEligibility(today).noWeightGoals });
  if (!items.length) return null;
  const fmt = (n, d) => (n == null ? '—' : (d ? fmtNum(n, d) : String(Math.round(n))));
  const rows = items.map((it) => {
    const m = it.metric; const su = shownMetric(m).unit; const unit = su ? ' ' + su : '';
    const show = (v) => shownMetric(m, v).value;   // kg → lb for a person on pounds
    const status = it.reached ? t('dashboardGoals.reached')
      : (it.current == null ? t('dashboardGoals.noReading') : t('dashboardGoals.stillToGo', { value: `${fmt(show(it.remaining), m.digits)}${unit}` }));
    const dl = it.daysLeft != null ? ` · ${it.daysLeft >= 0 ? t('dashboardGoals.daysLeft', { n: it.daysLeft }) : t('dashboardGoals.deadlinePassed')}` : '';
    return el('div', { style: { marginBottom: '11px' } }, [
      el('div', { class: 'row row--between', style: { fontSize: '.84rem', marginBottom: '3px' } }, [
        el('span', { style: { fontWeight: '650' }, text: m.label }),
        el('span', { style: { fontSize: '.76rem', color: it.reached ? 'var(--good)' : 'var(--text-2)' }, text: status + dl }),
      ]),
      el('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--surface-3)', overflow: 'hidden' } }, [
        el('div', { style: { height: '100%', width: Math.round(it.pct * 100) + '%', background: it.reached ? 'var(--good)' : 'var(--accent)', borderRadius: '999px', transition: 'width .3s ease' } }),
      ]),
      el('div', { class: 'dim', style: { fontSize: '.72rem', marginTop: '2px' }, text: t('dashboardGoals.currentToGoal', { current: `${fmt(show(it.current), m.digits)}${it.current == null ? '' : unit}`, target: `${fmt(show(it.target), m.digits)}${unit}` }) }),
    ]);
  });
  return el('div', { class: 'card mt-3' }, [
    el('div', { class: 'row row--between mb-2' }, [
      el('div', { class: 'card__title', text: t('dashboardGoals.healthGoals') }),
      el('button', { style: { fontSize: '.78rem', color: 'var(--accent-strong)', background: 'none', border: 'none', fontWeight: '650', cursor: 'pointer' }, onclick: () => navigate('#/settings'), text: t('dashboardGoals.manage') }),
    ]),
    ...rows,
  ]);
}

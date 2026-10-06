/* =========================================================================
   statistics.js — trends, plan adherence, training load (informative),
   session distribution, race prediction. All as guidance, without pressure.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, iconSvg, typeMeta, typeIcon, fmtKm, fmtDuration, fmtDayMonth, todayStr, addDays,
  diffDays, weekStartMonday, sectionHead, emptyState, fmtNum, fmtInt, fmtDec, localizeUnits,
} from './ui.js';
import { kmToShown, kgToShown, distanceUnit, weightUnit } from './units.js';
import { setHeader } from './router.js';
import { progressTabs } from './nav.js';
import { barChart, donut, lineChart, progressRing, heatmap, heatmapLegend } from './charts.js';
import { predictRace } from './suggestions.js';
import { formCard, zonesCard } from './formcards.js';
import { isProtectedDay } from './cycle.js';
import { planStatus, keyMetrics, activityMatrix, trainingLoad, runKm } from './fitness.js';
import { currentEligibility } from './wellness.js';

import { t, tp } from './i18n.js';

const AMPEL = { gruen: { c: '#2bb673', emoji: '🟢' }, gelb: { c: '#e8a13a', emoji: '🟡' }, rot: { c: '#e5594f', emoji: '🔴' } };

export function render(view) {
  setHeader({ title: t('nav.progress') });
  view.appendChild(progressTabs('#/stats'));
  const sessions = store.get('sessions');
  const today = todayStr();

  if (!sessions.length && !store.get('plans').length) {
    view.appendChild(emptyState('chart', t('statistics.noDataTitle'), t('statistics.noDataText')));
    return;
  }

  /* ---- Traffic light: "Am I on track?" (#20) ---- */
  const st = planStatus({ plans: store.get('plans'), sessions, today, isProtectedDay });
  const a = AMPEL[st.level];
  view.appendChild(sectionHead(t('statistics.onPlanHeading'), null, { help: 'fortschritt' }));
  view.appendChild(el('div', { class: 'card', style: { borderLeft: `5px solid ${a.c}` } }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.7rem', lineHeight: '1' }, text: a.emoji }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '800', fontSize: '1.12rem' }, text: st.title }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: t('statistics.onPlanHint') }),
      ]),
    ]),
    el('div', { class: 'mt-3', style: { display: 'flex', flexDirection: 'column', gap: '5px' } }, st.reasons.map((r) => {
      const mark = r.ok === true ? '✓' : r.ok === false ? '!' : '·';
      const mc = r.ok === true ? '#2bb673' : r.ok === false ? a.c : 'var(--text-3)';
      return el('div', { class: 'row gap-2', style: { alignItems: 'flex-start', fontSize: '.86rem' } }, [
        el('span', { style: { color: mc, fontWeight: '800', width: '12px', flex: '0 0 auto', textAlign: 'center' }, text: mark }),
        el('span', { text: r.text }),
      ]);
    })),
  ]));

  /* ---- Plan adherence (detail for the 4-week window) ---- */
  const adherence = st.adherence ?? 0;
  view.appendChild(sectionHead(t('statistics.adherenceHeading')));
  view.appendChild(el('div', { class: 'card row gap-4', style: { alignItems: 'center' } }, [
    ringWith(adherence),
    el('div', { class: 'grow' }, [
      el('div', { class: 'num', style: { fontSize: '1.6rem', fontWeight: '800' }, text: `${st.done}/${st.due}` }),
      el('div', { class: 'muted', text: t('statistics.dueDone') }),
      el('div', { class: 'dim mt-2', style: { fontSize: '.78rem' }, text: t('statistics.consistency') }),
    ]),
  ]));

  /* ---- Weekly volume (last 8 weeks, running only – like "Run km" below) ---- */
  view.appendChild(sectionHead(t('statistics.weeklyVolume')));
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = weekStartMonday(addDays(today, -i * 7));
    const km = runKm(sessions, ws, addDays(ws, 6));
    weeks.push({ label: t('statistics.weekLabel', { day: parseInt(ws.slice(-2)) }), value: Math.round(kmToShown(km)), ws });
  }
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginBottom: '2px' }, text: t('statistics.weeklyAxis', { unit: distanceUnit() }) }),
    barChart(weeks, { showValues: true, height: 150, yUnit: distanceUnit(), label: t('statistics.weeklyAria') }),
  ]));

  /* ---- Training year (heatmap in GitHub style) ---- */
  const matrix = activityMatrix({ sessions, today });
  view.appendChild(sectionHead(t('statistics.trainingYear')));
  const hmScroll = el('div', { style: { overflowX: 'auto', paddingBottom: '4px' } }, [heatmap(matrix)]);
  // As on GitHub: the most recent week (right) should be visible when opening.
  // Short timeout so that the layout (scrollWidth) is already settled.
  setTimeout(() => { hmScroll.scrollLeft = hmScroll.scrollWidth; }, 60);
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginBottom: '6px' }, text: tp('statistics.heatmapNote', matrix.activeDays) }),
    hmScroll,
    el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '4px' } }, [heatmapLegend()]),
  ]));

  /* ---- Training load (7d vs 28d, informative) ---- */
  const { last7, last28, level: loadLevel, zone: loadZone } = st.load;
  const loadHint = {
    unklar: t('statistics.hint.unclear'),
    aufbau: t('statistics.hint.building'),
    hoch: loadZone === 'hoch' ? t('statistics.hint.wellAbove') : t('statistics.hint.raised'),
    niedrig: t('statistics.hint.low'),
  }[loadLevel] || t('statistics.hint.normal');
  const load7 = trainingLoad(sessions, today, 7);
  view.appendChild(sectionHead(t('statistics.loadHeading'), null, { help: 'belastungspunkte' }));
  view.appendChild(el('div', { class: 'stat-grid' }, [
    miniStat(fmtKm(last7, 0), t('statistics.runKm7', { unit: distanceUnit() })),
    miniStat(fmtKm(last28, 0), t('statistics.runKm28', { unit: distanceUnit() })),
    miniStat(load7 ? fmtInt(load7) : '–', t('statistics.points7')),
  ]));
  view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('statistics.pointsExplain', { unit: distanceUnit() }) }));
  view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('statistics.loadHintNote', { hint: loadHint }) }),
  ]));

  /* ---- Cancelled sessions by reason (#21) ---- */
  if (st.missed.total > 0) {
    const MR = [['injured', '🩹', t('statistics.missed.injured')], ['sick', '🤒', t('statistics.missed.sick')], ['time', '⏰', t('statistics.missed.time')], ['other', '🤷', t('statistics.missed.other')]].filter(([k]) => st.missed.byReason[k] > 0);
    view.appendChild(sectionHead(t('statistics.missedHeading')));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, MR.map(([k, e, l]) => el('div', { class: 'stat' }, [
        el('div', { class: 'stat__val num', style: { fontSize: '1.2rem' }, text: `${e} ${st.missed.byReason[k]}` }),
        el('div', { class: 'stat__label', text: l }),
      ]))),
      (st.missed.byReason.injured + st.missed.byReason.sick > 0)
        ? el('div', { class: 'dim mt-2', style: { fontSize: '.78rem' }, text: t('statistics.healthMissNote') })
        : null,
    ]));
  }

  /* ---- Session distribution ---- */
  const byType = {};
  sessions.filter((s) => diffDays(s.date, today) <= 56 && diffDays(s.date, today) >= 0).forEach((s) => {
    const key = s.type || 'other';
    byType[key] = (byType[key] || 0) + 1;
  });
  const segs = Object.entries(byType).map(([k, v]) => ({ label: typeMeta(k).label, value: v, color: typeMeta(k).color }));
  if (segs.length) {
    view.appendChild(sectionHead(t('statistics.mixHeading')));
    const totalUnits = segs.reduce((a, b) => a + b.value, 0);
    view.appendChild(el('div', { class: 'card row gap-4', style: { alignItems: 'center' } }, [
      donut(segs, { centerValue: totalUnits, centerLabel: t('statistics.sessions'), label: t('statistics.sessionsByType') }),
      el('div', { class: 'grow' }, segs.sort((a, b) => b.value - a.value).map((sg) => el('div', { class: 'zones-legend__item', style: { display: 'flex', marginBottom: '6px' } }, [
        el('span', { class: 'zones-legend__sw', style: { background: sg.color } }),
        `${sg.label} · ${sg.value}`,
      ]))),
    ]));
  }

  /* ---- Values & goals: hold/improve + trend linking (#19, #22) ---- */
  const metrics = keyMetrics({ profile: store.profile(), health: store.get('health'), sessions, today, noWeightGoals: currentEligibility(today).noWeightGoals });
  if (metrics.length) {
    view.appendChild(sectionHead(t('statistics.metricsHeading')));
    view.appendChild(el('div', { class: 'card', style: { paddingTop: '4px', paddingBottom: '4px' } }, metrics.map((m, i) => {
      const arrow = m.dir === 'up' ? '↑' : m.dir === 'down' ? '↓' : '→';
      const ac = m.good === true ? '#2bb673' : m.good === false ? '#e5594f' : 'var(--text-3)';
      const targetTxt = m.target != null ? ` · ${t('statistics.target', { value: m.fmt(m.target), unit: m.unit })}` : '';
      return el('div', { class: 'row gap-3', style: { alignItems: 'center', padding: '9px 0', borderBottom: i < metrics.length - 1 ? '1px solid var(--border)' : 'none' } }, [
        el('div', { class: 'grow' }, [
          el('div', { style: { fontWeight: '600' }, text: m.label }),
          el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: m.hint + targetTxt }),
        ]),
        el('div', { style: { textAlign: 'right', flex: '0 0 auto' } }, [
          el('div', { class: 'num', style: { fontWeight: '800', fontSize: '1.05rem' }, text: `${m.fmt(m.value)} ${m.unit}`.trim() }),
          el('div', { style: { fontSize: '.76rem', color: ac, fontWeight: '700' }, text: `${arrow} ${m.goal === 'halten' ? t('statistics.goalHold') : t('statistics.goalImprove')}` }),
        ]),
      ]);
    })));
  }

  /* ---- Weight trend ---- */
  const health = store.get('health').filter((h) => h.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  if (health.length >= 2) {
    // Stored in kg, drawn in the person's unit (kg or lb).
    const targetKg = store.profile().targetWeightKg;
    const target = targetKg != null ? Math.round(kgToShown(targetKg) * 10) / 10 : targetKg;
    view.appendChild(sectionHead(t('statistics.weightHeading', { unit: weightUnit() })));
    view.appendChild(el('div', { class: 'card' }, lineChart(
      health.map((h) => ({ label: fmtDayMonth(h.date), date: h.date, value: kgToShown(Number(h.weight)) })),
      { label: t('statistics.weight'), target, targetLabel: t('statistics.target', { value: fmtDec(target), unit: weightUnit() }), unit: weightUnit(), fmt: (v) => fmtNum(v, 1) },
    )));
  }

  /* ---- Prediction ---- */
  const nextEvent = store.get('events').filter((e) => e.status !== 'abgeschlossen' && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (nextEvent) {
    const pred = predictRace(sessions, nextEvent.distanceKm, { hrZones: store.profile().hrZones, today });
    if (pred) {
      view.appendChild(sectionHead(t('statistics.predictionHeading'), null, { help: 'vdot' }));
      view.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row gap-3' }, [
          el('span', { class: 'type-icon', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: '800' }, text: fmtDuration(pred.seconds) }),
            el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('statistics.predictionFrom', { name: nextEvent.name, basis: pred.basis }) }),
          ]),
        ]),
        pred.note ? el('div', { class: 'muted mt-2', style: { fontSize: '.8rem' }, text: pred.note }) : null,
        el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: pred.method === 'riegel' ? t('statistics.predictionRiegel') : t('statistics.predictionVdot') }),
      ]));
    }
  }

  /* ---- Form & training zones (moved here from "Today", UI-15) ---- */
  const fc = formCard(today);
  const zc = zonesCard();
  if (fc || zc) {
    view.appendChild(sectionHead(t('statistics.formHeading'), null, { help: 'vdot' }));
    if (fc) view.appendChild(fc);
    if (zc) view.appendChild(zc);
  }

  /* ---- Sessions without a plan (logged spontaneously or imported) ---- */
  const free = sessions
    .filter((s) => s && !s.plannedId && s.date <= today && diffDays(s.date, today) <= 45)
    .sort((x, y) => y.date.localeCompare(x.date));
  if (free.length) {
    view.appendChild(sectionHead(t('statistics.freeHeading')));
    view.appendChild(el('div', { class: 'card' }, free.slice(0, 8).map((s) => el('a', {
      class: 'row gap-3', href: `#/session/${s.id}`,
      style: { alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' },
    }, [
      typeIcon(s.type, 'type-icon--sm'),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: localizeUnits(s.title) || typeMeta(s.type).label }),
        el('div', { class: 'muted', style: { fontSize: '.78rem' }, text: [fmtDayMonth(s.date), s.distanceKm ? fmtKm(s.distanceKm, 1) : null, s.durationSec ? fmtDuration(s.durationSec) : null].filter(Boolean).join(' · ') }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]))));
    view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('statistics.freeHint') }));
  }
}

function miniStat(val, label) { return el('div', { class: 'stat' }, [el('div', { class: 'stat__val num', style: { fontSize: '1.2rem' }, text: val }), el('div', { class: 'stat__label', text: label })]); }
function ringWith(pct) {
  return el('div', { class: 'ring-wrap' }, [
    progressRing(pct / 100, { size: 96 }),
    el('div', { class: 'ring-wrap__center' }, [el('div', { class: 'ring-wrap__val', text: `${pct}%` })]),
  ]);
}

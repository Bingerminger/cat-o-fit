/* =========================================================================
   statistics.js — Trends, Plan-Einhaltung (Adherence), Trainingslast (informativ),
   Einheiten-Verteilung, Wettkampfprognose. Alles als Orientierung, ohne Druck.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, iconSvg, typeMeta, fmtKm, fmtDuration, fmtDayMonth, todayStr, addDays,
  diffDays, weekStartMonday, sectionHead, emptyState, fmtNum, fmtInt,
} from './ui.js';
import { setHeader } from './router.js';
import { barChart, donut, lineChart, progressRing, heatmap, heatmapLegend } from './charts.js';
import { predictRace } from './suggestions.js';
import { isProtectedDay } from './cycle.js';
import { planStatus, keyMetrics, activityMatrix, trainingLoad } from './fitness.js';

const AMPEL = { gruen: { c: '#2bb673', emoji: '🟢' }, gelb: { c: '#e8a13a', emoji: '🟡' }, rot: { c: '#e5594f', emoji: '🔴' } };

export function render(view) {
  setHeader({ title: 'Statistik' });
  const sessions = store.get('sessions');
  const today = todayStr();

  if (!sessions.length && !store.get('plans').length) {
    view.appendChild(emptyState('chart', 'Noch keine Daten', 'Sobald du Einheiten absolvierst, erscheinen hier deine Trends.'));
    return;
  }

  /* ---- Ampel: „Bin ich auf Plan?" (#20) ---- */
  const st = planStatus({ plans: store.get('plans'), sessions, today, isProtectedDay });
  const a = AMPEL[st.level];
  view.appendChild(sectionHead('Bin ich auf Plan?'));
  view.appendChild(el('div', { class: 'card', style: { borderLeft: `5px solid ${a.c}` } }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.7rem', lineHeight: '1' }, text: a.emoji }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '800', fontSize: '1.12rem' }, text: st.title }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: 'Statusampel aus Einhaltung, Last und Ausfällen (letzte 4 Wochen)' }),
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

  /* ---- Plan-Einhaltung (Detail zum 4-Wochen-Fenster) ---- */
  const adherence = st.adherence ?? 0;
  view.appendChild(sectionHead('Plan-Einhaltung'));
  view.appendChild(el('div', { class: 'card row gap-4', style: { alignItems: 'center' } }, [
    ringWith(adherence),
    el('div', { class: 'grow' }, [
      el('div', { class: 'num', style: { fontSize: '1.6rem', fontWeight: '800' }, text: `${st.done}/${st.due}` }),
      el('div', { class: 'muted', text: 'fällige Einheiten (4 Wochen) erledigt' }),
      el('div', { class: 'dim mt-2', style: { fontSize: '.78rem' }, text: 'Konsistenz zählt mehr als einzelne Top-Tage.' }),
    ]),
  ]));

  /* ---- Wochenumfang (letzte 8 Wochen) ---- */
  view.appendChild(sectionHead('Wochenumfang'));
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = weekStartMonday(addDays(today, -i * 7));
    const we = addDays(ws, 6);
    const km = sessions.filter((s) => s.date >= ws && s.date <= we).reduce((a, s) => a + (s.distanceKm || 0), 0);
    weeks.push({ label: `${parseInt(ws.slice(-2))}.`, value: Math.round(km), ws });
  }
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginBottom: '2px' }, text: '↕ km pro Woche · → Kalenderwoche (Mo–So), letzte 8' }),
    barChart(weeks, { showValues: true, height: 150, yUnit: 'km' }),
  ]));

  /* ---- Trainingsjahr (Heatmap im GitHub-Stil) ---- */
  const matrix = activityMatrix({ sessions, today });
  view.appendChild(sectionHead('Trainingsjahr'));
  const hmScroll = el('div', { style: { overflowX: 'auto', paddingBottom: '4px' } }, [heatmap(matrix)]);
  // Wie bei GitHub: die aktuellste Woche (rechts) soll beim Öffnen sichtbar sein.
  // Kurzes Timeout, damit das Layout (scrollWidth) bereits feststeht.
  setTimeout(() => { hmScroll.scrollLeft = hmScroll.scrollWidth; }, 60);
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginBottom: '6px' }, text: `${matrix.activeDays} aktive Tage in den letzten 12 Monaten · je dunkler, desto mehr Trainingszeit` }),
    hmScroll,
    el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '4px' } }, [heatmapLegend()]),
  ]));

  /* ---- Trainingslast (7d vs 28d, informativ) ---- */
  const { last7, last28, level: loadLevel } = st.load;
  const loadHint = loadLevel === 'unklar' ? 'Noch zu wenig Daten.' : loadLevel === 'hoch' ? 'Belastung steigt deutlich – auf Erholung achten.' : loadLevel === 'niedrig' ? 'Ruhigere Phase – ideal zur Regeneration.' : 'Belastung im stabilen Bereich.';
  const load7 = trainingLoad(sessions, today, 7);
  view.appendChild(sectionHead('Trainingslast'));
  view.appendChild(el('div', { class: 'stat-grid' }, [
    miniStat(fmtKm(last7, 0), 'Lauf-km · 7 Tage'),
    miniStat(fmtKm(last28, 0), 'Lauf-km · 28 Tage'),
    miniStat(load7 ? fmtInt(load7) : '–', 'Belastung · 7 Tage'),
  ]));
  view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: 'Belastung = Dauer × Intensität über alle Sportarten (auch Kraft, Fußball, Rad) – Lauf-km zeigen nur das Laufpensum.' }));
  view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${loadHint} (Nur Orientierung, kein Verletzungsschutz-Versprechen.)` }),
  ]));

  /* ---- Ausgefallene Einheiten nach Grund (#21) ---- */
  if (st.missed.total > 0) {
    const MR = [['injured', '🩹', 'Verletzt'], ['sick', '🤒', 'Krank'], ['time', '⏰', 'Keine Zeit'], ['other', '🤷', 'Sonstiges']].filter(([k]) => st.missed.byReason[k] > 0);
    view.appendChild(sectionHead('Ausgefallene Einheiten (4 Wochen)'));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, MR.map(([k, e, l]) => el('div', { class: 'stat' }, [
        el('div', { class: 'stat__val num', style: { fontSize: '1.2rem' }, text: `${e} ${st.missed.byReason[k]}` }),
        el('div', { class: 'stat__label', text: l }),
      ]))),
      (st.missed.byReason.injured + st.missed.byReason.sick > 0)
        ? el('div', { class: 'dim mt-2', style: { fontSize: '.78rem' }, text: 'Gesundheitsbedingte Ausfälle zählen nicht gegen deine Einhaltung.' })
        : null,
    ]));
  }

  /* ---- Einheiten-Verteilung ---- */
  const byType = {};
  sessions.filter((s) => diffDays(s.date, today) <= 56 && diffDays(s.date, today) >= 0).forEach((s) => {
    const key = s.type || 'other';
    byType[key] = (byType[key] || 0) + 1;
  });
  const segs = Object.entries(byType).map(([k, v]) => ({ label: typeMeta(k).label, value: v, color: typeMeta(k).color }));
  if (segs.length) {
    view.appendChild(sectionHead('Einheiten-Verteilung (8 Wochen)'));
    const totalUnits = segs.reduce((a, b) => a + b.value, 0);
    view.appendChild(el('div', { class: 'card row gap-4', style: { alignItems: 'center' } }, [
      donut(segs, { centerValue: totalUnits, centerLabel: 'Einheiten' }),
      el('div', { class: 'grow' }, segs.sort((a, b) => b.value - a.value).map((sg) => el('div', { class: 'zones-legend__item', style: { display: 'flex', marginBottom: '6px' } }, [
        el('span', { class: 'zones-legend__sw', style: { background: sg.color } }),
        `${sg.label} · ${sg.value}`,
      ]))),
    ]));
  }

  /* ---- Werte & Ziele: halten/verbessern + Trend-Vermaschung (#19, #22) ---- */
  const metrics = keyMetrics({ profile: store.profile(), health: store.get('health'), sessions, today });
  if (metrics.length) {
    view.appendChild(sectionHead('Werte & Ziele'));
    view.appendChild(el('div', { class: 'card', style: { paddingTop: '4px', paddingBottom: '4px' } }, metrics.map((m, i) => {
      const arrow = m.dir === 'up' ? '↑' : m.dir === 'down' ? '↓' : '→';
      const ac = m.good === true ? '#2bb673' : m.good === false ? '#e5594f' : 'var(--text-3)';
      const targetTxt = m.target != null ? ` · Ziel ${m.fmt(m.target)} ${m.unit}` : '';
      return el('div', { class: 'row gap-3', style: { alignItems: 'center', padding: '9px 0', borderBottom: i < metrics.length - 1 ? '1px solid var(--border)' : 'none' } }, [
        el('div', { class: 'grow' }, [
          el('div', { style: { fontWeight: '600' }, text: m.label }),
          el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: m.hint + targetTxt }),
        ]),
        el('div', { style: { textAlign: 'right', flex: '0 0 auto' } }, [
          el('div', { class: 'num', style: { fontWeight: '800', fontSize: '1.05rem' }, text: `${m.fmt(m.value)} ${m.unit}`.trim() }),
          el('div', { style: { fontSize: '.76rem', color: ac, fontWeight: '700' }, text: `${arrow} ${m.goal === 'halten' ? 'halten' : 'verbessern'}` }),
        ]),
      ]);
    })));
  }

  /* ---- Gewichtstrend ---- */
  const health = store.get('health').filter((h) => h.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  if (health.length >= 2) {
    view.appendChild(sectionHead('Gewicht (kg)'));
    view.appendChild(el('div', { class: 'card' }, lineChart(
      health.map((h) => ({ label: fmtDayMonth(h.date), value: h.weight })),
      { target: store.profile().targetWeightKg, targetLabel: `Ziel ${store.profile().targetWeightKg} kg`, unit: 'kg', fmt: (v) => fmtNum(v, 1) },
    )));
  }

  /* ---- Prognose ---- */
  const nextEvent = store.get('events').filter((e) => e.status !== 'abgeschlossen' && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (nextEvent) {
    const pred = predictRace(sessions, nextEvent.distanceKm);
    if (pred) {
      view.appendChild(sectionHead('Wettkampfprognose'));
      view.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row gap-3' }, [
          el('span', { class: 'type-icon', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: '800' }, text: fmtDuration(pred.seconds) }),
            el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `${nextEvent.name} · aus ${pred.basis}` }),
          ]),
        ]),
        el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: 'Riegel-Schätzung – nur eine Näherung.' }),
      ]));
    }
  }
}

function miniStat(val, label) { return el('div', { class: 'stat' }, [el('div', { class: 'stat__val num', style: { fontSize: '1.2rem' }, text: val }), el('div', { class: 'stat__label', text: label })]); }
function ringWith(pct) {
  return el('div', { class: 'ring-wrap' }, [
    progressRing(pct / 100, { size: 96 }),
    el('div', { class: 'ring-wrap__center' }, [el('div', { class: 'ring-wrap__val', text: `${pct}%` })]),
  ]);
}

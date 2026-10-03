/* =========================================================================
   dashboard-goals.js — Ziel-Karten auf „Heute“: Ziel-Cockpit (Lauf + Gewicht),
   Wochenziele und Gesundheitsziele. Aus dashboard.js ausgelagert (FE-18).
   ========================================================================= */

import * as store from './storage.js';
import { el, iconSvg, navigate, fmtDuration, parseHms, fmtNum } from './ui.js';
import { predictRace } from './suggestions.js';
import { goalProgress } from './healthgoals.js';
import { currentEnergyTargets, currentEligibility } from './wellness.js';
import { goalsProgress } from './goals.js';
import { phaseEmphasis, stimulusCheck } from './dualgoal.js';
import { progressRing } from './charts.js';

/** Ziel-Cockpit (R4): Status aller Ziele (Lauf + Gewicht), Phasen-Schwerpunkt,
    phasenabhängige Ernährungskopplung und der ehrliche Trainingsreiz-Check. */
export function goalCockpitCard(today) {
  const sessions = store.get('sessions');
  // Dieselbe Quelle wie die Ernährungskarte: Plan zum nächsten Wettkampf, geglättetes
  // Gewicht, eine Definition von „Ziel erreicht“, dasselbe Defizit.
  const t = currentEnergyTargets(today);
  const plan = t.plan, event = t.event;
  // Kinder, Schwangerschaft/Stillzeit, Essstörung: kein Gewichtsziel, kein Abnehm-Cockpit.
  const gs = t.elig.noWeightGoals ? null : t.goalStatus;
  const hasWeight = !!gs;
  if (!plan && !hasWeight) return null;
  const dual = !!plan && hasWeight;
  const weightLabel = gs ? (gs.direction === 'up' ? 'Zunehmen' : gs.direction === 'down' ? 'Abnehmen' : 'Gewicht') : '';

  const rows = [];
  if (plan && event) {
    const pred = predictRace(sessions, event.distanceKm, { hrZones: store.profile().hrZones, today });
    const targetSec = parseHms(event.targetTime);
    let tone = 'neutral', detail;
    if (pred) {
      const onTrack = !targetSec || pred.seconds <= targetSec * 1.02;
      tone = onTrack ? 'good' : 'warn';
      detail = `Prognose ${fmtDuration(pred.seconds)}${event.targetTime ? ` · Ziel ${event.targetTime}` : ''} – ${onTrack ? 'auf Kurs' : 'da ist noch was zu tun'}.`;
      if (pred.caveat) detail += ' Setzt ausreichenden Umfang voraus.';
      else if (pred.onlyEasy) detail += ' Aus lockeren Läufen geschätzt.';
    } else detail = 'Noch zu wenige Läufe für eine Formprognose.';
    rows.push(goalRow('flag', event.name, detail, tone));
  }
  if (hasWeight) {
    const kg = (v) => `${fmtNum(v, 1)} kg`;
    const detail = gs.reached
      ? (gs.beyond ? `Ziel erreicht (${kg(gs.current)}) – jetzt halten. Passt das Ziel noch?` : `Ziel erreicht (${kg(gs.current)})`)
      : gs.status === 'halten'
        ? `${kg(gs.current)} – fast am Ziel ${kg(gs.target)}, jetzt halten`
        : `${kg(gs.current)} → Ziel ${kg(gs.target)} (noch ${kg(gs.remaining)})`;
    rows.push(goalRow('activity', 'Gewicht', detail, gs.reached ? 'good' : 'neutral'));
  }

  const children = [
    el('div', { class: 'card__title', style: { marginBottom: '4px' }, text: dual ? `Ziel-Cockpit · ${raceLabel(event)} + ${weightLabel}` : 'Ziel-Cockpit' }),
    ...rows,
  ];
  if (plan) {
    const emph = phaseEmphasis(plan, today);
    // Der Phasentext spricht vom Abnehmen – nur zeigen, wenn es ein Abnehmziel gibt.
    if (dual && gs.direction === 'down') children.push(el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '4px' }, text: `Phase „${emph.phaseName}“: ${emph.note}` }));
    if (dual) {
      let head;
      if (t.block === 'eligibility' || t.block === 'bmi') head = 'Kein Defizit empfohlen – Details in der Ernährung';
      else if (gs.status !== 'abnehmen') head = gs.status === 'zunehmen' ? 'Ziel: zunehmen – Details in der Ernährung' : 'Zielgewicht erreicht – jetzt halten';
      else if (!t.elig.answered) head = 'Tagesziel: erst kurz die Abgrenzung beantworten';
      else if (t.elig.hideNumbers) head = 'Abnehmziel aktiv – Tagesziel in der Ernährung';
      else head = `Empfohlenes Defizit: ${t.deficitKcal === 0 ? 'aktuell keins (Wettkampf-Fokus)' : Math.abs(t.deficitKcal) + ' kcal/Tag'}`;
      children.push(el('a', { class: 'card card--flat row row--between mt-2', href: '#/nutrition', style: { alignItems: 'center' } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.82rem' }, text: head }),
          el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: t.balance && t.balance.floored ? 'Phasenabhängig, mit Sicherheitsgrenze · zur Ernährung' : 'Phasenabhängig · zur Ernährung' }),
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
/** Kurzname des Wettkampfs für das Cockpit („Halbmarathon“, „10 km“ …). */
const RACE_LABELS = { '5k': '5 km', '10k': '10 km', HM: 'Halbmarathon', M: 'Marathon', hyrox: 'Hyrox' };
function raceLabel(event) {
  if (!event) return 'Wettkampf';
  if (RACE_LABELS[event.distanceType]) return RACE_LABELS[event.distanceType];
  const km = Number(event.distanceKm);
  if (Math.abs(km - 21.0975) < 0.3) return 'Halbmarathon';
  if (Math.abs(km - 42.195) < 0.5) return 'Marathon';
  return Number.isFinite(km) && km > 0 ? `${fmtNum(km, km % 1 ? 1 : 0)} km` : 'Wettkampf';
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
      el('div', { class: 'card__title', text: 'Wochenziele' }),
      el('button', { style: { fontSize: '.78rem', color: 'var(--accent-strong)', background: 'none', border: 'none', fontWeight: '650', cursor: 'pointer' }, onclick: () => navigate('#/settings'), text: 'Anpassen' }),
    ]),
    el('div', { class: 'row', style: { gap: '12px' } }, [
      ring(prog.minutes, 'Aktive Minuten', 'var(--accent)'),
      ring(prog.days, 'Trainingstage', '#3d8bff'),
    ]),
  ];
  if (prog.weight && !currentEligibility(today).noWeightGoals) {
    const w = prog.weight;
    const txt = w.reached
      ? 'Zielgewicht erreicht 🎉'
      : w.status === 'halten'
        ? `fast am Ziel ${fmtNum(w.target, 1)} kg – halten`
        : `noch ${fmtNum(w.remaining, 1)} kg bis ${fmtNum(w.target, 1)} kg`;
    children.push(el('div', { class: 'row gap-2 mt-3', style: { alignItems: 'center', justifyContent: 'center', fontSize: '.8rem' } }, [
      el('span', { style: { width: '18px', height: '18px', flexShrink: '0', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
      // Werte immer als Text setzen (nie als HTML) – sie stammen aus Nutzerdaten.
      el('span', {}, [el('strong', { text: `${fmtNum(w.current, 1)} kg` }), ` · ${txt}`]),
    ]));
  }
  if (prog.allMet) children.push(el('div', { class: 'center mt-2', style: { fontSize: '.76rem', color: 'var(--accent-strong)', fontWeight: '650' }, text: '✅ Wochenziel erreicht – stark!' }));

  return el('div', { class: 'card mt-3' }, children);
}

/** Dedizierte Gesundheits-/Gewichtsziele (Zielwert je Metrik) mit Fortschrittsbalken. */
export function healthGoalsCard(today) {
  const items = goalsProgress({ profile: store.profile(), health: store.get('health'), today, noWeightGoals: currentEligibility(today).noWeightGoals });
  if (!items.length) return null;
  const fmt = (n, d) => (n == null ? '—' : (d ? fmtNum(n, d) : String(Math.round(n))));
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

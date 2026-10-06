/* =========================================================================
   settings.js — profile & settings: values, HR zones, appearance,
   modules, metrics, backup (export/import), sync.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, toggle, segmented, field, input, textarea, select,
  openSheet, closeSheet, confirmDialog, alertDialog, toast, sectionHead, fmtPaceRange, todayStr,
  uid, nowIso, fmtDate, safeAccent, saveFile, savedFileMessage,
  refreshView, goOrRefresh, actionSheet,
  fmtDec, fmtHeight, fmtWeightDec,
  rerenderView,
} from './ui.js';
import { distanceUnit, weightUnit, toInput, fromInput, cmToFeetInches, heightFromInput } from './units.js';
import { sessionsCsv, healthCsv, labsCsv, diaryCsv } from './csv-export.js';
import { setHeader } from './router.js';
import { syncNow } from './storage.js';
import { geocode, refreshWeather, placeLabel } from './weather.js';
import { APP_VERSION } from './version.js';
import { weeklyGoals, DEFAULT_GOALS } from './healthgoals.js';
import { GOAL_METRICS, metricMeta, latestMetric, shownMetric } from './goals.js';
import { currentEligibility, openGateSheet } from './wellness.js';
import { ageOf, weightGoalBlockReason } from './eligibility.js';
import { weightNow, bmiFor } from './energy.js';
import { currentHrvMethod, hrvLabel } from './healthdata.js';
import { hrZonesFrom, estimateMaxHr, zoneName } from './hrzones.js';
import { t, tp, languages, locale } from './i18n.js';
import { applyLanguage, instanceLanguage } from './language.js';
import { weekdayNames } from './format.js';
import { applyUnits, personUnits } from './unit-prefs.js';

/** Language options: the supported languages by their own names. */
function languageOptions() {
  return Object.entries(languages()).map(([value, label]) => ({ value, label }));
}

/** Weight and body fat are "weight goals" (locked for children, pregnancy, eating disorder). */
const WEIGHT_METRICS = ['weight', 'bodyFat'];
/** Lower limits for body-fat goals (essential fat, roughly): below them it becomes risky for health. */
const BODY_FAT_FLOOR = { w: 12, m: 5 };

/** Redraw the settings without reloading the page. */
function rerender(view) { rerenderView(render, view); }

const ACCENTS = ['#18b48a', '#2bb673', '#19b9c9', '#3d8bff', '#7c5cff', '#ff5d8f', '#ff8a3d', '#f5b300'];

export function render(view) {
  setHeader({ title: t('nav.settings') });
  const p = store.profile();
  const s = store.settings();

/* ----- Account & family ----- */
  // Always the SIGNED-IN person (UI-02). If they are currently managing another profile, that is
  // stated explicitly here together with the way back – the settings below apply to the managed profile.
  const ident = store.identityMember();
  const acct = store.activeMember();
  if (ident && acct) {
    const managing = store.isManaging();
    const identColor = safeAccent(ident.color, '');   // only take real hex colours into styles
    view.appendChild(sectionHead(t('settings.sections.account')));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
        el('span', { class: 'member-card__avatar', 'aria-hidden': 'true', style: { width: '44px', height: '44px', fontSize: '1.4rem', background: identColor ? identColor + '22' : 'var(--accent-soft)', color: identColor || 'var(--accent)' }, text: ident.emoji || '🏃' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'card__title', text: ident.name }),
          el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: ident.role === 'admin' ? t('account.signedInAdmin') : t('account.signedInMember') }),
        ]),
      ]),
      managing ? el('div', { class: 'account__managing mt-3', role: 'status' }, [
        el('span', { class: 'account__managing-text', text: t('settings.managingNote', { name: acct.name }) }),
        el('button', { class: 'btn btn--soft account__back', type: 'button', onclick: async () => { await store.backToSelf(); goOrRefresh('#/settings'); } }, t('account.backToMe')),
      ]) : null,
      !managing && store.pinIsWeak()
        ? el('div', { class: 'pin-err mt-3', text: t('settings.weakPin') })
        : null,
      el('div', { class: 'row gap-2 mt-3' }, [
        managing
          ? el('button', { class: 'btn btn--ghost grow', onclick: () => openPinSheet(acct) }, `🔒 ${t('settings.pin.setFor', { name: acct.name })}`)
          : el('button', { class: 'btn btn--ghost grow', onclick: () => openPinSheet(ident) }, `🔒 ${store.memberHasPin(ident.id) ? t('settings.pin.change') : t('settings.pin.set')}`),
        el('button', { class: 'btn btn--ghost grow', onclick: async () => { await store.logout(); navigate('#/login'); } }, [icon('arrowLeft'), t('account.signOut')]),
      ]),
      el('div', { class: 'row row--between mt-3', style: { alignItems: 'center', gap: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' } }, [
        el('div', {}, [
          el('div', { text: t('settings.sharedDevice.title') }),
          el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: t('settings.sharedDevice.hint') }),
        ]),
        toggle(store.isSharedDevice(), (v) => { store.setSharedDevice(v); toast(v ? t('settings.sharedDevice.on') : t('settings.sharedDevice.off'), 'good'); }, t('settings.sharedDevice.title')),
      ]),
    ]));

    // Finer visibility in the team/family dashboard (the cycle always stays private regardless).
    view.appendChild(sectionHead(t('settings.sections.visibility')));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'muted mb-2', style: { fontSize: '.8rem' }, text: t('settings.visibility.intro') }),
      el('div', { class: 'row row--between', style: { padding: '8px 0' } }, [
        el('span', { text: t('settings.visibility.goal') }),
        toggle(s.shareGoal !== false, (v) => store.setSetting('shareGoal', v), t('settings.visibility.goal')),
      ]),
      el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
        el('span', { text: t('settings.visibility.metrics', { unit: distanceUnit() }) }),
        toggle(s.shareMetrics !== false, (v) => store.setSetting('shareMetrics', v), t('settings.visibility.metricsAria')),
      ]),
      el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)', gap: '12px' } }, [
        el('span', {}, [el('span', { text: t('settings.visibility.load') }), el('br'), el('span', { class: 'dim', style: { fontSize: '.76rem' }, text: t('settings.visibility.loadHint') })]),
        toggle(s.shareLoad === true, (v) => store.setSetting('shareLoad', v), t('settings.visibility.load')),
      ]),
    ]));
  }

/* ----- Profile ----- */
  const elig = currentEligibility();
  // Display in the person's units (height in ft/in alongside pounds); stored in cm and kg.
  const profileLine = [p.heightCm ? fmtHeight(p.heightCm) : '–', p.weightKg ? fmtWeightDec(p.weightKg) : '–'];
  if (!elig.noWeightGoals) profileLine.push(t('settings.profile.target', { weight: p.targetWeightKg ? fmtWeightDec(p.targetWeightKg) : '–' }));
  view.appendChild(sectionHead(t('settings.sections.profile')));
  view.appendChild(el('button', { class: 'card card--link', style: { width: '100%', textAlign: 'left' }, onclick: () => openProfileSheet() }, [
    el('div', { class: 'row gap-3' }, [
      el('span', { class: 'type-icon type-icon--lg', style: { background: 'var(--accent)' }, html: iconSvg('user') }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: p.name || t('settings.sections.profile') }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: profileLine.join(' · ') }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('edit') }),
    ]),
  ]));
  if (p.goals?.length) {
    view.appendChild(el('div', { class: 'card card--flat mt-2' }, [
      el('div', { class: 'dim mb-2', style: { fontSize: '.74rem', fontWeight: '650' }, text: t('settings.profile.goalsHeading') }),
      el('div', { class: 'row wrap gap-2' }, p.goals.map((g) => el('span', { class: 'chip chip--accent', text: g }))),
    ]));
  }

  /* ----- Health & eligibility (applies to the whole app) ----- */
  view.appendChild(sectionHead(t('settings.sections.health')));
  view.appendChild(eligibilityCard(elig, s, () => rerender(view)));

  /* ----- Weekly goals (activity) ----- */
  view.appendChild(sectionHead(t('settings.sections.weeklyGoals')));
  const wg = weeklyGoals(p);
  const minI = input({ type: 'number', min: '0', step: '10', value: String(wg.activeMinutes), inputmode: 'numeric' });
  const daysI = input({ type: 'number', min: '0', max: '7', step: '1', value: String(wg.trainingDays), inputmode: 'numeric' });
  const saveGoals = () => {
    const am = parseInt(minI.value, 10);
    const td = parseInt(daysI.value, 10);
    store.setSetting('weeklyGoals', {
      activeMinutes: Number.isFinite(am) && am > 0 ? am : DEFAULT_GOALS.activeMinutes,
      trainingDays: Number.isFinite(td) && td > 0 ? Math.min(7, td) : DEFAULT_GOALS.trainingDays,
    });
    toast(t('settings.weeklyGoals.saved'), 'good');
  };
  minI.addEventListener('change', saveGoals);
  daysI.addEventListener('change', saveGoals);
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'field__row' }, [
      field(t('settings.weeklyGoals.activeMinutes'), minI),
      field(t('settings.weeklyGoals.trainingDays'), daysI),
    ]),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: elig.minor
      ? t('settings.weeklyGoals.hintMinor')
      : t('settings.weeklyGoals.hint') }),
  ]));

  /* ----- Health goals (target values with progress) ----- */
  view.appendChild(sectionHead(t('settings.sections.healthGoals'), { label: t('settings.goals.add'), onClick: () => openGoalSheet(view, elig) }));
  const goals = (p.settings && p.settings.healthGoals) || [];
  const goalsCard = el('div', { class: 'card' });
  if (!goals.length) {
    goalsCard.appendChild(el('div', { class: 'dim', style: { fontSize: '.84rem' }, text: elig.noWeightGoals
      ? t('settings.goals.emptyNoWeight')
      : t('settings.goals.empty') }));
  } else {
    goals.forEach((g, i) => {
      const m = metricMeta(g.metric); const unit = m && m.unit ? ' ' + m.unit : '';
      // Weight goals in the person's unit (stored in kg).
      const target = m && m.key === 'weight' ? fmtWeightDec(g.target) : `${fmtDec(g.target)}${unit}`;
      const paused = elig.noWeightGoals && WEIGHT_METRICS.includes(g.metric);
      goalsCard.appendChild(el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.9rem' }, text: (m && m.label) || g.metric }),
          el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: paused
            ? t('settings.goals.paused')
            : g.deadline ? t('settings.goals.targetBy', { target, date: fmtDate(g.deadline) }) : t('settings.goals.target', { target }) }),
        ]),
        el('button', {
          class: 'icon-btn', 'aria-label': t('settings.goals.removeAria'),
          onclick: async () => {
            const ok = await confirmDialog({ title: t('settings.goals.removeTitle'), message: t('settings.goals.removeMessage', { name: (m && m.label) || g.metric }), confirmLabel: t('settings.goals.remove'), danger: true });
            if (ok) { store.setSetting('healthGoals', goals.filter((x) => x.id !== g.id)); rerender(view); }
          },
        }, icon('trash')),
      ]));
    });
  }
  view.appendChild(goalsCard);

/* ----- Heart-rate zones ----- */
  // HRmax measured or – as a starting value – estimated from age (Tanaka); zones
  // either in % HRmax or via the heart-rate reserve (Karvonen, with resting pulse).
  view.appendChild(sectionHead(t('settings.sections.hrZones'), null, { help: 'hf-zonen' }));
  const card = el('div', { class: 'card' });
  const age = ageOf(p, todayStr());
  const estMax = estimateMaxHr(age);
  const method = ['karvonen', 'lthr'].includes(p.hrZoneMethod) ? p.hrZoneMethod : 'hfmax';
  const saveZones = (patch) => {
    const next = { ...p, ...patch };
    const zones = hrZonesFrom({ maxHr: next.maxHr, restHr: next.restHr, method: next.hrZoneMethod, lthr: next.lthr });
    store.setProfile({ ...patch, hrZones: zones.length ? zones : (p.hrZones || null) });
    toast(t('settings.hrZones.updated'));
    refreshView();
  };
  card.appendChild(el('div', { class: 'field__row' }, [
    field(t('settings.hrZones.maxHr'), input({
      type: 'number', min: '100', max: '240', value: p.maxHr || '', inputmode: 'numeric', placeholder: estMax ? `≈ ${estMax}` : '',
      onchange: (e) => { const mh = parseInt(e.target.value, 10); if (mh >= 100 && mh <= 240) saveZones({ maxHr: mh, maxHrEstimated: false }); },
    })),
    field(t('settings.metrics.restingHr'), input({
      type: 'number', min: '30', max: '120', value: p.restHr || '', inputmode: 'numeric',
      onchange: (e) => { const rh = parseInt(e.target.value, 10); if (rh >= 30 && rh <= 120) { if (p.maxHr && method === 'karvonen') saveZones({ restHr: rh }); else store.setProfile({ restHr: rh }); } },
    })),
  ]));
  if (p.maxHr || p.lthr || method === 'lthr') {
    card.appendChild(el('div', { class: 'row row--between wrap mt-2', style: { gap: '8px', alignItems: 'center' } }, [
      el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: t('settings.hrZones.method') }),
      segmented([{ value: 'hfmax', label: t('settings.hrZones.pctMax') }, { value: 'karvonen', label: t('settings.hrZones.reserve') }, { value: 'lthr', label: t('settings.hrZones.threshold') }], method, (v) => {
        if (v === 'karvonen' && !p.restHr) { toast(t('settings.hrZones.needRestHr'), 'bad'); return; }
        if (v === 'lthr' && !p.lthr) { store.setProfile({ hrZoneMethod: 'lthr' }); refreshView(); return; }   // enter the threshold HR first
        saveZones({ hrZoneMethod: v });
      }),
    ]));
  }
  // Zones from the threshold HR (TRAIN-51): from a performance diagnostic or the 30-minute field test.
  if (method === 'lthr') {
    card.appendChild(field(t('settings.hrZones.lthrLabel'), input({
      type: 'number', min: '100', max: '220', value: p.lthr || '', inputmode: 'numeric', placeholder: t('settings.hrZones.lthrPlaceholder'), 'aria-label': t('settings.hrZones.lthrLabel'),
      onchange: (e) => { const v = parseInt(e.target.value, 10); if (v >= 100 && v <= 220) saveZones({ lthr: v, hrZoneMethod: 'lthr' }); },
    })));
    card.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: t('settings.hrZones.lthrHint') }));
  }
  if (!p.maxHr && estMax) {
    card.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => saveZones({ maxHr: estMax, maxHrEstimated: true }) },
      [icon('heart'), t('settings.hrZones.estimateFromAge', { max: estMax })]));
  }
  if (p.maxHrEstimated || (!p.maxHr && estMax)) {
    card.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('settings.hrZones.ageHint') }));
  }
  if (method === 'karvonen' && p.maxHr) {
    card.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: t('settings.hrZones.karvonenHint') }));
  }
  (p.hrZones || []).forEach((z) => card.appendChild(el('div', { class: 'row row--between', style: { padding: '6px 0', borderTop: '1px solid var(--border)' } }, [
    el('span', { class: 'row gap-2' }, [el('span', { class: 'zones-legend__sw', style: { background: z.color } }), `Z${z.zone} · ${zoneName(z.zone) || z.name}`]),
    el('span', { class: 'num muted', text: `${z.min}–${z.max} bpm` }),
  ])));
  view.appendChild(card);

/* ----- Pace ranges ----- */
  if (p.paceZones) {
    view.appendChild(sectionHead(t('settings.sections.paceZones')));
    const pc = el('div', { class: 'card' });
    Object.entries(p.paceZones).forEach(([k, z], i) => pc.appendChild(el('div', { class: 'row row--between', style: { padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: z.label }), el('span', { class: 'num muted', text: fmtPaceRange(z.min, z.max) }),
    ])));
    view.appendChild(pc);
  }

/* ----- Appearance ----- */
  view.appendChild(sectionHead(t('settings.sections.appearance'), null, { help: 'masseinheiten' }));
  const disp = el('div', { class: 'card' });
  disp.appendChild(el('div', { class: 'row row--between wrap mb-4' }, [
    el('span', { text: t('settings.appearance.theme') }),
    segmented([{ value: 'system', label: t('settings.appearance.system') }, { value: 'light', label: t('settings.appearance.light') }, { value: 'dark', label: t('settings.appearance.dark') }], s.theme || 'system', (v) => { store.setSetting('theme', v); window.dispatchEvent(new Event('catofit:theme')); }),
  ]));
  // Language of this person; empty follows the instance default. app.js applies it on the
  // profile change – except while an admin manages someone else (the admin's language stays).
  const instName = languages()[instanceLanguage()] || instanceLanguage();
  disp.appendChild(el('div', { class: 'row row--between wrap mb-1' }, [
    el('span', { text: t('settings.language.label') }),
    select([{ value: '', label: t('settings.language.instance', { language: instName }) }, ...languageOptions()],
      s.language || '', {
        'aria-label': t('settings.language.label'),
        onchange: (e) => store.setSetting('language', e.target.value || null),
      }),
  ]));
  disp.appendChild(el('div', { class: 'dim mb-4', style: { fontSize: '.74rem' }, text: t('settings.language.hint') }));
  // Units of this person – stored data stay metric, units.js converts for display and input.
  const pu = personUnits();
  const setUnit = (key, value) => { store.setSetting(key, value); applyUnits(); refreshView(); };
  const unitRow = (label, control) => el('div', { class: 'row row--between wrap mb-2', style: { gap: '8px' } }, [el('span', { text: label }), control]);
  const pair = (key, a, b, current, label) => segmented([{ value: a[0], label: a[1] }, { value: b[0], label: b[1] }], current, (v) => setUnit(key, v), { label });
  disp.appendChild(el('div', { class: 'dim mb-2', style: { fontSize: '.74rem', fontWeight: '650' }, text: t('settings.units.title') }));
  disp.appendChild(unitRow(t('settings.units.distance'), pair('distanceUnit', ['km', 'km'], ['mi', 'mi'], pu.distance, t('settings.units.distance'))));
  disp.appendChild(unitRow(t('settings.units.weight'), pair('weightUnit', ['kg', 'kg'], ['lb', 'lb'], pu.weight, t('settings.units.weight'))));
  disp.appendChild(unitRow(t('settings.units.temperature'), pair('temperatureUnit', ['c', '°C'], ['f', '°F'], pu.temperature, t('settings.units.temperature'))));
  disp.appendChild(unitRow(t('settings.units.weekStart'), select([1, 6, 0].map((d) => ({ value: String(d), label: weekdayNames(true)[d] })), String(pu.weekStart), {
    'aria-label': t('settings.units.weekStart'), onchange: (e) => setUnit('weekStart', Number(e.target.value)),
  })));
  disp.appendChild(unitRow(t('settings.units.labs'), pair('labUnits', ['si', t('settings.units.labsSi')], ['conventional', t('settings.units.labsConventional')], pu.labs, t('settings.units.labs'))));
  disp.appendChild(el('div', { class: 'dim mb-4', style: { fontSize: '.74rem' }, text: t('settings.units.hint') }));
  disp.appendChild(el('div', { class: 'dim mb-2', style: { fontSize: '.74rem', fontWeight: '650' }, text: t('settings.appearance.accent') }));
  disp.appendChild(el('div', { class: 'row wrap gap-3' }, ACCENTS.map((c) => {
    const active = (s.accent || '#18b48a').toLowerCase() === c.toLowerCase();
    return el('button', {
      'aria-label': t('settings.appearance.accentAria', { color: c }),
      style: { width: '38px', height: '38px', borderRadius: '50%', background: c, boxShadow: active ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : 'var(--shadow-1)' },
      onclick: () => { store.setSetting('accent', c); window.dispatchEvent(new Event('catofit:theme')); refreshView(); },
    });
  })));
  view.appendChild(disp);

/* ----- Modules ----- */
  view.appendChild(sectionHead(t('settings.sections.modules'), null, { help: 'module' }));
  const mods = s.modules || {};
  const modList = el('div', { class: 'card' });
  // A strength-training switch existed here until v3.20.0 without any effect (DOC-15) – removed;
  // a stored value does no harm.
  [['nutrition', t('nav.nutrition')], ['shopping', t('nav.shopping')], ['checklist', t('settings.modules.checklist')], ['cycle', t('settings.modules.cycle')], ['labs', t('nav.labs')]].forEach(([k, label], i) => {
    modList.appendChild(el('div', { class: 'row row--between', style: { padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: label }),
      // Read fresh modules (not the render snapshot) -> several toggles do not overwrite each other.
      // catofit:nav shows/hides the menu item immediately.
      toggle(mods[k] !== false, (v) => {
        store.setSetting('modules', { ...(store.settings().modules || {}), [k]: v });
        window.dispatchEvent(new Event('catofit:nav'));
      }, t('settings.modules.aria', { name: label })),
    ]));
  });
  view.appendChild(modList);

/* ----- Metrics ----- */
  view.appendChild(sectionHead(t('settings.sections.bodyMetrics')));
  const me = s.metricsEnabled || {};
  const metList = el('div', { class: 'card' });
  [['weight', t('settings.metrics.weight')], ['bodyFat', t('settings.metrics.bodyFat')], ['muscleMass', t('settings.metrics.muscleMass')], ['leanMass', t('settings.metrics.leanMass')], ['visceralFat', t('settings.metrics.visceralFat')], ['restingHr', t('settings.metrics.restingHr')], ['hrv', t('settings.metrics.hrv')], ['vo2max', t('settings.metrics.vo2max')], ['sleepHours', t('settings.metrics.sleep')], ['energy', t('settings.metrics.energy')], ['mood', t('settings.metrics.mood')]].forEach(([k, label], i) => {
    metList.appendChild(el('div', { class: 'row row--between', style: { padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: label }),
      toggle(me[k] !== false, (v) => store.setSetting('metricsEnabled', { ...(store.settings().metricsEnabled || {}), [k]: v }), t('settings.metrics.showAria', { name: label })),
    ]));
  });
  view.appendChild(metList);

/* ----- Location & weather ----- */
  view.appendChild(sectionHead(t('settings.sections.location')));
  const wcard = el('div', { class: 'card' });
  wcard.appendChild(el('div', { class: 'row row--between mb-4' }, [
    el('span', { text: t('settings.location.weatherShow') }),
    toggle(s.weather !== false, (v) => store.setSetting('weather', v), t('settings.location.weatherShow')),
  ]));
  const cityI = input({ value: s.location?.name || '', placeholder: t('settings.location.cityPlaceholder'), 'aria-label': t('settings.location.searchAria') });
  const hits = el('div', { class: 'col gap-2 mt-2', 'aria-live': 'polite' });
  // Matches with region and country to choose from; only the tap adopts the place (UI-40).
  const choose = async (g) => {
    store.setSetting('location', { name: g.name, region: g.region, country: g.country, lat: g.lat, lon: g.lon });
    try { await refreshWeather(g, true); } catch { /* the forecast arrives at the next start */ }
    toast(t('settings.location.chosen', { place: placeLabel(g) }), 'good');
    refreshView();
  };
  const searchBtn = el('button', {
    class: 'btn btn--soft', text: t('settings.location.search'), type: 'button',
    onclick: async () => {
      const q = cityI.value.trim();
      if (!q) return;
      searchBtn.textContent = '…';
      hits.innerHTML = '';
      try {
        const list = await geocode(q);
        searchBtn.textContent = t('settings.location.search');
        if (!list.length) { toast(t('settings.location.notFound'), 'bad'); return; }
        if (list.length === 1) { await choose(list[0]); return; }
        hits.appendChild(el('div', { class: 'dim', style: { fontSize: '.78rem' }, text: t('settings.location.which') }));
        list.forEach((g) => hits.appendChild(el('button', { class: 'btn btn--ghost btn--block', type: 'button', style: { justifyContent: 'flex-start' }, onclick: () => choose(g) }, [icon('mapPin'), placeLabel(g)])));
      } catch { toast(t('settings.location.unreachable'), 'bad'); searchBtn.textContent = t('settings.location.search'); }
    },
  });
  wcard.appendChild(field(t('settings.location.fieldLabel'), el('div', { class: 'row gap-2' }, [cityI, searchBtn])));
  wcard.appendChild(hits);
  if (s.location) wcard.appendChild(el('div', { class: 'dim', style: { fontSize: '.78rem' }, text: t('settings.location.current', { place: placeLabel(s.location) }) }));
  wcard.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('settings.location.credit') }));
  view.appendChild(wcard);

/* ----- Shopping ----- */
  view.appendChild(sectionHead(t('settings.sections.shopping')));
  view.appendChild(el('div', { class: 'card row row--between', style: { alignItems: 'center' } }, [
    el('div', {}, [
      el('div', { text: t('settings.shopping.day') }),
      el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: weekdayNames(true)[store.familySettings().shoppingDay ?? 2] }),
    ]),
    store.isAdmin()
      ? el('button', { class: 'btn btn--ghost', onclick: () => navigate('#/familie-verwalten') }, t('settings.change'))
      : el('span', { class: 'chip', text: t('settings.shopping.adminOnly') }),
  ]));

  /* ----- Nutrition ----- */
  view.appendChild(sectionHead(t('nav.nutrition')));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('span', { text: t('settings.nutrition.foodLookup') }),
      toggle(store.foodLookupEnabled(), (v) => store.setSetting('foodLookup', v), t('settings.nutrition.foodLookup')),
    ]),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('settings.nutrition.foodLookupHint') }),
    // Attribution required by the terms of use of Open Food Facts (DOC-16).
    el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, html: t('settings.nutrition.foodLookupCredit') }),
  ]));

  /* ----- Administration (admin only) – above the backup ----- */
  if (store.isAdmin()) {
    view.appendChild(sectionHead(t('settings.sections.admin')));
    view.appendChild(el('button', { class: 'card card--link', style: { width: '100%', textAlign: 'left' }, onclick: () => navigate('#/familie-verwalten') }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { class: 'type-icon type-icon--lg', style: { background: 'var(--accent)' }, html: iconSvg('grid') }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'card__title', text: t('settings.admin.manageTitle') }),
          el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('settings.admin.manageHint') }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
    ]));
    // Instance default: sign-in screen and everyone without an own choice.
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row row--between wrap' }, [
        el('span', { text: t('settings.language.instanceLabel') }),
        select(languageOptions(), instanceLanguage(), {
          'aria-label': t('settings.language.instanceLabel'),
          onchange: async (e) => { store.setFamilySetting('language', e.target.value); await applyLanguage(); refreshView(); },
        }),
      ]),
      el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: t('settings.language.instanceHint') }),
    ]));
  }

/* ----- Data ----- */
  view.appendChild(sectionHead(t('settings.sections.data'), null, { help: 'backup' }));
  view.appendChild(el('div', { class: 'col gap-2' }, [
    el('button', { class: 'btn btn--soft btn--block', onclick: () => { syncNow().then(() => toast(t('settings.data.synced'), 'good')); } }, [icon('refresh'), t('settings.data.syncNow')]),
    el('button', { class: 'btn btn--ghost btn--block', onclick: exportData }, [icon('download'), t('settings.data.exportBackup')]),
    el('button', { class: 'btn btn--ghost btn--block', onclick: openCsvExport }, [icon('download'), t('settings.data.exportCsv')]),
    el('button', { class: 'btn btn--ghost btn--block', onclick: importData }, [icon('upload'), t('settings.data.importBackup')]),
    el('a', { class: 'btn btn--ghost btn--block', href: '#/import' }, [icon('activity'), t('settings.data.healthImport')]),
  ]));
  view.appendChild(el('p', { class: 'dim', style: { fontSize: '.78rem', marginTop: '4px' }, text: t('settings.data.hint') }));
  if (!store.isManaging()) view.appendChild(readAccessCard());

  // Admin full backup: back up/restore the whole family (authoritative).
  if (store.isAdmin()) {
    view.appendChild(el('div', { class: 'card', style: { marginTop: '12px', borderColor: 'var(--accent-soft)' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '8px' } }, [
        el('span', { class: 'chip', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, text: t('account.admin') }),
        el('strong', { text: t('settings.fullBackup.title') }),
      ]),
      el('p', { class: 'dim', style: { fontSize: '.8rem', lineHeight: '1.5' }, text: t('settings.fullBackup.intro') }),
      el('div', { class: 'col gap-2', style: { marginTop: '8px' } }, [
        el('button', { class: 'btn btn--soft btn--block', onclick: exportFamilyData }, [icon('download'), t('settings.fullBackup.export')]),
        el('button', { class: 'btn btn--danger btn--block', onclick: importFamilyData }, [icon('upload'), t('settings.fullBackup.restore')]),
      ]),
    ]));
  }

  /* ----- About & legal ----- */
  view.appendChild(sectionHead(t('settings.sections.about')));
  const repo = 'https://github.com/Bingerminger/cat-o-fit';
  const legal = el('div', { class: 'card', style: { fontSize: '.8rem', lineHeight: '1.5' } }, [
    el('p', { class: 'dim', html: t('settings.about.legal1') }),
    el('p', { class: 'dim mt-2', html: t('settings.about.legal2') }),
    el('div', { class: 'row gap-2 mt-2', style: { flexWrap: 'wrap' } }, [
      [t('settings.about.license'), `${repo}/blob/main/LICENSE`],
      [t('settings.about.credits'), `${repo}/blob/main/CREDITS.md`],
      [t('settings.about.trademarks'), `${repo}/blob/main/TRADEMARKS.md`],
      [t('settings.about.source'), repo],
    ].map(([label, href]) => el('a', { class: 'btn btn--ghost', style: { fontSize: '.78rem', padding: '.4rem .7rem' }, href, target: '_blank', rel: 'noopener', text: label }))),
  ]);
  view.appendChild(legal);

  // App reset deliberately as the VERY LAST action (destructive) – danger zone at the very bottom.
  if (store.isAdmin()) {
    view.appendChild(el('div', { class: 'card card--flat mt-4' }, [
      el('button', { class: 'btn btn--ghost btn--block', style: { color: 'var(--bad-text)' }, onclick: openResetSheet }, [icon('trash'), t('settings.reset.button')]),
      el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('settings.reset.hint') }),
    ]));
  }

  view.appendChild(el('p', { class: 'dim center mt-6', style: { fontSize: '.76rem' }, text: t('settings.footer', { version: APP_VERSION }) }));
  view.insertBefore(jumpNav(view), view.firstChild);
}

/**
 * Jump bar above the settings: Account · Profile · Goals · Training · Appearance ·
 * Modules · Data – previously 6.3 screen heights without orientation, "Backup" or "Modules"
 * could only be found by scrolling (UI-15).
 */
function jumpNav(view) {
  const GROUPS = [
    [t('settings.sections.account'), t('settings.sections.account')],
    [t('settings.sections.profile'), t('settings.sections.profile')],
    [t('settings.sections.weeklyGoals'), t('settings.jump.goals')],
    [t('settings.sections.hrZones'), t('settings.jump.training')],
    [t('settings.sections.appearance'), t('settings.sections.appearance')],
    [t('settings.sections.modules'), t('settings.sections.modules')],
    [t('settings.sections.data'), t('settings.jump.backup')],
  ];
  // [...] – a NodeList in the browser (without find), an array in the test DOM.
  const heads = [...view.querySelectorAll('.section-head')];
  const find = (title) => heads.find((h) => ([...h.querySelectorAll('.section-head__title')][0] || {}).textContent === title);
  return el('nav', { class: 'jump-nav', 'aria-label': t('settings.jump.aria') },
    GROUPS.map(([title, label]) => [find(title), label]).filter(([h]) => h).map(([h, label]) => el('button', {
      class: 'chip chip--btn', type: 'button', text: label,
      onclick: () => { try { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { h.scrollIntoView(); } },
    })));
}

/** Eligibility (gate) and "Hide calorie figures" – one status for the whole app. */
function eligibilityCard(elig, s, onChange) {
  let status;
  if (elig.minor) {
    status = elig.age != null ? t('settings.gate.minorAge', { age: elig.age }) : t('settings.gate.minor');
  } else if (!elig.answered) {
    status = t('settings.gate.notAnswered');
  } else if (elig.mode === 'full') {
    status = t('settings.gate.answeredNone');
  } else {
    status = elig.noWeightGoals
      ? t('settings.gate.answeredNoWeight', { reasons: elig.reasons.join(' · ') })
      : t('settings.gate.answered', { reasons: elig.reasons.join(' · ') });
  }
  return el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'flex-start', gap: '12px' } }, [
      el('div', {}, [
        el('div', { text: t('settings.gate.title') }),
        el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '2px' }, text: status }),
      ]),
      el('button', { class: 'btn btn--ghost', style: { flex: '0 0 auto' }, onclick: () => openGateSheet({ onSaved: onChange }) }, Object.keys(s.labsGate || {}).length ? t('settings.change') : t('settings.gate.answer')),
    ]),
    el('div', { class: 'row row--between mt-3', style: { alignItems: 'center', gap: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' } }, [
      el('div', {}, [
        el('div', { text: t('settings.gate.hideCalories') }),
        el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: elig.minor
          ? t('settings.gate.hiddenMinor')
          : t('settings.gate.hideCaloriesHint') }),
      ]),
      elig.minor
        ? el('span', { class: 'chip', text: t('settings.gate.always') })
        : toggle(s.hideCalorieNumbers === true, (v) => { store.setSetting('hideCalorieNumbers', v); toast(v ? t('settings.gate.hidden') : t('settings.gate.visible'), 'good'); }, t('settings.gate.hideCalories')),
    ]),
    el('div', { class: 'dim mt-3', style: { fontSize: '.74rem', paddingTop: '10px', borderTop: '1px solid var(--border)' }, text: t('settings.gate.disclaimer') }),
  ]);
}

/* App reset: deletes everything (server & local) and leads to the initial setup. Type-to-confirm. */
function openResetSheet() {
  const inp = input({ type: 'text', placeholder: t('settings.reset.word'), maxlength: '12', autocomplete: 'off' });
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true, text: t('settings.reset.typeWord', { word: t('settings.reset.word') }) });
  let busy = false;
  const doReset = async () => {
    if (busy) return;
    if (inp.value.trim().toUpperCase() !== t('settings.reset.word').toUpperCase()) { err.hidden = false; inp.focus(); return; }
    // The server only deletes for a signed-in admin – without it everything would stay there.
    if (!store.serverSessionActive()) {
      toast(t('settings.reset.needServer'), 'bad', 5000);
      return;
    }
    busy = true;
    try { await store.resetApp(); } catch { /* restart anyway */ }
    location.hash = '#/login';
    location.reload();   // clean restart into the initial setup
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doReset(); });
  const body = el('div', { class: 'col gap-3' }, [
    el('div', { class: 'muted', style: { lineHeight: '1.5' }, text: t('settings.reset.intro') }),
    el('label', { class: 'field__label', text: t('settings.reset.label', { word: t('settings.reset.word') }) }), inp, err,
    el('button', { class: 'btn btn--danger btn--block', onclick: doReset }, [icon('trash'), t('settings.reset.confirmButton')]),
  ]);
  openSheet({ title: t('settings.reset.title'), body });
  setTimeout(() => inp.focus(), 120);
}

/** Create a new health goal (metric + target value + optional deadline). */
function openGoalSheet(view, elig = currentEligibility()) {
  // Children, pregnancy/breastfeeding, eating disorder: no weight and body-fat goals.
  const metrics = GOAL_METRICS.filter((m) => !(elig.noWeightGoals && WEIGHT_METRICS.includes(m.key)));
  let metric = metrics[0].key;
  const metricSel = select(
    // Weight in the person's unit (kg or lb): typed in it, stored in kg.
    metrics.map((m) => { const unit = shownMetric(m).unit; return { value: m.key, label: `${m.label}${unit ? ' (' + unit + ')' : ''}` }; }),
    metric, { onchange: (e) => { metric = e.target.value; updateHint(); } },
  );
  const targetI = input({ type: 'number', step: '0.1', inputmode: 'decimal', placeholder: t('settings.goalSheet.target') });
  const deadlineI = input({ type: 'date' });
  const hint = el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' } });
  // HRV goals apply to one measurement method (that of the most recent value) – SDNN and RMSSD are not comparable.
  const hrvMethod = currentHrvMethod(store.get('health'));
  function updateHint() {
    const cur = latestMetric(metric, { profile: store.profile(), health: store.get('health'), hrvMethod });
    const m = metricMeta(metric);
    const how = metric === 'hrv' && hrvMethod && hrvMethod !== 'unbekannt' ? ` (${t('settings.goalSheet.hrvMethod', { method: hrvLabel(hrvMethod) })})` : '';
    hint.textContent = cur != null
      ? t('settings.goalSheet.current', { value: `${metric === 'weight' ? fmtWeightDec(cur) : `${fmtDec(cur)}${m.unit ? ' ' + m.unit : ''}`}${how}` })
      : t('settings.goalSheet.noMeasurement');
  }
  updateHint();
  // Risky goals: hint directly in the sheet, only the second tap creates the goal (a follow-up question
  // as a separate sheet would close this one and discard the inputs).
  const warnBox = warningBox();
  const createBtn = el('button', { class: 'btn btn--primary grow', text: t('settings.goalSheet.create') });
  const confirm = pendingConfirm(warnBox, createBtn, t('settings.goalSheet.create'), t('settings.goalSheet.createAnyway'));
  targetI.addEventListener('input', confirm.reset);
  metricSel.addEventListener('change', confirm.reset);
  createBtn.onclick = () => {
    const target = metric === 'weight' ? fromInput(targetI.value, 'weight') : parseFloat(String(targetI.value).replace(',', '.'));
    if (!Number.isFinite(target)) { toast(t('settings.goalSheet.enterTarget'), 'bad'); return; }
    const profile = store.profile();
    if (!confirm.ok(goalWarning(metric, target, profile))) return;
    const start = latestMetric(metric, { profile, health: store.get('health'), hrvMethod });
    const goal = { id: uid('goal'), metric, target, start, deadline: deadlineI.value || null, createdAt: nowIso() };
    if (metric === 'hrv' && hrvMethod) goal.hrvMethod = hrvMethod;
    const list = [...((store.settings().healthGoals) || []), goal];
    store.setSetting('healthGoals', list);
    closeSheet(); toast(t('settings.goalSheet.created'), 'good'); rerender(view);
  };
  openSheet({
    title: t('settings.goalSheet.title'),
    body: el('div', {}, [
      field(t('settings.goalSheet.metric'), metricSel),
      field(t('settings.goalSheet.target'), targetI),
      field(t('settings.goalSheet.date'), deadlineI),
      hint,
      warnBox,
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      createBtn,
    ],
  });
}

/** Hint field for risky target values (in the sheet, hidden at first). */
function warningBox() {
  return el('div', { class: 'card card--flat mt-2', role: 'alert', hidden: true, style: { borderLeft: '3px solid var(--warn)', fontSize: '.82rem' } });
}

/** Two-step confirmation in the sheet: the first tap shows the hint, the second confirms. */
function pendingConfirm(box, btn, label, confirmLabel) {
  let shown = null;
  const reset = () => { shown = null; box.hidden = true; btn.textContent = label; };
  return {
    reset,
    ok(warning) {
      if (!warning || shown === warning) return true;
      shown = warning; box.textContent = warning; box.hidden = false; btn.textContent = confirmLabel;
      return false;
    },
  };
}

/** Hint for goals that are risky for health (underweight, very low body-fat percentage) – or null. */
function goalWarning(metric, target, profile = {}) {
  if (metric === 'weight') return targetWeightWarning(target, profile);
  if (metric === 'bodyFat') {
    const floor = profile.sex === 'm' ? BODY_FAT_FLOOR.m : BODY_FAT_FLOOR.w;
    if (target < floor) {
      const who = profile.sex === 'm' ? t('settings.bodyFat.men') : profile.sex === 'w' ? t('settings.bodyFat.women') : t('settings.bodyFat.unknown');
      return t('settings.bodyFat.warning', { floor, who });
    }
  }
  return null;
}

/** Hint when the target weight corresponds to a BMI below 18.5 (or null). */
function targetWeightWarning(target, profile = {}) {
  const bmi = bmiFor(target, profile);
  if (bmi == null || bmi >= 18.5) return null;
  return t('settings.bmiWarning', { height: fmtHeight(profile.heightCm), bmi: fmtDec(bmi) });
}

/**
 * Change PIN. One's own only with the current PIN (protects against someone else's still
 * open session on a shared device); when managing, an admin resets the member's
 * PIN. The new PIN is always entered twice. Removing it is not possible – the PIN is mandatory.
 */
function openPinSheet(member) {
  const self = member.id === store.identityId();
  const pinInput = (placeholder) => el('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder, 'aria-label': placeholder });
  const oldI = self && store.memberHasPin(member.id) ? pinInput(t('settings.pin.current')) : null;
  const newI = pinInput(t('settings.pin.new'));
  const new2I = pinInput(t('settings.pin.repeat'));
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true });
  const showErr = (msg, field) => { err.textContent = msg; err.hidden = false; if (field) { field.value = ''; field.focus(); } };
  let busy = false;
  const save = async () => {
    if (busy) return;
    const pin = newI.value.trim();
    const problem = store.pinProblem(pin);
    if (problem) { showErr(problem, newI); return; }
    if (pin !== new2I.value.trim()) { showErr(t('settings.pin.mismatch'), new2I); return; }
    busy = true;
    const r = await store.setMemberPin(member.id, pin, oldI ? oldI.value.trim() : null);
    busy = false;
    if (!r.ok) {
      if (r.code === 'pin') showErr(r.left ? tp('settings.pin.wrongLeft', r.left) : t('settings.pin.wrong'), oldI);
      else showErr(r.message || t('settings.pin.notSaved'));
      return;
    }
    closeSheet();
    toast(self ? t('settings.pin.changed') : t('settings.pin.resetFor', { name: member.name }), 'good');
    refreshView();   // redraw hints
  };
  [oldI, newI, new2I].filter(Boolean).forEach((f, i, all) => f.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (all[i + 1]) all[i + 1].focus(); else save();
  }));
  const body = el('div', { class: 'pin-dialog' }, [
    el('div', { class: 'pin-dialog__name', style: { textAlign: 'center' }, text: self ? t('settings.pin.dialogName', { name: member.name }) : t('settings.pin.dialogNameNew', { name: member.name }) }),
    oldI, newI, new2I,
    el('div', { class: 'muted', style: { fontSize: '.8rem', textAlign: 'center' }, text: t('settings.pin.rules') }),
    err,
    el('button', { class: 'btn btn--primary btn--block', onclick: save }, [icon('check'), t('settings.save')]),
  ]);
  openSheet({ title: t('settings.pin.title'), body });
  setTimeout(() => (oldI || newI).focus(), 120);
}

/* ------------------------------- Profile sheet --------------------------- */
function openProfileSheet() {
  const p = store.profile();
  const nameI = input({ value: p.name || '' });
  // Height and weights in the person's units – alongside pounds the height in feet and inches.
  // Stored in whole cm and in kg; a field left as it was keeps its stored value.
  const lb = weightUnit() === 'lb';
  const h0 = lb && p.heightCm ? cmToFeetInches(p.heightCm) : null;
  const hI = input({ type: 'number', value: lb ? (h0 ? h0.ft : '') : (p.heightCm || ''), inputmode: 'numeric',
    ...(lb ? { min: '0', max: '8', class: 'input input--dur', placeholder: 'ft', 'aria-label': t('settings.profile.height', { unit: 'ft' }) } : {}) });
  const hInI = lb ? input({ type: 'number', min: '0', max: '11', value: h0 ? h0.in : '', inputmode: 'numeric', class: 'input input--dur', placeholder: 'in', 'aria-label': t('settings.profile.height', { unit: 'in' }) }) : null;
  const heightControl = lb
    ? el('div', { class: 'dur-fields' }, [hI, el('span', { class: 'dur-unit', 'aria-hidden': 'true', text: 'ft' }), hInI, el('span', { class: 'dur-unit', 'aria-hidden': 'true', text: 'in' })])
    : hI;
  const wI = input({ type: 'number', step: '0.1', value: toInput(p.weightKg || null, 'weight'), inputmode: 'decimal' });
  const twI = input({ type: 'number', step: '0.1', value: toInput(p.targetWeightKg || null, 'weight'), inputmode: 'decimal' });
  const byI = input({ type: 'number', value: p.birthYear || '', inputmode: 'numeric', placeholder: t('settings.profile.year') });
  const sexI = select([{ value: '', label: t('settings.profile.sexNone') }, { value: 'w', label: t('settings.profile.sexFemale') }, { value: 'm', label: t('settings.profile.sexMale') }], p.sex || '');
  const goalsI = textarea({ value: (p.goals || []).join('\n'), placeholder: t('settings.profile.goalsPlaceholder') });

  // Target weight: not offered for children and adolescents; with a hint for pregnancy/eating disorder.
  const gate = store.settings().labsGate || {};
  const isMinor = () => {
    const age = ageOf({ birthYear: parseInt(byI.value) || null }, todayStr());
    return age != null ? age < 18 : gate.minor === true;
  };
  const twField = field(t('settings.profile.targetWeight', { unit: weightUnit() }), twI);
  const twNote = el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '-4px', marginBottom: '8px' } });
  const syncTarget = () => {
    const minor = isMinor();
    twField.hidden = minor;
    const block = minor
      ? t('settings.profile.minorNoTarget')
      : weightGoalBlockReason(currentEligibility());
    twNote.textContent = block || '';
    twNote.hidden = !block;
  };
  byI.addEventListener('input', syncTarget);
  syncTarget();

  // Target weight below BMI 18.5: hint in the sheet, only the second tap saves.
  const warnBox = warningBox();
  const saveBtn = el('button', { class: 'btn btn--primary grow', text: t('settings.save') });
  const confirm = pendingConfirm(warnBox, saveBtn, t('settings.save'), t('settings.profile.saveAnyway'));
  [twI, hI, hInI, byI].filter(Boolean).forEach((i) => i.addEventListener('input', confirm.reset));

  openSheet({
    title: t('settings.profile.editTitle'),
    body: el('div', {}, [
      field(t('settings.profile.name'), nameI),
      el('div', { class: 'field__row' }, [field(t('settings.profile.height', { unit: lb ? 'ft/in' : 'cm' }), heightControl), field(t('settings.profile.birthYear'), byI)]),
      el('div', { class: 'field__row' }, [field(t('settings.profile.weight', { unit: weightUnit() }), wI), twField]),
      twNote,
      warnBox,
      field(t('settings.profile.sex'), sexI),
      el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '-4px', marginBottom: '8px' }, text: t('settings.profile.sexHint') }),
      field(t('settings.profile.goals'), goalsI),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      saveBtn,
    ],
  });
  saveBtn.onclick = () => {
    const heightCm = lb ? heightFromInput(hI.value, hInI.value, p.heightCm) : (parseInt(hI.value) || null);
    const weightKg = fromInput(wI.value, 'weight', p.weightKg) || null;
    const targetWeightKg = isMinor() ? null : (fromInput(twI.value, 'weight', p.targetWeightKg) || null);
    const changed = targetWeightKg != null && targetWeightKg !== p.targetWeightKg;
    if (!confirm.ok(changed ? targetWeightWarning(targetWeightKg, { heightCm }) : null)) return;
    const changes = {
      name: nameI.value.trim(), heightCm, weightKg, targetWeightKg,
      birthYear: parseInt(byI.value) || null, sex: sexI.value || null,
      goals: goalsI.value.split('\n').map((x) => x.trim()).filter(Boolean),
    };
    // Remember the starting weight of the goal: it determines the direction (lose/gain),
    // even if the goal is later exceeded or undershot.
    if (targetWeightKg !== (p.targetWeightKg ?? null)) {
      changes.targetWeightStartKg = targetWeightKg != null ? weightNow(store.get('health'), { weightKg }, todayStr()) : null;
    }
    store.setProfile(changes);
    closeSheet(); toast(t('settings.profile.saved'), 'good'); refreshView();
  };
}

async function exportData() {
  try {
    const name = `catofit-backup-${todayStr()}.json`;
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
    const res = await saveFile(name, blob);
    if (res === 'cancelled') { toast(t('settings.backup.notSaved')); return; }
    alertDialog({ title: t('settings.backup.ready'), tone: 'good', message: savedFileMessage(res, name) });
  } catch (e) {
    alertDialog({ title: t('settings.backup.failed'), tone: 'bad', message: e.message || t('settings.backup.failedMsg') });
  }
}

/** Read access for your own tools, e.g. a self-hosted AI assistant (MKT-15).
    Off by default; read-only; without cycle, lab values and supplements. */
function readAccessCard() {
  const wrap = el('div', { class: 'card mt-3' });
  const draw = () => {
    wrap.innerHTML = '';
    const token = store.profile().readToken;
    wrap.appendChild(el('div', { class: 'row row--between', style: { alignItems: 'center', gap: '12px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.92rem' }, text: t('settings.readAccess.title') }),
        el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '2px' }, text: t('settings.readAccess.intro') }),
      ]),
      toggle(!!token, (on) => {
        if (on) {
          const a = new Uint8Array(24);
          crypto.getRandomValues(a);
          store.setProfile({ readToken: Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('') });
        } else {
          store.setProfile({ readToken: null });
        }
        draw();
      }, t('settings.readAccess.allow')),
    ]));
    if (!token) return;
    const url = `${new URL('api/api.php', location.href.split('#')[0]).href}?action=read&user=${encodeURIComponent(store.activeUserId())}`;
    const urlI = input({ value: url }); urlI.readOnly = true;
    const tokI = input({ value: token, type: 'password' }); tokI.readOnly = true;
    const copy = async (text, field, what) => {
      try { await navigator.clipboard.writeText(text); toast(t('settings.readAccess.copied', { what }), 'good'); } catch { field.type = 'text'; field.select(); toast(t('settings.readAccess.manual')); }
    };
    wrap.appendChild(el('div', { class: 'field__label mt-3', text: t('settings.readAccess.address') }));
    wrap.appendChild(el('div', { class: 'row gap-2' }, [urlI, el('button', { class: 'btn btn--soft', 'aria-label': t('settings.readAccess.copyAddress'), onclick: () => copy(url, urlI, t('settings.readAccess.address')) }, icon('link'))]));
    wrap.appendChild(el('div', { class: 'field__label mt-3', text: t('settings.readAccess.keyLabel') }));
    wrap.appendChild(el('div', { class: 'row gap-2' }, [tokI, el('button', { class: 'btn btn--soft', 'aria-label': t('settings.readAccess.copyKey'), onclick: () => copy(token, tokI, t('settings.readAccess.key')) }, icon('link'))]));
    wrap.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('settings.readAccess.hint') }));
  };
  draw();
  return wrap;
}

/** CSV per area – for further work in Excel, Numbers or another app (MKT-12). */
function openCsvExport() {
  const save = async (label, file, csv) => {
    const name = `catofit-${file}-${todayStr()}.csv`;
    try {
      const res = await saveFile(name, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      if (res === 'cancelled') { toast(t('settings.csv.notExported', { label })); return; }
      alertDialog({ title: t('settings.csv.ready', { label }), tone: 'good', message: savedFileMessage(res, name) });
    } catch (e) {
      alertDialog({ title: t('settings.csv.failed'), tone: 'bad', message: e.message || t('settings.csv.failedMsg') });
    }
  };
  const count = (area) => store.get(area).filter((x) => x && !x.deleted && !x._kind).length;
  actionSheet(t('settings.csv.title'), [
    { icon: 'activity', label: t('settings.csv.sessions'), hint: tp('settings.csv.sessionsHint', count('sessions')), onClick: () => save(t('settings.csv.sessions'), t('settings.fileNames.sessions'), sessionsCsv(store.get('sessions'))) },
    { icon: 'heart', label: t('settings.csv.health'), hint: tp('settings.csv.healthHint', count('health')), onClick: () => save(t('settings.csv.health'), t('settings.fileNames.health'), healthCsv(store.get('health'))) },
    { icon: 'flask', label: t('settings.csv.labs'), hint: tp('settings.csv.labsHint', count('labs')), onClick: () => save(t('settings.csv.labs'), t('settings.fileNames.labs'), labsCsv(store.get('labs'))) },
    { icon: 'utensils', label: t('settings.csv.diary'), hint: tp('settings.csv.diaryHint', count('diary')), onClick: () => save(t('settings.csv.diary'), t('settings.fileNames.diary'), diaryCsv(store.get('diary'))) },
  ]);
}

function importData() {
  const inp = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let dump;
      try { dump = JSON.parse(reader.result); }
      catch { await alertDialog({ title: t('errors.importFailed'), tone: 'bad', message: t('settings.import.notJson') }); return; }

      const me = store.activeMember();
      const foreign = dump && dump.user && me && dump.user !== me.id;
      const who = (dump && dump.userName) ? t('settings.import.quotedName', { name: dump.userName }) : t('settings.import.otherProfile');
      const msg = foreign
        ? (me ? t('settings.import.foreignNamed', { who, profile: me.name }) : t('settings.import.foreign', { who }))
        : t('settings.import.overwrite');
      const ok = await confirmDialog({ title: t('settings.import.confirmTitle'), message: msg, confirmLabel: t('settings.import.confirm'), danger: true });
      if (!ok) return;

      try {
        const res = store.importAll(dump);
        const n = res.imported.length;
        const restored = res.skipped.length
          ? tp('settings.import.restoredSkipped', n, { skipped: res.skipped.length })
          : tp('settings.import.restored', n);
        const priv = (res.privateSkipped || []).length
          ? t('settings.import.privateKept') : '';
        await alertDialog({ title: t('settings.import.done'), tone: 'good', message: [restored, priv, t('settings.import.reloading')].filter(Boolean).join(' ') });
        location.reload();
      } catch (e) {
        await alertDialog({ title: t('errors.importFailed'), tone: 'bad', message: e.message || t('settings.import.failedMsg') });
      }
    };
    reader.readAsText(f);
  });
  document.body.appendChild(inp); inp.click(); inp.remove();
}

/* ---------------------- Admin full backup (whole family) ----------------- */
async function exportFamilyData() {
  let dump;
  try { dump = await store.exportFamilyAll(); }
  catch (e) { await alertDialog({ title: t('settings.fullBackup.failed'), tone: 'bad', message: e.message || t('settings.fullBackup.failedMsg') }); return; }
  try {
    const n = Object.keys(dump.users || {}).length;
    const name = `${t('settings.fileNames.familyBackup')}-${todayStr()}.json`;
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const res = await saveFile(name, blob);
    if (res === 'cancelled') { toast(t('settings.fullBackup.notSaved')); return; }
    await alertDialog({ title: t('settings.fullBackup.ready'), tone: 'good', message: tp('settings.fullBackup.exported', n, { saved: savedFileMessage(res, name) }) });
  } catch (e) {
    await alertDialog({ title: t('settings.fullBackup.failed'), tone: 'bad', message: e.message || t('settings.fullBackup.fileFailedMsg') });
  }
}

function importFamilyData() {
  // The server only replaces the family for a signed-in admin – without it
  // only part of the restore would arrive.
  if (!store.serverSessionActive()) {
    alertDialog({ title: t('settings.fullBackup.needServerTitle'), tone: 'bad', message: t('settings.fullBackup.needServerMsg') });
    return;
  }
  const inp = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let dump;
      try { dump = JSON.parse(reader.result); }
      catch { await alertDialog({ title: t('settings.fullBackup.restoreFailed'), tone: 'bad', message: t('settings.import.notJson') }); return; }
      if (!dump || dump.kind !== 'family-full') {
        await alertDialog({ title: t('settings.fullBackup.wrongFileTitle'), tone: 'bad', message: t('settings.fullBackup.wrongFile', { action: t('settings.data.importBackup') }) }); return;
      }
      const n = dump.users ? Object.keys(dump.users).length : 0;
      const when = dump.exportedAt ? new Date(dump.exportedAt).toLocaleString(locale() === 'en' ? 'en-GB' : locale()) : t('settings.fullBackup.unknown');
      const ok = await confirmDialog({
        title: t('settings.fullBackup.confirmTitle'),
        message: tp('settings.fullBackup.confirm', n, { when }),
        confirmLabel: t('settings.fullBackup.confirmButton'), danger: true,
      });
      if (!ok) return;
      try {
        const res = await store.importFamilyAll(dump);
        const who = tp('settings.fullBackup.members', res.users);
        if (res.pending > 0) {
          await alertDialog({
            title: t('settings.fullBackup.partialTitle'), tone: 'bad',
            message: tp('settings.fullBackup.partial', res.pending, { who, done: res.areas - res.pending, total: res.areas }),
          });
        } else {
          await alertDialog({ title: t('settings.fullBackup.restoredTitle'), tone: 'good', message: tp('settings.fullBackup.restored', res.areas, { who }) });
        }
        location.reload();
      } catch (e) {
        await alertDialog({ title: t('settings.fullBackup.restoreFailed'), tone: 'bad', message: e.message || t('settings.fullBackup.restoreFailedMsg') });
      }
    };
    reader.readAsText(f);
  });
  document.body.appendChild(inp); inp.click(); inp.remove();
}

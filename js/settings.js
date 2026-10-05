/* =========================================================================
   settings.js — Profil & Einstellungen: Werte, HF-Zonen, Darstellung,
   Module, Metriken, Backup (Export/Import), Sync.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, toggle, segmented, field, input, textarea, select,
  openSheet, closeSheet, confirmDialog, alertDialog, toast, sectionHead, fmtPaceRange, todayStr,
  uid, nowIso, fmtDate, safeAccent, saveFile, savedFileMessage,
  refreshView, goOrRefresh, actionSheet,
  fmtDec,
  rerenderView,
} from './ui.js';
import { sessionsCsv, healthCsv, labsCsv, diaryCsv } from './csv-export.js';
import { setHeader } from './router.js';
import { syncNow } from './storage.js';
import { geocode, refreshWeather, placeLabel } from './weather.js';
import { APP_VERSION } from './version.js';
import { weeklyGoals, DEFAULT_GOALS } from './healthgoals.js';
import { GOAL_METRICS, metricMeta, latestMetric } from './goals.js';
import { currentEligibility, openGateSheet } from './wellness.js';
import { ageOf, weightGoalBlockReason } from './eligibility.js';
import { weightNow, bmiFor } from './energy.js';
import { currentHrvMethod, hrvLabel } from './healthdata.js';
import { hrZonesFrom, estimateMaxHr } from './hrzones.js';
import { t, tp, languages, locale } from './i18n.js';
import { applyLanguage, instanceLanguage } from './language.js';
import { weekdayNames } from './format.js';

/** Language options: the supported languages by their own names. */
function languageOptions() {
  return Object.entries(languages()).map(([value, label]) => ({ value, label }));
}

/** Gewicht und Körperfett sind „Gewichtsziele“ (gesperrt für Kinder, Schwangerschaft, Essstörung). */
const WEIGHT_METRICS = ['weight', 'bodyFat'];
/** Untergrenzen für Körperfett-Ziele (essenzielles Fett, grob): darunter wird es gesundheitlich riskant. */
const BODY_FAT_FLOOR = { w: 12, m: 5 };

/** Einstellungen neu zeichnen, ohne die Seite neu zu laden. */
function rerender(view) { rerenderView(render, view); }

const ACCENTS = ['#18b48a', '#2bb673', '#19b9c9', '#3d8bff', '#7c5cff', '#ff5d8f', '#ff8a3d', '#f5b300'];

export function render(view) {
  setHeader({ title: t('nav.settings') });
  const p = store.profile();
  const s = store.settings();

  /* ----- Konto & Familie ----- */
  // Immer die ANGEMELDETE Person (UI-02). Verwaltet sie gerade ein anderes Profil, steht das
  // hier ausdrücklich samt Rückweg – die Einstellungen darunter gelten dem verwalteten Profil.
  const ident = store.identityMember();
  const acct = store.activeMember();
  if (ident && acct) {
    const managing = store.isManaging();
    const identColor = safeAccent(ident.color, '');   // nur echte Hex-Farben in Stile übernehmen
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

    // Feinere Sichtbarkeit im Team/Familie-Dashboard (Zyklus bleibt unabhängig davon immer privat).
    view.appendChild(sectionHead(t('settings.sections.visibility')));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'muted mb-2', style: { fontSize: '.8rem' }, text: t('settings.visibility.intro') }),
      el('div', { class: 'row row--between', style: { padding: '8px 0' } }, [
        el('span', { text: t('settings.visibility.goal') }),
        toggle(s.shareGoal !== false, (v) => store.setSetting('shareGoal', v), t('settings.visibility.goal')),
      ]),
      el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
        el('span', { text: t('settings.visibility.metrics') }),
        toggle(s.shareMetrics !== false, (v) => store.setSetting('shareMetrics', v), t('settings.visibility.metricsAria')),
      ]),
      el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)', gap: '12px' } }, [
        el('span', {}, [el('span', { text: t('settings.visibility.load') }), el('br'), el('span', { class: 'dim', style: { fontSize: '.76rem' }, text: t('settings.visibility.loadHint') })]),
        toggle(s.shareLoad === true, (v) => store.setSetting('shareLoad', v), t('settings.visibility.load')),
      ]),
    ]));
  }

  /* ----- Profil ----- */
  const elig = currentEligibility();
  const profileLine = [`${p.heightCm || '–'} cm`, `${p.weightKg ? fmtDec(p.weightKg) : '–'} kg`];
  if (!elig.noWeightGoals) profileLine.push(t('settings.profile.target', { kg: p.targetWeightKg ? fmtDec(p.targetWeightKg) : '–' }));
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

  /* ----- Gesundheit & Eignung (gilt für die ganze App) ----- */
  view.appendChild(sectionHead(t('settings.sections.health')));
  view.appendChild(eligibilityCard(elig, s, () => rerender(view)));

  /* ----- Wochenziele (Aktivität) ----- */
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

  /* ----- Gesundheitsziele (Zielwerte mit Fortschritt) ----- */
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
      const paused = elig.noWeightGoals && WEIGHT_METRICS.includes(g.metric);
      goalsCard.appendChild(el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.9rem' }, text: (m && m.label) || g.metric }),
          el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: paused
            ? t('settings.goals.paused')
            : g.deadline ? t('settings.goals.targetBy', { target: `${fmtDec(g.target)}${unit}`, date: fmtDate(g.deadline) }) : t('settings.goals.target', { target: `${fmtDec(g.target)}${unit}` }) }),
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

  /* ----- Herzfrequenz-Zonen ----- */
  // HFmax gemessen oder – als Startwert – aus dem Alter geschätzt (Tanaka); Zonen
  // wahlweise in % HFmax oder über die Herzfrequenzreserve (Karvonen, mit Ruhepuls).
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
        if (v === 'lthr' && !p.lthr) { store.setProfile({ hrZoneMethod: 'lthr' }); refreshView(); return; }   // erst die Schwellen-HF eintragen
        saveZones({ hrZoneMethod: v });
      }),
    ]));
  }
  // Zonen aus der Schwellen-HF (TRAIN-51): aus einer Leistungsdiagnostik oder dem 30-Minuten-Feldtest.
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
    el('span', { class: 'row gap-2' }, [el('span', { class: 'zones-legend__sw', style: { background: z.color } }), `Z${z.zone} · ${z.name}`]),
    el('span', { class: 'num muted', text: `${z.min}–${z.max} bpm` }),
  ])));
  view.appendChild(card);

  /* ----- Pace-Bereiche ----- */
  if (p.paceZones) {
    view.appendChild(sectionHead(t('settings.sections.paceZones')));
    const pc = el('div', { class: 'card' });
    Object.entries(p.paceZones).forEach(([k, z], i) => pc.appendChild(el('div', { class: 'row row--between', style: { padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: z.label }), el('span', { class: 'num muted', text: fmtPaceRange(z.min, z.max) }),
    ])));
    view.appendChild(pc);
  }

  /* ----- Darstellung ----- */
  view.appendChild(sectionHead(t('settings.sections.appearance')));
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

  /* ----- Module ----- */
  view.appendChild(sectionHead(t('settings.sections.modules'), null, { help: 'module' }));
  const mods = s.modules || {};
  const modList = el('div', { class: 'card' });
  // „Krafttraining“ gab es hier bis v3.20.0 als Schalter ohne jede Wirkung (DOC-15) – entfernt;
  // ein gespeicherter Wert stört nicht.
  [['nutrition', t('nav.nutrition')], ['shopping', t('nav.shopping')], ['checklist', t('settings.modules.checklist')], ['cycle', t('settings.modules.cycle')], ['labs', t('nav.labs')]].forEach(([k, label], i) => {
    modList.appendChild(el('div', { class: 'row row--between', style: { padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: label }),
      // Frische Module lesen (nicht den Render-Snapshot) -> mehrere Toggles überschreiben sich nicht.
      // catofit:nav blendet den Menüpunkt sofort ein/aus.
      toggle(mods[k] !== false, (v) => {
        store.setSetting('modules', { ...(store.settings().modules || {}), [k]: v });
        window.dispatchEvent(new Event('catofit:nav'));
      }, t('settings.modules.aria', { name: label })),
    ]));
  });
  view.appendChild(modList);

  /* ----- Metriken ----- */
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

  /* ----- Standort & Wetter ----- */
  view.appendChild(sectionHead(t('settings.sections.location')));
  const wcard = el('div', { class: 'card' });
  wcard.appendChild(el('div', { class: 'row row--between mb-4' }, [
    el('span', { text: t('settings.location.weatherShow') }),
    toggle(s.weather !== false, (v) => store.setSetting('weather', v), t('settings.location.weatherShow')),
  ]));
  const cityI = input({ value: s.location?.name || '', placeholder: t('settings.location.cityPlaceholder'), 'aria-label': t('settings.location.searchAria') });
  const hits = el('div', { class: 'col gap-2 mt-2', 'aria-live': 'polite' });
  // Treffer mit Region und Land zur Auswahl; erst der Tipp übernimmt den Ort (UI-40).
  const choose = async (g) => {
    store.setSetting('location', { name: g.name, region: g.region, country: g.country, lat: g.lat, lon: g.lon });
    try { await refreshWeather(g, true); } catch { /* Vorhersage kommt beim nächsten Start */ }
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

  /* ----- Einkauf ----- */
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

  /* ----- Ernährung ----- */
  view.appendChild(sectionHead(t('nav.nutrition')));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('span', { text: t('settings.nutrition.foodLookup') }),
      toggle(store.foodLookupEnabled(), (v) => store.setSetting('foodLookup', v), t('settings.nutrition.foodLookup')),
    ]),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('settings.nutrition.foodLookupHint') }),
    // Namensnennung laut Nutzungsbedingungen von Open Food Facts (DOC-16).
    el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, html: t('settings.nutrition.foodLookupCredit') }),
  ]));

  /* ----- Verwaltung (nur Admin) – über dem Backup ----- */
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

  /* ----- Daten ----- */
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

  // Admin-Vollbackup: gesamte Familie sichern/wiederherstellen (autoritativ).
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

  /* ----- Über & Rechtliches ----- */
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

  // App-Reset bewusst als ALLERLETZTE Aktion (destruktiv) – Gefahrenzone ganz unten.
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
 * Sprungleiste über den Einstellungen: Konto · Profil · Ziele · Training · Darstellung ·
 * Module · Daten – vorher 6,3 Bildschirmhöhen ohne Orientierung, „Backup“ oder „Module“
 * fand man nur durch Scrollen (UI-15).
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
  // [...] – im Browser eine NodeList (ohne find), im Test-DOM ein Array.
  const heads = [...view.querySelectorAll('.section-head')];
  const find = (title) => heads.find((h) => ([...h.querySelectorAll('.section-head__title')][0] || {}).textContent === title);
  return el('nav', { class: 'jump-nav', 'aria-label': t('settings.jump.aria') },
    GROUPS.map(([title, label]) => [find(title), label]).filter(([h]) => h).map(([h, label]) => el('button', {
      class: 'chip chip--btn', type: 'button', text: label,
      onclick: () => { try { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { h.scrollIntoView(); } },
    })));
}

/** Abgrenzung (Gate) und „Kalorienzahlen ausblenden“ – ein Status für die ganze App. */
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

/* App-Reset: löscht alles (Server & lokal) und führt zur Ersteinrichtung. Tippe-Bestätigung. */
function openResetSheet() {
  const inp = input({ type: 'text', placeholder: t('settings.reset.word'), maxlength: '12', autocomplete: 'off' });
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true, text: t('settings.reset.typeWord', { word: t('settings.reset.word') }) });
  let busy = false;
  const doReset = async () => {
    if (busy) return;
    if (inp.value.trim().toUpperCase() !== t('settings.reset.word').toUpperCase()) { err.hidden = false; inp.focus(); return; }
    // Der Server löscht nur für eine angemeldete Admin-Person – ohne ihn bliebe alles dort liegen.
    if (!store.serverSessionActive()) {
      toast(t('settings.reset.needServer'), 'bad', 5000);
      return;
    }
    busy = true;
    try { await store.resetApp(); } catch { /* trotzdem neu starten */ }
    location.hash = '#/login';
    location.reload();   // sauberer Neustart in die Ersteinrichtung
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

/** Neues Gesundheitsziel anlegen (Metrik + Zielwert + optionale Frist). */
function openGoalSheet(view, elig = currentEligibility()) {
  // Kinder, Schwangerschaft/Stillzeit, Essstörung: keine Gewichts- und Körperfettziele.
  const metrics = GOAL_METRICS.filter((m) => !(elig.noWeightGoals && WEIGHT_METRICS.includes(m.key)));
  let metric = metrics[0].key;
  const metricSel = select(
    metrics.map((m) => ({ value: m.key, label: `${m.label}${m.unit ? ' (' + m.unit + ')' : ''}` })),
    metric, { onchange: (e) => { metric = e.target.value; updateHint(); } },
  );
  const targetI = input({ type: 'number', step: '0.1', inputmode: 'decimal', placeholder: t('settings.goalSheet.target') });
  const deadlineI = input({ type: 'date' });
  const hint = el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' } });
  // HRV-Ziele gelten für eine Messart (die des jüngsten Werts) – SDNN und RMSSD sind nicht vergleichbar.
  const hrvMethod = currentHrvMethod(store.get('health'));
  function updateHint() {
    const cur = latestMetric(metric, { profile: store.profile(), health: store.get('health'), hrvMethod });
    const m = metricMeta(metric);
    const how = metric === 'hrv' && hrvMethod && hrvMethod !== 'unbekannt' ? ` (${t('settings.goalSheet.hrvMethod', { method: hrvLabel(hrvMethod) })})` : '';
    hint.textContent = cur != null
      ? t('settings.goalSheet.current', { value: `${fmtDec(cur)}${m.unit ? ' ' + m.unit : ''}${how}` })
      : t('settings.goalSheet.noMeasurement');
  }
  updateHint();
  // Riskante Ziele: Hinweis direkt im Sheet, erst der zweite Tipp legt an (eine Rückfrage
  // als eigenes Sheet würde dieses schließen und die Eingaben verwerfen).
  const warnBox = warningBox();
  const createBtn = el('button', { class: 'btn btn--primary grow', text: t('settings.goalSheet.create') });
  const confirm = pendingConfirm(warnBox, createBtn, t('settings.goalSheet.create'), t('settings.goalSheet.createAnyway'));
  targetI.addEventListener('input', confirm.reset);
  metricSel.addEventListener('change', confirm.reset);
  createBtn.onclick = () => {
    const target = parseFloat(String(targetI.value).replace(',', '.'));
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

/** Hinweisfeld für riskante Zielwerte (im Sheet, zunächst verborgen). */
function warningBox() {
  return el('div', { class: 'card card--flat mt-2', role: 'alert', hidden: true, style: { borderLeft: '3px solid var(--warn)', fontSize: '.82rem' } });
}

/** Zweistufige Bestätigung im Sheet: erster Tipp zeigt den Hinweis, zweiter bestätigt. */
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

/** Hinweis bei gesundheitlich riskanten Zielen (Untergewicht, sehr niedriger Körperfettanteil) – oder null. */
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

/** Hinweis, wenn das Zielgewicht einem BMI unter 18,5 entspricht (oder null). */
function targetWeightWarning(target, profile = {}) {
  const bmi = bmiFor(target, profile);
  if (bmi == null || bmi >= 18.5) return null;
  return t('settings.bmiWarning', { height: profile.heightCm, bmi: fmtDec(bmi) });
}

/**
 * PIN ändern. Die eigene nur mit der bisherigen PIN (schützt vor einer fremden, noch
 * offenen Sitzung am geteilten Gerät); beim Verwalten setzt eine Admin-Person die PIN
 * des Mitglieds neu. Die neue PIN immer zweimal. Entfernen geht nicht – die PIN ist Pflicht.
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
    refreshView();   // Hinweise neu zeichnen
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

/* ------------------------------- Profil-Sheet --------------------------- */
function openProfileSheet() {
  const p = store.profile();
  const nameI = input({ value: p.name || '' });
  const hI = input({ type: 'number', value: p.heightCm || '', inputmode: 'numeric' });
  const wI = input({ type: 'number', step: '0.1', value: p.weightKg || '', inputmode: 'decimal' });
  const twI = input({ type: 'number', step: '0.1', value: p.targetWeightKg || '', inputmode: 'decimal' });
  const byI = input({ type: 'number', value: p.birthYear || '', inputmode: 'numeric', placeholder: t('settings.profile.year') });
  const sexI = select([{ value: '', label: t('settings.profile.sexNone') }, { value: 'w', label: t('settings.profile.sexFemale') }, { value: 'm', label: t('settings.profile.sexMale') }], p.sex || '');
  const goalsI = textarea({ value: (p.goals || []).join('\n'), placeholder: t('settings.profile.goalsPlaceholder') });

  // Zielgewicht: für Kinder und Jugendliche nicht angeboten; bei Schwangerschaft/Essstörung mit Hinweis.
  const gate = store.settings().labsGate || {};
  const isMinor = () => {
    const age = ageOf({ birthYear: parseInt(byI.value) || null }, todayStr());
    return age != null ? age < 18 : gate.minor === true;
  };
  const twField = field(t('settings.profile.targetWeight'), twI);
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

  // Zielgewicht unter BMI 18,5: Hinweis im Sheet, erst der zweite Tipp speichert.
  const warnBox = warningBox();
  const saveBtn = el('button', { class: 'btn btn--primary grow', text: t('settings.save') });
  const confirm = pendingConfirm(warnBox, saveBtn, t('settings.save'), t('settings.profile.saveAnyway'));
  [twI, hI, byI].forEach((i) => i.addEventListener('input', confirm.reset));

  openSheet({
    title: t('settings.profile.editTitle'),
    body: el('div', {}, [
      field(t('settings.profile.name'), nameI),
      el('div', { class: 'field__row' }, [field(t('settings.profile.height'), hI), field(t('settings.profile.birthYear'), byI)]),
      el('div', { class: 'field__row' }, [field(t('settings.profile.weight'), wI), twField]),
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
    const heightCm = parseInt(hI.value) || null;
    const weightKg = parseFloat(wI.value) || null;
    const targetWeightKg = isMinor() ? null : (parseFloat(twI.value) || null);
    const changed = targetWeightKg != null && targetWeightKg !== p.targetWeightKg;
    if (!confirm.ok(changed ? targetWeightWarning(targetWeightKg, { heightCm }) : null)) return;
    const changes = {
      name: nameI.value.trim(), heightCm, weightKg, targetWeightKg,
      birthYear: parseInt(byI.value) || null, sex: sexI.value || null,
      goals: goalsI.value.split('\n').map((x) => x.trim()).filter(Boolean),
    };
    // Startgewicht des Ziels merken: Daraus ergibt sich die Richtung (abnehmen/zunehmen),
    // auch wenn das Ziel später über- oder unterschritten wird.
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

/** Lesezugang für eigene Werkzeuge, etwa einen selbst betriebenen KI-Assistenten (MKT-15).
    Standardmäßig aus; nur lesend; ohne Zyklus, Labor und Ergänzungen. */
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

/** CSV je Bereich – zum Weiterarbeiten in Excel, Numbers oder einer anderen App (MKT-12). */
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

/* ---------------------- Admin-Vollbackup (ganze Familie) ----------------- */
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
  // Die Familie ersetzt der Server nur für eine angemeldete Admin-Person – ohne sie
  // käme nur ein Teil der Wiederherstellung an.
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

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

/** Gewicht und Körperfett sind „Gewichtsziele“ (gesperrt für Kinder, Schwangerschaft, Essstörung). */
const WEIGHT_METRICS = ['weight', 'bodyFat'];
/** Untergrenzen für Körperfett-Ziele (essenzielles Fett, grob): darunter wird es gesundheitlich riskant. */
const BODY_FAT_FLOOR = { w: 12, m: 5 };

/** Einstellungen neu zeichnen, ohne die Seite neu zu laden. */
function rerender(view) { rerenderView(render, view); }

const ACCENTS = ['#18b48a', '#2bb673', '#19b9c9', '#3d8bff', '#7c5cff', '#ff5d8f', '#ff8a3d', '#f5b300'];

export function render(view) {
  setHeader({ title: 'Einstellungen' });
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
    view.appendChild(sectionHead('Konto'));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
        el('span', { class: 'member-card__avatar', 'aria-hidden': 'true', style: { width: '44px', height: '44px', fontSize: '1.4rem', background: identColor ? identColor + '22' : 'var(--accent-soft)', color: identColor || 'var(--accent)' }, text: ident.emoji || '🏃' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'card__title', text: ident.name }),
          el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `${ident.role === 'admin' ? 'Administrator:in' : 'Mitglied'} · angemeldet` }),
        ]),
      ]),
      managing ? el('div', { class: 'account__managing mt-3', role: 'status' }, [
        el('span', { class: 'account__managing-text', text: `Du verwaltest gerade ${acct.name}. Die Einstellungen auf dieser Seite gelten für ${acct.name}.` }),
        el('button', { class: 'btn btn--soft account__back', type: 'button', onclick: async () => { await store.backToSelf(); goOrRefresh('#/settings'); } }, 'Zurück zu mir'),
      ]) : null,
      !managing && store.pinIsWeak()
        ? el('div', { class: 'pin-err mt-3', text: 'Du nutzt noch die Standard-PIN (oder gar keine). Bitte lege eine eigene fest.' })
        : null,
      el('div', { class: 'row gap-2 mt-3' }, [
        managing
          ? el('button', { class: 'btn btn--ghost grow', onclick: () => openPinSheet(acct) }, `🔒 PIN für ${acct.name} setzen`)
          : el('button', { class: 'btn btn--ghost grow', onclick: () => openPinSheet(ident) }, store.memberHasPin(ident.id) ? '🔒 PIN ändern' : '🔒 PIN festlegen'),
        el('button', { class: 'btn btn--ghost grow', onclick: async () => { await store.logout(); navigate('#/login'); } }, [icon('arrowLeft'), 'Abmelden']),
      ]),
      el('div', { class: 'row row--between mt-3', style: { alignItems: 'center', gap: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' } }, [
        el('div', {}, [
          el('div', { text: 'Gemeinsames Gerät' }),
          el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: 'Beim Abmelden alle persönlichen Daten von diesem Gerät entfernen – z. B. auf dem Familien-iPad. Gilt nur für dieses Gerät.' }),
        ]),
        toggle(store.isSharedDevice(), (v) => { store.setSharedDevice(v); toast(v ? 'Abmelden räumt dieses Gerät künftig auf' : 'Daten bleiben nach dem Abmelden auf dem Gerät', 'good'); }, 'Gemeinsames Gerät'),
      ]),
    ]));

    // Feinere Sichtbarkeit im Team/Familie-Dashboard (Zyklus bleibt unabhängig davon immer privat).
    view.appendChild(sectionHead('Sichtbarkeit im Team/Familie-Dashboard'));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'muted mb-2', style: { fontSize: '.8rem' }, text: 'Was die anderen von dir im gemeinsamen Dashboard sehen. Dein Name und Avatar bleiben für die Anmeldung sichtbar; Zyklus, Labor und Ergänzungen sind ohnehin immer privat.' }),
      el('div', { class: 'row row--between', style: { padding: '8px 0' } }, [
        el('span', { text: 'Mein Hauptziel zeigen' }),
        toggle(s.shareGoal !== false, (v) => store.setSetting('shareGoal', v), 'Mein Hauptziel zeigen'),
      ]),
      el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
        el('span', { text: 'Meine Kennzahlen zeigen (Momentum, km, Serie)' }),
        toggle(s.shareMetrics !== false, (v) => store.setSetting('shareMetrics', v), 'Meine Kennzahlen zeigen'),
      ]),
      el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)', gap: '12px' } }, [
        el('span', {}, [el('span', { text: 'Meine Belastung für Trainer:innen zeigen' }), el('br'), el('span', { class: 'dim', style: { fontSize: '.76rem' }, text: 'Admins sehen deine Wochenlast, das Lastverhältnis und dein Befinden der letzten Tage.' })]),
        toggle(s.shareLoad === true, (v) => store.setSetting('shareLoad', v), 'Meine Belastung für Trainer:innen zeigen'),
      ]),
    ]));
  }

  /* ----- Profil ----- */
  const elig = currentEligibility();
  const profileLine = [`${p.heightCm || '–'} cm`, `${p.weightKg || '–'} kg`];
  if (!elig.noWeightGoals) profileLine.push(`Ziel ${p.targetWeightKg || '–'} kg`);
  view.appendChild(sectionHead('Profil'));
  view.appendChild(el('button', { class: 'card card--link', style: { width: '100%', textAlign: 'left' }, onclick: () => openProfileSheet() }, [
    el('div', { class: 'row gap-3' }, [
      el('span', { class: 'type-icon type-icon--lg', style: { background: 'var(--accent)' }, html: iconSvg('user') }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: p.name || 'Profil' }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: profileLine.join(' · ') }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('edit') }),
    ]),
  ]));
  if (p.goals?.length) {
    view.appendChild(el('div', { class: 'card card--flat mt-2' }, [
      el('div', { class: 'dim mb-2', style: { fontSize: '.74rem', fontWeight: '650' }, text: 'ZIELE' }),
      el('div', { class: 'row wrap gap-2' }, p.goals.map((g) => el('span', { class: 'chip chip--accent', text: g }))),
    ]));
  }

  /* ----- Gesundheit & Eignung (gilt für die ganze App) ----- */
  view.appendChild(sectionHead('Gesundheit & Eignung'));
  view.appendChild(eligibilityCard(elig, s, () => rerender(view)));

  /* ----- Wochenziele (Aktivität) ----- */
  view.appendChild(sectionHead('Wochenziele'));
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
    toast('Wochenziele gespeichert', 'good');
  };
  minI.addEventListener('change', saveGoals);
  daysI.addEventListener('change', saveGoals);
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'field__row' }, [
      field('Aktive Minuten / Woche', minI),
      field('Trainingstage / Woche', daysI),
    ]),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: elig.minor
      ? 'An den WHO-Empfehlungen für Kinder und Jugendliche orientiert (im Schnitt 60 min Bewegung am Tag, also rund 420 min pro Woche). Der Fortschritt erscheint als Ringe auf „Heute“.'
      : 'An den WHO-Empfehlungen orientiert (≥ 150 min Bewegung pro Woche). Der Fortschritt erscheint als Ringe auf „Heute“.' }),
  ]));

  /* ----- Gesundheitsziele (Zielwerte mit Fortschritt) ----- */
  view.appendChild(sectionHead('Gesundheitsziele', { label: '+ Ziel', onClick: () => openGoalSheet(view, elig) }));
  const goals = (p.settings && p.settings.healthGoals) || [];
  const goalsCard = el('div', { class: 'card' });
  if (!goals.length) {
    goalsCard.appendChild(el('div', { class: 'dim', style: { fontSize: '.84rem' }, text: elig.noWeightGoals
      ? 'Noch keine Ziele. Lege z. B. ein Ruhepuls- oder VO₂max-Ziel an – der Fortschritt erscheint auf „Heute“.'
      : 'Noch keine Ziele. Lege z. B. ein Gewichts-, Ruhepuls- oder VO₂max-Ziel an – der Fortschritt erscheint auf „Heute“.' }));
  } else {
    goals.forEach((g, i) => {
      const m = metricMeta(g.metric); const unit = m && m.unit ? ' ' + m.unit : '';
      const paused = elig.noWeightGoals && WEIGHT_METRICS.includes(g.metric);
      goalsCard.appendChild(el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.9rem' }, text: (m && m.label) || g.metric }),
          el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: paused
            ? 'Ausgesetzt – Gewichts- und Körperfettziele sind nach deiner Abgrenzung aus.'
            : `Ziel ${g.target}${unit}${g.deadline ? ` · bis ${fmtDate(g.deadline)}` : ''}` }),
        ]),
        el('button', {
          class: 'icon-btn', 'aria-label': 'Ziel entfernen',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Ziel entfernen?', message: `„${(m && m.label) || g.metric}“ wirklich löschen?`, confirmLabel: 'Entfernen', danger: true });
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
  view.appendChild(sectionHead('Herzfrequenz-Zonen', null, { help: 'hf-zonen' }));
  const card = el('div', { class: 'card' });
  const age = ageOf(p, todayStr());
  const estMax = estimateMaxHr(age);
  const method = ['karvonen', 'lthr'].includes(p.hrZoneMethod) ? p.hrZoneMethod : 'hfmax';
  const saveZones = (patch) => {
    const next = { ...p, ...patch };
    const zones = hrZonesFrom({ maxHr: next.maxHr, restHr: next.restHr, method: next.hrZoneMethod, lthr: next.lthr });
    store.setProfile({ ...patch, hrZones: zones.length ? zones : (p.hrZones || null) });
    toast('Zonen aktualisiert');
    refreshView();
  };
  card.appendChild(el('div', { class: 'field__row' }, [
    field('Max. HF', input({
      type: 'number', min: '100', max: '240', value: p.maxHr || '', inputmode: 'numeric', placeholder: estMax ? `≈ ${estMax}` : '',
      onchange: (e) => { const mh = parseInt(e.target.value, 10); if (mh >= 100 && mh <= 240) saveZones({ maxHr: mh, maxHrEstimated: false }); },
    })),
    field('Ruhepuls', input({
      type: 'number', min: '30', max: '120', value: p.restHr || '', inputmode: 'numeric',
      onchange: (e) => { const rh = parseInt(e.target.value, 10); if (rh >= 30 && rh <= 120) { if (p.maxHr && method === 'karvonen') saveZones({ restHr: rh }); else store.setProfile({ restHr: rh }); } },
    })),
  ]));
  if (p.maxHr || p.lthr || method === 'lthr') {
    card.appendChild(el('div', { class: 'row row--between wrap mt-2', style: { gap: '8px', alignItems: 'center' } }, [
      el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Berechnung' }),
      segmented([{ value: 'hfmax', label: '% HFmax' }, { value: 'karvonen', label: 'HF-Reserve' }, { value: 'lthr', label: 'Schwelle' }], method, (v) => {
        if (v === 'karvonen' && !p.restHr) { toast('Für die HF-Reserve bitte zuerst den Ruhepuls eintragen', 'bad'); return; }
        if (v === 'lthr' && !p.lthr) { store.setProfile({ hrZoneMethod: 'lthr' }); refreshView(); return; }   // erst die Schwellen-HF eintragen
        saveZones({ hrZoneMethod: v });
      }),
    ]));
  }
  // Zonen aus der Schwellen-HF (TRAIN-51): aus einer Leistungsdiagnostik oder dem 30-Minuten-Feldtest.
  if (method === 'lthr') {
    card.appendChild(field('Schwellen-HF (bpm)', input({
      type: 'number', min: '100', max: '220', value: p.lthr || '', inputmode: 'numeric', placeholder: 'z. B. 168', 'aria-label': 'Schwellen-HF (bpm)',
      onchange: (e) => { const v = parseInt(e.target.value, 10); if (v >= 100 && v <= 220) saveZones({ lthr: v, hrZoneMethod: 'lthr' }); },
    })));
    card.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: 'Aus einer Leistungsdiagnostik (Laktat- oder Spiroergometrie-Schwelle) oder als Feldtest: nach dem Einlaufen 30 Minuten allein so schnell wie gleichmäßig möglich laufen – die Ø-HF der letzten 20 Minuten ist deine Schwellen-HF. Zonen nach Friel: Z2 85–89 %, Z4 95–99 % der Schwelle.' }));
  }
  if (!p.maxHr && estMax) {
    card.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => saveZones({ maxHr: estMax, maxHrEstimated: true }) },
      [icon('heart'), `Zonen aus dem Alter schätzen (HFmax ≈ ${estMax})`]));
  }
  if (p.maxHrEstimated || (!p.maxHr && estMax)) {
    card.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: 'Schätzung aus dem Alter (208 − 0,7 × Alter) – im Einzelfall oft 10 Schläge daneben. Ein harter Lauf mit Brustgurt oder ein Belastungstest liefert deine echte maximale Herzfrequenz.' }));
  }
  if (method === 'karvonen' && p.maxHr) {
    card.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: 'HF-Reserve (Karvonen): Ruhepuls + Anteil × (HFmax − Ruhepuls) – berücksichtigt deinen Ruhepuls.' }));
  }
  (p.hrZones || []).forEach((z) => card.appendChild(el('div', { class: 'row row--between', style: { padding: '6px 0', borderTop: '1px solid var(--border)' } }, [
    el('span', { class: 'row gap-2' }, [el('span', { class: 'zones-legend__sw', style: { background: z.color } }), `Z${z.zone} · ${z.name}`]),
    el('span', { class: 'num muted', text: `${z.min}–${z.max} bpm` }),
  ])));
  view.appendChild(card);

  /* ----- Pace-Bereiche ----- */
  if (p.paceZones) {
    view.appendChild(sectionHead('Trainingsbereiche (Pace)'));
    const pc = el('div', { class: 'card' });
    Object.entries(p.paceZones).forEach(([k, z], i) => pc.appendChild(el('div', { class: 'row row--between', style: { padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: z.label }), el('span', { class: 'num muted', text: fmtPaceRange(z.min, z.max) }),
    ])));
    view.appendChild(pc);
  }

  /* ----- Darstellung ----- */
  view.appendChild(sectionHead('Darstellung'));
  const disp = el('div', { class: 'card' });
  disp.appendChild(el('div', { class: 'row row--between wrap mb-4' }, [
    el('span', { text: 'Erscheinungsbild' }),
    segmented([{ value: 'system', label: 'System' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }], s.theme || 'system', (v) => { store.setSetting('theme', v); window.dispatchEvent(new Event('catofit:theme')); }),
  ]));
  disp.appendChild(el('div', { class: 'dim mb-2', style: { fontSize: '.74rem', fontWeight: '650' }, text: 'AKZENTFARBE' }));
  disp.appendChild(el('div', { class: 'row wrap gap-3' }, ACCENTS.map((c) => {
    const active = (s.accent || '#18b48a').toLowerCase() === c.toLowerCase();
    return el('button', {
      'aria-label': 'Akzent ' + c,
      style: { width: '38px', height: '38px', borderRadius: '50%', background: c, boxShadow: active ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : 'var(--shadow-1)' },
      onclick: () => { store.setSetting('accent', c); window.dispatchEvent(new Event('catofit:theme')); refreshView(); },
    });
  })));
  view.appendChild(disp);

  /* ----- Module ----- */
  view.appendChild(sectionHead('Module', null, { help: 'module' }));
  const mods = s.modules || {};
  const modList = el('div', { class: 'card' });
  // „Krafttraining“ gab es hier bis v3.20.0 als Schalter ohne jede Wirkung (DOC-15) – entfernt;
  // ein gespeicherter Wert stört nicht.
  [['nutrition', 'Ernährung'], ['shopping', 'Einkaufsliste'], ['checklist', 'Tages-Checkliste'], ['cycle', 'Zykluskalender'], ['labs', 'Labor & Ergänzung']].forEach(([k, label], i) => {
    modList.appendChild(el('div', { class: 'row row--between', style: { padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: label }),
      // Frische Module lesen (nicht den Render-Snapshot) -> mehrere Toggles überschreiben sich nicht.
      // catofit:nav blendet den Menüpunkt sofort ein/aus.
      toggle(mods[k] !== false, (v) => {
        store.setSetting('modules', { ...(store.settings().modules || {}), [k]: v });
        window.dispatchEvent(new Event('catofit:nav'));
      }, `Modul ${label}`),
    ]));
  });
  view.appendChild(modList);

  /* ----- Metriken ----- */
  view.appendChild(sectionHead('Sichtbare Körperwerte'));
  const me = s.metricsEnabled || {};
  const metList = el('div', { class: 'card' });
  [['weight', 'Gewicht'], ['bodyFat', 'Körperfett'], ['muscleMass', 'Muskelmasse'], ['leanMass', 'Fettfreie Masse'], ['visceralFat', 'Viszeralfett'], ['restingHr', 'Ruhepuls'], ['hrv', 'HRV'], ['vo2max', 'VO₂max'], ['sleepHours', 'Schlaf'], ['energy', 'Energie'], ['mood', 'Stimmung']].forEach(([k, label], i) => {
    metList.appendChild(el('div', { class: 'row row--between', style: { padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: label }),
      toggle(me[k] !== false, (v) => store.setSetting('metricsEnabled', { ...(store.settings().metricsEnabled || {}), [k]: v }), `${label} anzeigen`),
    ]));
  });
  view.appendChild(metList);

  /* ----- Standort & Wetter ----- */
  view.appendChild(sectionHead('Standort & Wetter'));
  const wcard = el('div', { class: 'card' });
  wcard.appendChild(el('div', { class: 'row row--between mb-4' }, [
    el('span', { text: 'Wetter im Plan anzeigen' }),
    toggle(s.weather !== false, (v) => store.setSetting('weather', v), 'Wetter im Plan anzeigen'),
  ]));
  const cityI = input({ value: s.location?.name || '', placeholder: 'Stadt, z. B. Dresden', 'aria-label': 'Ort suchen' });
  const hits = el('div', { class: 'col gap-2 mt-2', 'aria-live': 'polite' });
  // Treffer mit Region und Land zur Auswahl; erst der Tipp übernimmt den Ort (UI-40).
  const choose = async (g) => {
    store.setSetting('location', { name: g.name, region: g.region, country: g.country, lat: g.lat, lon: g.lon });
    try { await refreshWeather(g, true); } catch { /* Vorhersage kommt beim nächsten Start */ }
    toast(`Standort: ${placeLabel(g)}`, 'good');
    refreshView();
  };
  const searchBtn = el('button', {
    class: 'btn btn--soft', text: 'Suchen', type: 'button',
    onclick: async () => {
      const q = cityI.value.trim();
      if (!q) return;
      searchBtn.textContent = '…';
      hits.innerHTML = '';
      try {
        const list = await geocode(q);
        searchBtn.textContent = 'Suchen';
        if (!list.length) { toast('Ort nicht gefunden', 'bad'); return; }
        if (list.length === 1) { await choose(list[0]); return; }
        hits.appendChild(el('div', { class: 'dim', style: { fontSize: '.78rem' }, text: 'Welcher Ort ist gemeint?' }));
        list.forEach((g) => hits.appendChild(el('button', { class: 'btn btn--ghost btn--block', type: 'button', style: { justifyContent: 'flex-start' }, onclick: () => choose(g) }, [icon('mapPin'), placeLabel(g)])));
      } catch { toast('Wetterdienst nicht erreichbar', 'bad'); searchBtn.textContent = 'Suchen'; }
    },
  });
  wcard.appendChild(field('Standort für die Wettervorhersage', el('div', { class: 'row gap-2' }, [cityI, searchBtn])));
  wcard.appendChild(hits);
  if (s.location) wcard.appendChild(el('div', { class: 'dim', style: { fontSize: '.78rem' }, text: `Aktuell: ${placeLabel(s.location)}` }));
  wcard.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'Wetterdaten von Open-Meteo. Ohne Internet bleibt der zuletzt geladene Stand erhalten.' }));
  view.appendChild(wcard);

  /* ----- Einkauf ----- */
  view.appendChild(sectionHead('Einkauf'));
  view.appendChild(el('div', { class: 'card row row--between', style: { alignItems: 'center' } }, [
    el('div', {}, [
      el('div', { text: 'Einkaufstag (gemeinsam)' }),
      el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][store.familySettings().shoppingDay ?? 2] }),
    ]),
    store.isAdmin()
      ? el('button', { class: 'btn btn--ghost', onclick: () => navigate('#/familie-verwalten') }, 'Ändern')
      : el('span', { class: 'chip', text: 'nur Admin' }),
  ]));

  /* ----- Ernährung ----- */
  view.appendChild(sectionHead('Ernährung'));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('span', { text: 'Nährwerte online ergänzen' }),
      toggle(store.foodLookupEnabled(), (v) => store.setSetting('foodLookup', v), 'Nährwerte online ergänzen'),
    ]),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'An: Die „schätzen“-Hilfe beim Anlegen von Mahlzeiten fragt Kalorien und Eiweiß je Zutat bei Open Food Facts (offene Datenbank) nach. Dein Server schickt dabei nur den Zutatennamen dorthin; Ergebnisse werden auf dem Server zwischengespeichert. Aus: rein lokale Schätzung ohne Internet.' }),
    // Namensnennung laut Nutzungsbedingungen von Open Food Facts (DOC-16).
    el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, html: 'Nährwertdaten: <a href="https://openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> – Datenbank unter ODbL, Inhalte unter DbCL.' }),
  ]));

  /* ----- Verwaltung (nur Admin) – über dem Backup ----- */
  if (store.isAdmin()) {
    view.appendChild(sectionHead('Verwaltung (Admin)'));
    view.appendChild(el('button', { class: 'card card--link', style: { width: '100%', textAlign: 'left' }, onclick: () => navigate('#/familie-verwalten') }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { class: 'type-icon type-icon--lg', style: { background: 'var(--accent)' }, html: iconSvg('grid') }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'card__title', text: 'Team/Familie verwalten' }),
          el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: 'Mitglieder, Rollen, Einkaufstag & Dashboard-Kennzahlen.' }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
    ]));
  }

  /* ----- Daten ----- */
  view.appendChild(sectionHead('Daten & Sicherung', null, { help: 'backup' }));
  view.appendChild(el('div', { class: 'col gap-2' }, [
    el('button', { class: 'btn btn--soft btn--block', onclick: () => { syncNow().then(() => toast('Synchronisiert', 'good')); } }, [icon('refresh'), 'Jetzt synchronisieren']),
    el('button', { class: 'btn btn--ghost btn--block', onclick: exportData }, [icon('download'), 'Mein Backup exportieren (JSON)']),
    el('button', { class: 'btn btn--ghost btn--block', onclick: openCsvExport }, [icon('download'), 'Als Tabelle exportieren (CSV)']),
    el('button', { class: 'btn btn--ghost btn--block', onclick: importData }, [icon('upload'), 'Mein Backup importieren']),
    el('a', { class: 'btn btn--ghost btn--block', href: '#/import' }, [icon('activity'), 'Apple Health & Datei-Import']),
  ]));
  view.appendChild(el('p', { class: 'dim', style: { fontSize: '.78rem', marginTop: '4px' }, text: 'Dein persönliches Backup sichert deine eigenen Daten (inkl. Zyklus, Labor und Ergänzungen). Die Tabellen (CSV) sind zum Weiterarbeiten gedacht – wiederherstellen lässt sich nur das Backup.' }));
  if (!store.isManaging()) view.appendChild(readAccessCard());

  // Admin-Vollbackup: gesamte Familie sichern/wiederherstellen (autoritativ).
  if (store.isAdmin()) {
    view.appendChild(el('div', { class: 'card', style: { marginTop: '12px', borderColor: 'var(--accent-soft)' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '8px' } }, [
        el('span', { class: 'chip', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, text: 'Admin' }),
        el('strong', { text: 'Familien-Vollbackup' }),
      ]),
      el('p', { class: 'dim', style: { fontSize: '.8rem', lineHeight: '1.5' }, text: 'Sichert die gesamte Familie: alle Mitglieder, Rollen, Teams, Einstellungen und sämtliche Daten inkl. Urkunden/Reports. Aus Datenschutzgründen ohne die privaten Bereiche (Zyklus, Labor, Ergänzungen) – die sichert jedes Mitglied selbst.' }),
      el('div', { class: 'col gap-2', style: { marginTop: '8px' } }, [
        el('button', { class: 'btn btn--soft btn--block', onclick: exportFamilyData }, [icon('download'), 'Vollbackup exportieren']),
        el('button', { class: 'btn btn--danger btn--block', onclick: importFamilyData }, [icon('upload'), 'Vollbackup wiederherstellen (überschreibt alle)']),
      ]),
    ]));
  }

  /* ----- Über & Rechtliches ----- */
  view.appendChild(sectionHead('Über & Rechtliches'));
  const repo = 'https://github.com/Bingerminger/cat-o-fit';
  const legal = el('div', { class: 'card', style: { fontSize: '.8rem', lineHeight: '1.5' } }, [
    el('p', { class: 'dim', html: 'Cat-O-Fit ist <strong>quelloffen</strong> und steht unter der <strong>GNU AGPL v3.0 oder neuer</strong>. Deine Daten liegen auf diesem Gerät und auf deinem eigenen Server. Nur zwei abschaltbare Zusatzdienste gehen ins Internet: die Wetterabfrage bei Open-Meteo (direkt vom Gerät, mit Ort bzw. Koordinaten) und – falls eingeschaltet – die Nährwertsuche bei Open Food Facts (vom Server, nur mit dem Zutatennamen).' }),
    el('p', { class: 'dim mt-2', html: 'Wetterdaten von <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0; die kostenlose Schnittstelle ist nur für nicht-kommerzielle Nutzung). Nährwertdaten von <a href="https://openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL/DbCL). Genannte Marken (z. B. VDOT, Hyrox, Apple Health, Garmin, Strava, Synology) gehören ihren jeweiligen Inhabern und werden nur beschreibend genannt.' }),
    el('div', { class: 'row gap-2 mt-2', style: { flexWrap: 'wrap' } }, [
      ['Lizenz', `${repo}/blob/main/LICENSE`],
      ['Danksagungen', `${repo}/blob/main/CREDITS.md`],
      ['Markenhinweise', `${repo}/blob/main/TRADEMARKS.md`],
      ['Quellcode', repo],
    ].map(([label, href]) => el('a', { class: 'btn btn--ghost', style: { fontSize: '.78rem', padding: '.4rem .7rem' }, href, target: '_blank', rel: 'noopener', text: label }))),
  ]);
  view.appendChild(legal);

  // App-Reset bewusst als ALLERLETZTE Aktion (destruktiv) – Gefahrenzone ganz unten.
  if (store.isAdmin()) {
    view.appendChild(el('div', { class: 'card card--flat mt-4' }, [
      el('button', { class: 'btn btn--ghost btn--block', style: { color: 'var(--bad-text)' }, onclick: openResetSheet }, [icon('trash'), 'App zurücksetzen / leeren']),
      el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'Löscht ALLE Mitglieder und Daten unwiderruflich und startet die Ersteinrichtung neu.' }),
    ]));
  }

  view.appendChild(el('p', { class: 'dim center mt-6', style: { fontSize: '.76rem' }, text: `Cat-O-Fit · Trainingsplanung für die ganze Familie · v${APP_VERSION}` }));
  view.insertBefore(jumpNav(view), view.firstChild);
}

/**
 * Sprungleiste über den Einstellungen: Konto · Profil · Ziele · Training · Darstellung ·
 * Module · Daten – vorher 6,3 Bildschirmhöhen ohne Orientierung, „Backup“ oder „Module“
 * fand man nur durch Scrollen (UI-15).
 */
function jumpNav(view) {
  const GROUPS = [['Konto', 'Konto'], ['Profil', 'Profil'], ['Wochenziele', 'Ziele'], ['Herzfrequenz-Zonen', 'Training'],
    ['Darstellung', 'Darstellung'], ['Module', 'Module'], ['Daten & Sicherung', 'Daten & Backup']];
  // [...] – im Browser eine NodeList (ohne find), im Test-DOM ein Array.
  const heads = [...view.querySelectorAll('.section-head')];
  const find = (title) => heads.find((h) => ([...h.querySelectorAll('.section-head__title')][0] || {}).textContent === title);
  return el('nav', { class: 'jump-nav', 'aria-label': 'Abschnitte der Einstellungen' },
    GROUPS.map(([title, label]) => [find(title), label]).filter(([h]) => h).map(([h, label]) => el('button', {
      class: 'chip chip--btn', type: 'button', text: label,
      onclick: () => { try { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { h.scrollIntoView(); } },
    })));
}

/** Abgrenzung (Gate) und „Kalorienzahlen ausblenden“ – ein Status für die ganze App. */
function eligibilityCard(elig, s, onChange) {
  let status;
  if (elig.minor) {
    status = `Kinder- und Jugendprofil${elig.age != null ? ` (laut Geburtsjahr ${elig.age} Jahre)` : ''}: keine Kalorien- und Gewichtsziele, kein Abnehmprogramm, keine Leistungspräparate, Laborwerte nur dokumentiert.`;
  } else if (!elig.answered) {
    status = 'Noch nicht beantwortet – bis dahin rechnet Cat-O-Fit keine Abnehmziele.';
  } else if (elig.mode === 'full') {
    status = 'Beantwortet: Nichts davon trifft zu.';
  } else {
    status = `Beantwortet: ${elig.reasons.join(' · ')}. ${elig.noWeightGoals ? 'Keine Abnehm- oder Defizitziele; ' : ''}Labor und Ergänzung nur dokumentierend.`;
  }
  return el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'flex-start', gap: '12px' } }, [
      el('div', {}, [
        el('div', { text: 'Abgrenzung' }),
        el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '2px' }, text: status }),
      ]),
      el('button', { class: 'btn btn--ghost', style: { flex: '0 0 auto' }, onclick: () => openGateSheet({ onSaved: onChange }) }, Object.keys(s.labsGate || {}).length ? 'Ändern' : 'Beantworten'),
    ]),
    el('div', { class: 'row row--between mt-3', style: { alignItems: 'center', gap: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' } }, [
      el('div', {}, [
        el('div', { text: 'Kalorienzahlen ausblenden' }),
        el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: elig.minor
          ? 'Im Kinder- und Jugendprofil immer ausgeblendet.'
          : 'Blendet kcal-Angaben in Ernährung, auf „Heute“ und bei der Energieversorgung aus – für alle, denen Zahlen beim Essen nicht guttun. Erfassen kannst du weiterhin alles.' }),
      ]),
      elig.minor
        ? el('span', { class: 'chip', text: 'immer' })
        : toggle(s.hideCalorieNumbers === true, (v) => { store.setSetting('hideCalorieNumbers', v); toast(v ? 'Kalorienzahlen ausgeblendet' : 'Kalorienzahlen sichtbar', 'good'); }, 'Kalorienzahlen ausblenden'),
    ]),
    el('div', { class: 'dim mt-3', style: { fontSize: '.74rem', paddingTop: '10px', borderTop: '1px solid var(--border)' }, text: 'Cat-O-Fit dient der Dokumentation und allgemeinen Information für gesunde Erwachsene – kein Medizinprodukt, keine Diagnose, keine Therapie.' }),
  ]);
}

/* App-Reset: löscht alles (Server & lokal) und führt zur Ersteinrichtung. Tippe-Bestätigung. */
function openResetSheet() {
  const inp = input({ type: 'text', placeholder: 'LÖSCHEN', maxlength: '12', autocomplete: 'off' });
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true, text: 'Bitte „LÖSCHEN“ eintippen, um zu bestätigen.' });
  let busy = false;
  const doReset = async () => {
    if (busy) return;
    if (inp.value.trim().toUpperCase() !== 'LÖSCHEN') { err.hidden = false; inp.focus(); return; }
    // Der Server löscht nur für eine angemeldete Admin-Person – ohne ihn bliebe alles dort liegen.
    if (!store.serverSessionActive()) {
      toast('Zum Zurücksetzen braucht die App eine Verbindung zum Server und deine Anmeldung mit PIN.', 'bad', 5000);
      return;
    }
    busy = true;
    try { await store.resetApp(); } catch { /* trotzdem neu starten */ }
    location.hash = '#/login';
    location.reload();   // sauberer Neustart in die Ersteinrichtung
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doReset(); });
  const body = el('div', { class: 'col gap-3' }, [
    el('div', { class: 'muted', style: { lineHeight: '1.5' }, text: 'Das entfernt ALLE Mitglieder, Trainings, Pläne, Werte und Einstellungen – auf diesem Gerät und auf dem Server. Es lässt sich nicht rückgängig machen. Danach startet die Ersteinrichtung.' }),
    el('label', { class: 'field__label', text: 'Zur Bestätigung „LÖSCHEN“ eingeben' }), inp, err,
    el('button', { class: 'btn btn--danger btn--block', onclick: doReset }, [icon('trash'), 'Alles löschen und zurücksetzen']),
  ]);
  openSheet({ title: 'App zurücksetzen', body });
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
  const targetI = input({ type: 'number', step: '0.1', inputmode: 'decimal', placeholder: 'Zielwert' });
  const deadlineI = input({ type: 'date' });
  const hint = el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' } });
  // HRV-Ziele gelten für eine Messart (die des jüngsten Werts) – SDNN und RMSSD sind nicht vergleichbar.
  const hrvMethod = currentHrvMethod(store.get('health'));
  function updateHint() {
    const cur = latestMetric(metric, { profile: store.profile(), health: store.get('health'), hrvMethod });
    const m = metricMeta(metric);
    const how = metric === 'hrv' && hrvMethod && hrvMethod !== 'unbekannt' ? ` (${hrvLabel(hrvMethod)} – das Ziel zählt nur Werte dieser Messart)` : '';
    hint.textContent = cur != null
      ? `Aktuell: ${cur}${m.unit ? ' ' + m.unit : ''}${how} – wird als Startpunkt gemerkt, der Fortschritt zählt von hier zum Ziel.`
      : 'Noch kein Messwert erfasst – trage zuerst Körperwerte ein, damit der Fortschritt zählt.';
  }
  updateHint();
  // Riskante Ziele: Hinweis direkt im Sheet, erst der zweite Tipp legt an (eine Rückfrage
  // als eigenes Sheet würde dieses schließen und die Eingaben verwerfen).
  const warnBox = warningBox();
  const createBtn = el('button', { class: 'btn btn--primary grow', text: 'Anlegen' });
  const confirm = pendingConfirm(warnBox, createBtn, 'Anlegen', 'Trotzdem anlegen');
  targetI.addEventListener('input', confirm.reset);
  metricSel.addEventListener('change', confirm.reset);
  createBtn.onclick = () => {
    const target = parseFloat(String(targetI.value).replace(',', '.'));
    if (!Number.isFinite(target)) { toast('Bitte einen Zielwert eingeben', 'bad'); return; }
    const profile = store.profile();
    if (!confirm.ok(goalWarning(metric, target, profile))) return;
    const start = latestMetric(metric, { profile, health: store.get('health'), hrvMethod });
    const goal = { id: uid('goal'), metric, target, start, deadline: deadlineI.value || null, createdAt: nowIso() };
    if (metric === 'hrv' && hrvMethod) goal.hrvMethod = hrvMethod;
    const list = [...((store.settings().healthGoals) || []), goal];
    store.setSetting('healthGoals', list);
    closeSheet(); toast('Ziel angelegt', 'good'); rerender(view);
  };
  openSheet({
    title: 'Neues Gesundheitsziel',
    body: el('div', {}, [
      field('Metrik', metricSel),
      field('Zielwert', targetI),
      field('Zieldatum (optional)', deadlineI),
      hint,
      warnBox,
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
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
      const who = profile.sex === 'm' ? 'bei Männern' : profile.sex === 'w' ? 'bei Frauen' : 'bei Frauen (bei Männern unter etwa 5 %)';
      return `Ein Körperfettanteil unter etwa ${floor} % liegt ${who} im Bereich des lebensnotwendigen Fetts – das ist gesundheitlich riskant, auch für Hormone und Knochen. Besprich ein solches Ziel besser ärztlich.`;
    }
  }
  return null;
}

/** Hinweis, wenn das Zielgewicht einem BMI unter 18,5 entspricht (oder null). */
function targetWeightWarning(target, profile = {}) {
  const bmi = bmiFor(target, profile);
  if (bmi == null || bmi >= 18.5) return null;
  return `Das Zielgewicht entspricht bei ${profile.heightCm} cm einem BMI von ${fmtDec(bmi)} – unter 18,5 gilt als Untergewicht. Cat-O-Fit rechnet dafür kein Defizit, sondern empfiehlt, das Gewicht zu halten.`;
}

/**
 * PIN ändern. Die eigene nur mit der bisherigen PIN (schützt vor einer fremden, noch
 * offenen Sitzung am geteilten Gerät); beim Verwalten setzt eine Admin-Person die PIN
 * des Mitglieds neu. Die neue PIN immer zweimal. Entfernen geht nicht – die PIN ist Pflicht.
 */
function openPinSheet(member) {
  const self = member.id === store.identityId();
  const pinInput = (placeholder) => el('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder, 'aria-label': placeholder });
  const oldI = self && store.memberHasPin(member.id) ? pinInput('bisherige PIN') : null;
  const newI = pinInput('neue PIN');
  const new2I = pinInput('neue PIN wiederholen');
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true });
  const showErr = (msg, field) => { err.textContent = msg; err.hidden = false; if (field) { field.value = ''; field.focus(); } };
  let busy = false;
  const save = async () => {
    if (busy) return;
    const pin = newI.value.trim();
    const problem = store.pinProblem(pin);
    if (problem) { showErr(problem, newI); return; }
    if (pin !== new2I.value.trim()) { showErr('Die beiden neuen PINs stimmen nicht überein.', new2I); return; }
    busy = true;
    const r = await store.setMemberPin(member.id, pin, oldI ? oldI.value.trim() : null);
    busy = false;
    if (!r.ok) {
      if (r.code === 'pin') showErr(r.left ? `Die bisherige PIN stimmt nicht (noch ${r.left} Versuch${r.left === 1 ? '' : 'e'}).` : 'Die bisherige PIN stimmt nicht.', oldI);
      else showErr(r.message || 'Die PIN wurde nicht gespeichert.');
      return;
    }
    closeSheet();
    toast(self ? 'PIN geändert' : `PIN für ${member.name} neu gesetzt`, 'good');
    refreshView();   // Hinweise neu zeichnen
  };
  [oldI, newI, new2I].filter(Boolean).forEach((f, i, all) => f.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (all[i + 1]) all[i + 1].focus(); else save();
  }));
  const body = el('div', { class: 'pin-dialog' }, [
    el('div', { class: 'pin-dialog__name', style: { textAlign: 'center' }, text: self ? `PIN für ${member.name}` : `Neue PIN für ${member.name}` }),
    oldI, newI, new2I,
    el('div', { class: 'muted', style: { fontSize: '.8rem', textAlign: 'center' }, text: '4 bis 8 Ziffern, nicht 0000. Zum Ändern braucht die App eine Verbindung zum Server.' }),
    err,
    el('button', { class: 'btn btn--primary btn--block', onclick: save }, [icon('check'), 'Speichern']),
  ]);
  openSheet({ title: 'PIN', body });
  setTimeout(() => (oldI || newI).focus(), 120);
}

/* ------------------------------- Profil-Sheet --------------------------- */
function openProfileSheet() {
  const p = store.profile();
  const nameI = input({ value: p.name || '' });
  const hI = input({ type: 'number', value: p.heightCm || '', inputmode: 'numeric' });
  const wI = input({ type: 'number', step: '0.1', value: p.weightKg || '', inputmode: 'decimal' });
  const twI = input({ type: 'number', step: '0.1', value: p.targetWeightKg || '', inputmode: 'decimal' });
  const byI = input({ type: 'number', value: p.birthYear || '', inputmode: 'numeric', placeholder: 'Jahr' });
  const sexI = select([{ value: '', label: 'keine Angabe' }, { value: 'w', label: 'weiblich' }, { value: 'm', label: 'männlich' }], p.sex || '');
  const goalsI = textarea({ value: (p.goals || []).join('\n'), placeholder: 'Ein Ziel pro Zeile' });

  // Zielgewicht: für Kinder und Jugendliche nicht angeboten; bei Schwangerschaft/Essstörung mit Hinweis.
  const gate = store.settings().labsGate || {};
  const isMinor = () => {
    const age = ageOf({ birthYear: parseInt(byI.value) || null }, todayStr());
    return age != null ? age < 18 : gate.minor === true;
  };
  const twField = field('Zielgewicht (kg)', twI);
  const twNote = el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '-4px', marginBottom: '8px' } });
  const syncTarget = () => {
    const minor = isMinor();
    twField.hidden = minor;
    const block = minor
      ? 'Für Kinder und Jugendliche gibt es kein Zielgewicht – wichtig ist, genug und abwechslungsreich zu essen.'
      : weightGoalBlockReason(currentEligibility());
    twNote.textContent = block || '';
    twNote.hidden = !block;
  };
  byI.addEventListener('input', syncTarget);
  syncTarget();

  // Zielgewicht unter BMI 18,5: Hinweis im Sheet, erst der zweite Tipp speichert.
  const warnBox = warningBox();
  const saveBtn = el('button', { class: 'btn btn--primary grow', text: 'Speichern' });
  const confirm = pendingConfirm(warnBox, saveBtn, 'Speichern', 'Trotzdem speichern');
  [twI, hI, byI].forEach((i) => i.addEventListener('input', confirm.reset));

  openSheet({
    title: 'Profil bearbeiten',
    body: el('div', {}, [
      field('Name', nameI),
      el('div', { class: 'field__row' }, [field('Größe (cm)', hI), field('Geburtsjahr', byI)]),
      el('div', { class: 'field__row' }, [field('Gewicht (kg)', wI), twField]),
      twNote,
      warnBox,
      field('Geschlecht', sexI),
      el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '-4px', marginBottom: '8px' }, text: 'Für die Grundumsatz-Berechnung der Kalorienbilanz (optional).' }),
      field('Ziele', goalsI),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
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
    closeSheet(); toast('Profil gespeichert', 'good'); refreshView();
  };
}

async function exportData() {
  try {
    const name = `catofit-backup-${todayStr()}.json`;
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
    const res = await saveFile(name, blob);
    if (res === 'cancelled') { toast('Backup nicht gesichert'); return; }
    alertDialog({ title: 'Backup bereitgestellt', tone: 'good', message: savedFileMessage(res, name) });
  } catch (e) {
    alertDialog({ title: 'Backup fehlgeschlagen', tone: 'bad', message: e.message || 'Das Backup konnte nicht erstellt werden.' });
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
        el('div', { style: { fontWeight: '650', fontSize: '.92rem' }, text: 'Lesezugang für eigene Werkzeuge' }),
        el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '2px' }, text: 'Zum Beispiel für einen KI-Assistenten, den du selbst betreibst: Er kann deine Trainings, Pläne, Körperwerte und Ernährung lesen – nie schreiben. Zyklus, Labor und Ergänzungen sind nicht dabei. Cat-O-Fit selbst nutzt keine KI.' }),
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
      }, 'Lesezugang erlauben'),
    ]));
    if (!token) return;
    const url = `${new URL('api/api.php', location.href.split('#')[0]).href}?action=read&user=${encodeURIComponent(store.activeUserId())}`;
    const urlI = input({ value: url }); urlI.readOnly = true;
    const tokI = input({ value: token, type: 'password' }); tokI.readOnly = true;
    const copy = async (text, field, what) => {
      try { await navigator.clipboard.writeText(text); toast(`${what} kopiert`, 'good'); } catch { field.type = 'text'; field.select(); toast('Manuell kopieren (⌘/Strg+C)'); }
    };
    wrap.appendChild(el('div', { class: 'field__label mt-3', text: 'Adresse' }));
    wrap.appendChild(el('div', { class: 'row gap-2' }, [urlI, el('button', { class: 'btn btn--soft', 'aria-label': 'Adresse kopieren', onclick: () => copy(url, urlI, 'Adresse') }, icon('link'))]));
    wrap.appendChild(el('div', { class: 'field__label mt-3', text: 'Schlüssel (als Header „X-Catofit-Token“)' }));
    wrap.appendChild(el('div', { class: 'row gap-2' }, [tokI, el('button', { class: 'btn btn--soft', 'aria-label': 'Schlüssel kopieren', onclick: () => copy(token, tokI, 'Schlüssel') }, icon('link'))]));
    wrap.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: 'Optional „&areas=sessions,health“ und „&from=2026-01-01“ anhängen. Wer den Schlüssel kennt, kann diese Daten lesen – gib ihn nur Werkzeugen, denen du vertraust. Ausschalten macht ihn sofort ungültig.' }));
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
      if (res === 'cancelled') { toast(`${label} nicht exportiert`); return; }
      alertDialog({ title: `${label} bereitgestellt`, tone: 'good', message: savedFileMessage(res, name) });
    } catch (e) {
      alertDialog({ title: 'Export fehlgeschlagen', tone: 'bad', message: e.message || 'Die Tabelle konnte nicht erstellt werden.' });
    }
  };
  const count = (area) => store.get(area).filter((x) => x && !x.deleted && !x._kind).length;
  actionSheet('Als Tabelle exportieren', [
    { icon: 'activity', label: 'Trainings', hint: `${count('sessions')} Einträge · Dauer, Strecke, Herzfrequenz, Belastung`, onClick: () => save('Trainings', 'trainings', sessionsCsv(store.get('sessions'))) },
    { icon: 'heart', label: 'Körperwerte', hint: `${count('health')} Tage · Gewicht, Ruhepuls, HRV, Schlaf …`, onClick: () => save('Körperwerte', 'koerperwerte', healthCsv(store.get('health'))) },
    { icon: 'flask', label: 'Laborwerte', hint: `${count('labs')} Messungen · mit dem Referenzbereich deines Labors`, onClick: () => save('Laborwerte', 'laborwerte', labsCsv(store.get('labs'))) },
    { icon: 'utensils', label: 'Ess-Tagebuch', hint: `${count('diary')} Einträge · kcal und Eiweiß`, onClick: () => save('Ess-Tagebuch', 'ess-tagebuch', diaryCsv(store.get('diary'))) },
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
      catch { await alertDialog({ title: 'Import fehlgeschlagen', tone: 'bad', message: 'Die Datei ist kein gültiges JSON.' }); return; }

      const me = store.activeMember();
      const foreign = dump && dump.user && me && dump.user !== me.id;
      const who = (dump && dump.userName) ? `„${dump.userName}“` : 'einem anderen Profil';
      const msg = foreign
        ? `Dieses Backup stammt von ${who}. Es in dein Profil${me ? ` „${me.name}“` : ''} einzuspielen, überschreibt deine vorhandenen Daten.`
        : 'Vorhandene Daten in diesem Profil werden überschrieben.';
      const ok = await confirmDialog({ title: 'Backup einspielen?', message: msg, confirmLabel: 'Einspielen', danger: true });
      if (!ok) return;

      try {
        const res = store.importAll(dump);
        const n = res.imported.length;
        const skip = res.skipped.length ? `, ${res.skipped.length} übersprungen` : '';
        const priv = (res.privateSkipped || []).length
          ? ' Private Bereiche (Zyklus, Labor, Ergänzung) des Mitglieds bleiben beim Verwalten unangetastet.' : '';
        await alertDialog({ title: 'Backup eingespielt', tone: 'good', message: `${n} Bereich${n === 1 ? '' : 'e'} wiederhergestellt${skip}.${priv} Die App wird jetzt neu geladen.` });
        location.reload();
      } catch (e) {
        await alertDialog({ title: 'Import fehlgeschlagen', tone: 'bad', message: e.message || 'Das Backup konnte nicht eingespielt werden.' });
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
  catch (e) { await alertDialog({ title: 'Vollbackup fehlgeschlagen', tone: 'bad', message: e.message || 'Das Vollbackup konnte nicht erstellt werden.' }); return; }
  try {
    const n = Object.keys(dump.users || {}).length;
    const name = `catofit-familienbackup-${todayStr()}.json`;
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const res = await saveFile(name, blob);
    if (res === 'cancelled') { toast('Vollbackup nicht gesichert'); return; }
    await alertDialog({ title: 'Vollbackup bereitgestellt', tone: 'good', message: `Die gesamte Familie (${n} Mitglied${n === 1 ? '' : 'er'}) ohne private Zyklusdaten. ${savedFileMessage(res, name)}` });
  } catch (e) {
    await alertDialog({ title: 'Vollbackup fehlgeschlagen', tone: 'bad', message: e.message || 'Die Datei konnte nicht bereitgestellt werden.' });
  }
}

function importFamilyData() {
  // Die Familie ersetzt der Server nur für eine angemeldete Admin-Person – ohne sie
  // käme nur ein Teil der Wiederherstellung an.
  if (!store.serverSessionActive()) {
    alertDialog({ title: 'Verbindung zum Server nötig', tone: 'bad', message: 'Ein Vollbackup lässt sich nur mit Verbindung zum Server wiederherstellen. Bitte ab- und mit PIN wieder anmelden, sobald der Server erreichbar ist.' });
    return;
  }
  const inp = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let dump;
      try { dump = JSON.parse(reader.result); }
      catch { await alertDialog({ title: 'Wiederherstellung fehlgeschlagen', tone: 'bad', message: 'Die Datei ist kein gültiges JSON.' }); return; }
      if (!dump || dump.kind !== 'family-full') {
        await alertDialog({ title: 'Falsche Datei', tone: 'bad', message: 'Das ist kein Familien-Vollbackup. Für ein persönliches Backup nutze „Mein Backup importieren“.' }); return;
      }
      const n = dump.users ? Object.keys(dump.users).length : 0;
      const when = dump.exportedAt ? new Date(dump.exportedAt).toLocaleString('de-DE') : 'unbekannt';
      const ok = await confirmDialog({
        title: 'Komplette Familie wiederherstellen?',
        message: `Dieses Vollbackup (${n} Mitglied${n === 1 ? '' : 'er'}, erstellt am ${when}) überschreibt ALLE Mitglieder, Rollen, Teams, Einstellungen und Daten – auf diesem Gerät und auf dem Server. Private Bereiche (Zyklus, Labor, Ergänzungen) und die PINs bleiben unangetastet. Das lässt sich nicht rückgängig machen.`,
        confirmLabel: 'Alles wiederherstellen', danger: true,
      });
      if (!ok) return;
      try {
        const res = await store.importFamilyAll(dump);
        const who = `${res.users} Mitglied${res.users === 1 ? '' : 'er'}`;
        if (res.pending > 0) {
          await alertDialog({
            title: 'Wiederherstellung noch nicht vollständig', tone: 'bad',
            message: `${who}: ${res.areas - res.pending} von ${res.areas} Bereichen sind auf dem Server. ${res.pending} Bereich${res.pending === 1 ? '' : 'e'} konnte${res.pending === 1 ? '' : 'n'} noch nicht gesendet werden – sie sind auf diesem Gerät gesichert und werden automatisch nachgereicht, sobald der Server erreichbar ist. Neuere Eingaben der Mitglieder werden dabei nicht überschrieben. Die App wird jetzt neu geladen.`,
          });
        } else {
          await alertDialog({ title: 'Familie wiederhergestellt', tone: 'good', message: `${who} und ${res.areas} Bereiche wurden wiederhergestellt und sind auf dem Server. Die App wird jetzt neu geladen.` });
        }
        location.reload();
      } catch (e) {
        await alertDialog({ title: 'Wiederherstellung fehlgeschlagen', tone: 'bad', message: e.message || 'Das Vollbackup konnte nicht eingespielt werden.' });
      }
    };
    reader.readAsText(f);
  });
  document.body.appendChild(inp); inp.click(); inp.remove();
}

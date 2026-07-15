/* =========================================================================
   settings.js — Profil & Einstellungen: Werte, HF-Zonen, Darstellung,
   Module, Metriken, Backup (Export/Import), Sync.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, toggle, segmented, field, input, textarea, select,
  openSheet, closeSheet, confirmDialog, alertDialog, toast, sectionHead, fmtPaceRange, todayStr,
  uid, nowIso, fmtDate,
} from './ui.js';
import { setHeader } from './router.js';
import { syncNow } from './storage.js';
import { geocode, refreshWeather } from './weather.js';
import { APP_VERSION } from './version.js';
import { weeklyGoals, DEFAULT_GOALS } from './healthgoals.js';
import { GOAL_METRICS, metricMeta, latestMetric } from './goals.js';

const ACCENTS = ['#18b48a', '#2bb673', '#19b9c9', '#3d8bff', '#7c5cff', '#ff5d8f', '#ff8a3d', '#f5b300'];

function recalcZones(maxHr) {
  const defs = [[50, 60, 'Regeneration', '#7fb8ff'], [60, 70, 'Grundlage (GA1)', '#43c59e'], [70, 80, 'Tempo (GA2)', '#f5c451'], [80, 90, 'Schwelle', '#f59145'], [90, 100, 'VO2max', '#ef5d6c']];
  return defs.map(([a, b, name, color], i) => ({ zone: i + 1, name, minPct: a, maxPct: b, min: Math.round(maxHr * a / 100), max: Math.round(maxHr * b / 100), color }));
}

export function render(view) {
  setHeader({ title: 'Einstellungen' });
  const p = store.profile();
  const s = store.settings();

  /* ----- Konto & Familie ----- */
  const acct = store.activeMember();
  if (acct) {
    view.appendChild(sectionHead('Konto'));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
        el('span', { class: 'member-card__avatar', style: { width: '44px', height: '44px', fontSize: '1.4rem', background: (acct.color || 'var(--accent)') + '22', color: acct.color || 'var(--accent)' }, text: acct.emoji || '🏃' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'card__title', text: acct.name }),
          el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: acct.role === 'admin' ? 'Administrator:in' : 'Mitglied' }),
        ]),
      ]),
      el('div', { class: 'row gap-2 mt-3' }, [
        el('button', { class: 'btn btn--ghost grow', onclick: () => openPinSheet(acct) }, store.memberHasPin(acct.id) ? '🔒 PIN ändern' : '🔒 PIN festlegen'),
        el('button', { class: 'btn btn--ghost grow', onclick: async () => { await store.logout(); navigate('#/login'); } }, [icon('arrowLeft'), 'Abmelden']),
      ]),
    ]));

    // Feinere Sichtbarkeit im Team/Familie-Dashboard (Zyklus bleibt unabhängig davon immer privat).
    view.appendChild(sectionHead('Sichtbarkeit im Team/Familie-Dashboard'));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'muted mb-2', style: { fontSize: '.8rem' }, text: 'Was die anderen von dir im gemeinsamen Dashboard sehen. Dein Name und Avatar bleiben für die Anmeldung sichtbar; Zyklusdaten sind ohnehin immer privat.' }),
      el('div', { class: 'row row--between', style: { padding: '8px 0' } }, [
        el('span', { text: 'Mein Hauptziel zeigen' }),
        toggle(s.shareGoal !== false, (v) => store.setSetting('shareGoal', v)),
      ]),
      el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
        el('span', { text: 'Meine Kennzahlen zeigen (Momentum, km, Serie)' }),
        toggle(s.shareMetrics !== false, (v) => store.setSetting('shareMetrics', v)),
      ]),
    ]));
  }

  /* ----- Profil ----- */
  view.appendChild(sectionHead('Profil'));
  view.appendChild(el('button', { class: 'card card--link', style: { width: '100%', textAlign: 'left' }, onclick: () => openProfileSheet() }, [
    el('div', { class: 'row gap-3' }, [
      el('span', { class: 'type-icon type-icon--lg', style: { background: 'var(--accent)' }, html: iconSvg('user') }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: p.name || 'Profil' }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `${p.heightCm || '–'} cm · ${p.weightKg || '–'} kg · Ziel ${p.targetWeightKg || '–'} kg` }),
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
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'An den WHO-Empfehlungen orientiert (≥ 150 min Bewegung pro Woche). Der Fortschritt erscheint als Ringe auf „Heute".' }),
  ]));

  /* ----- Gesundheitsziele (Zielwerte mit Fortschritt) ----- */
  view.appendChild(sectionHead('Gesundheitsziele', { label: '+ Ziel', onClick: () => openGoalSheet(view) }));
  const goals = (p.settings && p.settings.healthGoals) || [];
  const goalsCard = el('div', { class: 'card' });
  if (!goals.length) {
    goalsCard.appendChild(el('div', { class: 'dim', style: { fontSize: '.84rem' }, text: 'Noch keine Ziele. Lege z. B. ein Gewichts-, Ruhepuls- oder VO₂max-Ziel an – der Fortschritt erscheint auf „Heute".' }));
  } else {
    goals.forEach((g, i) => {
      const m = metricMeta(g.metric); const unit = m && m.unit ? ' ' + m.unit : '';
      goalsCard.appendChild(el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: '650', fontSize: '.9rem' }, text: (m && m.label) || g.metric }),
          el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: `Ziel ${g.target}${unit}${g.deadline ? ` · bis ${fmtDate(g.deadline)}` : ''}` }),
        ]),
        el('button', {
          class: 'icon-btn', 'aria-label': 'Ziel entfernen',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Ziel entfernen?', message: `„${(m && m.label) || g.metric}" wirklich löschen?`, confirmLabel: 'Entfernen', danger: true });
            if (ok) { store.setSetting('healthGoals', goals.filter((x) => x.id !== g.id)); render(view); }
          },
        }, icon('trash')),
      ]));
    });
  }
  view.appendChild(goalsCard);

  /* ----- Herzfrequenz-Zonen ----- */
  view.appendChild(sectionHead('Herzfrequenz-Zonen'));
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'field__row' }, [
    field('Max. HF', input({ type: 'number', value: p.maxHr || '', inputmode: 'numeric', onchange: (e) => { const mh = parseInt(e.target.value) || 190; store.setProfile({ maxHr: mh, hrZones: recalcZones(mh) }); toast('Zonen aktualisiert'); setTimeout(() => location.reload(), 60); } })),
    field('Ruhepuls', input({ type: 'number', value: p.restHr || '', inputmode: 'numeric', onchange: (e) => store.setProfile({ restHr: parseInt(e.target.value) || 55 }) })),
  ]));
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
      onclick: () => { store.setSetting('accent', c); window.dispatchEvent(new Event('catofit:theme')); setTimeout(() => location.reload(), 50); },
    });
  })));
  view.appendChild(disp);

  /* ----- Module ----- */
  view.appendChild(sectionHead('Module'));
  const mods = s.modules || {};
  const modList = el('div', { class: 'card' });
  [['nutrition', 'Ernährung'], ['shopping', 'Einkaufsliste'], ['checklist', 'Tages-Checkliste'], ['strength', 'Krafttraining'], ['cycle', 'Zykluskalender']].forEach(([k, label], i) => {
    modList.appendChild(el('div', { class: 'row row--between', style: { padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: label }),
      // Frische Module lesen (nicht den Render-Snapshot) -> mehrere Toggles überschreiben sich nicht.
      // catofit:nav blendet den Menüpunkt sofort ein/aus.
      toggle(mods[k] !== false, (v) => {
        store.setSetting('modules', { ...(store.settings().modules || {}), [k]: v });
        window.dispatchEvent(new Event('catofit:nav'));
      }),
    ]));
  });
  view.appendChild(modList);

  /* ----- Metriken ----- */
  view.appendChild(sectionHead('Sichtbare Körperwerte'));
  const me = s.metricsEnabled || {};
  const metList = el('div', { class: 'card' });
  [['weight', 'Gewicht'], ['bodyFat', 'Körperfett'], ['muscleMass', 'Muskelmasse'], ['visceralFat', 'Viszeralfett'], ['restingHr', 'Ruhepuls'], ['hrv', 'HRV'], ['vo2max', 'VO₂max'], ['sleepHours', 'Schlaf'], ['energy', 'Energie'], ['mood', 'Stimmung']].forEach(([k, label], i) => {
    metList.appendChild(el('div', { class: 'row row--between', style: { padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('span', { text: label }),
      toggle(me[k] !== false, (v) => store.setSetting('metricsEnabled', { ...(store.settings().metricsEnabled || {}), [k]: v })),
    ]));
  });
  view.appendChild(metList);

  /* ----- Standort & Wetter ----- */
  view.appendChild(sectionHead('Standort & Wetter'));
  const wcard = el('div', { class: 'card' });
  wcard.appendChild(el('div', { class: 'row row--between mb-4' }, [
    el('span', { text: 'Wetter im Plan anzeigen' }),
    toggle(s.weather !== false, (v) => store.setSetting('weather', v)),
  ]));
  const cityI = input({ value: s.location?.name || '', placeholder: 'Stadt, z. B. Dresden' });
  const searchBtn = el('button', {
    class: 'btn btn--soft', text: 'Suchen',
    onclick: async () => {
      const q = cityI.value.trim();
      if (!q) return;
      searchBtn.textContent = '…';
      try {
        const g = await geocode(q);
        if (!g) { toast('Ort nicht gefunden', 'bad'); searchBtn.textContent = 'Suchen'; return; }
        store.setSetting('location', g);
        await refreshWeather(g, true);
        toast(`Standort: ${g.name}`, 'good');
        setTimeout(() => location.reload(), 80);
      } catch { toast('Wetterdienst nicht erreichbar', 'bad'); searchBtn.textContent = 'Suchen'; }
    },
  });
  wcard.appendChild(field('Standort für die Wettervorhersage', el('div', { class: 'row gap-2' }, [cityI, searchBtn])));
  if (s.location) wcard.appendChild(el('div', { class: 'dim', style: { fontSize: '.78rem' }, text: `Aktuell: ${s.location.name}${s.location.country ? ', ' + s.location.country : ''}` }));
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
      toggle(s.foodLookup !== false, (v) => store.setSetting('foodLookup', v)),
    ]),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'Die „schätzen"-Hilfe beim Anlegen von Mahlzeiten holt Kalorien & Eiweiß je Zutat von Open Food Facts (offene Datenbank). Nur der Zutatenname verlässt den Server; Ergebnisse werden lokal zwischengespeichert. Aus: rein lokale Schätzung.' }),
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
  view.appendChild(sectionHead('Daten & Sicherung'));
  view.appendChild(el('div', { class: 'col gap-2' }, [
    el('button', { class: 'btn btn--soft btn--block', onclick: () => { syncNow().then(() => toast('Synchronisiert', 'good')); } }, [icon('refresh'), 'Jetzt synchronisieren']),
    el('button', { class: 'btn btn--ghost btn--block', onclick: exportData }, [icon('download'), 'Mein Backup exportieren (JSON)']),
    el('button', { class: 'btn btn--ghost btn--block', onclick: importData }, [icon('upload'), 'Mein Backup importieren']),
  ]));
  view.appendChild(el('p', { class: 'dim', style: { fontSize: '.78rem', marginTop: '4px' }, text: 'Dein persönliches Backup sichert deine eigenen Daten (inkl. privater Zyklusdaten).' }));

  // Admin-Vollbackup: gesamte Familie sichern/wiederherstellen (autoritativ).
  if (store.isAdmin()) {
    view.appendChild(el('div', { class: 'card', style: { marginTop: '12px', borderColor: 'var(--accent-soft)' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '8px' } }, [
        el('span', { class: 'chip', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, text: 'Admin' }),
        el('strong', { text: 'Familien-Vollbackup' }),
      ]),
      el('p', { class: 'dim', style: { fontSize: '.8rem', lineHeight: '1.5' }, text: 'Sichert die gesamte Familie: alle Mitglieder, Rollen, Einstellungen und sämtliche Daten inkl. Urkunden/Reports. Aus Datenschutzgründen ohne private Zyklusdaten – die sichert jedes Mitglied selbst.' }),
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
    el('p', { class: 'dim', html: 'Cat-O-Fit ist <strong>quelloffen</strong> und steht unter der <strong>MIT-Lizenz</strong>. Die App ist abhängigkeitsfrei und läuft lokal – es werden keine Daten an Dritte gesendet.' }),
    el('p', { class: 'dim mt-2', html: 'Wetterdaten von <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0). Genannte Marken (z. B. VDOT, Hyrox, Apple Health, Garmin, Strava, Synology) gehören ihren jeweiligen Inhabern und werden nur beschreibend genannt.' }),
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
      el('button', { class: 'btn btn--ghost btn--block', style: { color: 'var(--bad)' }, onclick: openResetSheet }, [icon('trash'), 'App zurücksetzen / leeren']),
      el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'Löscht ALLE Mitglieder und Daten unwiderruflich und startet die Ersteinrichtung neu.' }),
    ]));
  }

  view.appendChild(el('p', { class: 'dim center mt-6', style: { fontSize: '.76rem' }, text: `Cat-O-Fit · Fitness & Health für Team und Familie · v${APP_VERSION}` }));
}

/** Neues Gesundheitsziel anlegen (Metrik + Zielwert + optionale Frist). */
/* App-Reset: löscht alles (Server & lokal) und führt zur Ersteinrichtung. Tippe-Bestätigung. */
function openResetSheet() {
  const inp = input({ type: 'text', placeholder: 'LÖSCHEN', maxlength: '12', autocomplete: 'off' });
  const err = el('div', { class: 'pin-err', hidden: true, text: 'Bitte „LÖSCHEN" eintippen, um zu bestätigen.' });
  let busy = false;
  const doReset = async () => {
    if (busy) return;
    if (inp.value.trim().toUpperCase() !== 'LÖSCHEN') { err.hidden = false; inp.focus(); return; }
    busy = true;
    try { await store.resetApp(); } catch { /* trotzdem neu starten */ }
    location.hash = '#/login';
    location.reload();   // sauberer Neustart in die Ersteinrichtung
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doReset(); });
  const body = el('div', { class: 'col gap-3' }, [
    el('div', { class: 'muted', style: { lineHeight: '1.5' }, text: 'Das entfernt ALLE Mitglieder, Trainings, Pläne, Werte und Einstellungen – auf diesem Gerät und auf dem Server. Es lässt sich nicht rückgängig machen. Danach startet die Ersteinrichtung.' }),
    el('label', { class: 'field__label', text: 'Zur Bestätigung „LÖSCHEN" eingeben' }), inp, err,
    el('button', { class: 'btn btn--danger btn--block', onclick: doReset }, [icon('trash'), 'Alles löschen und zurücksetzen']),
  ]);
  openSheet({ title: 'App zurücksetzen', body });
  setTimeout(() => inp.focus(), 120);
}

function openGoalSheet(view) {
  let metric = GOAL_METRICS[0].key;
  const metricSel = select(
    GOAL_METRICS.map((m) => ({ value: m.key, label: `${m.label}${m.unit ? ' (' + m.unit + ')' : ''}` })),
    metric, { onchange: (e) => { metric = e.target.value; updateHint(); } },
  );
  const targetI = input({ type: 'number', step: '0.1', inputmode: 'decimal', placeholder: 'Zielwert' });
  const deadlineI = input({ type: 'date' });
  const hint = el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' } });
  function updateHint() {
    const cur = latestMetric(metric, { profile: store.profile(), health: store.get('health') });
    const m = metricMeta(metric);
    hint.textContent = cur != null
      ? `Aktuell: ${cur}${m.unit ? ' ' + m.unit : ''} – wird als Startpunkt gemerkt, der Fortschritt zählt von hier zum Ziel.`
      : 'Noch kein Messwert erfasst – trage zuerst Körperwerte ein, damit der Fortschritt zählt.';
  }
  updateHint();
  openSheet({
    title: 'Neues Gesundheitsziel',
    body: el('div', {}, [
      field('Metrik', metricSel),
      field('Zielwert', targetI),
      field('Zieldatum (optional)', deadlineI),
      hint,
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Anlegen',
        onclick: () => {
          const target = parseFloat(String(targetI.value).replace(',', '.'));
          if (!Number.isFinite(target)) { toast('Bitte einen Zielwert eingeben', 'bad'); return; }
          const start = latestMetric(metric, { profile: store.profile(), health: store.get('health') });
          const list = [...((store.settings().healthGoals) || []), { id: uid('goal'), metric, target, start, deadline: deadlineI.value || null, createdAt: nowIso() }];
          store.setSetting('healthGoals', list);
          closeSheet(); toast('Ziel angelegt', 'good'); render(view);
        },
      }),
    ],
  });
}

/** PIN für das aktive Mitglied festlegen/ändern/entfernen. */
function openPinSheet(me) {
  const inp = el('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: '••••' });
  const hint = el('div', { class: 'muted', style: { fontSize: '.82rem', textAlign: 'center' }, text: 'Leer lassen und speichern entfernt die PIN.' });
  const save = async () => {
    const pin = inp.value.trim();
    await store.setMemberPin(me.id, pin);
    closeSheet();
    toast(pin ? 'PIN gespeichert' : 'PIN entfernt', 'good');
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const body = el('div', { class: 'pin-dialog' }, [
    el('div', { class: 'pin-dialog__name', style: { textAlign: 'center' }, text: `PIN für ${me.name}` }),
    inp, hint,
    el('button', { class: 'btn btn--primary btn--block', onclick: save }, [icon('check'), 'Speichern']),
  ]);
  openSheet({ title: 'PIN', body });
  setTimeout(() => inp.focus(), 120);
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

  openSheet({
    title: 'Profil bearbeiten',
    body: el('div', {}, [
      field('Name', nameI),
      el('div', { class: 'field__row' }, [field('Größe (cm)', hI), field('Geburtsjahr', byI)]),
      el('div', { class: 'field__row' }, [field('Gewicht (kg)', wI), field('Zielgewicht (kg)', twI)]),
      field('Geschlecht', sexI),
      el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '-4px', marginBottom: '8px' }, text: 'Für die Grundumsatz-Berechnung der Kalorienbilanz (optional).' }),
      field('Ziele', goalsI),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern',
        onclick: () => {
          store.setProfile({
            name: nameI.value.trim(), heightCm: parseInt(hI.value) || null,
            weightKg: parseFloat(wI.value) || null, targetWeightKg: parseFloat(twI.value) || null,
            birthYear: parseInt(byI.value) || null, sex: sexI.value || null,
            goals: goalsI.value.split('\n').map((x) => x.trim()).filter(Boolean),
          });
          closeSheet(); toast('Profil gespeichert', 'good'); setTimeout(() => location.reload(), 60);
        },
      }),
    ],
  });
}

function exportData() {
  try {
    const name = `catofit-backup-${todayStr()}.json`;
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alertDialog({ title: 'Backup erstellt', tone: 'good', message: `Deine Daten wurden als „${name}" heruntergeladen. Bewahre die Datei sicher auf.` });
  } catch (e) {
    alertDialog({ title: 'Backup fehlgeschlagen', tone: 'bad', message: e.message || 'Das Backup konnte nicht erstellt werden.' });
  }
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
      const who = (dump && dump.userName) ? `„${dump.userName}"` : 'einem anderen Profil';
      const msg = foreign
        ? `Dieses Backup stammt von ${who}. Es in dein Profil${me ? ` „${me.name}"` : ''} einzuspielen, überschreibt deine vorhandenen Daten.`
        : 'Vorhandene Daten in diesem Profil werden überschrieben.';
      const ok = await confirmDialog({ title: 'Backup einspielen?', message: msg, confirmLabel: 'Einspielen', danger: true });
      if (!ok) return;

      try {
        const res = store.importAll(dump);
        const n = res.imported.length;
        const skip = res.skipped.length ? `, ${res.skipped.length} übersprungen` : '';
        await alertDialog({ title: 'Backup eingespielt', tone: 'good', message: `${n} Bereich${n === 1 ? '' : 'e'} wiederhergestellt${skip}. Die App wird jetzt neu geladen.` });
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
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await alertDialog({ title: 'Vollbackup erstellt', tone: 'good', message: `Die gesamte Familie (${n} Mitglied${n === 1 ? '' : 'er'}) wurde als „${name}" gesichert – ohne private Zyklusdaten. Bewahre die Datei sicher auf.` });
  } catch (e) {
    await alertDialog({ title: 'Vollbackup fehlgeschlagen', tone: 'bad', message: e.message || 'Die Datei konnte nicht heruntergeladen werden.' });
  }
}

function importFamilyData() {
  const inp = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let dump;
      try { dump = JSON.parse(reader.result); }
      catch { await alertDialog({ title: 'Wiederherstellung fehlgeschlagen', tone: 'bad', message: 'Die Datei ist kein gültiges JSON.' }); return; }
      if (!dump || dump.kind !== 'family-full') {
        await alertDialog({ title: 'Falsche Datei', tone: 'bad', message: 'Das ist kein Familien-Vollbackup. Für ein persönliches Backup nutze „Mein Backup importieren".' }); return;
      }
      const n = dump.users ? Object.keys(dump.users).length : 0;
      const when = dump.exportedAt ? new Date(dump.exportedAt).toLocaleString('de-DE') : 'unbekannt';
      const ok = await confirmDialog({
        title: 'Komplette Familie wiederherstellen?',
        message: `Dieses Vollbackup (${n} Mitglied${n === 1 ? '' : 'er'}, erstellt am ${when}) überschreibt ALLE Mitglieder, Rollen, Einstellungen und Daten autoritativ – auf diesem Gerät und auf dem Server. Private Zyklusdaten bleiben unangetastet. Das lässt sich nicht rückgängig machen.`,
        confirmLabel: 'Alles wiederherstellen', danger: true,
      });
      if (!ok) return;
      try {
        const res = await store.importFamilyAll(dump);
        await alertDialog({ title: 'Familie wiederhergestellt', tone: 'good', message: `${res.users} Mitglied${res.users === 1 ? '' : 'er'} und ${res.areas} Bereiche wurden autoritativ wiederhergestellt. Die App wird jetzt neu geladen.` });
        location.reload();
      } catch (e) {
        await alertDialog({ title: 'Wiederherstellung fehlgeschlagen', tone: 'bad', message: e.message || 'Das Vollbackup konnte nicht eingespielt werden.' });
      }
    };
    reader.readAsText(f);
  });
  document.body.appendChild(inp); inp.click(); inp.remove();
}

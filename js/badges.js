/* =========================================================================
   badges.js — Belohnungssystem: Erfolgs-Badges + Momentum.
   Philosophie „Motivation ohne Druck": viele positive, humorvolle Abzeichen;
   das Momentum (eine Schwung-Flamme) reagiert sanft auf Konsistenz – es
   schrumpft bei Lücken, formuliert aber immer aktivierend statt strafend.

   Badges werden live aus den vorhandenen Daten berechnet. Die „schon gesehen"-
   Liste liegt clientseitig im LocalStorage (das Feier-Erlebnis muss nicht syncen).
   ========================================================================= */

import { diffDays, todayStr, addDays, typeMeta, el, iconSvg, sectionHead, fmtNum } from './ui.js';
import { lsGet, lsSet } from './env.js';
import * as store from './storage.js';
import { setHeader } from './router.js';
import { isProtectedDay } from './cycle.js';
import { weekOfDate } from './plans.js';

/** Alkoholfreie Tage in Folge bis heute (null, wenn nie ein Alkohol-Tag erfasst wurde). */
export function alcoholFreeStreak(health, today = todayStr()) {
  const drinkDays = new Set((health || []).filter((h) => h && !h.deleted && h.alcohol === true).map((h) => h.date));
  if (!drinkDays.size) return null;
  let streak = 0; let d = today;
  while (!drinkDays.has(d) && streak <= 3650) { streak++; d = addDays(d, -1); }
  return streak;
}

/* ------------------------- Kennzahlen aus dem Bestand ------------------- */
export function computeStats({ sessions = [], plans = [], health = [], events = [], profile = {} }, today = todayStr()) {
  const run = sessions.filter((s) => !s.deleted);
  const totalSessions = run.length;
  const totalKm = run.reduce((a, s) => a + (s.distanceKm || 0), 0);
  const longestRun = run.reduce((m, s) => Math.max(m, s.distanceKm || 0), 0);
  const intervalCount = run.filter((s) => s.type === 'interval').length;
  const qualityCount = run.filter((s) => ['tempo', 'interval'].includes(s.type)).length;

  // Aktuelle Aktiv-Streak (Tage in Folge mit Aktivität).
  const active = new Set(run.map((s) => s.date));
  plans.forEach((p) => (p.units || []).forEach((u) => { if (u.status === 'erledigt') active.add(u.date); }));
  let streak = 0; let d = today;
  if (!active.has(d)) d = addDays(d, -1);
  while (active.has(d)) { streak++; d = addDays(d, -1); }

  // Plan-Einhaltung (geschützte Tage zählen nicht als Malus).
  let due = 0; let done = 0;
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (u.type === 'rest' || u.date > today) return;
    if (u.status === 'erledigt') { due++; done++; }
    else if (!isProtectedDay(u.date)) due++;
  }));
  const adherence = due ? Math.round((done / due) * 100) : 0;

  // „Harte Kämpferin": an einem geschützten (Menstruations-)Tag trainiert.
  const hardFighter = run.some((s) => isProtectedDay(s.date));

  // Perfekte Woche: irgendeine vergangene Plan-Woche komplett erledigt.
  let perfectWeek = false;
  plans.forEach((p) => {
    const byWeek = {};
    // Woche aus dem Datum ableiten (nicht aus u.week): sonst landen manuell
    // angelegte Einheiten ohne `week`-Feld gemeinsam im „undefined"-Eimer und
    // könnten eine „Perfekte Woche" fälschlich auslösen.
    (p.units || []).forEach((u) => {
      if (u.type === 'rest') return;
      const wk = weekOfDate(p, u.date) ?? u.week;
      (byWeek[wk] ||= []).push(u);
    });
    Object.values(byWeek).forEach((list) => {
      if (list.length && list.every((u) => u.date < today) && list.every((u) => u.status === 'erledigt')) perfectWeek = true;
    });
  });

  // Gewicht: jemals Zielgewicht erreicht?
  const target = profile.targetWeightKg;
  const minWeight = health.filter((h) => h.weight != null).reduce((m, h) => Math.min(m, h.weight), Infinity);
  const weightReached = target != null && minWeight <= target;

  // Wettkampf gefinisht.
  const raceFinished = run.some((s) => s.type === 'race') || events.some((e) => e.status === 'abgeschlossen');

  // Schlaf-Serie: 7 der letzten Einträge ≥ 7 h.
  const sleepStreak = health.filter((h) => h.sleepHours != null).sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7).filter((h) => h.sleepHours >= 7).length;

  const soberStreak = alcoholFreeStreak(health, today) || 0;

  // Sportart-Zähler (je Trainingsart) + Vielfalt
  const byType = {};
  run.forEach((s) => { if (s.type) byType[s.type] = (byType[s.type] || 0) + 1; });
  const cnt = (t) => byType[t] || 0;
  const distinctTypes = Object.keys(byType).filter((t) => t !== 'rest').length;
  const distinctCats = new Set(run.map((s) => typeMeta(s.type).cat).filter((c) => c && c !== 'rest')).size;
  const marathonRun = longestRun >= 42;

  // Event-/Wettkampfarten (abgeschlossene Events)
  const doneEvents = events.filter((e) => !e.deleted && e.status === 'abgeschlossen');
  const racesFinishedCount = Math.max(
    doneEvents.filter((e) => e.kind !== 'program').length,
    run.filter((s) => s.type === 'race').length,
  );
  const programsDone = doneEvents.filter((e) => e.kind === 'program').length;
  const distinctDistances = new Set(doneEvents.filter((e) => e.kind !== 'program' && e.distanceType).map((e) => e.distanceType)).size;
  const hyroxDone = doneEvents.some((e) => e.sport === 'hyrox' || /hyrox/i.test(e.name || ''));
  const triathlonDone = doneEvents.some((e) => e.sport === 'triathlon' || /triathlon/i.test(e.name || ''));

  return {
    totalSessions, totalKm, longestRun, intervalCount, qualityCount, streak, adherence, perfectWeek,
    weightReached, raceFinished, sleepStreak, hardFighter, soberStreak,
    // Sportarten
    byType, distinctTypes, distinctCats, marathonRun,
    swimCount: cnt('swim'), hikeCount: cnt('hike'), rowingCount: cnt('rowing'),
    bikeCount: cnt('cross_bike') + cnt('spinning'), strengthCount: cnt('strength') + cnt('gym'),
    racketCount: cnt('tennis') + cnt('badminton') + cnt('squash') + cnt('tabletennis'),
    walkCount: cnt('walk'),
    // Eventarten
    racesFinishedCount, programsDone, distinctDistances, hyroxDone, triathlonDone,
  };
}

/* ------------------------------- Badges --------------------------------- */
// Jeder Badge: emoji, name, desc, Kategorie und eine Fortschrittsfunktion.
// tier = Aufwand/Schwierigkeit: 4 Legendär · 3 Episch · 2 Fortgeschritten · 1 Einsteiger.
export const TIERS = [
  { tier: 4, label: 'Legendär', color: '#f5a623' },
  { tier: 3, label: 'Episch', color: '#7c5cff' },
  { tier: 2, label: 'Fortgeschritten', color: '#3d8bff' },
  { tier: 1, label: 'Einsteiger', color: '#43c59e' },
];

export const BADGES = [
  /* ---- Einstieg & Konstanz ---- */
  { id: 'first', tier: 1, emoji: '🌱', name: 'Erster Schritt', cat: 'Start', desc: 'Dein allererstes Training', p: (s) => [s.totalSessions, 1] },
  { id: 'streak3', tier: 1, emoji: '🔥', name: 'Drei am Stück', cat: 'Konstanz', desc: '3 Tage in Folge aktiv', p: (s) => [s.streak, 3] },
  { id: 'streak7', tier: 2, emoji: '💪', name: 'Wochenheld:in', cat: 'Konstanz', desc: '7 Tage in Folge aktiv', p: (s) => [s.streak, 7] },
  { id: 'streak14', tier: 3, emoji: '⚡', name: 'Unaufhaltbar', cat: 'Konstanz', desc: '14 Tage in Folge aktiv', p: (s) => [s.streak, 14] },
  { id: 'streak30', tier: 4, emoji: '🏔️', name: 'Eiserne Disziplin', cat: 'Konstanz', desc: '30 Tage in Folge aktiv', p: (s) => [s.streak, 30] },
  { id: 'streak60', tier: 4, emoji: '❄️', name: 'Frostfest', cat: 'Konstanz', desc: '60 Tage in Folge aktiv', p: (s) => [s.streak, 60] },

  /* ---- Umfang (Trainings) ---- */
  { id: 'count10', tier: 1, emoji: '📦', name: 'Zehnerpack', cat: 'Umfang', desc: '10 Trainings absolviert', p: (s) => [s.totalSessions, 10] },
  { id: 'count50', tier: 3, emoji: '🎯', name: 'Halbhundert', cat: 'Umfang', desc: '50 Trainings absolviert', p: (s) => [s.totalSessions, 50] },
  { id: 'count100', tier: 4, emoji: '👑', name: 'Centurio', cat: 'Umfang', desc: '100 Trainings absolviert', p: (s) => [s.totalSessions, 100] },
  { id: 'count200', tier: 4, emoji: '🏛️', name: 'Doppel-Centurio', cat: 'Umfang', desc: '200 Trainings absolviert', p: (s) => [s.totalSessions, 200] },

  /* ---- Distanz (km) ---- */
  { id: 'km100', tier: 2, emoji: '🛣️', name: 'Erste 100 km', cat: 'Distanz', desc: '100 km gesammelt', p: (s) => [s.totalKm, 100] },
  { id: 'km500', tier: 3, emoji: '🚀', name: '500-km-Club', cat: 'Distanz', desc: '500 km gesammelt', p: (s) => [s.totalKm, 500] },
  { id: 'km1000', tier: 4, emoji: '🌍', name: 'Tausendsassa', cat: 'Distanz', desc: '1000 km gesammelt', p: (s) => [s.totalKm, 1000] },
  { id: 'km2000', tier: 4, emoji: '✈️', name: 'Weltenbummler:in', cat: 'Distanz', desc: '2000 km gesammelt', p: (s) => [s.totalKm, 2000] },

  /* ---- Long Run & Tempo ---- */
  { id: 'long15', tier: 2, emoji: '🦵', name: 'Langstreckenliebe', cat: 'Long Run', desc: 'Ein Lauf über 15 km', p: (s) => [s.longestRun, 15] },
  { id: 'long21', tier: 3, emoji: '🏃‍♀️', name: 'HM-Generalprobe', cat: 'Long Run', desc: 'Ein Lauf über 21 km', p: (s) => [s.longestRun, 21] },
  { id: 'marathon', tier: 4, emoji: '🏁', name: 'Marathon-Distanz', cat: 'Long Run', desc: 'Ein Lauf über 42 km', p: (s) => [s.longestRun, 42] },
  { id: 'quality1', tier: 1, emoji: '🌶️', name: 'Schärfe drin', cat: 'Tempo', desc: 'Erste Tempo-/Intervalleinheit', p: (s) => [s.qualityCount, 1] },
  { id: 'interval10', tier: 3, emoji: '🎡', name: 'Intervall-König:in', cat: 'Tempo', desc: '10 Intervalleinheiten', p: (s) => [s.intervalCount, 10] },

  /* ---- Sportarten: Schwimmen ---- */
  { id: 'swim1', tier: 1, emoji: '🏊', name: 'Erste Bahnen', cat: 'Schwimmen', desc: 'Erste Schwimmeinheit', p: (s) => [s.swimCount, 1] },
  { id: 'swim10', tier: 2, emoji: '🌊', name: 'Wasserratte', cat: 'Schwimmen', desc: '10× geschwommen', p: (s) => [s.swimCount, 10] },
  { id: 'swim25', tier: 3, emoji: '🐬', name: 'Delfin', cat: 'Schwimmen', desc: '25× geschwommen', p: (s) => [s.swimCount, 25] },

  /* ---- Sportarten: Wandern & Gehen ---- */
  { id: 'hike1', tier: 1, emoji: '🥾', name: 'Erste Wanderung', cat: 'Wandern', desc: 'Erste Wanderung', p: (s) => [s.hikeCount, 1] },
  { id: 'hike10', tier: 3, emoji: '⛰️', name: 'Gipfelstürmer:in', cat: 'Wandern', desc: '10× gewandert', p: (s) => [s.hikeCount, 10] },
  { id: 'walk10', tier: 1, emoji: '🚶', name: 'Vielgeher:in', cat: 'Gehen', desc: '10× spazieren / gehen', p: (s) => [s.walkCount, 10] },

  /* ---- Sportarten: Rudern ---- */
  { id: 'row1', tier: 1, emoji: '🚣', name: 'Erste Ruderschläge', cat: 'Rudern', desc: 'Erste Rudereinheit', p: (s) => [s.rowingCount, 1] },
  { id: 'row10', tier: 3, emoji: '🛶', name: 'Rudermeister:in', cat: 'Rudern', desc: '10× gerudert', p: (s) => [s.rowingCount, 10] },

  /* ---- Sportarten: Rückschlag, Rad, Kraft ---- */
  { id: 'racket1', tier: 1, emoji: '🎾', name: 'Erster Aufschlag', cat: 'Rückschlag', desc: 'Erstes Tennis/Badminton/Squash/TT', p: (s) => [s.racketCount, 1] },
  { id: 'racket10', tier: 2, emoji: '🏓', name: 'Matchball', cat: 'Rückschlag', desc: '10× Rückschlagsport', p: (s) => [s.racketCount, 10] },
  { id: 'bike10', tier: 2, emoji: '🚴', name: 'Vielfahrer:in', cat: 'Radsport', desc: '10× Rad/Indoor-Cycling', p: (s) => [s.bikeCount, 10] },
  { id: 'strength10', tier: 2, emoji: '🏋️', name: 'Eisen-Fan', cat: 'Kraft', desc: '10× Kraft/Gerätetraining', p: (s) => [s.strengthCount, 10] },
  { id: 'strength50', tier: 4, emoji: '🦾', name: 'Kraftpaket', cat: 'Kraft', desc: '50× Kraft/Gerätetraining', p: (s) => [s.strengthCount, 50] },

  /* ---- Vielfalt ---- */
  { id: 'variety5', tier: 2, emoji: '🎨', name: 'Allrounder:in', cat: 'Vielfalt', desc: '5 verschiedene Sportarten', p: (s) => [s.distinctTypes, 5] },
  { id: 'cats4', tier: 3, emoji: '🤹', name: 'Vielseitig', cat: 'Vielfalt', desc: 'Lauf, Kraft, Cross & Mobility', p: (s) => [s.distinctCats, 4] },
  { id: 'variety10', tier: 4, emoji: '🌈', name: 'Zehnkämpfer:in', cat: 'Vielfalt', desc: '10 verschiedene Sportarten', p: (s) => [s.distinctTypes, 10] },

  /* ---- Eventarten / Wettkämpfe ---- */
  { id: 'race', tier: 3, emoji: '🏅', name: 'Finisher', cat: 'Wettkampf', desc: 'Einen Wettkampf absolviert', p: (s) => [s.racesFinishedCount, 1] },
  { id: 'races3', tier: 4, emoji: '🥇', name: 'Seriensieger:in', cat: 'Wettkampf', desc: '3 Wettkämpfe absolviert', p: (s) => [s.racesFinishedCount, 3] },
  { id: 'dist3', tier: 3, emoji: '🎽', name: 'Distanzsammler:in', cat: 'Wettkampf', desc: '3 verschiedene Wettkampf-Distanzen', p: (s) => [s.distinctDistances, 3] },
  { id: 'hyrox', tier: 4, emoji: '🤸', name: 'Hyrox-Held:in', cat: 'Wettkampf', desc: 'Einen Hyrox absolviert', p: (s) => [s.hyroxDone ? 1 : 0, 1] },
  { id: 'triathlon', tier: 4, emoji: '🔱', name: 'Triathlet:in', cat: 'Wettkampf', desc: 'Einen Triathlon absolviert', p: (s) => [s.triathlonDone ? 1 : 0, 1] },
  { id: 'program1', tier: 2, emoji: '📋', name: 'Programm durchgezogen', cat: 'Programm', desc: 'Ein Trainingsprogramm abgeschlossen', p: (s) => [s.programsDone, 1] },
  { id: 'program3', tier: 4, emoji: '🎖️', name: 'Programm-Profi', cat: 'Programm', desc: '3 Trainingsprogramme abgeschlossen', p: (s) => [s.programsDone, 3] },

  /* ---- Plan & Gesundheit ---- */
  { id: 'perfectweek', tier: 2, emoji: '📅', name: 'Perfekte Woche', cat: 'Plan', desc: 'Eine Trainingswoche komplett erledigt', p: (s) => [s.perfectWeek ? 1 : 0, 1] },
  { id: 'adherence90', tier: 3, emoji: '🤝', name: 'Verlässlich', cat: 'Plan', desc: '90 % Plan-Einhaltung', p: (s) => [s.adherence, 90] },
  { id: 'weight', tier: 3, emoji: '⚖️', name: 'Ziel erreicht', cat: 'Gesundheit', desc: 'Zielgewicht erreicht', p: (s) => [s.weightReached ? 1 : 0, 1] },
  { id: 'sleep7', tier: 2, emoji: '😴', name: 'Schlafchampion', cat: 'Gesundheit', desc: '7× mindestens 7 h Schlaf', p: (s) => [s.sleepStreak, 7] },
  { id: 'sober7', tier: 2, emoji: '🌿', name: 'Klare Woche', cat: 'Gesundheit', desc: '7 Tage in Folge ohne Alkohol', p: (s) => [s.soberStreak, 7] },
  { id: 'sober30', tier: 4, emoji: '💎', name: 'Klarer Kopf', cat: 'Gesundheit', desc: '30 Tage in Folge ohne Alkohol', p: (s) => [s.soberStreak, 30] },
  { id: 'hardfighter', tier: 2, emoji: '🥊', name: 'Harte Kämpferin', cat: 'Zyklus', desc: 'An einem deiner Tage trainiert – Respekt!', p: (s) => [s.hardFighter ? 1 : 0, 1] },
];

/** Bewertet alle Badges gegen die aktuellen Kennzahlen. */
export function evaluateBadges(data, today = todayStr()) {
  const stats = computeStats(data, today);
  return BADGES.map((b) => {
    const [cur, target] = b.p(stats);
    const progress = Math.max(0, Math.min(1, cur / target));
    return { ...b, cur, target, progress, unlocked: cur >= target };
  });
}

/* ------------------------------ Momentum -------------------------------- */
/** Schwung-Wert (0–100) aus Aktivität der letzten 14 Tage, Lücken und Streak. */
export function momentum(data, today = todayStr()) {
  const { sessions = [], plans = [] } = data;
  const stats = computeStats(data, today);
  let score = 42;
  const done14 = sessions.filter((s) => !s.deleted && diffDays(s.date, today) >= 0 && diffDays(s.date, today) <= 14).length;
  score += done14 * 6;
  let missed = 0;
  plans.forEach((p) => (p.units || []).forEach((u) => {
    const dd = diffDays(u.date, today);
    if (dd >= 0 && dd <= 14 && u.type !== 'rest' && !isProtectedDay(u.date)) {
      if (u.status === 'verpasst' || (u.date < today && u.status !== 'erledigt')) missed++;
    }
  }));
  score -= missed * 8;
  score += Math.min(stats.streak, 10) * 2;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const level = score >= 75 ? 'Lodernd' : score >= 50 ? 'In Schwung' : score >= 25 ? 'Funke' : 'Glut';
  const flames = score >= 75 ? '🔥🔥🔥' : score >= 50 ? '🔥🔥' : score >= 25 ? '🔥' : '✨';
  const message = score >= 75
    ? `${stats.streak ? stats.streak + ' Tage Serie – ' : ''}du brennst gerade richtig!`
    : score >= 50
      ? 'Schöner Schwung – bleib dran, es läuft!'
      : score >= 25
        ? 'Der Funke ist da – die nächste Einheit facht ihn an.'
        : missed > 0
          ? 'Dein Schwung lässt nach – schon eine lockere Einheit bringt dich zurück.'
          : 'Zeit, den Schwung zu entfachen – los geht\'s!';
  return { score, level, flames, missed, done14, streak: stats.streak, message };
}

/* --------------------------- „Neu freigeschaltet" ----------------------- */
function loadSeen() { try { return new Set(JSON.parse(lsGet('seenBadges') || '[]')); } catch { return new Set(); } }

/** Liefert neu erreichte Badges seit dem letzten Aufruf und merkt sie vor. */
export function newlyUnlocked(data, today = todayStr()) {
  const seen = loadSeen();
  const unlocked = evaluateBadges(data, today).filter((b) => b.unlocked);
  const fresh = unlocked.filter((b) => !seen.has(b.id));
  return fresh;
}
export function markSeen(ids) {
  const seen = loadSeen();
  ids.forEach((id) => seen.add(id));
  lsSet('seenBadges', JSON.stringify([...seen]));
}
/** Alle aktuell erreichten Badges als gesehen markieren (z. B. nach Anzeige). */
export function markAllSeen(data, today = todayStr()) {
  markSeen(evaluateBadges(data, today).filter((b) => b.unlocked).map((b) => b.id));
}

/* ------------------------------- Ansicht -------------------------------- */
function storeData() {
  return { sessions: store.get('sessions'), plans: store.get('plans'), health: store.get('health'), events: store.get('events'), profile: store.profile() };
}

export function render(view) {
  setHeader({ title: 'Erfolge' });
  const data = storeData();
  const today = todayStr();
  const m = momentum(data, today);
  const badges = evaluateBadges(data, today);
  const unlockedCount = badges.filter((b) => b.unlocked).length;

  // Momentum-Hero
  view.appendChild(el('div', { class: 'hero' }, [
    el('div', { class: 'hero__eyebrow', text: 'Dein Schwung' }),
    el('div', { class: 'hero__row', style: { alignItems: 'center', marginTop: '6px' } }, [
      el('div', {}, [
        el('div', { style: { fontSize: '2.4rem', lineHeight: '1' }, text: m.flames }),
        el('div', { style: { fontWeight: '800', fontSize: '1.25rem', marginTop: '4px' }, text: m.level }),
      ]),
      el('div', { style: { textAlign: 'right' } }, [
        el('div', { class: 'num', style: { fontSize: '2.6rem', fontWeight: '800', lineHeight: '1' }, text: String(m.score) }),
        el('div', { style: { opacity: '.85', fontSize: '.72rem' }, text: 'Momentum' }),
      ]),
    ]),
    el('div', { style: { marginTop: '10px', opacity: '.95', fontSize: '.9rem', position: 'relative' }, text: m.message }),
  ]));

  // Abzeichen – nach Aufwand gruppiert, die anspruchsvollste Stufe zuerst.
  view.appendChild(sectionHead(`Abzeichen · ${unlockedCount}/${badges.length}`));
  TIERS.forEach(({ tier, label, color }) => {
    const group = badges.filter((b) => (b.tier || 1) === tier);
    if (!group.length) return;
    const got = group.filter((b) => b.unlocked).length;
    view.appendChild(el('div', { class: `badge-tier-head badge-tier-head--t${tier}` }, [
      el('span', { class: 'badge-tier-dot', style: { background: color } }),
      el('span', { class: 'badge-tier-label', text: label }),
      el('span', { class: 'badge-tier-count', text: `${got}/${group.length}` }),
    ]));
    const grid = el('div', { class: 'badge-grid' });
    // freigeschaltete innerhalb der Stufe zuerst (motivierend), sonst Definitionsreihenfolge
    group.slice().sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0)).forEach((b) => grid.appendChild(badgeCard(b)));
    view.appendChild(grid);
  });

  view.appendChild(el('p', { class: 'dim center mt-6', style: { fontSize: '.78rem' }, text: 'Abzeichen schalten sich automatisch frei, sobald du sie erreichst – ganz ohne Druck.' }));

  // Erreichte als „gesehen" markieren (keine erneute Feier).
  markAllSeen(data, today);
}

// Umbruch-Hinweise (Zero-Width-Space) vor dem Hauptwort zusammengesetzter
// Substantive einfügen, damit lange Namen dort statt nach Rechtschreibung
// (mit Trennstrich) umbrechen. Liest sich natürlicher.
const WRAP_PARTS = [
  'bummler', 'meister', 'stürmer', 'sammler', 'champion', 'sieger', 'ratte',
  'paket', 'kämpfer', 'fahrer', 'geher', 'probe', 'liebe', 'sassa', 'rounder', 'held',
];
export function softWrap(text) {
  let out = text;
  for (const p of WRAP_PARTS) out = out.replace(new RegExp(`(.)(${p})`, 'g'), `$1​$2`);
  return out;
}

function badgeCard(b) {
  const card = el('div', { class: `badge-card badge-card--t${b.tier || 1} ${b.unlocked ? 'is-unlocked' : ''}` }, [
    el('div', { class: 'badge-card__emoji', text: b.emoji }),
    el('div', { class: 'badge-card__name', text: softWrap(b.name) }),
    el('div', { class: 'badge-card__desc', text: softWrap(b.desc) }),
  ]);
  if (b.unlocked) {
    card.appendChild(el('div', { class: 'badge-card__check', text: '✓ erreicht' }));
  } else if (b.target > 1) {
    card.appendChild(el('div', { class: 'badge-progress' }, el('i', { style: { width: `${Math.round(b.progress * 100)}%` } })));
    card.appendChild(el('div', { class: 'badge-card__prog', text: `${fmtNum(Math.min(b.cur, b.target), b.cur % 1 ? 1 : 0)} / ${b.target}` }));
  }
  return card;
}

/* Tests für den Plan-Generator (js/plangen.js): Renntag an jedem Wochentag,
   feste Termine nur auf Wunsch, Paces aus der Zielzeit, Umfang nach Niveau und
   Lauftagen, Long-Run-Deckel, Tapering, Triathlon/Hyrox, Vorbereitungszeit. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isoDow, diffDays } from '../js/ui.js';
import {
  generatePlanUnits, buildWeekUnits, makePhases, weekTemplateFor, planCommitments, coveredFixed,
  planReadiness, volumeConfig, weekVolumes, trainingHistory, suggestLevel, raceKey, LEGACY_COMMITMENT_IDS,
  DEFAULT_WEEK_TEMPLATE, TRIATHLON_TEMPLATE, HYROX_TEMPLATE,
} from '../js/plangen.js';
import { planPaces, pacesFromVdot, racePaceFromVdot } from '../js/vdot.js';
import { isHard } from '../js/planflow.js';

const START = '2026-10-05'; // Montag
const RUN = ['easy', 'long', 'tempo', 'interval', 'recovery', 'run'];
const KM = { '5k': 5, '10k': 10, hm: 21.0975, marathon: 42.195 };

function mkPlan({ key = 'hm', weeks = 12, level = 'fortgeschritten', days = 4, raceDow = 6, sport = 'run', paces = null, commitments = [], extra = {} } = {}) {
  const km = { ...KM, tri_sprint: 5, tri_olympic: 10, hyrox: 8 }[key];
  const distanceType = key === 'tri_sprint' ? 'tri-sprint' : key === 'tri_olympic' ? 'tri-olympic' : null;
  const event = { id: 'e', name: 'Rennen', date: addDays(START, (weeks - 1) * 7 + raceDow - 1), distanceKm: km, sport, distanceType };
  const plan = { id: 'p', eventId: 'e', startDate: START, weeks, phases: makePhases(weeks), level, daysPerWeek: days,
    weekTemplate: weekTemplateFor(sport, days), commitments, paces, sport, ...extra };
  return { plan, event, units: generatePlanUnits(plan, event, {}) };
}
function weekRun(units, week) {
  const ws = addDays(START, (week - 1) * 7), we = addDays(ws, 6);
  const us = units.filter((u) => u.date >= ws && u.date <= we);
  return {
    km: us.filter((u) => RUN.includes(u.type)).reduce((a, u) => a + (u.targetDistanceKm || 0), 0),
    long: Math.max(0, ...us.filter((u) => u.type === 'long').map((u) => u.targetDistanceKm || 0)),
  };
}

test('TRAIN-01: Renneinheit an jedem Wochentag, Tag davor Shakeout oder frei, zwei Tage vorher frei', () => {
  for (let dow = 1; dow <= 7; dow++) {
    const { event, units } = mkPlan({ raceDow: dow });
    const races = units.filter((u) => u.type === 'race');
    assert.equal(races.length, 1, `Rennen am Wochentag ${dow}`);
    assert.equal(races[0].date, event.date);
    assert.equal(isoDow(races[0].date), dow);
    const before = units.filter((u) => u.date === addDays(event.date, -1) && u.type !== 'mobility');
    assert.ok(before.every((u) => u.title === 'Shakeout 3 km'), `Vortag nur Shakeout (Wochentag ${dow}): ${before.map((u) => u.title)}`);
    const twoBefore = units.filter((u) => u.date === addDays(event.date, -2) && u.type !== 'mobility');
    assert.equal(twoBefore.length, 0, `zwei Tage vorher frei (Wochentag ${dow})`);
    assert.ok(!units.some((u) => u.date > event.date), 'nichts nach dem Rennen');
    assert.ok(!units.some((u) => u.type === 'long' && diffDays(u.date, event.date) <= 6), 'kein Long Run in der Rennwoche');
  }
});

test('TRAIN-02/UI-05: keine Standardtermine; Altpläne behalten Fußball mit stabilen IDs', () => {
  const { units } = mkPlan();
  assert.equal(units.filter((u) => u.fixed).length, 0, 'neuer Plan ohne Phantom-Fußball');
  // Altplan (vor v3.7.0) ohne Feld: Fußball Mo + Mi, bei jedem Lesen dieselben IDs.
  const legacy = { weekTemplate: DEFAULT_WEEK_TEMPLATE };
  const c1 = planCommitments(legacy), c2 = planCommitments(legacy);
  assert.deepEqual(c1.map((c) => c.dow), [1, 3]);
  assert.deepEqual(c1.map((c) => c.id), LEGACY_COMMITMENT_IDS);
  assert.deepEqual(c1.map((c) => c.id), c2.map((c) => c.id));
  assert.deepEqual(planCommitments({ weekTemplate: TRIATHLON_TEMPLATE }), [], 'Triathlon hatte nie Standardtermine');
  assert.deepEqual(planCommitments({ commitments: [], weekTemplate: DEFAULT_WEEK_TEMPLATE }), [], 'bewusst leer bleibt leer');
});

test('UI-05: derselbe feste Termin in zwei Plänen erscheint nicht doppelt – nach dem Ende des ersten Plans übernimmt der zweite', () => {
  const c = [{ id: 'c1', type: 'cross_football', dow: 1, durationMin: 90, intensity: 'normal', label: 'Fußballtraining' }];
  const a = mkPlan({ key: '10k', weeks: 6, commitments: c });
  const b = mkPlan({ key: 'hm', weeks: 14, commitments: c });
  const units = generatePlanUnits(b.plan, b.event, {}, { coveredFixed: coveredFixed([{ id: 'p', units: a.units }], 'other') });
  const aDates = new Set(a.units.filter((u) => u.fixed).map((u) => u.date));
  assert.ok(aDates.size >= 5);
  assert.ok(!units.some((u) => u.fixed && aDates.has(u.date)), 'kein zweiter Fußball am selben Tag');
  assert.ok(units.some((u) => u.fixed && u.date > a.event.date), 'nach Plan A trägt Plan B den Termin');
  // Der Termin formt trotzdem die Woche: montags keine Schlüsseleinheit in Plan B.
  assert.ok(!units.some((u) => isoDow(u.date) === 1 && ['tempo', 'interval', 'long'].includes(u.type)));
});

test('TRAIN-04/05/14: Paces aus der Zielzeit, Renntempo je Distanz, Zonenschlüssel an jeder Laufeinheit', () => {
  for (const [key, targetSec] of [['10k', 3000], ['hm', 6900], ['marathon', 14400]]) {
    const pp = planPaces({ distanceKm: KM[key], targetSec });
    const { units } = mkPlan({ key, paces: pp.zones, weeks: 14 });
    const run = units.filter((u) => RUN.includes(u.type) || u.type === 'race');
    assert.ok(run.every((u) => u.targetPaceSecPerKm && u.paceKey), `${key}: jede Laufeinheit mit Pace und Zonenschlüssel`);
    const race = units.find((u) => u.type === 'race');
    assert.equal(race.paceKey, 'race');
    const goalPace = targetSec / KM[key];
    assert.ok(race.targetPaceSecPerKm <= goalPace && race.targetPaceMaxSecPerKm >= goalPace, `${key}: Renntempo umschließt die Zielpace`);
  }
  // Marathon-Blöcke im Marathon-Renntempo – nicht im HM-Tempo (TRAIN-14, T05).
  const pp = planPaces({ distanceKm: KM.marathon, targetSec: 14400 });
  const { units } = mkPlan({ key: 'marathon', paces: pp.zones, weeks: 16 });
  const mp = units.filter((u) => /Marathon-Renntempo/.test(u.title));
  assert.ok(mp.length >= 1);
  assert.ok(mp.every((u) => u.targetPaceSecPerKm === pp.zones.race.min), 'Marathon-Renntempo-Block = Renntempo aus der Zielzeit');
  const hmZone = pacesFromVdot(pp.goalVdot).race_hm;
  const mid = (a, b) => (a + b) / 2;
  assert.ok(mid(mp[0].targetPaceSecPerKm, mp[0].targetPaceMaxSecPerKm) - mid(hmZone.min, hmZone.max) >= 8, 'spürbar langsamer als HM-Tempo');
});

test('TRAIN-14: Renntempo über die Äquivalenzzeit – auch für langsamere Läufer:innen', () => {
  // VDOT 30: äquivalente HM-Pace ≈ 6:42 – früher lag die Zone bei 6:21–6:35.
  const z = pacesFromVdot(30).race_hm;
  const eq = racePaceFromVdot(30, 21.0975);
  assert.ok(Math.abs(eq - 402) <= 3, `HM-Äquivalenz ≈ 6:42, war ${eq}`);
  assert.ok(z.min <= eq && z.max >= eq);
  const m = pacesFromVdot(45).marathon;
  assert.ok(m.min <= 296 && m.max >= 296, 'VDOT 45: Marathon-Pace ≈ 4:56 liegt in der Zone');
});

test('TRAIN-36: Long-Zone ist nicht schneller als die Easy-Zone', () => {
  for (const v of [30, 40, 50, 60]) {
    const p = pacesFromVdot(v);
    assert.ok(p.long.min >= p.easy.min, `VDOT ${v}: Long nicht schneller als Easy`);
    assert.equal(p.long.max, p.easy.max, 'gleiches ruhiges Ende');
    assert.ok(p.recovery.min > p.easy.min);
  }
});

test('TRAIN-04: ambitionierte Zielzeit – Training nach Form, Renntempo nach Ziel', () => {
  const pp = planPaces({ distanceKm: KM.hm, targetSec: 5400, formVdot: 40 });   // 1:30 ≈ VDOT 51
  assert.equal(pp.ambitious, true);
  assert.equal(pp.trainingVdot, 40);
  assert.equal(pp.zones.race.min, Math.round(Math.round(5400 / KM.hm) * 0.98));
  assert.equal(planPaces({ distanceKm: KM.hm, targetSec: 6900, formVdot: 38.5 }).ambitious, false);
  assert.equal(planPaces({ distanceKm: KM.hm }), null, 'ohne Zielzeit und Form keine Paces');
});

test('TRAIN-16: Long Run gedeckelt (Anteil, Zeit), Wochensprünge ≤ 30 %', () => {
  for (const key of ['5k', '10k', 'hm', 'marathon']) {
    for (const level of ['einsteiger', 'fortgeschritten', 'leistung']) {
      const { plan, units } = mkPlan({ key, level, weeks: 16 });
      const weeks = Array.from({ length: plan.weeks }, (_, i) => weekRun(units, i + 1));
      const maxShare = { '5k': 0.4, '10k': 0.4, hm: 0.44, marathon: 0.46 }[key];
      weeks.slice(0, -1).forEach((w, i) => {
        if (w.km >= 20 && w.long) assert.ok(w.long / w.km <= maxShare, `${key}/${level} W${i + 1}: Long ${w.long} von ${w.km} km`);
      });
      for (let i = 1; i < weeks.length - 2; i++) {
        if (weeks[i - 1].km >= 12) assert.ok(weeks[i].km / weeks[i - 1].km <= 1.3, `${key}/${level} W${i + 1}: +${Math.round((weeks[i].km / weeks[i - 1].km - 1) * 100)} %`);
      }
      // Zeitdeckel: Einsteiger ≤ 150 min, sonst ≤ 180 min beim ruhigen Tempo.
      const cap = level === 'einsteiger' ? 150 : 180;
      const pace = { einsteiger: 420, fortgeschritten: 370, leistung: 330 }[level];
      assert.ok(Math.max(...weeks.map((w) => w.long)) * pace / 60 <= cap + 1, `${key}/${level}: Long Run über ${cap} min`);
    }
  }
});

test('TRAIN-17: Niveau und Lauftage bestimmen den Umfang; die Historie kann den Einstieg auch senken', () => {
  const peak = (level, days = 4) => { const { plan, units } = mkPlan({ key: 'hm', level, days, weeks: 16 }); return Math.max(...Array.from({ length: plan.weeks }, (_, i) => weekRun(units, i + 1).km)); };
  assert.ok(peak('einsteiger') < peak('fortgeschritten') && peak('fortgeschritten') < peak('leistung'));
  assert.ok(peak('fortgeschritten', 3) < peak('fortgeschritten', 6), 'mehr Lauftage, mehr Umfang');
  const w1 = (extra) => weekRun(mkPlan({ key: '10k', level: 'fortgeschritten', extra }).units, 1).km;
  assert.ok(w1({ baseWeekKm: 10 }) < w1({}), 'wenig Historie senkt den Einstieg');
  assert.ok(w1({ baseWeekKm: 10 }) <= 13);
  // Einsteiger ohne Laufbasis: 5 km beginnt mit Lauf-Geh-Wechseln statt 8-km-Long-Run.
  const e = mkPlan({ key: '5k', level: 'einsteiger', weeks: 10, days: 3 });
  const week1 = e.units.filter((u) => u.week === 1 && RUN.includes(u.type));
  assert.ok(week1.every((u) => u.title.startsWith('Lauf-Geh-Wechsel')), week1.map((u) => u.title).join(', '));
  assert.ok(week1.every((u) => (u.targetDistanceKm || 0) < 6));
  // Lauftage → Gerüst
  assert.equal(weekTemplateFor('run', 3).flatMap((t) => t.units).filter((u) => u.role !== 'mobility').length, 3);
  assert.equal(weekTemplateFor('run', 6).flatMap((t) => t.units).filter((u) => u.role !== 'mobility').length, 6);
});

test('Historie und Niveauvorschlag', () => {
  const T = '2026-10-05';
  const s = [];
  for (let w = 0; w < 4; w++) { s.push({ date: addDays(T, -w * 7 - 1), type: 'long', distanceKm: 14 }); s.push({ date: addDays(T, -w * 7 - 3), type: 'easy', distanceKm: 8 }); }
  s.push({ date: addDays(T, -2), type: 'cross_bike', distanceKm: 60 });   // Rad zählt nicht
  const h = trainingHistory(s, T);
  assert.equal(h.weekKm, 22);
  assert.equal(h.longKm, 14);
  assert.equal(suggestLevel(h), 'fortgeschritten');
  assert.equal(suggestLevel({}), 'einsteiger');
  assert.equal(suggestLevel({ weekKm: 45 }), 'leistung');
});

test('T16/T17: Entlastungswochen und Tapering im Long Run', () => {
  const { plan, event, units } = mkPlan({ key: 'hm', weeks: 12 });
  const w = (n) => weekRun(units, n);
  assert.ok(w(4).long < w(3).long, `Woche 4 entlastet (${w(4).long} < ${w(3).long})`);
  assert.ok(w(5).long >= w(3).long, 'danach zurück aufs Niveau');
  assert.ok(w(8).km < w(7).km, 'Woche 8 entlastet');
  const peakLong = Math.max(...Array.from({ length: 10 }, (_, i) => w(i + 1).long));
  assert.ok(w(11).long <= peakLong * 0.6, `W-1: Long ≤ 60 % der Spitze (${w(11).long} von ${peakLong})`);
  assert.equal(w(12).long, 0, 'in der Rennwoche kein Long Run');
  const vols = weekVolumes(plan, volumeConfig(plan, event, {}));
  assert.equal(vols[4].deload, true);
  assert.equal(vols[11].taper, 'w1');
  assert.ok(vols[12].km < vols[11].km);
});

test('TRAIN-08: Triathlon mit Ruhetag, Formaten und Tapering', () => {
  for (const key of ['tri_sprint', 'tri_olympic']) {
    const { event, units } = mkPlan({ key, sport: 'triathlon', raceDow: 7, weeks: 12 });
    for (let week = 1; week <= 11; week++) {
      const ws = addDays(START, (week - 1) * 7);
      const days = new Set(units.filter((u) => u.date >= ws && u.date <= addDays(ws, 6)).map((u) => u.date));
      assert.ok(days.size <= 6, `${key} W${week}: mindestens ein trainingsfreier Tag`);
    }
    const raceWeek = units.filter((u) => diffDays(u.date, event.date) >= 0 && diffDays(u.date, event.date) <= 6);
    assert.ok(!raceWeek.some((u) => u.title.startsWith('Lange Radeinheit')), 'keine lange Radeinheit in der Rennwoche');
    const longBike = (w) => units.find((u) => u.week === w && u.title.startsWith('Lange Radeinheit'))?.targetDurationMin || 0;
    assert.ok(longBike(10) > longBike(1), 'Rad steigert sich');
    assert.ok(longBike(11) < longBike(10), 'Tapering kürzt');
    const race = units.find((u) => u.type === 'race');
    assert.match(race.description, key === 'tri_sprint' ? /750 m Schwimmen · 20 km Rad · 5 km Laufen/ : /1500 m Schwimmen · 40 km Rad · 10 km Laufen/);
    assert.equal(raceKey(event), key);
  }
});

test('TRAIN-08/MKT-13: Hyrox mit Ruhetagen, keinen harten Folgetagen, Stationsprogression und Simulation', () => {
  const { event, units } = mkPlan({ key: 'hyrox', sport: 'hyrox', raceDow: 6, weeks: 16 });
  for (let week = 1; week <= 14; week++) {
    const ws = addDays(START, (week - 1) * 7);
    const wk = units.filter((u) => u.date >= ws && u.date <= addDays(ws, 6));
    assert.ok(new Set(wk.map((u) => u.date)).size <= 6, `W${week}: Ruhetag`);
  }
  const hard = units.filter((u) => isHard(u) && u.type !== 'race').map((u) => u.date).sort();
  for (let i = 1; i < hard.length; i++) assert.notEqual(diffDays(hard[i - 1], hard[i]), 1, `harte Folgetage ${hard[i - 1]} → ${hard[i]}`);
  const func = units.filter((u) => u.title.startsWith('Hyrox'));
  assert.ok(func.some((u) => /Technik/.test(u.title)) && func.some((u) => /Laufbelastung/.test(u.title)), 'Progression Technik → unter Laufbelastung');
  assert.ok(func.some((u) => /Wettkampfsimulation/.test(u.title)), 'Wettkampfsimulation in der Spitzenphase');
  const race = units.find((u) => u.type === 'race');
  assert.match(race.description, /SkiErg 1000 m · Sled Push 50 m/);
  const withTime = generatePlanUnits(mkPlan({ key: 'hyrox', sport: 'hyrox', weeks: 8 }).plan, { ...event, date: addDays(START, 7 * 7 + 5), targetTime: '01:20:00' }, {});
  assert.match(withTime.find((u) => u.type === 'race').description, /je Laufkilometer etwa/);
});

test('TRAIN-47: Vorbereitungszeit – vergangen, heute, zu kurz, passend', () => {
  const T = '2026-10-05';
  assert.equal(planReadiness({ date: addDays(T, -3), distanceKm: 10 }, { today: T }).status, 'past');
  assert.equal(planReadiness({ date: T, distanceKm: 10 }, { today: T }).status, 'today');
  const short = planReadiness({ date: addDays(T, 25), distanceKm: 42.195 }, { today: T, level: 'einsteiger' });
  assert.equal(short.status, 'short');
  assert.match(short.text, /mindestens 18 Wochen/);
  assert.match(short.text, /späteres Rennen, eine kürzere Distanz/);
  assert.equal(planReadiness({ date: addDays(T, 25), distanceKm: 42.195 }, { today: T, level: 'fortgeschritten', hist: { longKm: 30 } }).status, 'ok', 'passende Historie');
  assert.equal(planReadiness({ date: addDays(T, 100), distanceKm: 21.0975 }, { today: T }).status, 'ok');
});

test('Relocation: Schlüsseleinheiten weichen festen Terminen aus, nie in die zwei Tage vor dem Rennen', () => {
  const c = [1, 2, 3, 4].map((dow, i) => ({ id: `c${i}`, type: 'cross_football', dow, durationMin: 90, intensity: 'normal' }));
  const { event, units } = mkPlan({ key: '10k', weeks: 6, raceDow: 7, commitments: c });
  const moved = units.filter((u) => u.relocatedFrom);
  assert.ok(moved.length > 0);
  assert.ok(moved.every((u) => diffDays(u.date, event.date) > 2 || u.title === 'Shakeout 3 km'));
});

test('buildWeekUnits: Planstart mitten in der Woche – Wochentage bleiben richtig', () => {
  const plan = { id: 'p', eventId: 'e', startDate: '2026-10-07', weeks: 1, phases: makePhases(1), level: 'fortgeschritten', daysPerWeek: 4, weekTemplate: DEFAULT_WEEK_TEMPLATE, commitments: [] };
  const event = { id: 'e', date: '2026-10-11', distanceKm: 10 };   // Mi-Start, Rennen So
  const units = buildWeekUnits(plan, event, {}, 1);
  assert.ok(units.every((u) => u.date >= plan.startDate && u.date <= event.date));
  assert.equal(units.find((u) => u.type === 'race').date, '2026-10-11');
  assert.ok(units.every((u) => u.dow === isoDow(u.date)));
});

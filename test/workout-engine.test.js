/* Tests für js/workout-engine.js — Phasen des Workout-Modus und Zeitrechnung
   nach echter Zeit (statt fester 0,2 s je Timer-Tick). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhases, advance, phaseRemaining, parseStructure } from '../js/workout-engine.js';
import { generatePlanUnits, makePhases, weekTemplateFor } from '../js/plangen.js';
import { planPaces } from '../js/vdot.js';
import { addDays } from '../js/ui.js';

const works = (ph) => ph.filter((p) => p.kind === 'work');

test('buildPhases: Strecken-Intervalle laufen über die Zielpace, mit Ein- und Auslaufen', () => {
  const unit = {
    type: 'interval', title: 'VO2max 8×400 m', targetPaceSecPerKm: 251, targetPaceMaxSecPerKm: 261, targetHrZone: 5,
    intervals: { warmupKm: 2, cooldownKm: 2, segments: Array.from({ length: 8 }, (_, i) => ({ workM: 400, workSec: 102, restSec: 90, label: `400 m · ${i + 1}/8` })) },
  };
  const ph = buildPhases(unit);
  assert.equal(ph[0].kind, 'warmup');
  assert.equal(ph.at(-1).kind, 'cooldown');
  assert.equal(works(ph).length, 8);
  // 400 m bei 4:16 min/km ≈ 102 s – nicht 3 Minuten wie früher.
  assert.ok(works(ph).every((p) => p.sec >= 98 && p.sec <= 106), works(ph).map((p) => p.sec).join(','));
  assert.equal(ph.filter((p) => p.kind === 'rest').length, 7, 'keine Pause nach der letzten Belastung');
  assert.deepEqual(works(ph)[0].target, { pace: [251, 261], hrZone: 5 }, 'Zielpace und Zone je Phase');
  assert.ok(ph[0].sec > 500 && ph[0].sec < 700, `Einlaufen 2 km ruhig, war ${ph[0].sec}`);
});

test('buildPhases: ältere Einheiten ohne Segmente – Struktur aus dem Titel, Strecke über die Pace', () => {
  const vo2 = buildPhases({ type: 'interval', title: 'VO2max-Intervalle 6×800 m', targetPaceSecPerKm: 251, targetPaceMaxSecPerKm: 261 });
  assert.equal(works(vo2).length, 6);
  assert.ok(works(vo2).every((p) => Math.abs(p.sec - 205) <= 3), `800 m ≈ 205 s, war ${works(vo2)[0].sec}`);
  assert.equal(vo2[0].kind, 'warmup', 'auch ältere Einheiten beginnen mit Einlaufen');
  const mara = buildPhases({ type: 'tempo', title: 'Marathon-Renntempo 3×4 km', targetPaceSecPerKm: 290, targetPaceMaxSecPerKm: 302 });
  assert.equal(works(mara).length, 3);
  assert.ok(works(mara)[0].sec > 1100, `4 km ≈ 19 min, war ${works(mara)[0].sec}`);
  // „Aktivierung“ trägt die Struktur nur in der Beschreibung (3×2 min), nicht 3×6 min.
  const act = buildPhases({ type: 'tempo', title: 'Aktivierung', description: '2 km locker, 3×2 min im Renntempo, 4 Steigerungen.' });
  assert.deepEqual(works(act).map((p) => p.sec), [120, 120, 120]);
  assert.equal(buildPhases({ type: 'easy', title: 'Lockerer Dauerlauf' }), null, 'Dauerlauf = Stoppuhr');
});

test('parseStructure: erkennt Minuten, Meter und Kilometer', () => {
  assert.deepEqual(parseStructure('Schwellenlauf 3×6 min'), { rounds: 3, workMin: 6 });
  assert.deepEqual(parseStructure('VO2max 8x400 m'), { rounds: 8, workM: 400 });
  assert.deepEqual(parseStructure('HM-Renntempo 3×3 km'), { rounds: 3, workM: 3000 });
  assert.equal(parseStructure('Long Run 18 km'), null);
});

test('advance: rechnet nach echter Zeit weiter – auch über mehrere Phasen (Bildschirmsperre)', () => {
  const phases = [{ kind: 'work', sec: 60 }, { kind: 'rest', sec: 60 }, { kind: 'work', sec: 60 }, { kind: 'rest', sec: 60 }];
  // 5 s blockiert (wie gesperrter Bildschirm): die Phase läuft trotzdem 5 s weiter.
  let s = advance({ phase: 0, phaseElapsed: 2 }, phases, 5);
  assert.equal(s.phase, 0);
  assert.equal(phaseRemaining(s, phases), 53);
  // 130 s im Hintergrund: zwei Phasenwechsel, aber keine 3-2-1-Signale beim Aufholen.
  s = advance(s, phases, 130);
  assert.equal(s.phase, 2);
  assert.equal(Math.round(s.phaseElapsed), 17);
  assert.equal(s.events.filter((e) => e.type === 'phase').length, 2);
  assert.equal(s.events.filter((e) => e.type === 'count').length, 0);
  s = advance(s, phases, 200);
  assert.equal(s.done, true);
  assert.equal(s.events.at(-1).type, 'done');
});

test('advance: im normalen Takt kommen 3-2-1 vor dem Wechsel', () => {
  const phases = [{ kind: 'work', sec: 4 }, { kind: 'rest', sec: 10 }];
  let s = { phase: 0, phaseElapsed: 0 };
  const counts = [];
  for (let i = 0; i < 25; i++) { s = advance(s, phases, 0.2); counts.push(...s.events.filter((e) => e.type === 'count').map((e) => e.k)); }
  assert.deepEqual(counts, [3, 2, 1]);
  assert.equal(s.phase, 1);
});

test('Workout-Phasen passen zu jedem Titel eines generierten Plans (TRAIN-09/31)', () => {
  for (const [km, targetSec] of [[5, 1500], [10, 3000], [21.0975, 6900], [42.195, 14400]]) {
    const start = '2026-10-05';
    const event = { id: 'e', date: addDays(start, 11 * 7 + 5), distanceKm: km, sport: 'run' };
    const pp = planPaces({ distanceKm: km, targetSec });
    const plan = { id: 'p', eventId: 'e', startDate: start, weeks: 12, phases: makePhases(12), level: 'fortgeschritten', daysPerWeek: 4, weekTemplate: weekTemplateFor('run', 4), commitments: [], paces: pp.zones };
    const units = generatePlanUnits(plan, event, {}).filter((u) => ['tempo', 'interval'].includes(u.type));
    assert.ok(units.length > 5);
    for (const u of units) {
      const ph = buildPhases(u);
      const st = parseStructure(u.title);
      assert.ok(ph && ph.length, `${u.title}: Phasen vorhanden`);
      if (st) assert.equal(works(ph).length, st.rounds, `${u.title}: ${works(ph).length} Belastungen`);
      if (st && st.workMin) assert.ok(works(ph).every((p) => p.sec === st.workMin * 60), `${u.title}: Zeitblöcke`);
      if (st && st.workM) {
        const expect = (st.workM / 1000) * ((u.targetPaceSecPerKm + u.targetPaceMaxSecPerKm) / 2);
        assert.ok(works(ph).every((p) => Math.abs(p.sec - expect) <= 3), `${u.title}: Strecke über die Pace (${works(ph)[0].sec} vs. ${Math.round(expect)})`);
      }
      assert.equal(ph[0].kind, 'warmup', `${u.title}: beginnt mit Einlaufen`);
    }
  }
});

test('Lauf-Geh-Wechsel: Gehpausen und Aufwärmen im Gehen', () => {
  const start = '2026-10-05';
  const event = { id: 'e', date: addDays(start, 11 * 7 + 5), distanceKm: 5, sport: 'run' };
  const plan = { id: 'p', eventId: 'e', startDate: start, weeks: 12, phases: makePhases(12), level: 'einsteiger', daysPerWeek: 3, weekTemplate: weekTemplateFor('run', 3), commitments: [] };
  const u = generatePlanUnits(plan, event, {}).find((x) => x.title.startsWith('Lauf-Geh-Wechsel'));
  const ph = buildPhases(u);
  assert.equal(ph[0].label, 'Aufwärmen (gehen)');
  assert.match(works(ph)[0].label, /^Laufen 1\//);
  assert.equal(ph.find((p) => p.kind === 'rest').label, 'Gehen');
});

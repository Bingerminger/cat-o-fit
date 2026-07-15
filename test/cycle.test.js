/* Unit-Tests für die Zyklus-Phasenlogik (js/cycle.js).
   Integrationsnah: füllt den Store (cycle-Daten) und aktiviert das Modul. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays, diffDays, todayStr } from '../js/ui.js';
import {
  cyclePhase, isProtectedDay, cycleEnabled, avgCycleLength, avgPeriodLength, nextPredictedStart,
  cycleSoftenTargets, cycleEaseVariant,
} from '../js/cycle.js';

const REAL = '2026-06-12'; // letzter echter Periodenstart
function seed({ enabled = true } = {}) {
  store.replaceArea('cycle', [
    { id: 'cyc-a', startDate: '2026-05-15', periodLength: 5, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'cyc-b', startDate: REAL, periodLength: 5, createdAt: '2026-01-01T00:00:00Z' },
  ]);
  store.setSetting('modules', enabled ? { cycle: true } : { cycle: false });
}

beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

test('cycleEnabled: Standard an, in den Einstellungen abschaltbar', () => {
  assert.equal(cycleEnabled(), true);              // beforeEach: {} -> Standard an
  store.setSetting('modules', { cycle: false });
  assert.equal(cycleEnabled(), false);             // ausdrücklich abgewählt
  store.setSetting('modules', { cycle: true });
  assert.equal(cycleEnabled(), true);
});

test('deaktiviertes Modul -> keine Phase', () => {
  seed({ enabled: false });
  assert.equal(cyclePhase(REAL), null);
  assert.equal(isProtectedDay(REAL), false);
});

test('avgCycleLength/avgPeriodLength aus den Einträgen', () => {
  seed();
  assert.equal(avgCycleLength(), 28); // 15.5. -> 12.6. = 28 Tage
  assert.equal(avgPeriodLength(), 5);
});

test('Phasen über den Zyklus (echter Start)', () => {
  seed();
  const at = (n) => cyclePhase(addDays(REAL, n));
  assert.equal(at(0).phase, 'menstruation');
  assert.equal(at(0).cycleDay, 1);
  assert.equal(at(0).predicted, false);
  assert.equal(at(4).phase, 'menstruation'); // Tag 5, periodLength 5
  assert.equal(at(5).phase, 'follikel');
  assert.equal(at(13).phase, 'ovulation');
  assert.equal(at(16).phase, 'luteal');
});

test('isProtectedDay nur während der Menstruation', () => {
  seed();
  assert.equal(isProtectedDay(REAL), true);
  assert.equal(isProtectedDay(addDays(REAL, 4)), true);
  assert.equal(isProtectedDay(addDays(REAL, 5)), false); // Follikelphase
  assert.equal(isProtectedDay(addDays(REAL, 16)), false); // Lutealphase
});

test('nächste Periode wird in die Zukunft prognostiziert', () => {
  seed();
  const next = nextPredictedStart();
  const today = todayStr();
  // Datumsstabile Invarianten statt eines fixen Datums (der alte Vergleich mit
  // REAL+28 schlug an genau dem Tag fehl, an dem heute == REAL+28 ist):
  assert.ok(next > today, 'Prognose liegt in der Zukunft (nach heute)');
  assert.ok(next > REAL, 'und nach dem letzten echten Start');
  assert.equal(diffDays(REAL, next) % avgCycleLength(), 0, 'im 28-Tage-Raster des echten Starts');
  assert.ok(addDays(next, -avgCycleLength()) <= today, 'erster Termin nach heute (keiner übersprungen)');
  // Ein prognostizierter Menstruationstag ist ebenfalls geschützt.
  assert.equal(isProtectedDay(next), true);
  assert.equal(cyclePhase(next).predicted, true);
});

test('cycleSoftenTargets: offene, fordernde/normale Einheiten am 1. Tag – nicht fix/locker/Wettkampf (#3)', () => {
  const D = '2026-07-11';
  const units = [
    { id: 'a', date: D, type: 'long', status: 'geplant' },
    { id: 'b', date: D, type: 'strength', status: 'geplant' },
    { id: 'c', date: D, type: 'recovery', status: 'geplant' },                    // schon locker -> aus
    { id: 'd', date: D, type: 'cross_football', fixed: true, status: 'geplant' }, // fester Termin -> aus
    { id: 'e', date: D, type: 'race', status: 'geplant' },                        // Wettkampf -> aus
    { id: 'f', date: D, type: 'easy', status: 'erledigt' },                       // erledigt -> aus
    { id: 'g', date: '2026-07-12', type: 'tempo', status: 'geplant' },            // anderer Tag -> aus
  ];
  assert.deepEqual(cycleSoftenTargets(units, D).map((u) => u.id).sort(), ['a', 'b']);
});

test('cycleEaseVariant: Lauf -> Recovery, Kraft -> Mobility, Marker cycleEased (#3)', () => {
  const run = cycleEaseVariant({ type: 'long', targetDistanceKm: 18 });
  assert.equal(run.type, 'recovery');
  assert.equal(run.cycleEased, true);
  assert.equal(run.originalType, 'long');
  const str = cycleEaseVariant({ type: 'strength' });
  assert.equal(str.type, 'mobility');
  assert.equal(str.cycleEased, true);
});

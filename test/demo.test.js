/* Tests für den Demodaten-Builder (js/demo.js). Der Plan selbst wird in
   storage.seedDemo() über den echten Generator erzeugt (browser-getestet). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemo, demoHealthSeries, demoCycle, completeDemoUnits, planPeriodSessions } from '../js/demo.js';
import { isoDow } from '../js/ui.js';
import { trainingLoad } from '../js/load.js';
import { eligibilityFor } from '../js/eligibility.js';
import { SUGGESTED_MEALS } from '../js/nutrition.js';

const TODAY = '2026-06-15';

test('buildDemo: Admin bekommt Profil, Standort, Ziele, Wettkampf, viel Historie + weitere Bereiche', () => {
  const d = buildDemo(TODAY);
  assert.ok(d.profile.heightCm && d.profile.targetWeightKg, 'Profilwerte gesetzt');
  assert.ok(d.profile.birthYear, 'Geburtsjahr für die Kalorienbilanz');
  assert.ok(d.settings && d.settings.location && d.settings.location.lat != null, 'Standort fürs Wetter gesetzt');
  assert.ok(d.settings.healthGoals && d.settings.healthGoals.length >= 2, 'Gesundheitsziele für die Demo');
  assert.equal(d.settings.modules && d.settings.modules.cycle, true, 'Zyklus-Modul aktiviert');
  const usage = d.settings.exerciseUsage || {};
  assert.ok(Object.keys(usage).length >= 8, 'Übungs-Nutzungszähler vorbelegt (v3.11.0)');
  assert.ok((usage.child_pose || 0) > 0 || (usage.superman || 0) > 0, 'auch neue Übungen mit Nutzung');
  assert.equal(d.self.events.length, 1);
  assert.equal(d.self.events[0].kind, 'race');
  assert.ok(d.self.events[0].location, 'Wettkampf hat einen Ort');
  assert.ok(d.self.sessions.length >= 28, `viel Trainingshistorie (war ${d.self.sessions.length})`);
  assert.ok(d.self.sessions.every((s) => s.status === 'erledigt'), 'Historie ist absolviert');
  assert.ok(new Set(d.self.sessions.map((s) => s.type)).size >= 4, 'verschiedene Trainingsarten');
  assert.ok(d.self.health.length >= 6, 'Gewichts-/Pulsreihe');
  assert.ok(d.self.nutrition.length >= 4, 'geplante Gerichte (Wochenplan)');
  assert.ok(d.self.nutrition.every((m) => m.plannedServings > 0 && Array.isArray(m.ingredients) && m.ingredients.length), 'Gerichte eingeplant inkl. Zutaten');
  assert.ok(d.pantry.length >= 4, 'gemeinsames Familien-Lager gefüllt');
  assert.ok(d.pantry.every((p) => p.name && p.unit && p.amount > 0), 'Lager-Einträge vollständig');
  assert.ok(d.self.diary.length >= 2 && d.self.diary.filter((x) => !x._kind).every((x) => x.kcal > 0), 'heute gegessen (Kalorienbilanz; Tagesmarker ohne kcal)');
  assert.ok(d.self.checklist.length >= 4, 'Checkliste (Routinen + Termine)');
  assert.ok(d.self.checklist.some((c) => c.dueDate), 'mindestens ein Termin mit Datum');
  assert.equal(d.self.plans, undefined, 'Plan generiert seedDemo, nicht der Builder');
});

test('buildDemo: 10 Demo-Mitglieder (11-Personen-Szenario) mit voller Datenfülle', () => {
  const d = buildDemo(TODAY);
  assert.equal(d.members.length, 10);
  d.members.forEach((m) => {
    assert.ok(m.name && ['user', 'admin'].includes(m.role));
    assert.ok(Array.isArray(m.data.sessions) && m.data.sessions.length >= 8, 'reichlich Läufe');
    assert.ok(Array.isArray(m.data.health) && m.data.health.length >= 10, 'lange Werte-Reihe');
    assert.ok(Array.isArray(m.data.events));
    assert.ok(m.profile && m.profile.sex && m.profile.settings, 'Mitglied hat ein vollständiges Profil');
  });
  assert.equal(d.members.filter((m) => m.role === 'admin').length, 3, 'mit der Admin-Person zusammen 4 Admins');
  assert.ok(d.members.some((m) => (m.data.nutrition || []).some((x) => x.plannedServings > 0)), 'Mitglieder planen Gerichte (gemeinsamer Wochenplan)');
  assert.ok(d.members.some((m) => m.name === 'Horst') && d.members.some((m) => m.name === 'Henriette'));
});

test('buildDemo: ein Kinder- und Jugendprofil (Jonas, 12) ohne Zielgewicht', () => {
  const d = buildDemo(TODAY);
  const kid = d.members.find((m) => m.name === 'Jonas');
  assert.ok(kid, 'minderjähriges Demo-Mitglied vorhanden');
  const elig = eligibilityFor({ profile: kid.profile, settings: kid.profile.settings, today: TODAY });
  assert.equal(elig.minor, true);
  assert.equal(elig.noWeightGoals, true);
  assert.equal(kid.profile.targetWeightKg, null);
  assert.ok(kid.profile.heightCm < 170, 'kindgerechte Größe');
  // Wachstum: Das Gewicht steigt leicht, statt zu sinken.
  const w = kid.data.health.filter((h) => h.weight != null);
  assert.ok(w.at(-1).weight >= w[0].weight - 0.5);
  // Alle Erwachsenen bleiben Erwachsene.
  assert.equal(d.members.filter((m) => eligibilityFor({ profile: m.profile, settings: m.profile.settings, today: TODAY }).minor).length, 1);
});

test('buildDemo: Tagebuch-Tage bestätigt, Gerichte wie im Rezeptkatalog', () => {
  const d = buildDemo(TODAY);
  const days = new Set(d.self.diary.filter((x) => !x._kind).map((x) => x.date));
  const marked = d.self.diary.filter((x) => x._kind === 'day' && x.complete);
  assert.equal(marked.length, days.size - 1, 'jeder vergangene Tag bestätigt, heute noch offen');
  assert.ok(!marked.some((x) => x.date === TODAY));
  assert.ok(d.self.diary.filter((x) => x._kind).every((x) => x.kcal == null), 'Marker zählen nicht als Mahlzeit');
  for (const m of d.self.nutrition) {
    const cat = SUGGESTED_MEALS.find((s) => s.title === m.title);
    if (!cat) continue;
    assert.equal(m.kcal, cat.kcal, `${m.title}: kcal wie im Katalog`);
    assert.equal(m.protein, cat.protein, `${m.title}: Eiweiß wie im Katalog`);
  }
  const oats = d.self.diary.find((x) => x.date === TODAY && x.title === 'Overnight Oats mit Beeren');
  assert.ok(Math.abs(oats.kcal - SUGGESTED_MEALS.find((s) => s.title === oats.title).kcal) <= 520 * 0.08, 'Tagebuch nahe am Katalogwert');
});

test('buildDemo: 3 Teams – Henriette in 2 Teams, Horst in keinem', () => {
  const d = buildDemo(TODAY);
  assert.equal(d.teams.length, 3);
  const inTeams = (name) => d.teams.filter((t) => t.memberNames.includes(name)).length;
  assert.equal(inTeams('Henriette'), 2, 'Henriette in zwei Teams (Mehrfach-Mitgliedschaft)');
  assert.equal(inTeams('Horst'), 0, 'Horst bleibt ohne Team');
  assert.ok(d.teams.some((t) => t.memberNames.includes('__self__')), 'Admin (Nora) ist in einem Team');
  assert.ok(d.teams.every((t) => t.name && t.memberNames.length >= 3));
});

test('buildDemo: Zyklusdaten hat der Admin UND jede Frau – je eigene, eindeutige (privat)', () => {
  const d = buildDemo(TODAY);
  assert.ok(Array.isArray(d.self.cycle) && d.self.cycle.length >= 1, 'Admin (Nora) hat eigene Zyklusdaten');
  const women = d.members.filter((m) => m.sex === 'w');
  const men = d.members.filter((m) => m.sex === 'm');
  assert.ok(women.length >= 4, 'mehrere weibliche Mitglieder');
  women.forEach((m) => assert.ok(Array.isArray(m.data.cycle) && m.data.cycle.length >= 1, `${m.name} (w) hat eigene Zyklusdaten`));
  men.forEach((m) => assert.equal(m.data.cycle, undefined, `${m.name} (m) hat KEINE Zyklusdaten`));
  // IDs global eindeutig (keine Kollision self ↔ Mitglieder).
  const allCycleIds = [...d.self.cycle, ...women.flatMap((m) => m.data.cycle)].map((c) => c.id);
  assert.equal(new Set(allCycleIds).size, allCycleIds.length, 'Zyklus-IDs eindeutig');
});

test('buildDemo: alle Mitglieder haben vollständige Stammdaten (Profil + Einstellungen)', () => {
  const d = buildDemo(TODAY);
  d.members.forEach((m) => {
    const p = m.profile;
    assert.ok(p && p.heightCm && p.weightKg && p.birthYear && p.sex, `${m.name}: Profil-Basisdaten`);
    assert.ok(p.maxHr && p.restHr && Array.isArray(p.hrZones) && p.hrZones.length === 5, `${m.name}: HF-Zonen`);
    assert.ok(p.paceZones && p.paceZones.threshold, `${m.name}: Pace-Zonen`);
    assert.ok(p.settings && p.settings.location && p.settings.location.lat != null, `${m.name}: Standort`);
    assert.equal(p.settings.modules.cycle, m.sex === 'w', `${m.name}: Zyklus-Modul = weiblich`);
  });
});

test('buildDemo: Sessions in der Vergangenheit, Datum relativ zu today', () => {
  const d = buildDemo(TODAY);
  assert.ok(d.self.sessions.some((s) => s.date < TODAY), 'Vergangenheits-Trainings vorhanden');
  assert.ok(d.self.sessions.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date)));
});

test('demoHealthSeries: lange Reihe mit allen Körper-/Fitnesswerten + realistische Trends', () => {
  const h = demoHealthSeries(TODAY);
  assert.ok(h.length >= 30, `lange Reihe (war ${h.length})`);
  const last = h.at(-1);
  ['weight', 'bodyFat', 'muscleMass', 'visceralFat', 'restingHr', 'hrv', 'sleepHours', 'energy', 'mood'].forEach((k) =>
    assert.ok(last[k] != null, `Metrik ${k} vorhanden`));
  assert.ok(h.some((x) => x.vo2max != null), 'VO2max zumindest teilweise gemessen');
  assert.ok(h[0].weight > last.weight, 'Gewicht fällt über die Zeit');
  assert.ok(h[0].hrv < last.hrv, 'HRV steigt über die Zeit');
  for (let i = 1; i < h.length; i++) assert.ok(h[i - 1].date < h[i].date, 'chronologisch sortiert');
  assert.deepEqual(demoHealthSeries(TODAY), demoHealthSeries(TODAY), 'deterministisch');
});

test('buildDemo: Events nutzen gültige Distanz-Schlüssel (nicht Labels) – sonst crasht das Speichern', () => {
  const d = buildDemo(TODAY);
  const VALID = ['5k', '10k', 'HM', 'M', 'tri-sprint', 'tri-olympic', 'hyrox', 'custom'];
  assert.ok(VALID.includes(d.self.events[0].distanceType), `Admin-Event: ${d.self.events[0].distanceType}`);
  d.members.forEach((m) => (m.data.events || []).forEach((e) => {
    if (e.kind === 'race') assert.ok(VALID.includes(e.distanceType), `Mitglied-Event: ${e.distanceType}`);
  }));
});

test('demoCycle: mehrere Zyklen ~alle 28 Tage, chronologisch', () => {
  const c = demoCycle(TODAY);
  assert.ok(c.length >= 4, 'mehrere Zyklen');
  assert.ok(c.every((x) => x.startDate && x.periodLength > 0));
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].startDate < c[i].startDate, 'chronologisch');
});

test('buildDemo: jede Kategorie hat Demodaten (inkl. Einkaufsliste & Zonen)', () => {
  const d = buildDemo(TODAY);
  ['events', 'sessions', 'health', 'nutrition', 'diary', 'cycle', 'checklist', 'shopping'].forEach((area) =>
    assert.ok(Array.isArray(d.self[area]) && d.self[area].length > 0, `Kategorie ${area} befüllt`));
  assert.ok(d.self.shopping.every((s) => s.name && s.qty), 'Einkaufsliste vollständig');
  assert.ok(d.profile.paceZones && d.profile.hrZones, 'Trainingsbereiche (Pace-/HF-Zonen) im Profil');
});

test('TRAIN-46: Demo mit Vereinsfußball – mit Dauer und Anstrengung in der Belastung', () => {
  const d = buildDemo(TODAY);
  const fb = d.self.sessions.filter((s) => s.type === 'cross_football');
  assert.ok(fb.length >= 16, `Mo/Mi über 9 Wochen, waren ${fb.length}`);
  assert.ok(fb.every((s) => s.durationSec === 5400 && s.rpe === 7 && s.date < TODAY));
  assert.ok(fb.every((s) => [1, 3].includes(isoDow(s.date))), 'nur montags und mittwochs');
  const load7 = trainingLoad(d.self.sessions, TODAY, 7);
  const noFb = trainingLoad(d.self.sessions.filter((s) => s.type !== 'cross_football'), TODAY, 7);
  assert.ok(load7 > noFb, 'Fußball zählt in die Belastung');
});

test('Demo: im Planzeitraum endet die alte Lauf-Routine – Fußball und Extra-Einheiten bleiben', () => {
  const d = buildDemo(TODAY);
  const start = '2026-06-01';
  const kept = planPeriodSessions(d.self.sessions, start, TODAY);
  const inPeriod = kept.filter((s) => s.date >= start && s.date < TODAY);
  assert.ok(inPeriod.length > 0);
  assert.ok(inPeriod.every((s) => s.type === 'cross_football' || s.extra), 'nur Fußball und ausdrücklich zusätzliche Einheiten');
  assert.equal(inPeriod.filter((s) => s.extra).length, 2);
  assert.ok(kept.some((s) => s.date < start && s.type === 'long'), 'Historie davor bleibt');
});

test('TRAIN-46: jede vergangene erledigte Plan-Einheit hat ein Training (auch Fußball)', () => {
  const units = [
    { id: 'fb', date: '2026-06-08', type: 'cross_football', title: 'Fußballtraining', fixed: true, intensity: 'normal', targetDurationMin: 90, status: 'erledigt' },
    { id: 'm', date: '2026-06-07', type: 'match', title: 'Fußballspiel', fixed: true, targetDurationMin: 120, status: 'erledigt' },
    { id: 'e', date: '2026-06-09', type: 'easy', title: 'Lockerer Dauerlauf', targetDistanceKm: 8, targetPaceSecPerKm: 350, targetPaceMaxSecPerKm: 370, status: 'erledigt' },
    { id: 'r', date: '2026-06-10', type: 'rest', status: 'erledigt' },
    { id: 'x', date: '2026-06-11', type: 'easy', status: 'erledigt', executedSessionId: 'schon' },
    { id: 'f', date: '2026-06-20', type: 'long', status: 'geplant' },
  ];
  const { units: us, sessions } = completeDemoUnits(units, [], TODAY, 'e1');
  const byUnit = new Map(sessions.map((s) => [s.plannedId, s]));
  assert.equal(byUnit.get('fb').durationSec, 90 * 60);
  assert.equal(byUnit.get('fb').rpe, 7);
  assert.equal(byUnit.get('m').rpe, 8);
  assert.equal(byUnit.get('e').distanceKm, 8);
  assert.equal(byUnit.get('e').paceSecPerKm, 360);
  assert.ok(!byUnit.has('r') && !byUnit.has('x') && !byUnit.has('f'), 'Ruhetag, schon verknüpfte und künftige Einheiten bleiben');
  assert.ok(us.filter((u) => ['fb', 'm', 'e'].includes(u.id)).every((u) => u.executedSessionId));
});

test('UI-31: Demo-Mitglieder zeigen keine internen Kürzel in sichtbaren Namen', async () => {
  const { demoMemberData } = await import('../js/demo.js');
  const d = demoMemberData('dm7', '2026-09-29', { level: 'high', raceOffset: 40 });
  const visible = [...(d.events || []).map((e) => e.name), ...(d.nutrition || []).map((n) => n.title)];
  assert.ok(visible.length > 0);
  assert.ok(visible.every((t) => !t.includes('dm7')), visible.join(' | '));
});

test('v3.21.0: Demo zeigt Strecke, Kraftsätze und die Trainer-Sicht', async () => {
  const { demoRoute, DEMO_STRENGTH_IDS } = await import('../js/demo.js');
  const { decodePolyline, haversineSum } = await import('../js/gpx.js');
  const { teamLoad } = await import('../js/teamstats.js');
  // Strecke: Länge passt zur Einheit, Höhenmeter unter der Hügel-Schwelle der Form-Schätzung.
  const r = demoRoute(17);
  const pts = decodePolyline(r.route.poly);
  assert.ok(pts.length >= 50 && pts.length <= 150, `${pts.length} Punkte`);
  assert.ok(Math.abs(haversineSum(pts) / 1000 - 17) < 0.5);
  assert.equal(r.route.ele.length, 60);
  assert.ok(r.ascentM > 0 && r.ascentM < 5 * 17, `${r.ascentM} Hm`);

  const units = [
    { id: 'k1', date: '2026-06-02', type: 'strength', title: 'Kraft', targetDurationMin: 40, status: 'erledigt' },
    { id: 'k2', date: '2026-06-09', type: 'strength', title: 'Kraft', targetDurationMin: 40, status: 'erledigt' },
    { id: 'k3', date: '2026-06-16', type: 'strength', title: 'Kraft', targetDurationMin: 40, status: 'geplant' },
    { id: 'l1', date: '2026-06-06', type: 'long', title: 'Long Run', targetDistanceKm: 14, status: 'erledigt' },
    { id: 'l2', date: '2026-06-13', type: 'long', title: 'Long Run', targetDistanceKm: 16, status: 'erledigt' },
  ];
  const before = JSON.stringify(units);
  const { units: us, sessions } = completeDemoUnits(units, [], TODAY, 'e1');
  assert.equal(JSON.stringify(units), before, 'Eingabe bleibt unverändert');
  assert.ok(us.filter((u) => u.type === 'strength').every((u) => u.exerciseIds.join() === DEMO_STRENGTH_IDS.join()), 'auch die künftige Krafteinheit');
  const k = sessions.filter((s) => s.type === 'strength').sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(k.length, 2);
  const squat = (s) => s.strengthSets.find((x) => x.exerciseId === 'squat').sets[0].kg;
  assert.ok(squat(k[1]) > squat(k[0]), 'das Gewicht steigt');
  const longs = sessions.filter((s) => s.type === 'long').sort((a, b) => a.date.localeCompare(b.date));
  assert.ok(!longs[0].route && longs[1].route && longs[1].ascentM > 0, 'nur der jüngste lange Lauf hat eine Strecke');

  // Trainer-Sicht: einige Erwachsene geben frei, das Kind nie; die Karte hat Zeilen.
  const d = buildDemo(TODAY);
  const sharing = d.members.filter((m) => m.profile.settings.shareLoad === true);
  assert.ok(sharing.length >= 2);
  assert.ok(d.members.filter((m) => m.name === 'Jonas').every((m) => m.profile.settings.shareLoad === false));
  const rows = teamLoad(d.members.map((m) => ({ id: m.name, name: m.name, shareLoad: m.profile.settings.shareLoad, maxHr: m.profile.maxHr, sessions: m.data.sessions, health: m.data.health })), TODAY);
  assert.equal(rows.length, sharing.length);
});

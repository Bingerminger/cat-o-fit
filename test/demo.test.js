/* Tests für den Demodaten-Builder (js/demo.js). Der Plan selbst wird in
   storage.seedDemo() über den echten Generator erzeugt (browser-getestet). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemo, demoHealthSeries, demoCycle } from '../js/demo.js';

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
  assert.ok(d.self.diary.length >= 2 && d.self.diary.every((x) => x.kcal > 0), 'heute gegessen (Kalorienbilanz)');
  assert.ok(d.self.checklist.length >= 4, 'Checkliste (Routinen + Termine)');
  assert.ok(d.self.checklist.some((c) => c.dueDate), 'mindestens ein Termin mit Datum');
  assert.equal(d.self.plans, undefined, 'Plan generiert seedDemo, nicht der Builder');
});

test('buildDemo: 9 Demo-Mitglieder (10-Personen-Szenario) mit voller Datenfülle', () => {
  const d = buildDemo(TODAY);
  assert.equal(d.members.length, 9);
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

/* Workout history from Strong, Hevy and FitNotes (CSV): format detection, sets in kg (pounds
   converted), cardio rows skipped, exercise names matched only exactly – "Deadlift (Barbell)" is
   not our Romanian deadlift – and the session records the app stores. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectFormat, parseWhen, parseDuration, matchExercise, readStrengthCsv, toSession, alreadyImported } from '../js/strength-import.js';

const STRONG = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-09-01 18:00:00,Push Day,1h 5m,Bench Press (Barbell),1,60,10,0,0,,,8
2026-09-01 18:00:00,Push Day,1h 5m,Bench Press (Barbell),2,62.5,8,0,0,,,9
2026-09-01 18:00:00,Push Day,1h 5m,Push Up,1,0,15,0,0,,,
2026-09-01 18:00:00,Push Day,1h 5m,Treadmill,1,0,0,2,600,,,
2026-09-03 18:00:00,Legs,50m,Squat (Barbell),1,80,5,0,0,,,
2026-09-03 18:00:00,Legs,50m,Deadlift (Barbell),1,100,5,0,0,,,
2026-09-03 18:00:00,Legs,50m,Romanian Deadlift (Barbell),1,70,8,0,0,,,
`;
const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Upper","15 Sep 2026, 07:30","15 Sep 2026, 08:20","","Pull Up","","","0","normal","","8","","",""
"Upper","15 Sep 2026, 07:30","15 Sep 2026, 08:20","","Bicep Curl (Dumbbell)","","","0","normal","12","10","","","8"
"Upper","15 Sep 2026, 07:30","15 Sep 2026, 08:20","","Bicep Curl (Dumbbell)","","","1","normal","12","9","","","9"
`;
const FITNOTES = `Date,Exercise,Category,Weight (lbs),Reps,Distance,Distance Unit,Time,Comment
2026-09-20,Flat Barbell Bench Press,Chest,135.0,8,,,,
2026-09-20,Plank,Abs,,,,,0:01:00,
`;

test('CSV: separator from the header, quotes and doubled quotes, CRLF', () => {
  assert.deepEqual(parseCsv('a;b\r\n"x;1";"say ""hi"""\r\n'), [['a', 'b'], ['x;1', 'say "hi"']]);
  assert.deepEqual(parseCsv('﻿a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('format detection, dates and durations of the three apps', () => {
  assert.equal(detectFormat(parseCsv(STRONG)[0]), 'strong');
  assert.equal(detectFormat(parseCsv(HEVY)[0]), 'hevy');
  assert.equal(detectFormat(parseCsv(FITNOTES)[0]), 'fitnotes');
  assert.equal(detectFormat(['Date', 'Distance']), null);
  assert.deepEqual(parseWhen('2026-09-01 18:00:00'), { date: '2026-09-01', minutes: 1080 });
  assert.deepEqual(parseWhen('15 Sep 2026, 07:30'), { date: '2026-09-15', minutes: 450 });
  assert.deepEqual(parseWhen('2026-09-20'), { date: '2026-09-20', minutes: null });
  assert.equal(parseDuration('1h 5m'), 3900);
  assert.equal(parseDuration('50m'), 3000);
  assert.equal(parseDuration('2700'), 2700);
});

test('exercise names: exact matches only – the conventional deadlift stays an exercise of its own', () => {
  assert.equal(matchExercise('Push Up'), 'pushup');
  assert.equal(matchExercise('Pull Up'), 'pullup');
  assert.equal(matchExercise('Squat (Barbell)'), 'squat');
  assert.equal(matchExercise('Bicep Curl (Dumbbell)'), 'biceps_curl');
  assert.equal(matchExercise('Romanian Deadlift (Barbell)'), 'deadlift');
  assert.equal(matchExercise('Deadlift (Barbell)'), null);
  assert.equal(matchExercise('Bench Press (Barbell)'), null);
  assert.equal(matchExercise('Hack Squat (Machine)'), null, 'a longer name is another exercise');
});

test('Strong: workouts with sets, bodyweight sets without weight, cardio skipped', () => {
  const r = readStrengthCsv(STRONG);
  assert.equal(r.format, 'strong');
  assert.equal(r.unitKnown, false, 'Strong without a unit column – the app asks kg or lb');
  assert.equal(r.skipped, 1, 'the treadmill row');
  assert.equal(r.workouts.length, 2);
  const [push, legs] = r.workouts;
  assert.equal(push.title, 'Push Day');
  assert.equal(push.durationSec, 3900);
  assert.equal(push.rpe, 9, 'average of the set RPEs, rounded');
  assert.deepEqual(push.exercises.map((x) => [x.name, x.exerciseId, x.sets.length]), [['Bench Press (Barbell)', null, 2], ['Push Up', 'pushup', 1]]);
  assert.deepEqual(push.exercises[1].sets[0], { reps: 15, kg: null });
  assert.deepEqual(legs.exercises.map((x) => x.exerciseId), ['squat', null, 'deadlift']);
});

test('Strong in pounds and with semicolons', () => {
  const r = readStrengthCsv(STRONG.replace(/,/g, ';'), { unit: 'lb' });
  assert.equal(r.workouts.length, 2);
  assert.equal(r.workouts[0].exercises[0].sets[0].kg, 27.25, '60 lb ≈ 27.2 kg, in steps of 0.25');
});

test('Hevy and FitNotes: duration from start and end, pounds converted, rows without reps skipped', () => {
  const h = readStrengthCsv(HEVY);
  assert.equal(h.unitKnown, true);
  assert.equal(h.workouts.length, 1);
  assert.equal(h.workouts[0].durationSec, 3000);
  assert.deepEqual(h.workouts[0].exercises.map((x) => [x.exerciseId, x.sets.length]), [['pullup', 1], ['biceps_curl', 2]]);
  const f = readStrengthCsv(FITNOTES);
  assert.equal(f.skipped, 1, 'the plank (time, no reps)');
  assert.deepEqual(f.workouts[0].exercises[0].sets, [{ reps: 8, kg: 61.25 }]);
  assert.equal(f.workouts[0].title, '');
});

test('session records: known exercises by id, others by name; a second import is recognised', () => {
  const w = readStrengthCsv(STRONG).workouts[0];
  const s = toSession(w, 'strong');
  assert.equal(s.type, 'strength');
  assert.equal(s.source, 'strong');
  assert.deepEqual(s.strengthSets[0], { exerciseId: null, name: 'Bench Press (Barbell)', sets: w.exercises[0].sets });
  assert.equal(s.strengthSets[1].exerciseId, 'pushup');
  assert.equal(alreadyImported(w, 'strong', [{ ...s, id: 'x' }]), true);
  assert.equal(alreadyImported(w, 'hevy', [{ ...s, id: 'x' }]), false);
});

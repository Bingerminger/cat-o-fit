/* GPX/TCX-Import: Sportart, lokales Datum, Bewegungszeit, Splits, Zeit in
   HF-Zonen (TRAIN-28, FE-21, FE-22). Zeitzone fest auf Europe/Berlin – dieser
   Testprozess läuft für sich, die Einstellung wirkt nur hier. */
process.env.TZ = 'Europe/Berlin';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { parseActivityFile, sportType } = await import('../js/gpx.js');

function gpx(points, type = null) {
  return `<gpx><trk>${type ? `<type>${type}</type>` : ''}<trkseg>${points.map((p) =>
    `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${p.t}</time>${p.hr ? `<extensions><gpxtpx:hr>${p.hr}</gpxtpx:hr></extensions>` : ''}</trkpt>`).join('')}</trkseg></trk></gpx>`;
}
/** Gerade Strecke nach Norden: je Punkt `stepM` Meter in `stepSec` Sekunden. */
function track({ start = '2026-09-26T08:00:00Z', n = 60, stepM = 100, stepSec = 30, hr = 140, pauseAt = null, pauseSec = 0 } = {}) {
  const pts = [];
  let t = Date.parse(start);
  for (let i = 0; i < n; i++) {
    pts.push({ lat: (51 + (i * stepM) / 111195).toFixed(6), lon: '13.000000', t: new Date(t).toISOString(), hr: typeof hr === 'function' ? hr(i) : hr });
    t += stepSec * 1000;
    if (pauseAt === i) { pts.push({ lat: (51 + (i * stepM) / 111195).toFixed(6), lon: '13.000000', t: new Date(t + pauseSec * 1000).toISOString(), hr: 100 }); t += pauseSec * 1000; }
  }
  return pts;
}

test('FE-21: Datum in lokaler Zeit – Nachtlauf um 0:40 Uhr gehört zum lokalen Tag', () => {
  const s = parseActivityFile(gpx(track({ start: '2026-09-27T22:40:00Z', n: 10 })));   // So 28.09. 00:40 MESZ
  assert.equal(s.date, '2026-09-28');
  const ny = parseActivityFile(gpx(track({ start: '2026-12-31T23:30:00Z', n: 10 })));  // Fr 01.01.2027 00:30 MEZ
  assert.equal(ny.date, '2027-01-01');
});

test('TRAIN-28: Sportart aus der Datei – eine Radtour wird kein Lauf', () => {
  const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap><TotalTimeSeconds>4200</TotalTimeSeconds><DistanceMeters>20000</DistanceMeters><Track>
    <Trackpoint><Time>2026-09-20T07:00:00Z</Time><DistanceMeters>0</DistanceMeters></Trackpoint>
    <Trackpoint><Time>2026-09-20T08:10:00Z</Time><DistanceMeters>20000</DistanceMeters></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const s = parseActivityFile(tcx);
  assert.equal(s.type, 'cross_bike');
  assert.equal(s.sportKnown, true);
  assert.equal(parseActivityFile(gpx(track({ n: 5 }), 'running')).type, 'run');
  assert.equal(parseActivityFile(gpx(track({ n: 5 }), 'hiking')).type, 'hike');
  assert.equal(parseActivityFile(gpx(track({ n: 5 }))).sportKnown, false, 'ohne Angabe: unbekannt (der Import fragt nach)');
  assert.equal(sportType('9'), 'run');
  assert.equal(sportType('1'), 'cross_bike');
  assert.equal(sportType('Yoga'), null);
});

test('TRAIN-28: Bewegungszeit statt Bruttozeit (Pausen herausgerechnet)', () => {
  const pts = track({ n: 61, stepM: 100, stepSec: 30, pauseAt: 30, pauseSec: 600 });
  const s = parseActivityFile(gpx(pts, 'running'));
  assert.equal(s.elapsedSec, 60 * 30 + 600);
  assert.ok(Math.abs(s.durationSec - 60 * 30) <= 31, `10 min Pause nicht mitgezählt, war ${s.durationSec}`);
});

test('FE-22: Kilometer-Splits und Zeit in HF-Zonen aus den Trackpunkten', () => {
  // 6 km in 100-m-Schritten, erste 3 km à 5:00, dann à 4:30 min/km.
  const pts = [];
  let t = Date.parse('2026-09-26T08:00:00Z');
  for (let i = 0; i <= 62; i++) {
    pts.push({ lat: (51 + (i * 100) / 111195).toFixed(6), lon: '13.000000', t: new Date(t).toISOString(), hr: i <= 30 ? 140 : 165 });
    t += (i < 30 ? 30 : 27) * 1000;
  }
  const zones = [{ zone: 1, min: 95, max: 114 }, { zone: 2, min: 114, max: 133 }, { zone: 3, min: 133, max: 152 }, { zone: 4, min: 152, max: 171 }, { zone: 5, min: 171, max: 190 }];
  const s = parseActivityFile(gpx(pts, 'running'), { hrZones: zones });
  assert.equal(s.splits.length, 6);
  assert.ok(Math.abs(s.splits[0].sec - 300) <= 2, `km 1 ≈ 5:00, war ${s.splits[0].sec}`);
  assert.ok(Math.abs(s.splits[5].sec - 270) <= 2, `km 6 ≈ 4:30, war ${s.splits[5].sec}`);
  assert.ok(s.timeInZones[3] > 800 && s.timeInZones[4] > 700, JSON.stringify(s.timeInZones));
  assert.equal(parseActivityFile(gpx(pts, 'running')).timeInZones, null, 'ohne Zonen keine Zonenzeiten');
  assert.equal(parseActivityFile(gpx(pts, 'cycling')).splits.length, 0, 'Rad: keine Lauf-Splits');
});

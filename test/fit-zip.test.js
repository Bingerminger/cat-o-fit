/* =========================================================================
   fit-zip.test.js — Trainingsdateien ohne Bibliothek: FIT (Binärformat der Uhren),
   ZIP und GZ (Massenexporte), dazu Strecke (Polyline) und Höhenmeter.
   Die FIT- und ZIP-Dateien baut der Test selbst – so ist jedes Feld bekannt.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { readFit, parseFit, isFit } from '../js/fit.js';
import { unzip, gunzip, isZip } from '../js/zip.js';
import { activitiesFrom, sameActivity, guessType } from '../js/activity-import.js';
import { encodePolyline, decodePolyline, simplifyRoute, ascentOf, parseActivityFile } from '../js/gpx.js';

const FIT_EPOCH = Date.UTC(1989, 11, 31) / 1000;
const fitTs = (iso) => Math.round(Date.parse(iso) / 1000 - FIT_EPOCH);

/** Minimaler FIT-Schreiber: Definitionen + Daten, optional komprimierte Zeitstempel. */
function fitFile({ records = [], session = null, activity = null, bigEndianSession = false, compressed = false }) {
  const chunks = [];
  const def = (local, global, fields, little = true) => {
    const b = [0x40 | local, 0, little ? 0 : 1, ...(little ? [global & 0xff, global >> 8] : [global >> 8, global & 0xff]), fields.length];
    for (const [num, size, type] of fields) b.push(num, size, type);
    chunks.push(Uint8Array.from(b));
  };
  const data = (header, fields, values, little = true) => {
    const size = fields.reduce((a, f) => a + f[1], 0);
    const dv = new DataView(new ArrayBuffer(1 + size));
    dv.setUint8(0, header);
    let o = 1;
    fields.forEach(([, sz, type], i) => {
      const v = values[i];
      const t = type & 0x1f;
      if (t === 0 || t === 2) dv.setUint8(o, v);
      else if (t === 4) dv.setUint16(o, v, little);
      else if (t === 5) dv.setInt32(o, v, little);
      else if (t === 6) dv.setUint32(o, v, little);
      o += sz;
    });
    chunks.push(new Uint8Array(dv.buffer));
  };
  const REC = [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [3, 1, 0x02], [5, 4, 0x86]];
  const REC_NOTS = REC.slice(1);
  if (records.length) {
    def(0, 20, REC);
    if (compressed) def(1, 20, REC_NOTS);
    records.forEach((r, i) => {
      const vals = [Math.round(r.lat / (180 / 2 ** 31)), Math.round(r.lon / (180 / 2 ** 31)), Math.round((r.ele + 500) * 5), r.hr, Math.round(r.dist * 100)];
      if (compressed && i > 0) data(0x80 | (1 << 5) | (r.ts & 0x1f), REC_NOTS, vals);
      else data(0, REC, [r.ts, ...vals]);
    });
  }
  if (session) {
    const F = [[2, 4, 0x86], [5, 1, 0x00], [6, 1, 0x00], [7, 4, 0x86], [8, 4, 0x86], [9, 4, 0x86], [11, 2, 0x84], [16, 1, 0x02], [17, 1, 0x02], [22, 2, 0x84]];
    def(2, 18, F, !bigEndianSession);
    data(2, F, [session.start, session.sport, session.sub ?? 0, session.elapsedMs, session.timerMs, session.distCm, session.kcal, session.avgHr, session.maxHr, session.ascent], !bigEndianSession);
  }
  if (activity) {
    const F = [[253, 4, 0x86], [5, 4, 0x86]];
    def(3, 34, F);
    data(3, F, [activity.ts, activity.local]);
  }
  const body = Uint8Array.from(chunks.flatMap((c) => [...c]));
  const head = new Uint8Array(14);
  const hv = new DataView(head.buffer);
  head[0] = 14; head[1] = 0x10; hv.setUint16(2, 2132, true); hv.setUint32(4, body.length, true);
  head.set([0x2e, 0x46, 0x49, 0x54], 8);
  return Uint8Array.from([...head, ...body, 0, 0]);
}

/** Lauf nach Norden: 60 Punkte, alle 30 s 100 m, bergauf 1 m je Punkt. */
function runRecords(startIso = '2026-09-27T22:30:00Z', n = 60) {
  const t0 = fitTs(startIso);
  return Array.from({ length: n }, (_, i) => ({ ts: t0 + i * 30, lat: 51 + (i * 100) / 111195, lon: 13, ele: 100 + i, hr: 140 + (i % 20), dist: i * 100 }));
}

/** ZIP mit „stored“- und „deflate“-Einträgen (Prüfsumme 0 – der Leser prüft sie nicht). */
function zipFile(entries) {
  const local = [], central = [];
  let off = 0;
  for (const { name, data, deflate } of entries) {
    const nb = new TextEncoder().encode(name);
    const comp = deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, deflate ? 8 : 0, true);
    lh.setUint32(18, comp.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    local.push(new Uint8Array(lh.buffer), nb, comp);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, deflate ? 8 : 0, true);
    ch.setUint32(20, comp.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + comp.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, off, true);
  return Uint8Array.from([...local, ...central, new Uint8Array(eo.buffer)].flatMap((c) => [...c]));
}

test('FIT: Lauf mit Summen der Uhr, Strecke, Höhe, Kalendertag in der Ortszeit', () => {
  const recs = runRecords();
  const start = recs[0].ts;
  const file = fitFile({
    records: recs,
    session: { start, sport: 1, elapsedMs: 1800000, timerMs: 1770000, distCm: 590000, kcal: 410, avgHr: 150, maxHr: 170, ascent: 42 },
    activity: { ts: start + 1800, local: start + 1800 + 7200 },   // Uhr lief auf UTC+2
  });
  assert.ok(isFit(file));
  const a = parseFit(file);
  assert.equal(a.type, 'run');
  assert.equal(a.sportKnown, true);
  assert.equal(a.durationSec, 1770, 'Stoppuhr-Zeit der Uhr');
  assert.equal(a.distanceKm, 5.9);
  assert.equal(a.avgHr, 150);
  assert.equal(a.maxHr, 170);
  assert.equal(a.kcal, 410);
  assert.equal(a.ascentM, 42, 'Höhenmeter der Uhr haben Vorrang');
  assert.equal(a.date, '2026-09-28', 'Start 22:30 UTC = 0:30 Uhr Ortszeit am Folgetag');
  assert.equal(a.splits.length, 5, 'fünf volle Kilometer aus den Messpunkten');
  const pts = decodePolyline(a.route.poly);
  assert.ok(pts.length >= 2 && pts.length <= 150);
  assert.ok(Math.abs(pts[0][0] - 51) < 1e-4 && Math.abs(pts[0][1] - 13) < 1e-4, 'Strecke beginnt am Start');
  assert.equal(a.route.ele.length, 60);
  assert.equal(a.route.ele[0], 100);
  assert.equal(a.route.ele[59], 159);
});

test('FIT: komprimierte Zeitstempel, Big-Endian-Session, Sportarten aus Unterart', () => {
  const recs = runRecords('2026-09-20T07:00:00Z', 40).map((r, i) => ({ ...r, ts: r.ts }));
  const file = fitFile({ records: recs, compressed: true, session: { start: recs[0].ts, sport: 10, sub: 20, elapsedMs: 1200000, timerMs: 1200000, distCm: 0, kcal: 200, avgHr: 120, maxHr: 150, ascent: 0 }, bigEndianSession: true });
  const fit = readFit(file);
  assert.equal(fit.records.length, 40);
  assert.equal(fit.records[5][253], recs[5].ts, 'Zeitstempel aus dem komprimierten Kopf');
  const a = parseFit(file);
  assert.equal(a.type, 'strength', 'Training + Unterart Kraft');
  assert.equal(a.durationSec, 1200);
  const bike = parseFit(fitFile({ records: runRecords(), session: { start: runRecords()[0].ts, sport: 2, elapsedMs: 1800000, timerMs: 1800000, distCm: 1500000, kcal: 300, avgHr: 130, maxHr: 150, ascent: 10 } }));
  assert.equal(bike.type, 'cross_bike');
  assert.deepEqual(bike.splits, [], 'keine Lauf-Splits fürs Rad');
});

test('FIT: kaputte oder fremde Dateien → null', () => {
  assert.equal(parseFit(new Uint8Array([1, 2, 3])), null);
  assert.equal(isFit(new TextEncoder().encode('<gpx></gpx>')), false);
  const cut = fitFile({ records: runRecords() }).slice(0, 60);   // mitten in den Daten abgeschnitten
  assert.doesNotThrow(() => parseFit(cut));
});

test('Strecke: Polyline hin und zurück, Vereinfachung auf höchstens 150 Punkte, Höhenmeter ohne Rauschen', () => {
  const pts = [[51.05, 13.7373], [51.0512, 13.7401], [51.049, 13.745]];
  assert.deepEqual(decodePolyline(encodePolyline(pts)), pts);
  const zigzag = Array.from({ length: 1000 }, (_, i) => [51 + i * 1e-4, 13 + (i % 2 ? 2e-4 : 0)]);
  const s = simplifyRoute(zigzag);
  assert.ok(s.length <= 150 && s.length >= 2);
  assert.deepEqual(s[0], zigzag[0]);
  assert.deepEqual(s[s.length - 1], zigzag[999]);
  assert.equal(ascentOf([100, 101, 99, 100, 102, 110, 109, 120]), 21, 'vom Tiefpunkt 99 auf 120 – der Wackler 110 → 109 zählt nicht');
});

test('GPX: Höhe (<ele>) ergibt Höhenmeter und Profil', () => {
  const t0 = Date.parse('2026-09-26T08:00:00Z');
  const gpx = `<gpx><trk><type>running</type><trkseg>${Array.from({ length: 30 }, (_, i) =>
    `<trkpt lat="${(51 + (i * 100) / 111195).toFixed(6)}" lon="13.000000"><ele>${200 + i * 2}</ele><time>${new Date(t0 + i * 30000).toISOString()}</time></trkpt>`).join('')}</trkseg></trk></gpx>`;
  const a = parseActivityFile(gpx);
  assert.equal(a.ascentM, 58);
  assert.equal(a.route.ele[0], 200);
});

test('ZIP und GZ: Einträge entpacken, Ordner und Fremdes überspringen', async () => {
  const fit = fitFile({ records: runRecords() });
  const zip = zipFile([
    { name: 'activities/', data: new Uint8Array(0) },
    { name: 'activities/1.fit', data: fit, deflate: true },
    { name: 'activities/notes.txt', data: new TextEncoder().encode('hallo') },
  ]);
  assert.ok(isZip(zip));
  const all = await unzip(zip);
  assert.deepEqual(all.map((e) => e.name), ['activities/1.fit', 'activities/notes.txt']);
  assert.deepEqual([...all[0].data], [...fit], 'deflate-Eintrag byte-gleich entpackt');
  const onlyFit = await unzip(zip, (n) => n.endsWith('.fit'));
  assert.equal(onlyFit.length, 1);
  assert.deepEqual([...(await gunzip(new Uint8Array(gzipSync(Buffer.from('abc')))))], [97, 98, 99]);
  await assert.rejects(() => unzip(new Uint8Array(40)), /kein ZIP/);
});

test('Massenimport: ZIP im ZIP (Garmin), .fit.gz (Strava), GPX – sortiert, Unlesbares gezählt', async () => {
  const run = fitFile({ records: runRecords('2026-09-02T06:00:00Z'), session: { start: fitTs('2026-09-02T06:00:00Z'), sport: 1, elapsedMs: 1800000, timerMs: 1800000, distCm: 600000, kcal: 400, avgHr: 150, maxHr: 170, ascent: 5 } });
  const ride = fitFile({ records: runRecords('2026-09-01T06:00:00Z'), session: { start: fitTs('2026-09-01T06:00:00Z'), sport: 2, elapsedMs: 3600000, timerMs: 3600000, distCm: 3000000, kcal: 700, avgHr: 130, maxHr: 150, ascent: 80 } });
  const inner = zipFile([{ name: 'UploadedFiles_0-_Part1/run.fit', data: run, deflate: true }]);
  const outer = zipFile([
    { name: 'DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip', data: inner },
    { name: 'activities/ride.fit.gz', data: new Uint8Array(gzipSync(Buffer.from(ride))) },
    { name: 'activities/broken.fit', data: new Uint8Array([0, 1, 2, 3]) },
    { name: 'README.txt', data: new TextEncoder().encode('ignoriert') },
  ]);
  const seen = [];
  const r = await activitiesFrom([{ name: 'export.zip', data: outer }], { onProgress: (n) => seen.push(n) });
  assert.deepEqual(r.activities.map((x) => x.act.type), ['cross_bike', 'run'], 'älteste zuerst');
  assert.equal(r.activities[1].name, 'UploadedFiles_0-_Part1/run.fit');
  assert.equal(r.activities[0].name, 'activities/ride.fit', '.gz entpackt');
  assert.equal(r.skipped, 1, 'kaputte Datei gezählt, README gar nicht erst gelesen');
  assert.ok(seen.length >= 3);
});

test('Doppel-Erkennung und Sportart-Schätzung', () => {
  assert.ok(sameActivity({ date: '2026-09-01', distanceKm: 10, durationSec: 3000 }, { date: '2026-09-01', distanceKm: 10.2, durationSec: 3050 }));
  assert.ok(!sameActivity({ date: '2026-09-01', distanceKm: 10, durationSec: 3000 }, { date: '2026-09-02', distanceKm: 10, durationSec: 3000 }));
  assert.equal(guessType({ sportKnown: false, distanceKm: 30, durationSec: 3600 }), 'cross_bike');
  assert.equal(guessType({ sportKnown: false, distanceKm: 10, durationSec: 3600 }), 'run');
  assert.equal(guessType({ sportKnown: true, type: 'swim' }), 'swim');
});

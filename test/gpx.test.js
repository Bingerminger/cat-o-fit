/* Unit tests for js/gpx.js — string-based GPX/TCX parser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActivityFile, haversineSum } from '../js/gpx.js';

test('parseActivityFile: GPX with HR and coordinates', () => {
  const gpx = `<gpx><trk><trkseg>
    <trkpt lat="51.05" lon="13.74"><time>2026-06-20T08:00:00Z</time><extensions><gpxtpx:hr>140</gpxtpx:hr></extensions></trkpt>
    <trkpt lat="51.06" lon="13.75"><time>2026-06-20T08:05:00Z</time><extensions><gpxtpx:hr>150</gpxtpx:hr></extensions></trkpt>
  </trkseg></trk></gpx>`;
  const s = parseActivityFile(gpx);
  assert.equal(s.date, '2026-06-20');
  assert.equal(s.durationSec, 300);
  assert.equal(s.avgHr, 145);
  assert.ok(s.distanceKm > 0.5 && s.distanceKm < 3, `Plausible distance: ${s.distanceKm}`);
  assert.equal(s.type, 'run');
});

test('parseActivityFile: TCX with DistanceMeters and HeartRateBpm', () => {
  const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="Running">
    <Lap><TotalTimeSeconds>1800</TotalTimeSeconds><DistanceMeters>5000</DistanceMeters>
    <Track>
    <Trackpoint><Time>2026-06-21T07:00:00Z</Time><HeartRateBpm><Value>142</Value></HeartRateBpm><DistanceMeters>0</DistanceMeters></Trackpoint>
    <Trackpoint><Time>2026-06-21T07:30:00Z</Time><HeartRateBpm><Value>158</Value></HeartRateBpm><DistanceMeters>5000</DistanceMeters></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const s = parseActivityFile(tcx);
  assert.equal(s.date, '2026-06-21');
  assert.equal(s.durationSec, 1800);
  assert.equal(s.distanceKm, 5);
  assert.equal(s.avgHr, 150);
});

test('parseActivityFile: garbage/empty/timeless input -> null', () => {
  assert.equal(parseActivityFile('hallo welt'), null);
  assert.equal(parseActivityFile(''), null);
  assert.equal(parseActivityFile(null), null);
  assert.equal(parseActivityFile('<gpx><trkpt lat="1" lon="2"/></gpx>'), null); // fewer than two timestamps
});

test('haversineSum: ~1.11 km per 0.01° of latitude', () => {
  const m = haversineSum([[51.0, 13.0], [51.01, 13.0]]);
  assert.ok(m > 1050 && m < 1170, `~1110 m, was ${Math.round(m)}`);
  assert.equal(haversineSum([[51, 13]]), 0); // single point
});

test('parseActivityFile: Garmin ns3:hr namespace is recognised', () => {
  const gpx = `<gpx><trkpt lat="51.05" lon="13.74"><time>2026-06-20T08:00:00Z</time><extensions><ns3:hr>138</ns3:hr></extensions></trkpt>
    <trkpt lat="51.06" lon="13.75"><time>2026-06-20T08:10:00Z</time><extensions><ns3:hr>152</ns3:hr></extensions></trkpt></gpx>`;
  const s = parseActivityFile(gpx);
  assert.equal(s.avgHr, 145);
  assert.equal(s.durationSec, 600);
});

test('parseActivityFile: without HR avgHr stays null, distance is still computed', () => {
  const gpx = `<gpx><trkpt lat="51.0" lon="13.0"><time>2026-06-20T08:00:00Z</time></trkpt>
    <trkpt lat="51.02" lon="13.0"><time>2026-06-20T08:15:00Z</time></trkpt></gpx>`;
  const s = parseActivityFile(gpx);
  assert.equal(s.avgHr, null);
  assert.ok(s.distanceKm > 2.0 && s.distanceKm < 2.4, `Distance ${s.distanceKm}`);
});

test('parseActivityFile: reversed or identical timestamps -> null', () => {
  const rev = `<gpx><trkpt lat="51" lon="13"><time>2026-06-20T09:00:00Z</time></trkpt><trkpt lat="51.01" lon="13"><time>2026-06-20T08:00:00Z</time></trkpt></gpx>`;
  const eq = `<gpx><trkpt lat="51" lon="13"><time>2026-06-20T08:00:00Z</time></trkpt><trkpt lat="51.01" lon="13"><time>2026-06-20T08:00:00Z</time></trkpt></gpx>`;
  assert.equal(parseActivityFile(rev), null);
  assert.equal(parseActivityFile(eq), null);
});

test('parseActivityFile: TCX takes the largest DistanceMeters (not Haversine)', () => {
  const tcx = `<TrainingCenterDatabase><Activities><Activity><Track>
    <Trackpoint><Time>2026-06-22T07:00:00Z</Time><DistanceMeters>0</DistanceMeters></Trackpoint>
    <Trackpoint><Time>2026-06-22T07:40:00Z</Time><DistanceMeters>8000</DistanceMeters></Trackpoint>
    </Track></Activity></Activities></TrainingCenterDatabase>`;
  assert.equal(parseActivityFile(tcx).distanceKm, 8);
});

/* A straight line north: 0.009° of latitude ≈ 1 km; one point a minute. */
function line({ from = 0, n, km = 1, t0 = Date.parse('2026-06-23T07:00:00Z'), quote = '"', lat0 = 51 } = {}) {
  return Array.from({ length: n }, (_, i) => `<trkpt lat=${quote}${(lat0 + (from + i) * 0.009 * km).toFixed(6)}${quote} lon=${quote}13.7${quote}><time>${new Date(t0 + (from + i) * 6e4).toISOString()}</time></trkpt>`).join('\n');
}

test('GPX: attributes in single quotes are read like double ones', () => {
  const dbl = parseActivityFile(`<gpx><trk><trkseg>${line({ n: 11, km: 0.2 })}</trkseg></trk></gpx>`);
  const sgl = parseActivityFile(`<gpx><trk><trkseg>${line({ n: 11, km: 0.2, quote: "'" })}</trkseg></trk></gpx>`);
  assert.ok(sgl.distanceKm > 1.9, `${sgl.distanceKm}`);
  assert.equal(sgl.distanceKm, dbl.distanceKm);
  assert.ok(sgl.route);
  const tcx = parseActivityFile(`<TrainingCenterDatabase><Activities><Activity Sport='Biking'><Lap><Track>
    <Trackpoint><Time>2026-06-23T07:00:00Z</Time><DistanceMeters>0</DistanceMeters></Trackpoint>
    <Trackpoint><Time>2026-06-23T07:30:00Z</Time><DistanceMeters>12000</DistanceMeters></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`);
  assert.equal(tcx.sportKnown, true);
});

test('GPX: two track segments are not joined – a transfer in between is neither distance nor moving time', () => {
  // 5 km in 25 min, 20 min break and 15 km away, then 5 km more.
  const t0 = Date.parse('2026-06-23T07:00:00Z');
  const seg2 = Array.from({ length: 26 }, (_, i) => `<trkpt lat="${(51 + 0.135 + 0.0018 * i).toFixed(6)}" lon="13.7"><time>${new Date(t0 + (45 + i) * 6e4).toISOString()}</time></trkpt>`).join('\n');
  const s = parseActivityFile(`<gpx><trk><trkseg>${line({ n: 26, km: 0.2 })}</trkseg><trkseg>${seg2}</trkseg></trk></gpx>`);
  assert.ok(Math.abs(s.distanceKm - 10) < 0.1, `${s.distanceKm}`);
  assert.equal(s.durationSec, 50 * 60);
  assert.equal(s.splits.length, 10);
});

test('TCX: laps without trackpoint distance add up', () => {
  const lap = (i) => `<Lap><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters><Track>
    <Trackpoint><Time>2026-06-24T07:${String(i * 10).padStart(2, '0')}:00Z</Time></Trackpoint>
    <Trackpoint><Time>2026-06-24T07:${String(i * 10 + 9).padStart(2, '0')}:59Z</Time></Trackpoint></Track></Lap>`;
  const s = parseActivityFile(`<TrainingCenterDatabase><Activities><Activity Sport="Running">${lap(0)}${lap(1)}${lap(2)}</Activity></Activities></TrainingCenterDatabase>`);
  assert.equal(s.distanceKm, 6);
  assert.equal(s.durationSec, 1800);
});

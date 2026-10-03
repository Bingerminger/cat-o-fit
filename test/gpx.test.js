/* Unit-Tests für js/gpx.js — string-basierter GPX/TCX-Parser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActivityFile, haversineSum } from '../js/gpx.js';

test('parseActivityFile: GPX mit HR und Koordinaten', () => {
  const gpx = `<gpx><trk><trkseg>
    <trkpt lat="51.05" lon="13.74"><time>2026-06-20T08:00:00Z</time><extensions><gpxtpx:hr>140</gpxtpx:hr></extensions></trkpt>
    <trkpt lat="51.06" lon="13.75"><time>2026-06-20T08:05:00Z</time><extensions><gpxtpx:hr>150</gpxtpx:hr></extensions></trkpt>
  </trkseg></trk></gpx>`;
  const s = parseActivityFile(gpx);
  assert.equal(s.date, '2026-06-20');
  assert.equal(s.durationSec, 300);
  assert.equal(s.avgHr, 145);
  assert.ok(s.distanceKm > 0.5 && s.distanceKm < 3, `Distanz plausibel: ${s.distanceKm}`);
  assert.equal(s.type, 'run');
});

test('parseActivityFile: TCX mit DistanceMeters und HeartRateBpm', () => {
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

test('parseActivityFile: Müll/leere/zeitlose Eingabe -> null', () => {
  assert.equal(parseActivityFile('hallo welt'), null);
  assert.equal(parseActivityFile(''), null);
  assert.equal(parseActivityFile(null), null);
  assert.equal(parseActivityFile('<gpx><trkpt lat="1" lon="2"/></gpx>'), null); // keine zwei Zeiten
});

test('haversineSum: ~1,11 km pro 0,01° Breite', () => {
  const m = haversineSum([[51.0, 13.0], [51.01, 13.0]]);
  assert.ok(m > 1050 && m < 1170, `~1110 m, war ${Math.round(m)}`);
  assert.equal(haversineSum([[51, 13]]), 0); // einzelner Punkt
});

test('parseActivityFile: Garmin ns3:hr-Namespace wird erkannt', () => {
  const gpx = `<gpx><trkpt lat="51.05" lon="13.74"><time>2026-06-20T08:00:00Z</time><extensions><ns3:hr>138</ns3:hr></extensions></trkpt>
    <trkpt lat="51.06" lon="13.75"><time>2026-06-20T08:10:00Z</time><extensions><ns3:hr>152</ns3:hr></extensions></trkpt></gpx>`;
  const s = parseActivityFile(gpx);
  assert.equal(s.avgHr, 145);
  assert.equal(s.durationSec, 600);
});

test('parseActivityFile: ohne HR bleibt avgHr null, Distanz wird trotzdem berechnet', () => {
  const gpx = `<gpx><trkpt lat="51.0" lon="13.0"><time>2026-06-20T08:00:00Z</time></trkpt>
    <trkpt lat="51.02" lon="13.0"><time>2026-06-20T08:15:00Z</time></trkpt></gpx>`;
  const s = parseActivityFile(gpx);
  assert.equal(s.avgHr, null);
  assert.ok(s.distanceKm > 2.0 && s.distanceKm < 2.4, `Distanz ${s.distanceKm}`);
});

test('parseActivityFile: umgekehrte oder identische Zeiten -> null', () => {
  const rev = `<gpx><trkpt lat="51" lon="13"><time>2026-06-20T09:00:00Z</time></trkpt><trkpt lat="51.01" lon="13"><time>2026-06-20T08:00:00Z</time></trkpt></gpx>`;
  const eq = `<gpx><trkpt lat="51" lon="13"><time>2026-06-20T08:00:00Z</time></trkpt><trkpt lat="51.01" lon="13"><time>2026-06-20T08:00:00Z</time></trkpt></gpx>`;
  assert.equal(parseActivityFile(rev), null);
  assert.equal(parseActivityFile(eq), null);
});

test('parseActivityFile: TCX nimmt die größte DistanceMeters (nicht Haversine)', () => {
  const tcx = `<TrainingCenterDatabase><Activities><Activity><Track>
    <Trackpoint><Time>2026-06-22T07:00:00Z</Time><DistanceMeters>0</DistanceMeters></Trackpoint>
    <Trackpoint><Time>2026-06-22T07:40:00Z</Time><DistanceMeters>8000</DistanceMeters></Trackpoint>
    </Track></Activity></Activities></TrainingCenterDatabase>`;
  assert.equal(parseActivityFile(tcx).distanceKm, 8);
});

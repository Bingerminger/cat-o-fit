/* =========================================================================
   gpx.js — clientseitiger Parser für einzelne GPX-/TCX-Dateien und die gemeinsame
   Auswertung aller Aufzeichnungen (auch FIT, siehe fit.js).
   Bewusst string-/regexbasiert (kein DOMParser) → ohne Browser-DOM testbar.

   Liefert eine durchgeführte Session: Sportart (aus TCX `Sport` bzw. GPX
   `<type>`), Datum in LOKALER Zeit (die Zeitstempel der Dateien sind UTC – ein
   Lauf um 0:30 Uhr gehört zum lokalen Tag, nicht zum Vortag), Bewegungszeit
   (Pausen herausgerechnet; TCX: Summe der Runden-Zeiten), Distanz, Ø-/Max-HF,
   Kilometer-Splits, – mit den HF-Zonen des Profils – die Zeit je Zone, Höhenmeter
   und eine vereinfachte Strecke (höchstens 150 Punkte, ohne Kartendienst gezeichnet).
   ========================================================================= */

const R = 6371000; // Erdradius in Metern
function toRad(d) { return (d * Math.PI) / 180; }
function dist2(la1, lo1, la2, lo2) {
  const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** Summe der Haversine-Distanzen aufeinanderfolgender Punkte (Meter). */
export function haversineSum(points = []) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist2(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  return sum;
}

/** Stillstand: langsamer als 0,5 m/s (1,8 km/h) zählt nicht zur Bewegungszeit. */
const MOVING_MIN_MPS = 0.5;

/** Sportart aus dem Dateitext → Session-Typ (null = unbekannt). */
const SPORT_TYPES = [
  [/^(running|run|trail_?running|treadmill_?running|laufen|9)$/i, 'run'],
  [/^(biking|cycling|ride|road_?biking|mountain_?biking|gravel_?cycling|radfahren|1)$/i, 'cross_bike'],
  [/^(walking|walk|gehen|10)$/i, 'walk'],
  [/^(hiking|hike|wandern|4)$/i, 'hike'],
  [/^(swimming|swim|open_?water_?swimming|schwimmen)$/i, 'swim'],
];
export function sportType(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const [re, type] of SPORT_TYPES) if (re.test(s)) return type;
  return null;
}

/** Kalendertag eines Zeitpunkts: mit bekanntem UTC-Versatz der Aufzeichnung (FIT) genau
    dort, sonst in der Zeitzone des Geräts. */
function localDate(ms, utcOffsetMin = null) {
  const p = (n) => String(n).padStart(2, '0');
  if (utcOffsetMin != null) {
    const d = new Date(ms + utcOffsetMin * 60000);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const d = new Date(ms);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function num(re, text) { const m = re.exec(text); return m ? parseFloat(m[1]) : null; }

/** Messpunkte: { t (ms), lat, lon, d (kumulierte Meter aus TCX), hr, ele (m) }. */
function readPoints(text, isTcx) {
  const pts = [];
  if (isTcx) {
    for (const m of text.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)) {
      const b = m[1];
      const time = /<Time>([^<]+)<\/Time>/.exec(b);
      pts.push({
        t: time ? Date.parse(time[1].trim()) : NaN,
        lat: num(/<LatitudeDegrees>\s*([\d.-]+)/, b), lon: num(/<LongitudeDegrees>\s*([\d.-]+)/, b),
        d: num(/<DistanceMeters>\s*([\d.]+)/, b),
        hr: num(/<HeartRateBpm[^>]*>\s*<Value>\s*(\d{2,3})/, b),
        ele: num(/<AltitudeMeters>\s*([\d.-]+)/, b),
      });
    }
  } else {
    for (const m of text.matchAll(/<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g)) {
      const attrs = m[1] || '', b = m[2] || '';
      const time = /<time>([^<]+)<\/time>/.exec(b);
      pts.push({
        t: time ? Date.parse(time[1].trim()) : NaN,
        lat: num(/lat="([\d.-]+)"/, attrs), lon: num(/lon="([\d.-]+)"/, attrs),
        d: null,
        hr: num(/<(?:gpxtpx:hr|ns3:hr|hr)>\s*(\d{2,3})\s*</, b),
        ele: num(/<ele>\s*([\d.-]+)\s*<\/ele>/, b),
      });
    }
  }
  // Reihenfolge der Datei beibehalten: rückwärts laufende Zeitstempel sind kaputt
  // und führen (wie bisher) zu „keine gültige Aktivität“.
  return pts.filter((p) => !Number.isNaN(p.t));
}

/** Zone (1–5) einer Herzfrequenz; unterhalb von Zone 1 zählt Zone 1, oberhalb Zone 5. */
function zoneOf(hr, zones) {
  const sorted = zones.slice().sort((a, b) => a.zone - b.zone);
  for (const z of sorted) if (hr >= z.min && hr <= z.max) return z.zone;
  if (hr < sorted[0].min) return sorted[0].zone;
  return sorted[sorted.length - 1].zone;
}

/* ------------------------- Strecke & Höhenprofil ------------------------- */

/** Höchstens so viele Punkte speichert eine Strecke (reicht fürs Bild, spart Speicher). */
export const ROUTE_MAX_POINTS = 150;
const ELE_SAMPLES = 60;

/** Douglas-Peucker in lokaler Meter-Projektion; liefert die behaltenen Indizes. */
function simplifyIdx(xy, eps) {
  const keep = new Uint8Array(xy.length);
  keep[0] = 1; keep[xy.length - 1] = 1;
  const stack = [[0, xy.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let far = -1, dMax = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      const d = Math.sqrt(qx * qx + qy * qy);
      if (d > dMax) { dMax = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out = [];
  keep.forEach((k, i) => { if (k) out.push(i); });
  return out;
}

/** Vereinfacht [lat, lon]-Punkte auf höchstens `max` Stück (Toleranz wächst, bis es passt). */
export function simplifyRoute(coords, max = ROUTE_MAX_POINTS) {
  if (coords.length <= max) return coords.slice();
  const lat0 = toRad(coords[0][0]);
  const xy = coords.map(([la, lo]) => [toRad(lo) * R * Math.cos(lat0), toRad(la) * R]);
  let eps = 2, idx = simplifyIdx(xy, eps);
  while (idx.length > max && eps < 5000) { eps *= 1.6; idx = simplifyIdx(xy, eps); }
  return idx.map((i) => coords[i]);
}

/** Polyline-Kodierung (Genauigkeit 1e-5 ≈ 1 m): ~5 Zeichen je Punkt statt ~20 als Zahlen. */
export function encodePolyline(coords) {
  let out = '', pLa = 0, pLo = 0;
  const enc = (v) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let str = '';
    while (s >= 0x20) { str += String.fromCharCode((0x20 | (s & 0x1f)) + 63); s >>= 5; }
    return str + String.fromCharCode(s + 63);
  };
  for (const [la, lo] of coords) {
    const a = Math.round(la * 1e5), b = Math.round(lo * 1e5);
    out += enc(a - pLa) + enc(b - pLo);
    pLa = a; pLo = b;
  }
  return out;
}
export function decodePolyline(str) {
  const out = [];
  let i = 0, la = 0, lo = 0;
  const next = () => {
    let res = 0, shift = 0, c;
    do { c = str.charCodeAt(i++) - 63; res |= (c & 0x1f) << shift; shift += 5; } while (c >= 0x20 && i < str.length + 1);
    return res & 1 ? ~(res >> 1) : res >> 1;
  };
  while (i < String(str || '').length) { la += next(); lo += next(); out.push([la / 1e5, lo / 1e5]); }
  return out;
}

/** Höhenmeter bergauf. Rauschen unter 3 m zählt nicht (Barometer und GPS schwanken): Ein
    Anstieg gilt erst ab 3 m über dem letzten Tiefpunkt, danach zählt jeder weitere Meter,
    bis ein Abstieg von mindestens 3 m ihn beendet. */
export function ascentOf(eles) {
  let up = 0, ref = null, climbing = false;
  for (const e of eles) {
    if (e == null || !Number.isFinite(e)) continue;
    if (ref == null) { ref = e; continue; }
    if (climbing) {
      if (e > ref) { up += e - ref; ref = e; } else if (ref - e >= 3) { climbing = false; ref = e; }
    } else if (e - ref >= 3) { up += e - ref; ref = e; climbing = true; } else if (e < ref) ref = e;
  }
  return Math.round(up);
}

/* ------------------------- Gemeinsame Auswertung ------------------------- */

/**
 * Aus Messpunkten eine Session – gemeinsam für GPX, TCX und FIT. `totals` darf Werte der
 * Datei vorgeben (start/end in ms, distanceM, durationSec als Stoppuhr-Zeit, avgHr, maxHr,
 * kcal, ascentM); sonst rechnet die Auswertung aus den Punkten.
 * @returns {{date,durationSec,elapsedSec,distanceKm,avgHr,maxHr,type,sportKnown,splits,timeInZones,ascentM,route,kcal}|null}
 */
export function buildActivity(pts = [], { type = null, totals = {}, hrZones = null, utcOffsetMin = null } = {}) {
  const start = totals.start != null ? totals.start : (pts.length ? pts[0].t : NaN);
  const end = totals.end != null ? totals.end : (pts.length ? pts[pts.length - 1].t : NaN);
  if (!(end > start)) return null;
  const elapsedSec = Math.round((end - start) / 1000);

  // Kumulierte Strecke je Punkt (TCX/FIT direkt, sonst aus den Koordinaten).
  let cum = 0;
  const track = pts.map((p, i) => {
    if (i > 0) {
      const q = pts[i - 1];
      if (p.d != null && q.d != null) cum = Math.max(cum, p.d);
      else if (p.lat != null && q.lat != null) cum += dist2(q.lat, q.lon, p.lat, p.lon);
    } else if (p.d != null) cum = p.d;
    return { ...p, cum };
  });
  const hasTrack = track.length >= 2 && track.some((p) => p.lat != null || p.d != null);

  const meters = totals.distanceM != null ? totals.distanceM
    : (track.length >= 2 && track.some((p) => p.lat != null || p.d != null) ? track[track.length - 1].cum : null);
  const distanceKm = meters != null ? Math.round((meters / 1000) * 100) / 100 : null;

  // Bewegungszeit: Stoppuhr der Datei, sonst Abschnitte in Bewegung.
  let durationSec = elapsedSec;
  if (totals.durationSec > 0) durationSec = Math.round(totals.durationSec);
  else if (hasTrack) {
    let moving = 0;
    for (let i = 1; i < track.length; i++) {
      const dt = (track[i].t - track[i - 1].t) / 1000;
      const dd = track[i].cum - track[i - 1].cum;
      if (dt > 0 && dd / dt >= MOVING_MIN_MPS) moving += dt;
    }
    if (moving > 0) durationSec = Math.round(moving);
  }

  // Herzfrequenz (Mittel der Messwerte, Maximum) – ohne Spread, lange Aufzeichnungen haben 30 000+ Punkte.
  let hrSum = 0, hrN = 0, hrMax = 0;
  for (const p of pts) if (p.hr > 0) { hrSum += p.hr; hrN++; if (p.hr > hrMax) hrMax = p.hr; }
  const avgHr = totals.avgHr != null ? totals.avgHr : (hrN ? Math.round(hrSum / hrN) : null);
  const maxHr = totals.maxHr != null ? totals.maxHr : (hrN ? hrMax : null);

  const t = type || 'run';

  // Kilometer-Splits (nur Laufen/Gehen/Wandern) – Zeit je voller Kilometer, interpoliert.
  const splits = [];
  if (['run', 'walk', 'hike'].includes(t) && track.length >= 2 && track[track.length - 1].cum >= 1000) {
    let nextKm = 1, lastT = track[0].t;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      while (b.cum >= nextKm * 1000 && b.cum > a.cum) {
        const f = (nextKm * 1000 - a.cum) / (b.cum - a.cum);
        const tt = a.t + f * (b.t - a.t);
        splits.push({ km: nextKm, sec: Math.round((tt - lastT) / 1000) });
        lastT = tt;
        nextKm++;
      }
    }
  }

  // Zeit je HF-Zone (braucht Zonen aus dem Profil und HF je Punkt).
  let timeInZones = null;
  if (Array.isArray(hrZones) && hrZones.length && hrN) {
    timeInZones = {};
    for (let i = 1; i < pts.length; i++) {
      const hr = pts[i].hr || pts[i - 1].hr;
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (!(hr > 0) || !(dt > 0) || dt > 300) continue;   // Lücken > 5 min sind Pausen
      const z = zoneOf(hr, hrZones);
      timeInZones[z] = Math.round((timeInZones[z] || 0) + dt);
    }
    if (!Object.keys(timeInZones).length) timeInZones = null;
  }

  // Höhenmeter und Strecke (ohne Kartenkacheln – nur die Linie).
  const eles = track.map((p) => p.ele);
  const hasEle = eles.filter((e) => e != null && Number.isFinite(e)).length >= 2;
  const ascentM = totals.ascentM != null ? Math.round(totals.ascentM) : (hasEle ? ascentOf(eles) : null);
  let route = null;
  const geo = track.filter((p) => p.lat != null && p.lon != null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  if (geo.length >= 2 && (meters == null || meters >= 200)) {
    route = { poly: encodePolyline(simplifyRoute(geo.map((p) => [p.lat, p.lon]))) };
    if (hasEle && track[track.length - 1].cum > 0) {
      // Höhenprofil: 60 Werte in gleichen Streckenabständen.
      const total = track[track.length - 1].cum;
      const ele = [];
      let j = 0;
      for (let k = 0; k < ELE_SAMPLES; k++) {
        const at = (total * k) / (ELE_SAMPLES - 1);
        while (j < track.length - 1 && track[j + 1].cum <= at) j++;
        let e = null;
        for (let q = j; q < track.length && e == null; q++) if (track[q].ele != null && Number.isFinite(track[q].ele)) e = track[q].ele;
        ele.push(e == null ? null : Math.round(e));
      }
      if (ele.some((e) => e != null)) route.ele = ele;
    }
  }

  return {
    date: localDate(start, utcOffsetMin), durationSec, elapsedSec, distanceKm, avgHr, maxHr,
    type: t, sportKnown: !!type, splits, timeInZones, ascentM, route, kcal: totals.kcal != null ? totals.kcal : null,
  };
}

/**
 * Parst GPX- oder TCX-Text in eine Session. null, wenn es keine brauchbare
 * Aktivität ist (kein Zeitbereich erkennbar).
 * @param {string} text
 * @param {{hrZones?: Array<{zone,min,max}>}} [opts]
 */
export function parseActivityFile(text, { hrZones = null } = {}) {
  if (!text || typeof text !== 'string') return null;
  const isTcx = /<TrainingCenterDatabase|<Activities|<DistanceMeters/.test(text);
  const isGpx = /<gpx[\s>]|<trkpt/.test(text);
  if (!isTcx && !isGpx) return null;

  const pts = readPoints(text, isTcx);
  const totals = {};
  // Ohne erkennbare Messpunkte: alle Zeitstempel der Datei als Rückfall.
  if (pts.length < 2) {
    const times = [...text.matchAll(/<[Tt]ime>([^<]+)<\/[Tt]ime>/g)].map((m) => Date.parse(m[1].trim())).filter((t) => !Number.isNaN(t));
    if (times.length < 2) return null;
    totals.start = times[0]; totals.end = times[times.length - 1];
    const hrs = [...text.matchAll(/<(?:gpxtpx:hr|ns3:hr)>\s*(\d{2,3})\s*<|<HeartRateBpm[^>]*>\s*<Value>\s*(\d{2,3})/g)].map((m) => parseInt(m[1] || m[2], 10)).filter((n) => n > 0);
    if (hrs.length) { totals.avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length); totals.maxHr = hrs.reduce((a, b) => Math.max(a, b), 0); }
  }
  // Distanz – TCX nennt sie direkt (größter Wert), sonst die Summe der Koordinaten.
  if (isTcx) {
    const dists = [...text.matchAll(/<DistanceMeters>\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
    if (dists.length) totals.distanceM = dists.reduce((a, b) => Math.max(a, b), 0);
    // Bewegungszeit: TCX-Runden-Zeiten (Stoppuhr der Uhr).
    const laps = [...text.matchAll(/<TotalTimeSeconds>\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
    if (laps.length) totals.durationSec = laps.reduce((a, b) => a + b, 0);
  }

  // Sportart: TCX `Sport="…"`, GPX `<type>…</type>`.
  const tcxSport = /<Activity\b[^>]*\bSport="([^"]+)"/.exec(text);
  const gpxType = /<type>\s*([^<]+?)\s*<\/type>/.exec(text);
  const known = sportType(tcxSport ? tcxSport[1] : gpxType ? gpxType[1] : '');
  return buildActivity(pts, { type: known, totals, hrZones });
}

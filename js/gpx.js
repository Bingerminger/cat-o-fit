/* =========================================================================
   gpx.js — clientseitiger Parser für einzelne GPX-/TCX-Dateien.
   Bewusst string-/regexbasiert (kein DOMParser) → ohne Browser-DOM testbar.
   Liefert eine durchgeführte Lauf-Session: Datum, Dauer, Distanz, Ø-HF.
   ========================================================================= */

const R = 6371000; // Erdradius in Metern
function toRad(d) { return (d * Math.PI) / 180; }
/** Summe der Haversine-Distanzen aufeinanderfolgender Punkte (Meter). */
export function haversineSum(points = []) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const [la1, lo1] = points[i - 1], [la2, lo2] = points[i];
    const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
    sum += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return sum;
}

/**
 * Parst GPX- oder TCX-Text in eine Session. null, wenn es keine brauchbare
 * Aktivität ist (kein Zeitbereich erkennbar).
 * @returns {{date,durationSec,distanceKm,avgHr,type}|null}
 */
export function parseActivityFile(text) {
  if (!text || typeof text !== 'string') return null;
  const isTcx = /<TrainingCenterDatabase|<Activities|<DistanceMeters/.test(text);
  const isGpx = /<gpx[\s>]|<trkpt/.test(text);
  if (!isTcx && !isGpx) return null;

  // Zeitstempel (GPX: <time>, TCX: <Time>) – erster und letzter ergeben die Dauer.
  const times = [...text.matchAll(/<[Tt]ime>([^<]+)<\/[Tt]ime>/g)].map((m) => m[1].trim()).filter(Boolean);
  if (times.length < 2) return null;
  const start = Date.parse(times[0]), end = Date.parse(times[times.length - 1]);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const durationSec = Math.round((end - start) / 1000);
  const date = times[0].slice(0, 10);

  // Herzfrequenz (GPX-Extensions gpxtpx:hr/ns3:hr, TCX HeartRateBpm><Value>)
  const hrs = [...text.matchAll(/<(?:gpxtpx:hr|ns3:hr)>\s*(\d{2,3})\s*<|<HeartRateBpm[^>]*>\s*<Value>\s*(\d{2,3})/g)]
    .map((m) => parseInt(m[1] || m[2], 10)).filter((n) => n > 0);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;

  // Distanz – TCX nennt sie direkt; GPX aus den Track-Koordinaten berechnen.
  let meters = null;
  if (isTcx) {
    const dists = [...text.matchAll(/<DistanceMeters>\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
    if (dists.length) meters = Math.max(...dists);
  }
  if (meters == null) {
    const pts = [...text.matchAll(/<trkpt[^>]*lat="([\d.-]+)"[^>]*lon="([\d.-]+)"/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
    if (pts.length >= 2) meters = haversineSum(pts);
  }
  const distanceKm = meters != null ? Math.round((meters / 1000) * 100) / 100 : null;

  return { date, durationSec, distanceKm, avgHr, type: 'run' };
}

/* =========================================================================
   weather.js — Wetter im Trainingsplan (Open-Meteo, schlüssellos, CORS-fähig).
   - Standort wird als Koordinaten in den Profil-Einstellungen gespeichert.
   - Forecast (bis 16 Tage) wird im LocalStorage zwischengespeichert.
   - Offline-robust: ohne Netz einfach keine Wetterdaten, App läuft weiter.
   Bewusste Ausnahme vom „kein externer Dienst“-Prinzip – Wetter geht nicht ohne.
   ========================================================================= */

import { typeMeta } from './ui.js';
import { lsGet, lsSet } from './env.js';
import { locale, t } from './i18n.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FC_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL = 60 * 60 * 1000; // 1 Stunde

/** Stadtname -> Koordinaten (erstes Ergebnis). */
/** Bis zu fünf Treffer mit Region und Land – bei mehrdeutigen Namen (Neustadt, Frankfurt,
    Halle) wählt die Person selbst; vorher galt ungefragt der erste Treffer (UI-40). */
export async function geocode(name) {
  const r = await fetch(`${GEO_URL}?name=${encodeURIComponent(name)}&count=5&language=${locale().split('-')[0]}&format=json`);
  const j = await r.json();
  return (j.results || []).map((g) => ({
    name: g.name, region: g.admin1 || '', country: g.country_code || g.country || '',
    lat: g.latitude, lon: g.longitude,
  }));
}

/** „Frankfurt (Oder), Brandenburg, DE“ – Anzeigename eines Treffers. */
export function placeLabel(g) {
  return [g.name, g.region, g.country].filter(Boolean).join(', ');
}

async function fetchForecast(lat, lon) {
  const url = `${FC_URL}?latitude=${lat}&longitude=${lon}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'
    + '&timezone=auto&forecast_days=16';
  const r = await fetch(url);
  const j = await r.json();
  if (!j.daily) return null;
  const d = j.daily;
  const days = {};
  d.time.forEach((date, i) => {
    days[date] = {
      code: d.weather_code[i],
      tMax: Math.round(d.temperature_2m_max[i]),
      tMin: Math.round(d.temperature_2m_min[i]),
      precip: d.precipitation_probability_max[i] ?? null,
      wind: Math.round(d.wind_speed_10m_max[i]),
    };
  });
  return days;
}

let mem = null;
export function cachedWeather() {
  if (mem) return mem;
  try { mem = JSON.parse(lsGet('weather') || 'null'); } catch { mem = null; }
  return mem;
}

/** Holt/erneuert den Forecast für den Standort (mit Cache + Offline-Fallback). */
export async function refreshWeather(location, force = false) {
  if (!location || location.lat == null) return null;
  const cache = cachedWeather();
  const fresh = cache && cache.lat === location.lat && (Date.now() - cache.fetchedAt) < CACHE_TTL && cache.days;
  if (fresh && !force) return cache;
  try {
    const days = await fetchForecast(location.lat, location.lon);
    if (!days) return cache;
    mem = { lat: location.lat, lon: location.lon, name: location.name, fetchedAt: Date.now(), days };
    lsSet('weather', JSON.stringify(mem));
    window.dispatchEvent(new Event('catofit:weather'));
    return mem;
  } catch {
    return cache; // offline -> alter Stand
  }
}

/** Wetter für ein bestimmtes Datum (oder null außerhalb des Forecasts). */
export function weatherForDate(dateStr) {
  const c = cachedWeather();
  return c && c.days ? c.days[dateStr] || null : null;
}

/** WMO-Wettercode -> Emoji + Label. */
export function wmo(code) {
  if (code === 0) return { emoji: '☀️', label: t('weather.wmo.clear') };
  if (code <= 2) return { emoji: '🌤️', label: t('weather.wmo.fair') };
  if (code === 3) return { emoji: '☁️', label: t('weather.wmo.cloudy') };
  if (code <= 48) return { emoji: '🌫️', label: t('weather.wmo.fog') };
  if (code <= 57) return { emoji: '🌦️', label: t('weather.wmo.drizzle') };
  if (code <= 67) return { emoji: '🌧️', label: t('weather.wmo.rain') };
  if (code <= 77) return { emoji: '❄️', label: t('weather.wmo.snow') };
  if (code <= 82) return { emoji: '🌦️', label: t('weather.wmo.showers') };
  if (code <= 86) return { emoji: '🌨️', label: t('weather.wmo.snowShowers') };
  return { emoji: '⛈️', label: t('weather.wmo.thunderstorm') };
}

/**
 * Wie viel langsamer bei Wärme (Prozent der Pace): ab 20 °C etwa 0,4 % je Grad über 15 °C,
 * höchstens 8 %. Eine Faustregel aus der Laufliteratur (Luftfeuchte bleibt außen vor) –
 * lieber etwas langsamer als am Ende einbrechen.
 */
export function heatSlowdownPct(tMax) {
  const temp = Number(tMax);
  if (!Number.isFinite(temp) || temp < 20) return 0;
  return Math.min(8, Math.round((temp - 15) * 0.4));
}

/**
 * Wetter-Hinweis für eine geplante Einheit (nur für Läufe sinnvoll).
 * @returns {{text:string, tone:string}|null}
 */
export function weatherHint(unit, w) {
  if (!w || !unit || typeMeta(unit.type).cat !== 'run') return null;
  if (unit.type === 'rest') return null;
  const slow = heatSlowdownPct(w.tMax);
  if (w.code >= 95) return { text: t('weather.thunder'), tone: 'warn' };
  if (w.code >= 71 && w.code <= 77) return { text: t('weather.snowIce'), tone: 'warn' };
  if (w.wind >= 45) return { text: t('weather.stormy'), tone: 'warn' };
  if (w.tMax >= 28) return { text: t('weather.hot', { temp: w.tMax, slow }), tone: 'warn' };
  if ((w.precip != null && w.precip >= 70) || (w.code >= 61 && w.code <= 67) || (w.code >= 80 && w.code <= 82)) return { text: t('weather.rainLikely'), tone: 'neutral' };
  if (w.tMax <= 0) return { text: t('weather.freezing', { temp: w.tMax }), tone: 'neutral' };
  if (w.tMax >= 24) return { text: t('weather.warm', { temp: w.tMax, slow }), tone: 'neutral' };
  if (w.code <= 2 && w.tMax >= 8 && w.tMax <= 22) return { text: t('weather.perfect'), tone: 'good' };
  return null;
}

/** Kompakte Anzeige-Daten (Emoji + Temperatur) für Kalenderzellen. */
export function weatherBadge(dateStr) {
  const w = weatherForDate(dateStr);
  if (!w) return null;
  return { emoji: wmo(w.code).emoji, tMax: w.tMax, tMin: w.tMin, label: wmo(w.code).label };
}

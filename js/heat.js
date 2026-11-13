/* =========================================================================
   heat.js — the one heat rule of the app, pure and DOM-free. The weather hint on a planned session
   (weather.js) and the form estimate (vdot.js) use the same numbers: a run in the heat is slower than
   the same effort in cool weather, so its time is turned back into a cool-weather time before it
   enters the estimate (since 4.2). Indoor sessions (treadmill) never get a weather correction.
   ========================================================================= */

/**
 * How much slower in warm weather (percent of pace): from 20 °C roughly 0.4 % per degree above 15 °C,
 * at most 8 %. A rule of thumb from the running literature (Ely et al. 2007; humidity is left out) –
 * better a bit slower than collapsing at the end.
 */
export function heatSlowdownPct(temp) {
  const t = Number(temp);
  if (temp == null || temp === '' || !Number.isFinite(t) || t < 20) return 0;
  return Math.min(8, Math.round((t - 15) * 0.4));
}

/** The weather fields of a session from imported or typed data: `indoor` only when true, `tempC` only
    for a plausible air temperature (−40 to 55 °C) – sessions without them keep their shape. */
export function sessionWeather(data = {}) {
  const d = data || {};
  const t = d.tempC == null || d.tempC === '' ? NaN : Number(d.tempC);
  return {
    ...(d.indoor === true ? { indoor: true } : {}),
    ...(d.indoor !== true && Number.isFinite(t) && t >= -40 && t <= 55 ? { tempC: t } : {}),
  };
}

/**
 * The share a session's time is taken back by for the heat it was run in (0 when indoors, without a
 * temperature or below 20 °C). `tempC` is the air temperature during the session, never a daily high.
 */
export function sessionHeatPct(session) {
  if (!session || session.indoor === true) return 0;
  return heatSlowdownPct(session.tempC);
}

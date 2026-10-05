/* =========================================================================
   contrast.js — colour contrast according to WCAG 2.x (UI-12): relative luminance,
   contrast ratio and the variants of the accent colour derived from them.

   The accent colour is freely selectable (eight presets, member colours in the
   management view). Surfaces keep it; for TEXT and icons the app computes suitable variants:
     onAccent   – text ON the accent surface (buttons, chips): white, dark-tinted
                  or black – whichever reaches ≥ 4.5:1 (previously fixed white up to L 0.55:
                  2.65:1 on the default green).
     textOn     – accent as text on a light or dark background, darkened/lightened
                  only as much as needed to reach ≥ 4.5:1.
     heroEnd    – second colour of the hero gradient: moved away from the text colour (lighter
                  for dark text, darker for white text) so that the contrast holds everywhere.
   ========================================================================= */

export function hexToRgb(hex) {
  const m = String(hex || '').replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6);
  const v = parseInt(n, 16);
  if (!/^[0-9a-f]{6}$/i.test(n) || Number.isNaN(v)) return null;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}

/** Relative luminance (WCAG 2.x). */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two colours (1 … 21). */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mix in sRGB: t = share of b (0 … 1) – like color-mix(in srgb, a, b t). */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return a;
  return rgbToHex(A.map((c, i) => c + (B[i] - c) * t));
}

/** Text on the accent surface: white, otherwise a dark tint of the accent, otherwise black. */
export function onAccent(accent, target = 4.5) {
  if (contrast('#ffffff', accent) >= target) return '#ffffff';
  const tinted = mix(accent, '#000000', 0.8);
  if (contrast(tinted, accent) >= target) return tinted;
  return contrast('#000000', accent) >= contrast('#ffffff', accent) ? '#000000' : '#ffffff';
}

/** Shift the accent in small steps towards `towards` until it reaches ≥ target on `bg`. */
export function textOn(accent, bg, { towards = '#000000', target = 4.5 } = {}) {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(accent, towards, t);
    if (contrast(c, bg) >= target) return c;
  }
  return towards;
}

/**
 * All accent variants for a theme. `dark`: dark theme. The backgrounds correspond to
 * css/style.css (light: --bg, dark: --surface-2 – in each case the least favourable background); the
 * soft background (chips, soft buttons) is the accent at 14 % on top.
 */
export function accentPalette(accent, dark = false) {
  const base = dark ? '#1d242c' : '#eef1f5';
  const soft = mix(base, accent, 0.14);
  const text = textOn(accent, soft, { towards: dark ? '#ffffff' : '#000000' });
  const on = onAccent(accent);
  const heroEnd = luminance(on) < 0.5 ? mix(accent, '#ffffff', 0.22) : mix(accent, '#000000', 0.22);
  return { contrast: on, text, strong: text, heroEnd };
}

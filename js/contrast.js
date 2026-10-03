/* =========================================================================
   contrast.js — Farbkontrast nach WCAG 2.x (UI-12): relative Luminanz,
   Kontrastverhältnis und daraus abgeleitete Varianten der Akzentfarbe.

   Die Akzentfarbe ist frei wählbar (acht Vorgaben, Mitgliedsfarben beim Verwalten).
   Flächen behalten sie; für TEXT und Symbole errechnet die App passende Varianten:
     onAccent   – Schrift AUF der Akzentfläche (Knöpfe, Chips): Weiß, dunkel getönt
                  oder Schwarz – was ≥ 4,5:1 erreicht (vorher fest Weiß bis L 0,55:
                  2,65:1 auf dem Standardgrün).
     textOn     – Akzent als Text auf hellem bzw. dunklem Grund, so wenig wie nötig
                  abgedunkelt/aufgehellt, bis ≥ 4,5:1.
     heroEnd    – zweite Farbe des Hero-Verlaufs: weg von der Schriftfarbe (bei dunkler
                  Schrift heller, bei weißer dunkler), damit der Kontrast überall hält.
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

/** Relative Luminanz (WCAG 2.x). */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis zweier Farben (1 … 21). */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mischung in sRGB: t = Anteil von b (0 … 1) – wie color-mix(in srgb, a, b t). */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return a;
  return rgbToHex(A.map((c, i) => c + (B[i] - c) * t));
}

/** Schrift auf der Akzentfläche: Weiß, sonst eine dunkle Tönung des Akzents, sonst Schwarz. */
export function onAccent(accent, target = 4.5) {
  if (contrast('#ffffff', accent) >= target) return '#ffffff';
  const tinted = mix(accent, '#000000', 0.8);
  if (contrast(tinted, accent) >= target) return tinted;
  return contrast('#000000', accent) >= contrast('#ffffff', accent) ? '#000000' : '#ffffff';
}

/** Akzent in kleinen Schritten Richtung `towards` verschieben, bis er auf `bg` ≥ target erreicht. */
export function textOn(accent, bg, { towards = '#000000', target = 4.5 } = {}) {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(accent, towards, t);
    if (contrast(c, bg) >= target) return c;
  }
  return towards;
}

/**
 * Alle Akzent-Varianten für ein Theme. `dark`: dunkles Theme. Die Hintergründe entsprechen
 * css/style.css (hell: --bg, dunkel: --surface-2 – jeweils der ungünstigste Grund); der
 * Soft-Grund (Chips, Soft-Knöpfe) ist der Akzent zu 14 % darüber.
 */
export function accentPalette(accent, dark = false) {
  const base = dark ? '#1d242c' : '#eef1f5';
  const soft = mix(base, accent, 0.14);
  const text = textOn(accent, soft, { towards: dark ? '#ffffff' : '#000000' });
  const on = onAccent(accent);
  const heroEnd = luminance(on) < 0.5 ? mix(accent, '#ffffff', 0.22) : mix(accent, '#000000', 0.22);
  return { contrast: on, text, strong: text, heroEnd };
}

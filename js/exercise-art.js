/* =========================================================================
   exercise-art.js — symbolhafte SVG-Illustrationen für die Übungs-Bibliothek.

   Bewusst schematische Strichfiguren (keine Fotos, keine externen Assets) –
   passend zur abhängigkeitsfreien, selbst gezeichneten Optik der App. Jede
   Figur nutzt `currentColor`, übernimmt also die Akzentfarbe der Umgebung.
   ViewBox 120×100, Boden bei y≈92.
   ========================================================================= */

const GROUND = '<line x1="14" y1="92" x2="106" y2="92" stroke-width="2.5" opacity="0.45"/>';
function fig(inner, opts = {}) {
  const g = opts.noGround ? '' : GROUND;
  return `<svg viewBox="0 0 120 100" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}${inner}</svg>`;
}
const head = (x, y, r = 7.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const bar = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="4.5"/>`;
const weight = (x, y) => `<rect x="${x - 5}" y="${y - 7}" width="10" height="14" rx="2" fill="currentColor" stroke="none"/>`;

const ART = {
  // ---- Kraft ----
  squat: fig(`${head(60, 24)}
    <path d="M60 32 L60 56"/>
    <path d="M60 56 L46 60 L48 92 M60 56 L78 60 L80 92"/>
    <path d="M60 38 L82 44 M60 38 L38 44"/>`),
  lunge: fig(`${head(54, 24)}
    <path d="M54 32 L56 58"/>
    <path d="M56 58 L78 70 L78 92 M56 58 L40 78 L30 92"/>
    <path d="M54 40 L46 56 M54 40 L64 54"/>`),
  pushup: fig(`${head(30, 64)}
    <path d="M37 66 L92 78"/>
    <path d="M44 68 L42 88 M70 73 L70 90"/>
    <path d="M36 67 L34 84 M58 70 L56 86"/>`, { noGround: true }),
  plank: fig(`${head(28, 60)}
    <path d="M35 62 L96 74"/>
    <path d="M40 63 L36 86 M90 73 L92 86"/>`, { noGround: true }),
  side_plank: fig(`${head(30, 50)}
    <path d="M36 53 L98 86"/>
    <path d="M40 55 L40 86"/>
    <path d="M52 60 L52 30"/>`, { noGround: true }),
  glute_bridge: fig(`${head(34, 70)}
    <path d="M40 70 L60 56 L78 70"/>
    <path d="M78 70 L88 88 M78 70 L70 88"/>
    <path d="M40 70 L30 86"/>`),
  calf_raise: fig(`${head(60, 22)}
    <path d="M60 30 L60 64"/>
    <path d="M60 64 L54 86 M60 64 L66 86"/>
    <path d="M48 86 L72 86" stroke-width="2.5" opacity="0.5"/>
    <path d="M60 36 L74 50 M60 36 L46 50"/>`),
  deadlift: fig(`${head(40, 30)}
    <path d="M40 38 L52 58"/>
    <path d="M52 58 L48 92 M52 58 L62 78 L60 92"/>
    <path d="M44 46 L44 74"/>
    ${bar(22, 74, 66, 74)} ${weight(22, 74)} ${weight(66, 74)}`),
  row: fig(`${head(36, 36)}
    <path d="M36 43 L58 56"/>
    <path d="M58 56 L52 92 M58 56 L70 76 L68 92"/>
    <path d="M46 49 L48 70" />
    ${weight(48, 72)}`),
  overhead_press: fig(`${head(60, 30)}
    <path d="M60 38 L60 66"/>
    <path d="M60 66 L52 92 M60 66 L68 92"/>
    <path d="M60 42 L44 24 M60 42 L76 24"/>
    ${weight(44, 22)} ${weight(76, 22)}`),
  split_squat: fig(`${head(48, 22)}
    <path d="M48 30 L50 56"/>
    <path d="M50 56 L44 78 L44 92 M50 56 L72 70 L86 64"/>
    <path d="M48 38 L40 54"/>
    <line x1="80" y1="70" x2="104" y2="70" stroke-width="2.5" opacity="0.5"/>`),
  wall_sit: fig(`<line x1="26" y1="12" x2="26" y2="92" stroke-width="2.5" opacity="0.4"/>
    ${head(38, 40)}
    <path d="M38 48 L38 68"/>
    <path d="M38 68 L66 68 L66 90"/>
    <path d="M38 55 L54 62"/>`),
  step_up: fig(`<path d="M74 72 L104 72 M104 72 L104 92" stroke-width="2.5" opacity="0.5"/>
    ${head(50, 24)}
    <path d="M50 32 L54 58"/>
    <path d="M54 58 L74 72 M54 58 L44 78 L44 92"/>
    <path d="M50 40 L63 52"/>`),
  // ---- Core ----
  dead_bug: fig(`${head(24, 70)}
    <path d="M31 71 L74 71"/>
    <path d="M74 71 L92 56 M74 71 L86 86"/>
    <path d="M40 71 L30 52"/>`, { noGround: true }),
  side_crunch: fig(`${head(60, 30)}
    <path d="M60 38 L58 64"/>
    <path d="M58 64 L46 86 M58 64 L70 86"/>
    <path d="M60 44 L78 36"/>
    <path d="M60 44 L48 40"/>`),
  crunch: fig(`${head(30, 72)}
    <path d="M36 74 L58 82"/>
    <path d="M58 82 L68 64 L80 82"/>
    <path d="M36 74 L52 71"/>`),
  leg_raise: fig(`${head(22, 84)}
    <path d="M29 84 L60 84"/>
    <path d="M60 84 L74 54"/>
    <path d="M60 84 L70 52" opacity="0.5"/>`),
  hollow_hold: fig(`${head(28, 72)}
    <path d="M35 74 Q60 88 86 70"/>
    <path d="M28 72 L14 60"/>
    <path d="M86 70 L96 56"/>`, { noGround: true }),
  superman: fig(`${head(26, 62)}
    <path d="M33 64 Q62 58 92 64"/>
    <path d="M26 62 L12 54"/>
    <path d="M92 64 L106 56"/>`, { noGround: true }),
  bird_dog: fig(`${head(26, 54)}
    <path d="M33 56 L82 60"/>
    <path d="M33 56 L15 46"/>
    <path d="M44 57 L42 88"/>
    <path d="M82 60 L102 50"/>
    <path d="M74 59 L76 88"/>`),
  // ---- Beweglichkeit ----
  hip_flexor_stretch: fig(`${head(58, 26)}
    <path d="M58 34 L58 58"/>
    <path d="M58 58 L80 66 L80 88 M58 58 L40 84 L28 88"/>
    <path d="M58 40 L70 30"/>`),
  hamstring_stretch: fig(`${head(50, 30)}
    <path d="M50 37 L62 56"/>
    <path d="M62 56 L62 90"/>
    <path d="M50 40 L40 64"/>`),
  calf_stretch: fig(`<line x1="100" y1="14" x2="100" y2="92" stroke-width="2.5" opacity="0.4"/>
    ${head(44, 30)}
    <path d="M44 37 L52 58"/>
    <path d="M52 58 L36 86 M52 58 L74 76 L88 84"/>
    <path d="M44 42 L92 40"/>`),
  cat_cow: fig(`${head(26, 52)}
    <path d="M33 54 Q60 40 90 56"/>
    <path d="M38 56 L36 88 M86 58 L90 88"/>
    <path d="M52 50 L52 88 M72 50 L74 88" opacity="0.55"/>`),
  chest_opener: fig(`${head(60, 24)}
    <path d="M60 32 L60 64"/>
    <path d="M60 64 L52 92 M60 64 L68 92"/>
    <path d="M60 40 L42 32 M60 40 L78 32"/>`),
  child_pose: fig(`${head(34, 76)}
    <path d="M41 76 Q64 66 86 74"/>
    <path d="M86 74 L92 88 M86 74 L74 88"/>
    <path d="M41 76 L20 84"/>`),
  supine_twist: fig(`${head(24, 82)}
    <path d="M31 82 L62 82"/>
    <path d="M62 82 L78 70 L88 80"/>
    <path d="M44 82 L46 62"/>`),
  figure_four: fig(`${head(22, 82)}
    <path d="M29 82 L56 80"/>
    <path d="M56 80 L64 58"/>
    <path d="M64 58 L52 68 L66 74"/>
    <path d="M56 80 L62 62" opacity="0.5"/>`),
  butterfly_stretch: fig(`${head(60, 28)}
    <path d="M60 36 L60 66"/>
    <path d="M60 66 L44 82 L60 86 L76 82 L60 66"/>
    <path d="M60 48 L60 66"/>`),
};

/** Liefert das SVG einer Übung (oder eine neutrale Figur als Fallback). */
export function exerciseArt(key) {
  return ART[key] || ART.squat;
}
export const ART_KEYS = Object.keys(ART);

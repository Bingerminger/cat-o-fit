/* =========================================================================
   exercise-motions.js — Bewegungsabläufe der Übungs-Bibliothek (reine Daten).

   Je Übung: Ansicht (`side`/`front`), wenige Schlüsselposen (`keys`), der Ablauf
   einer Wiederholung (`seq`) im echten Takt mit Beschriftung, Hinweis und Atmung,
   die beanspruchten Körperteile (`focus`) und Hilfsmittel (`props`, `hold`).

   Regeln für die Nachvollziehbarkeit:
   - EINE Ansicht je Übung: die, in der die Hauptbewegung in der Bildebene liegt
     (`top: true` = von oben gesehen, z. B. liegende Rotation).
   - 2–4 Schlüsselposen; Takt wie im Training (z. B. 2 s runter, 1 s hoch).
   - Je Phase höchstens ein kurzer Hinweis (≤ 44 Zeichen) und die Atmung.
   - Jeder Durchgang endet wieder in der Startpose (`start`) – so läuft die Schleife ruckfrei.
   - `sides: 'alternate'` wechselt je Wiederholung die Seite, `'each'` macht erst alle
     Wiederholungen einer Seite. Die bewegte Seite ist in den Posen immer die rechte (`r`).
   - `intro`: einmaliger Weg in die Ausgangsposition (Dehnungen, Halteübungen).
   - `reps` = Wiederholungen je Satz (bei Seiten je Seite), `holdS` = Sekunden je Satz.
   Posen-Helfer unten; Koordinaten und Winkel wie in motion-rig.js beschrieben.
   ========================================================================= */

import { BODY, STAND_HIP, ik } from './motion-rig.js';

const B = BODY;
const FY = -B.ankle;          // Fußgelenk, Fuß flach am Boden
const TY = -7;                // Fußgelenk im Zehenstand (Stütz)
const HY = -B.wrist;          // Handgelenk, Hand am Boden
const LIE = -8;               // Becken in Rücken- oder Bauchlage
const STAND = STAND_HIP + 0.6;
const RAD = Math.PI / 180;

const at = (x, y, o = {}) => ({ at: [x, y], ...o });
const atP = (p, o = {}) => ({ at: [p[0], p[1]], ...o });
const ang = (a1, a2 = a1, o = {}) => ({ a: [a1, a2], ...o });
const pair = (r, l = r) => ({ r, l });

/* ---------- Geometrie (Seitenansicht) ---------- */
const tdir = (t) => [Math.sin(t * RAD), -Math.cos(t * RAD)];     // Becken → Schulter
const fdir = (t) => [Math.cos(t * RAD), Math.sin(t * RAD)];      // Körpervorderseite
const dirA = (a) => [Math.sin(a * RAD), Math.cos(a * RAD)];      // Gliedwinkel
const mv = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];
const shoulderOf = (hip, t) => mv(hip, tdir(t), B.torso);
const headOf = (hip, t, h = 0) => mv(shoulderOf(hip, t), tdir(t + h), B.neck + B.head);
const chestPt = (hip, t, fwd = 10, down = 13) => mv(mv(shoulderOf(hip, t), tdir(t), -down), fdir(t), fwd);
const behindHead = (hip, t) => mv(mv(headOf(hip, t), fdir(t), -9), tdir(t), -2);
const hipFrom = (sh, t) => mv(sh, tdir(t), -B.torso);
const tFromDir = (d) => Math.atan2(d[0], -d[1]) / RAD;
/** Endpunkt eines Glieds aus absoluten Winkeln. */
const fk = (root, a1, a2, l1, l2) => { const j = mv(root, dirA(a1), l1); return { joint: j, end: mv(j, dirA(a2), l2) }; };
/** Höchster Punkt im Abstand r1 von A und r2 von C (Dreieck nach oben). */
function apex(A, r1, C, r2) {
  const d = Math.hypot(C[0] - A[0], C[1] - A[1]);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = [A[0] + (a * (C[0] - A[0])) / d, A[1] + (a * (C[1] - A[1])) / d];
  const n = [-(C[1] - A[1]) / d, (C[0] - A[0]) / d];
  const p1 = mv(m, n, h); const p2 = mv(m, n, -h);
  return p1[1] < p2[1] ? p1 : p2;
}

/** Aufrechter Stand (Seitenansicht), Füße unter dem Becken. */
function stand(o = {}) {
  const x = o.x || 0;
  return {
    hip: [x + (o.dx || 0), STAND + (o.drop || 0)], torso: o.lean || 0, head: o.head || 0,
    legs: o.legs || pair(at(x + 2, FY), at(x - 2, FY)),
    arms: o.arms || pair(ang(4, 8), ang(-3, 0)),
  };
}

/** Aufrechter Stand von vorn; `w` = halber Fußabstand. */
function standFront(o = {}) {
  const x = o.x || 0; const w = o.w != null ? o.w : 7;
  return {
    hip: [x + (o.dx || 0), STAND + (o.drop || 0)], torso: o.lean || 0, head: o.head || 0, pelvis: 0,
    legs: o.legs || pair(at(x - w, FY), at(x + w, FY)),
    arms: o.arms || pair(ang(-6, -4), ang(6, 4)),
  };
}
/** Hände vor der Brust gefaltet (Frontansicht). */
const clasp = (hipY, x = 0) => pair(at(x - 3, hipY - B.torso + 17, { bend: 'down' }), at(x + 3, hipY - B.torso + 17, { bend: 'down' }));

/**
 * Gerader Körper von den Fußgelenken `A` aus, `deg` Grad über der Waagerechten,
 * Kopf in +x (Stütz, Liegestütz). Liefert Becken, Rumpfwinkel und Schulterpunkt.
 */
function bodyLine(A, deg) {
  const v = [Math.cos(deg * RAD), -Math.sin(deg * RAD)];
  const hip = mv(A, v, B.thigh + B.shin);
  return { hip, torso: 90 - deg, sh: mv(hip, v, B.torso) };
}
/** Winkel über der Waagerechten, damit die Schulter auf Höhe `shY` liegt. */
const lineDeg = (A, shY, len = B.thigh + B.shin + B.torso) => Math.asin((A[1] - shY) / len) / RAD;
/** Gerader Körper von der Schulter zu den Fersen (Rückenlage, Kopf links). */
function lineFromShoulder(sh, A) {
  const d = [A[0] - sh[0], A[1] - sh[1]];
  const len = Math.hypot(d[0], d[1]);
  const v = [d[0] / len, d[1] / len];
  return { hip: mv(sh, v, B.torso), torso: tFromDir([-v[0], -v[1]]) };
}
/** Frontansicht, Seitlage: Rumpfwinkel, damit die untere (linke) Schulter auf `target` liegt. */
function torsoForLowShoulder(hip, target) {
  let best = 0; let err = Infinity;
  for (let t = 20; t <= 120; t += 0.25) {
    const u = tdir(t); const n = [-u[1], u[0]];
    const p = [hip[0] + u[0] * B.torso + n[0] * B.shoulderW, hip[1] + u[1] * B.torso + n[1] * B.shoulderW];
    const e = Math.hypot(p[0] - target[0], p[1] - target[1]);
    if (e < err) { err = e; best = t; }
  }
  return best;
}

/* ---------- Wiederkehrende Bausteine ---------- */
const DOWN = (s, cue, extra = {}) => ({ to: 'down', s, label: 'Runter', cue, breath: 'ein', ...extra });
const UP = (s, cue, extra = {}) => ({ to: 'up', s, label: 'Hoch', cue, breath: 'aus', ...extra });
const HOLD = (s, label = 'Halten', extra = {}) => ({ hold: s, label, ...extra });
const STILL = (cue, breath = 'ruhig weiteratmen') => [HOLD(4, 'Halten', { cue, breath })];

/* Liegestütz/Plank: Füße auf den Zehen bei x = −52 */
const PL_A = [-52, TY];
// Der hintere (ferne) Fuß steht minimal weiter vorn – weiter hinten wäre er bei gestrecktem Körper außer Reichweite.
const TOES = (x = PL_A[0], y = TY) => pair(at(x, y, { foot: 20 }), at(x + 2, y, { foot: 20 }));
const PL_FA = bodyLine(PL_A, lineDeg(PL_A, -27));
const PU_TOP = bodyLine(PL_A, lineDeg(PL_A, -47.5));
const PU_LOW = bodyLine(PL_A, lineDeg(PL_A, -15));
const PU_HAND = PU_TOP.sh[0] - 2;
const plankTop = (o = {}) => ({ ...PU_TOP, legs: TOES(), arms: pair(at(PU_HAND, HY), at(PU_HAND - 3, HY)), ...o });

/* Vierfüßlerstand: Knie unter der Hüfte, Hände unter den Schultern */
const QUAD_HIP = [0, -37];
const QUAD_T = 90 - Math.asin((47.5 - 37) / B.torso) / RAD;
const QUAD_SH_X = B.torso * Math.sin(QUAD_T * RAD);
const KNEES_DOWN = () => pair(at(-31, -5, { bend: 'down', foot: -90 }), at(-33, -5, { bend: 'down', foot: -90 }));
function quad(o = {}) {
  return {
    hip: [...QUAD_HIP], torso: QUAD_T, head: o.head || 0, curl: o.curl || 0,
    legs: o.legs || KNEES_DOWN(),
    arms: o.arms || pair(at(QUAD_SH_X, HY), at(QUAD_SH_X - 2, HY)),
  };
}
/* Bärenstand: Knie schweben knapp über dem Boden */
const BEAR_HIP = [0, -41];
const BEAR_T = 90 - Math.asin((47.5 - 41) / B.torso) / RAD;
const BEAR_SH_X = B.torso * Math.sin(BEAR_T * RAD);
const bear = (o = {}) => ({
  hip: [...BEAR_HIP], torso: BEAR_T, head: 0,
  legs: o.legs || pair(at(-30, -7, { bend: 'down', foot: 25 }), at(-33, -7, { bend: 'down', foot: 25 })),
  arms: o.arms || pair(at(BEAR_SH_X, HY), at(BEAR_SH_X - 3, HY)),
});

/* Rückenlage: Kopf links, Schultern bei x = −36 */
const SUP_SH = [-36, LIE];
const SUP_HIP = [SUP_SH[0] + B.torso, LIE];
const FEET_UP = () => pair(at(30, FY), at(27, FY));
function supine(o = {}) {
  return {
    hip: [...SUP_HIP], torso: o.torso != null ? o.torso : -90, head: o.head || 0, curl: o.curl || 0,
    legs: o.legs || FEET_UP(),
    arms: o.arms || pair(ang(90, 90), ang(88, 88)),
  };
}
/** Becken angehoben, Schultern bleiben liegen: Rumpfwinkel aus der Höhe. */
function bridgeTorso(hipY) {
  const c = (hipY - SUP_SH[1]) / B.torso;
  const t = -Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
  const hipX = SUP_SH[0] - B.torso * Math.sin(t * RAD);
  return { hip: [hipX, hipY], torso: t, head: -90 - t };
}
/** Schultern angehoben (Crunch-Haltung): Becken bleibt liegen. */
const lifted = (t, o = {}) => supine({ torso: t, curl: o.curl, head: o.head, legs: o.legs, arms: o.arms });

/* Bauchlage: Kopf rechts */
const PRONE_HIP = [0, LIE];
const prone = (o = {}) => ({
  hip: [...PRONE_HIP], torso: o.torso != null ? o.torso : 90, head: o.head || 0, curl: o.curl || 0,
  legs: o.legs || pair(ang(-90, -90, { foot: -90 }), ang(-91, -91, { foot: -90 })),
  arms: o.arms || pair(ang(92, 92), ang(91, 91)),
});

/* Kalb-/Zehenstand: Zehen bleiben, Ferse hebt sich */
function onToes(x, fa = 38) {
  const toe = x + (B.foot - B.heel);
  const d = dirA(fa);
  return at(toe - d[0] * (B.foot - B.heel), FY - d[1] * (B.foot - B.heel), { foot: fa });
}

/* =============================== Abläufe =============================== */

const M = {};

/* ------------------------------ Kraft ------------------------------ */

M.squat = {
  view: 'side', start: 'up', reps: 12, focus: ['thigh', 'hip'],
  keys: {
    up: stand(),
    down: { hip: [-17, STAND_HIP + 33], torso: 42, legs: pair(at(2, FY), at(-2, FY)), arms: pair(ang(84, 88), ang(80, 84)) },
  },
  seq: [DOWN(2, 'Hüfte nach hinten, Brust bleibt offen'), HOLD(0.4, 'Unten'), UP(1.4, 'Durch die ganze Fußsohle drücken'), HOLD(0.6, 'Oben')],
};

M.goblet_squat = (() => {
  const upHip = [0, STAND]; const dnHip = [-14, STAND_HIP + 36];
  const hands = (hip, t) => { const c = chestPt(hip, t, 11, 15); return pair(atP(c, { bend: 'down' }), at(c[0] - 2, c[1], { bend: 'down' })); };
  return {
    view: 'side', start: 'up', reps: 10, focus: ['thigh', 'hip'], hold: { both: 'kb' },
    keys: {
      up: stand({ arms: hands(upHip, 0) }),
      down: { hip: dnHip, torso: 28, legs: pair(at(2, FY), at(-2, FY)), arms: hands(dnHip, 28) },
    },
    seq: [DOWN(2, 'Ellbogen zwischen die Knie, Brust hoch'), HOLD(0.4, 'Unten'), UP(1.4, 'Fersen in den Boden drücken'), HOLD(0.5, 'Oben')],
  };
})();

M.sumo_squat = {
  view: 'front', start: 'up', reps: 12, focus: ['thigh', 'hip'],
  keys: {
    up: standFront({ w: 24, drop: 2, arms: clasp(STAND + 2) }),
    down: { hip: [0, -40], torso: 0, legs: pair(at(-24, FY, { bend: 'out' }), at(24, FY, { bend: 'out' })), arms: clasp(-40) },
  },
  seq: [DOWN(2, 'Knie zeigen nach außen über die Füße'), HOLD(0.4, 'Unten'), UP(1.4, 'Po anspannen und hochdrücken'), HOLD(0.5, 'Oben')],
};

M.lunge = {
  view: 'side', start: 'up', reps: 10, sides: 'alternate', focus: ['thigh', 'hip'],
  keys: {
    up: stand({ dx: -6, legs: pair(at(-4, FY), at(-8, FY)) }),
    step: { hip: [2, STAND_HIP + 4], torso: 0, legs: pair(at(14, -12), at(-8, FY)), arms: pair(ang(10, 14), ang(-8, -4)) },
    down: { hip: [-4, -42], torso: 2, legs: pair(at(24, FY), at(-34, -13, { foot: 64 })), arms: pair(ang(4, 10), ang(-4, 0)) },
  },
  seq: [
    { to: 'step', s: 0.6, label: 'Schritt nach vorn' },
    { to: 'down', s: 1.4, label: 'Runter', cue: 'Hinteres Knie sinkt Richtung Boden', breath: 'ein' },
    HOLD(0.3, 'Unten'),
    { to: 'step', s: 0.9, label: 'Zurückdrücken', cue: 'Über die vordere Ferse abdrücken', breath: 'aus' },
    { to: 'up', s: 0.5, label: 'Stand' },
    HOLD(0.4, 'Stand'),
  ],
};

M.reverse_lunge = {
  view: 'side', start: 'up', reps: 10, sides: 'alternate', focus: ['thigh', 'hip'],
  keys: {
    up: stand(),
    back: { hip: [-2, STAND_HIP + 3], torso: 4, legs: pair(at(-22, -14, { foot: 70 }), at(-2, FY)), arms: pair(ang(-6, 0), ang(8, 14)) },
    down: { hip: [-8, -42], torso: 6, legs: pair(at(-40, -13, { foot: 64 }), at(-2, FY)), arms: pair(ang(0, 6), ang(4, 10)) },
  },
  seq: [
    { to: 'back', s: 0.6, label: 'Schritt zurück' },
    { to: 'down', s: 1.4, label: 'Runter', cue: 'Vorderes Knie bleibt über dem Fuß', breath: 'ein' },
    HOLD(0.3, 'Unten'),
    { to: 'back', s: 0.9, label: 'Hochdrücken', cue: 'Kraft aus der vorderen Ferse', breath: 'aus' },
    { to: 'up', s: 0.5, label: 'Stand' },
    HOLD(0.4, 'Stand'),
  ],
};

M.side_lunge = {
  view: 'front', start: 'mid', reps: 8, sides: 'alternate', focus: ['thigh', 'hip'],
  keys: {
    mid: { hip: [0, -61], torso: 0, legs: pair(at(-34, FY), at(34, FY)), arms: clasp(-61) },
    side: { hip: [-20, -42], torso: 0, legs: pair(at(-34, FY, { bend: 'out' }), at(34, FY)), arms: clasp(-42, -20) },
  },
  seq: [
    { to: 'side', s: 1.6, label: 'Zur Seite beugen', cue: 'Anderes Bein bleibt gestreckt', breath: 'ein' },
    HOLD(0.4, 'Unten'),
    { to: 'mid', s: 1.2, label: 'Zurück zur Mitte', breath: 'aus' },
    HOLD(0.3, 'Mitte'),
  ],
};

M.split_squat = {
  view: 'side', start: 'up', reps: 8, sides: 'each', focus: ['thigh', 'hip'], props: { box: [-66, -28, 28] },
  keys: {
    up: { hip: [-6, -60], torso: 4, legs: pair(at(18, FY), at(-50, -32, { foot: -95 })), arms: pair(ang(4, 8), ang(-2, 2)) },
    down: { hip: [-8, -34], torso: 6, legs: pair(at(18, FY), at(-50, -32, { foot: -95 })), arms: pair(ang(6, 12), ang(0, 4)) },
  },
  seq: [DOWN(2, 'Vorderes Knie bleibt über dem Fuß'), HOLD(0.3, 'Unten'), UP(1.2, 'Über die vordere Ferse hochdrücken'), HOLD(0.4, 'Oben')],
};

M.wall_sit = {
  view: 'side', start: 'hold', holdS: 30, focus: ['thigh'], props: { wall: -30 },
  intro: { from: 'stand', seq: [{ to: 'hold', s: 2, label: 'An der Wand hinunterrutschen' }] },
  keys: {
    stand: { hip: [-22, -58], torso: 0, legs: pair(at(11, FY), at(8, FY)), arms: pair(ang(4, 8), ang(-2, 2)) },
    hold: { hip: [-21, -35], torso: 0, legs: pair(at(11, FY), at(8, FY)), arms: pair(ang(10, 70), ang(6, 66)) },
  },
  seq: STILL('Knie über den Knöcheln, Rücken an der Wand'),
};

M.step_up = {
  view: 'side', start: 'up', reps: 10, sides: 'alternate', focus: ['thigh', 'hip'], props: { box: [12, -22, 46] },
  keys: {
    up: stand(),
    plant: { hip: [4, -66], torso: 8, legs: pair(at(30, -26), at(-2, FY)), arms: pair(ang(20, 30), ang(-15, -10)) },
    top: { hip: [30, -84.4], torso: 0, legs: pair(at(32, -26), at(28, -26)), arms: pair(ang(4, 8), ang(-3, 0)) },
    back: { hip: [26, -78], torso: 6, legs: pair(at(32, -26), at(8, -32, { foot: 70 })), arms: pair(ang(10, 16), ang(-6, -2)) },
  },
  seq: [
    { to: 'plant', s: 0.7, label: 'Fuß auf die Stufe' },
    { to: 'top', s: 1.2, label: 'Hochdrücken', cue: 'Kraft aus der Ferse, Knie stabil', breath: 'aus' },
    HOLD(0.4, 'Oben stabil'),
    { to: 'back', s: 0.7, label: 'Absenken', cue: 'Das obere Bein bremst', breath: 'ein' },
    { to: 'plant', s: 0.6, label: 'Absenken' },
    { to: 'up', s: 0.6, label: 'Stand' },
    HOLD(0.3, 'Stand'),
  ],
};

M.step_down = {
  view: 'side', start: 'up', reps: 8, sides: 'each', focus: ['thigh'], props: { box: [-24, -26, 44] },
  keys: {
    up: { hip: [0, -88.4], torso: 0, legs: pair(at(2, -30), at(24, -36)), arms: pair(ang(30, 40), ang(20, 30)) },
    down: { hip: [-6, -56], torso: 22, legs: pair(at(2, -30), at(30, FY)), arms: pair(ang(70, 80), ang(64, 74)) },
  },
  seq: [
    { to: 'down', s: 3, label: 'Langsam absenken', cue: 'Knie bleibt über dem Fuß', breath: 'ein' },
    HOLD(0.3, 'Ferse tippt'),
    { to: 'up', s: 1.2, label: 'Hochdrücken', breath: 'aus' },
    HOLD(0.5, 'Oben'),
  ],
};

M.deadlift = {
  view: 'side', start: 'up', reps: 8, focus: ['hip', 'thigh'], hold: { r: 'db', l: 'db' },
  keys: {
    up: stand({ arms: pair(ang(2, 2), ang(0, 0)) }),
    down: { hip: [-15, STAND_HIP + 7], torso: 72, legs: pair(at(2, FY), at(-2, FY)), arms: pair(ang(0, 0), ang(-2, -2)) },
  },
  seq: [
    { to: 'down', s: 2, label: 'Hüfte nach hinten', cue: 'Rücken gerade, Gewicht nah am Bein', breath: 'ein' },
    HOLD(0.3, 'Unten'),
    { to: 'up', s: 1.4, label: 'Aufrichten', cue: 'Hüfte nach vorn, Po anspannen', breath: 'aus' },
    HOLD(0.6, 'Oben'),
  ],
};

M.single_leg_deadlift = {
  view: 'side', start: 'up', reps: 8, sides: 'each', focus: ['hip', 'thigh'],
  keys: {
    up: stand({ legs: pair(at(-6, -6, { foot: 70 }), at(-2, FY)) }),
    down: { hip: [-4, STAND + 3], torso: 82, legs: pair(ang(-86, -88, { foot: -20 }), at(-2, FY)), arms: pair(ang(-2, -2), ang(2, 2)) },
  },
  seq: [
    { to: 'down', s: 2, label: 'Nach vorn kippen', cue: 'Hinteres Bein und Rücken bilden eine Linie', breath: 'ein' },
    HOLD(0.5, 'Unten'),
    { to: 'up', s: 1.6, label: 'Aufrichten', cue: 'Becken bleibt waagerecht', breath: 'aus' },
    HOLD(0.5, 'Stand'),
  ],
};

M.good_morning = (() => {
  const upHip = [0, STAND]; const dnHip = [-14, STAND_HIP + 5];
  const hands = (hip, t) => { const p = behindHead(hip, t); return pair(atP(p, { bend: 'front' }), at(p[0] - 2, p[1], { bend: 'front' })); };
  return {
    view: 'side', start: 'up', reps: 10, focus: ['hip', 'thigh', 'torso'],
    keys: {
      up: stand({ arms: hands(upHip, 0) }),
      down: { hip: dnHip, torso: 74, legs: pair(at(2, FY), at(-2, FY)), arms: hands(dnHip, 74) },
    },
    seq: [
      { to: 'down', s: 2, label: 'Nach vorn neigen', cue: 'Rücken gerade, Knie leicht gebeugt', breath: 'ein' },
      HOLD(0.3, 'Unten'),
      { to: 'up', s: 1.5, label: 'Aufrichten', cue: 'Hüfte nach vorn schieben', breath: 'aus' },
      HOLD(0.5, 'Oben'),
    ],
  };
})();

M.row = (() => {
  const hip = [-10, -61]; const t = 50;
  const rib = mv(mv(hip, tdir(t), 20), fdir(t), 6);
  return {
    view: 'side', start: 'down', reps: 10, focus: ['upper', 'torso'], hold: { r: 'db', l: 'db' },
    keys: {
      down: { hip, torso: t, legs: pair(at(2, FY), at(-2, FY)), arms: pair(ang(0, 0), ang(-2, -2)) },
      up: { hip, torso: t, legs: pair(at(2, FY), at(-2, FY)), arms: pair(atP(rib, { bend: 'up' }), at(rib[0] - 3, rib[1], { bend: 'up' })) },
    },
    seq: [
      { to: 'up', s: 1, label: 'Ziehen', cue: 'Ellbogen eng am Körper nach hinten', breath: 'aus' },
      HOLD(0.5, 'Oben'),
      { to: 'down', s: 2, label: 'Ablassen', cue: 'Rücken bleibt stabil', breath: 'ein' },
      HOLD(0.3, 'Unten'),
    ],
  };
})();

M.single_arm_row = (() => {
  const hip = [-12, -62]; const t = 78; const sh = shoulderOf(hip, t);
  const pull = mv(mv(hip, tdir(t), 24), fdir(t), 8);
  const base = {
    hip, torso: t,
    legs: pair(at(-14, FY), at(-42, -34, { bend: 'down', foot: -90 })),
  };
  return {
    view: 'side', start: 'down', reps: 10, sides: 'each', focus: ['upper', 'torso'], hold: { r: 'db' }, props: { box: [-50, -30, 84] },
    keys: {
      down: { ...base, arms: pair(ang(0, 0), at(sh[0] + 1, -33.5)) },
      up: { ...base, arms: pair(atP(pull, { bend: 'up' }), at(sh[0] + 1, -33.5)) },
    },
    seq: [
      { to: 'up', s: 1, label: 'Ziehen', cue: 'Ellbogen zur Hüfte, Rücken gerade', breath: 'aus' },
      HOLD(0.5, 'Oben'),
      { to: 'down', s: 2, label: 'Ablassen', breath: 'ein' },
      HOLD(0.3, 'Unten'),
    ],
  };
})();

M.overhead_press = {
  view: 'side', start: 'down', reps: 10, crop: -62, focus: ['upper', 'fore'], hold: { r: 'db', l: 'db' },
  keys: {
    down: stand({ arms: pair(at(8, -103, { bend: 'down' }), at(5, -103, { bend: 'down' })) }),
    up: stand({ arms: pair(ang(176, 178), ang(174, 176)) }),
  },
  seq: [
    { to: 'up', s: 1, label: 'Hochdrücken', cue: 'Bauch fest, kein Hohlkreuz', breath: 'aus' },
    HOLD(0.4, 'Oben'),
    { to: 'down', s: 2, label: 'Absenken', cue: 'Kontrolliert auf Schulterhöhe', breath: 'ein' },
    HOLD(0.3, 'Schulterhöhe'),
  ],
};

M.thruster = (() => {
  const rack = (hip, t) => { const s = shoulderOf(hip, t); return pair(at(s[0] + 7, s[1] + 1, { bend: 'down' }), at(s[0] + 4, s[1] + 1, { bend: 'down' })); };
  const dnHip = [-16, -34];
  return {
    view: 'side', start: 'rack', reps: 10, focus: ['thigh', 'upper'], hold: { r: 'db', l: 'db' },
    keys: {
      rack: stand({ arms: rack([0, STAND], 0) }),
      down: { hip: dnHip, torso: 38, legs: pair(at(2, FY), at(-2, FY)), arms: rack(dnHip, 38) },
      press: stand({ arms: pair(ang(176, 178), ang(174, 176)) }),
    },
    seq: [
      { to: 'down', s: 1.2, label: 'Runter', cue: 'Gewichte bleiben auf den Schultern', breath: 'ein' },
      { to: 'press', s: 1, label: 'Hochdrücken', cue: 'Aus den Beinen in einem Zug nach oben', breath: 'aus' },
      { to: 'rack', s: 0.8, label: 'Zurück auf die Schultern' },
      HOLD(0.2, 'Stand'),
    ],
  };
})();

M.calf_raise = {
  view: 'side', start: 'down', reps: 15, focus: ['shin'],
  keys: {
    down: stand(),
    up: stand({ dx: 3, drop: -7.2, legs: pair(onToes(2), onToes(-2)) }),
  },
  seq: [UP(1, 'Auf die Zehenspitzen'), HOLD(1, 'Oben halten'), DOWN(2, 'Langsam absenken', { label: 'Absenken' }), HOLD(0.4, 'Unten')],
};

M.soleus_raise = {
  view: 'side', start: 'down', reps: 15, focus: ['shin'], props: { wall: 40 },
  keys: {
    down: { hip: [-6, STAND + 9], torso: 12, legs: pair(at(2, FY), at(-2, FY)), arms: pair(at(38, -92, { bend: 'down' }), at(37, -94, { bend: 'down' })) },
    up: { hip: [-3, STAND + 2], torso: 12, legs: pair(onToes(2), onToes(-2)), arms: pair(at(38, -92, { bend: 'down' }), at(37, -94, { bend: 'down' })) },
  },
  seq: [UP(1, 'Fersen hoch, Knie bleiben gebeugt'), HOLD(1, 'Oben halten'), DOWN(3, 'Langsam absenken (3 Sekunden)', { label: 'Absenken' }), HOLD(0.3, 'Unten')],
};

M.tibialis_raise = {
  view: 'side', start: 'down', reps: 15, focus: ['shin'], props: { wall: -30 },
  keys: {
    down: { hip: [-14, STAND + 2], torso: -10, legs: pair(at(8, FY), at(4, FY)), arms: pair(ang(-6, -4), ang(-8, -6)) },
    up: { hip: [-14, STAND + 2], torso: -10, legs: pair(at(8, FY, { foot: 128 }), at(4, FY, { foot: 128 })), arms: pair(ang(-6, -4), ang(-8, -6)) },
  },
  seq: [UP(1, 'Zehen hoch, Fersen bleiben am Boden', { label: 'Zehen hoch' }), HOLD(1, 'Oben'), DOWN(1.5, 'Langsam absenken', { label: 'Absenken' })],
};

M.kettlebell_swing = {
  view: 'side', start: 'top', reps: 15, focus: ['hip', 'thigh'], hold: { both: 'kb' },
  keys: {
    top: { hip: [0, STAND], torso: -4, legs: pair(at(2, FY), at(-2, FY)), arms: pair(ang(90, 92), ang(88, 90)) },
    back: { hip: [-18, STAND_HIP + 8], torso: 68, legs: pair(at(2, FY), at(-2, FY)), arms: pair(ang(-24, -28), ang(-26, -30)) },
  },
  seq: [
    { to: 'back', s: 0.7, label: 'Zurückschwingen', cue: 'Hüfte nach hinten, Rücken gerade', breath: 'ein' },
    { to: 'top', s: 0.6, label: 'Hüfte nach vorn', cue: 'Schwung aus der Hüfte, nicht aus den Armen', breath: 'aus' },
    HOLD(0.15, 'Oben'),
  ],
};

M.jump_squat = {
  view: 'side', start: 'up', reps: 10, focus: ['thigh', 'hip'],
  keys: {
    up: stand(),
    down: { hip: [-12, STAND_HIP + 24], torso: 32, legs: pair(at(2, FY), at(-2, FY)), arms: pair(ang(-30, -26), ang(-32, -28)) },
    air: { hip: [0, STAND_HIP - 10], torso: 0, legs: pair(at(2, -14, { foot: 40 }), at(-2, -14, { foot: 40 })), arms: pair(ang(170, 175), ang(168, 172)) },
  },
  seq: [
    DOWN(0.8, 'Halbe Kniebeuge'),
    { to: 'air', s: 0.35, label: 'Abspringen', cue: 'Explosiv strecken', breath: 'aus' },
    { to: 'up', s: 0.35, label: 'Landen', cue: 'Weich und leise landen' },
    HOLD(0.5, 'Stand'),
  ],
};

M.wall_ball = (() => {
  const chest = (hip, t) => { const c = chestPt(hip, t, 12, 14); return pair(atP(c, { bend: 'down' }), at(c[0] - 2, c[1], { bend: 'down' })); };
  const dnHip = [-14, -32];
  return {
    view: 'side', start: 'up', reps: 15, focus: ['thigh', 'upper'], hold: { both: 'ball' }, props: { wall: 46 },
    keys: {
      up: stand({ arms: chest([0, STAND], 0) }),
      down: { hip: dnHip, torso: 32, legs: pair(at(2, FY), at(-2, FY)), arms: chest(dnHip, 32) },
      throw: { hip: [2, STAND - 3], torso: -4, legs: pair(onToes(2, 50), onToes(-2, 50)), arms: pair(ang(165, 170), ang(163, 168)) },
    },
    seq: [
      DOWN(1, 'Tief in die Hocke, Ball an der Brust'),
      { to: 'throw', s: 0.6, label: 'Strecken und werfen', cue: 'Aus den Beinen zum Ziel an der Wand', breath: 'aus' },
      { to: 'up', s: 0.6, label: 'Ball fangen' },
      HOLD(0.2, 'Stand'),
    ],
  };
})();

M.farmers_carry = {
  view: 'side', start: 'base', holdS: 30, sides: 'alternate', focus: ['fore', 'torso'], hold: { r: 'db', l: 'db' },
  keys: {
    base: stand({ arms: pair(ang(0, 0), ang(-1, -1)) }),
    lift: stand({ dx: 1, drop: -1, legs: pair(at(9, -12, { foot: 80 }), at(-2, FY)), arms: pair(ang(0, 0), ang(-1, -1)) }),
  },
  seq: [{ to: 'lift', s: 0.3, label: 'Gehen', cue: 'Aufrecht, Schultern tief, fester Griff' }, { to: 'base', s: 0.3, label: 'Gehen' }],
};

M.pushup = {
  view: 'side', start: 'up', reps: 10, focus: ['upper', 'fore', 'torso'],
  keys: {
    up: plankTop(),
    down: { ...PU_LOW, legs: TOES(), arms: pair(at(PU_HAND, HY), at(PU_HAND - 3, HY)) },
  },
  seq: [
    { to: 'down', s: 2, label: 'Absenken', cue: 'Körper bleibt eine gerade Linie', breath: 'ein' },
    HOLD(0.3, 'Unten'),
    { to: 'up', s: 1, label: 'Hochdrücken', cue: 'Ellbogen schräg nach hinten', breath: 'aus' },
    HOLD(0.5, 'Oben'),
  ],
};

M.knee_pushup = (() => {
  const K = [-22, -5];
  const ankle = mv(K, [-Math.cos(25 * RAD), -Math.sin(25 * RAD)], B.shin);
  const pose = (shY) => {
    const deg = lineDeg(K, shY, B.thigh + B.torso);
    const v = [Math.cos(deg * RAD), -Math.sin(deg * RAD)];
    const hip = mv(K, v, B.thigh);
    return { hip, torso: 90 - deg, legs: pair(atP(ankle, { bend: 'down', foot: -110 }), at(ankle[0] - 3, ankle[1], { bend: 'down', foot: -110 })) };
  };
  const top = pose(-47.5);
  const handX = shoulderOf(top.hip, top.torso)[0] + 3;
  return {
    view: 'side', start: 'up', reps: 10, focus: ['upper', 'fore', 'torso'], props: { mat: [-60, 80] },
    keys: {
      up: { ...top, arms: pair(at(handX, HY), at(handX - 3, HY)) },
      down: { ...pose(-16), arms: pair(at(handX, HY), at(handX - 3, HY)) },
    },
    seq: [
      { to: 'down', s: 2, label: 'Absenken', cue: 'Knie bis Kopf eine Linie', breath: 'ein' },
      HOLD(0.3, 'Unten'),
      { to: 'up', s: 1, label: 'Hochdrücken', breath: 'aus' },
      HOLD(0.4, 'Oben'),
    ],
  };
})();

M.incline_pushup = (() => {
  const A = [-54, TY]; const top = -30; const hy = top - B.wrist;
  const up = bodyLine(A, lineDeg(A, hy - 44));
  const low = bodyLine(A, lineDeg(A, hy - 16));
  const hx = (up.sh[0] + low.sh[0]) / 2 - 2;
  return {
    view: 'side', start: 'up', reps: 12, focus: ['upper', 'fore', 'torso'], props: { box: [hx - 16, top, 32] },
    keys: {
      up: { ...up, legs: TOES(A[0]), arms: pair(at(hx, hy), at(hx - 3, hy)) },
      down: { ...low, legs: TOES(A[0]), arms: pair(at(hx, hy), at(hx - 3, hy)) },
    },
    seq: [
      { to: 'down', s: 2, label: 'Absenken', cue: 'Brust zur Kante, Körper gerade', breath: 'ein' },
      HOLD(0.3, 'Unten'),
      { to: 'up', s: 1, label: 'Hochdrücken', breath: 'aus' },
      HOLD(0.4, 'Oben'),
    ],
  };
})();

M.pike_pushup = (() => {
  const A = [-21.5, TY]; const H = [54, HY];
  return {
    view: 'side', start: 'up', reps: 8, focus: ['upper', 'fore'],
    keys: {
      up: { hip: [0, -66.2], torso: 138, legs: pair(atP(A, { foot: 30 }), at(A[0] - 3, TY, { foot: 30 })), arms: pair(atP(H), at(H[0] - 3, HY)) },
      down: { hip: [6, -62], torso: 147, legs: pair(atP(A, { foot: 30 }), at(A[0] - 3, TY, { foot: 30 })), arms: pair(atP(H), at(H[0] - 3, HY)) },
    },
    seq: [
      { to: 'down', s: 2, label: 'Kopf Richtung Boden', cue: 'Hüfte bleibt hoch', breath: 'ein' },
      HOLD(0.3, 'Unten'),
      { to: 'up', s: 1.2, label: 'Hochdrücken', breath: 'aus' },
      HOLD(0.4, 'Oben'),
    ],
  };
})();

M.bench_dip = {
  view: 'side', start: 'up', reps: 10, focus: ['upper', 'fore'], props: { box: [-60, -30, 36] },
  keys: {
    up: { hip: [-16, -36], torso: 0, legs: pair(at(30, FY), at(27, FY)), arms: pair(at(-26, -33.5, { bend: 'back' }), at(-28, -33.5, { bend: 'back' })) },
    down: { hip: [-16, -15], torso: 4, legs: pair(at(30, FY), at(27, FY)), arms: pair(at(-26, -33.5, { bend: 'back' }), at(-28, -33.5, { bend: 'back' })) },
  },
  seq: [
    { to: 'down', s: 2, label: 'Absenken', cue: 'Ellbogen zeigen nach hinten', breath: 'ein' },
    HOLD(0.3, 'Unten'),
    { to: 'up', s: 1, label: 'Hochdrücken', breath: 'aus' },
    HOLD(0.4, 'Oben'),
  ],
};

M.biceps_curl = {
  view: 'side', start: 'down', reps: 12, crop: -40, focus: ['upper'], hold: { r: 'db', l: 'db' },
  keys: {
    down: stand({ arms: pair(ang(2, 4), ang(-1, 1)) }),
    up: stand({ arms: pair(ang(4, 156), ang(0, 152)) }),
  },
  seq: [
    { to: 'up', s: 1, label: 'Beugen', cue: 'Ellbogen bleiben am Körper', breath: 'aus' },
    HOLD(0.4, 'Oben'),
    { to: 'down', s: 2, label: 'Langsam strecken', breath: 'ein' },
    HOLD(0.2, 'Unten'),
  ],
};

M.triceps_extension = {
  view: 'side', start: 'up', reps: 12, crop: -78, focus: ['upper'], hold: { both: 'db' },
  keys: {
    up: stand({ arms: pair(ang(174, 178), ang(172, 176)) }),
    down: stand({ arms: pair(ang(170, -14), ang(168, -16)) }),
  },
  seq: [
    { to: 'down', s: 2, label: 'Hinter den Kopf senken', cue: 'Oberarme bleiben neben dem Kopf', breath: 'ein' },
    HOLD(0.3, 'Unten'),
    { to: 'up', s: 1, label: 'Strecken', breath: 'aus' },
    HOLD(0.4, 'Oben'),
  ],
};

M.lateral_raise = {
  view: 'front', start: 'down', reps: 12, crop: -40, focus: ['upper'], hold: { r: 'db', l: 'db' },
  keys: {
    down: standFront({ arms: pair(ang(-8, -6), ang(8, 6)) }),
    up: standFront({ arms: pair(ang(-86, -82), ang(86, 82)) }),
  },
  seq: [
    { to: 'up', s: 1.2, label: 'Seitlich heben', cue: 'Bis Schulterhöhe, Schultern tief', breath: 'aus' },
    HOLD(0.4, 'Oben'),
    { to: 'down', s: 2, label: 'Absenken', breath: 'ein' },
    HOLD(0.2, 'Unten'),
  ],
};

M.band_pull_apart = {
  view: 'front', start: 'close', reps: 15, crop: -40, focus: ['upper', 'torso'], props: { band: [['rh', 'lh']] },
  keys: {
    close: standFront({ arms: pair(at(-11, -97, { bend: 'down', fs: 0.62 }), at(11, -97, { bend: 'down', fs: 0.62 })) }),
    open: standFront({ arms: pair(ang(-90, -90), ang(90, 90)) }),
  },
  seq: [
    { to: 'open', s: 1.2, label: 'Auseinanderziehen', cue: 'Schulterblätter zusammen, Arme lang', breath: 'aus' },
    HOLD(0.6, 'Halten'),
    { to: 'close', s: 1.6, label: 'Zurückführen', breath: 'ein' },
    HOLD(0.2, 'Vorn'),
  ],
};

M.pullup = {
  view: 'front', start: 'hang', reps: 6, focus: ['upper', 'torso'], props: { bar: [0, -158] }, floor: false,
  keys: {
    hang: { hip: [0, -78], torso: 0, legs: pair(at(-5, -32, { fs: 0.75 }), at(5, -32, { fs: 0.75 })), arms: pair(at(-26, -158, { bend: 'out' }), at(26, -158, { bend: 'out' })) },
    top: { hip: [0, -110], torso: 0, legs: pair(at(-5, -64, { fs: 0.75 }), at(5, -64, { fs: 0.75 })), arms: pair(at(-26, -158, { bend: 'out' }), at(26, -158, { bend: 'out' })) },
  },
  seq: [
    { to: 'top', s: 1.4, label: 'Hochziehen', cue: 'Brust zur Stange, Schultern tief', breath: 'aus' },
    HOLD(0.4, 'Oben'),
    { to: 'hang', s: 2, label: 'Langsam ablassen', breath: 'ein' },
    HOLD(0.4, 'Hängen'),
  ],
};

M.inverted_row = (() => {
  const bar = [-40, -62]; const A = [55, -6];
  const down = lineFromShoulder([-40, -18], A);
  const up = lineFromShoulder([-38, -48], A);
  const legs = pair(atP(A, { foot: 165 }), at(A[0] - 2, A[1], { foot: 165 }));
  return {
    view: 'side', start: 'down', reps: 10, focus: ['upper', 'torso'], props: { bar },
    keys: {
      down: { ...down, legs, arms: pair(atP(bar, { bend: 'down' }), at(bar[0] - 2, bar[1], { bend: 'down' })) },
      up: { ...up, legs, arms: pair(atP(bar, { bend: 'down' }), at(bar[0] - 2, bar[1], { bend: 'down' })) },
    },
    seq: [
      { to: 'up', s: 1.2, label: 'Brust zur Stange', cue: 'Körper bleibt eine Linie', breath: 'aus' },
      HOLD(0.4, 'Oben'),
      { to: 'down', s: 2, label: 'Ablassen', breath: 'ein' },
      HOLD(0.3, 'Unten'),
    ],
  };
})();

M.hip_thrust = (() => {
  const sh = [-38, -30.5];
  const dnT = -(Math.acos((-12 - sh[1]) / B.torso) / RAD);
  const down = { hip: hipFrom(sh, dnT), torso: dnT, head: 0 };
  const up = { hip: hipFrom(sh, -90), torso: -90, head: 18 };
  const legs = pair(at(28, FY), at(25, FY));
  const arms = pair(ang(-70, -96), ang(-72, -98));
  return {
    view: 'side', start: 'down', reps: 12, focus: ['hip', 'thigh'], props: { box: [-66, -24, 30] },
    keys: { down: { ...down, legs, arms }, up: { ...up, legs, arms } },
    seq: [
      { to: 'up', s: 1.2, label: 'Becken hoch', cue: 'Po fest, Knie über den Fersen', breath: 'aus' },
      HOLD(1, 'Oben halten'),
      { to: 'down', s: 1.8, label: 'Absenken', breath: 'ein' },
      HOLD(0.3, 'Unten'),
    ],
  };
})();

M.glute_bridge = {
  view: 'side', start: 'down', reps: 15, focus: ['hip', 'thigh'], props: { mat: [-62, 46] },
  keys: {
    down: supine(),
    up: { ...bridgeTorso(-31), legs: FEET_UP(), arms: pair(ang(90, 90), ang(88, 88)) },
  },
  seq: [
    { to: 'up', s: 1.4, label: 'Becken heben', cue: 'Po fest, kein Hohlkreuz', breath: 'aus' },
    HOLD(1, 'Oben halten'),
    { to: 'down', s: 2, label: 'Absenken', cue: 'Wirbel für Wirbel ablegen', breath: 'ein' },
    HOLD(0.5, 'Unten'),
  ],
};

M.single_leg_bridge = {
  view: 'side', start: 'down', reps: 10, sides: 'each', focus: ['hip', 'thigh'], props: { mat: [-62, 60] },
  keys: {
    down: supine({ legs: pair(ang(122, 122), at(27, FY)) }),
    up: { ...bridgeTorso(-28), legs: pair(ang(112, 112), at(27, FY)), arms: pair(ang(90, 90), ang(88, 88)) },
  },
  seq: [
    { to: 'up', s: 1.4, label: 'Becken heben', cue: 'Becken bleibt waagerecht', breath: 'aus' },
    HOLD(1, 'Oben halten'),
    { to: 'down', s: 2, label: 'Absenken', breath: 'ein' },
    HOLD(0.4, 'Unten'),
  ],
};

M.cossack_squat = {
  view: 'front', start: 'mid', reps: 6, sides: 'alternate', focus: ['thigh', 'hip'],
  keys: {
    mid: { hip: [0, -58], torso: 0, legs: pair(at(-36, FY), at(36, FY)), arms: clasp(-58) },
    side: { hip: [-24, -27], torso: 0, legs: pair(at(-36, FY, { bend: 'out' }), at(36, FY)), arms: clasp(-27, -18) },
  },
  seq: [
    { to: 'side', s: 2, label: 'Tief zur Seite', cue: 'Ferse bleibt am Boden, anderes Bein lang', breath: 'ein' },
    HOLD(0.5, 'Unten'),
    { to: 'mid', s: 1.5, label: 'Zurück zur Mitte', breath: 'aus' },
    HOLD(0.3, 'Mitte'),
  ],
};

M.side_lying_leg_raise = (() => {
  const hip = [0, -15]; const t = 90;
  return {
    view: 'front', start: 'down', reps: 15, sides: 'each', focus: ['thigh'], props: { mat: [-76, 70] },
    keys: {
      down: { hip, torso: t, legs: pair(at(-63, -16), at(-63, -7)), arms: pair(at(34, HY, { bend: 'up' }), ang(90, 90)) },
      up: { hip, torso: t, legs: pair(at(-52, -58), at(-63, -7)), arms: pair(at(34, HY, { bend: 'up' }), ang(90, 90)) },
    },
    seq: [
      { to: 'up', s: 1.2, label: 'Bein heben', cue: 'Zehen zeigen nach vorn, nicht kippen', breath: 'aus' },
      HOLD(0.6, 'Oben'),
      { to: 'down', s: 1.8, label: 'Absenken', breath: 'ein' },
      HOLD(0.2, 'Unten'),
    ],
  };
})();

M.clamshell = (() => {
  const hip = [0, -18]; const t = 90;
  const base = { hip, torso: t, arms: pair(at(30, HY, { bend: 'up' }), ang(90, 90)) };
  const low = ang(-78, 92, { fs: [0.95, 0.74] });
  return {
    view: 'front', start: 'closed', reps: 15, sides: 'each', focus: ['thigh'], props: { mat: [-34, 64] },
    keys: {
      closed: { ...base, legs: pair(ang(-72, 91, { fs: [0.95, 0.74] }), low) },
      open: { ...base, legs: pair(ang(-155, 10, { fs: [0.95, 1] }), low) },
    },
    seq: [
      { to: 'open', s: 1.2, label: 'Knie öffnen', cue: 'Füße bleiben zusammen, Becken ruhig', breath: 'aus' },
      HOLD(0.6, 'Oben'),
      { to: 'closed', s: 1.6, label: 'Schließen', breath: 'ein' },
      HOLD(0.2, 'Zu'),
    ],
  };
})();

M.monster_walk = (() => {
  const hipY = -58;
  const hands = pair(at(-14, hipY - 3, { bend: 'out' }), at(14, hipY - 3, { bend: 'out' }));
  return {
    view: 'front', start: 'base', reps: 10, sides: 'alternate', focus: ['hip', 'thigh'], props: { band: [['rk', 'lk']] },
    keys: {
      base: { hip: [0, hipY], torso: 0, legs: pair(at(-13, FY, { bend: 'out' }), at(13, FY, { bend: 'out' })), arms: hands },
      lift: { hip: [-4, hipY], torso: 0, legs: pair(at(-22, -12, { bend: 'out' }), at(13, FY, { bend: 'out' })), arms: hands },
      wide: { hip: [-8, hipY], torso: 0, legs: pair(at(-30, FY, { bend: 'out' }), at(13, FY, { bend: 'out' })), arms: hands },
    },
    seq: [
      { to: 'lift', s: 0.4, label: 'Schritt zur Seite', cue: 'Spannung im Band halten' },
      { to: 'wide', s: 0.4, label: 'Aufsetzen' },
      { to: 'lift', s: 0.4, label: 'Zurück' },
      { to: 'base', s: 0.4, label: 'Aufsetzen' },
    ],
  };
})();

M.donkey_kick = {
  view: 'side', start: 'base', reps: 12, sides: 'each', focus: ['hip'],
  keys: {
    base: quad(),
    kick: quad({ legs: pair(ang(-96, 176, { foot: -90 }), at(-33, -5, { bend: 'down', foot: -90 })) }),
  },
  seq: [
    { to: 'kick', s: 1, label: 'Ferse zur Decke', cue: 'Kein Hohlkreuz, Becken bleibt gerade', breath: 'aus' },
    HOLD(0.5, 'Oben'),
    { to: 'base', s: 1.4, label: 'Zurück', breath: 'ein' },
    HOLD(0.2, 'Vierfüßler'),
  ],
};

M.nordic_hamstring = (() => {
  const K = [0, -5];
  const leanAt = (deg) => { const v = [Math.sin(deg * RAD), -Math.cos(deg * RAD)]; return { hip: mv(K, v, B.thigh), torso: deg }; };
  const legs = pair(at(-31, -5, { bend: 'down', foot: -90 }), at(-33, -5, { bend: 'down', foot: -90 }));
  const catchP = leanAt(78); const csh = shoulderOf(catchP.hip, 78);
  return {
    view: 'side', start: 'up', reps: 5, focus: ['thigh'], props: { mat: [-48, 96], box: [-44, -15, 16] },
    keys: {
      up: { hip: [0, -37], torso: 0, legs, arms: pair(atP(chestPt([0, -37], 0, 8, 14), { bend: 'down' }), atP(chestPt([0, -37], 0, 6, 14), { bend: 'down' })) },
      lean: { ...leanAt(55), legs, arms: pair(ang(70, 82), ang(66, 78)) },
      catch: { ...catchP, legs, arms: pair(at(csh[0] + 6, HY), at(csh[0] + 3, HY)) },
    },
    seq: [
      { to: 'lean', s: 2.5, label: 'Langsam nach vorn', cue: 'Hüfte gestreckt, mit der Rückseite bremsen', breath: 'ein' },
      { to: 'catch', s: 0.7, label: 'Abfangen' },
      HOLD(0.3, 'Hände am Boden'),
      { to: 'up', s: 1.4, label: 'Zurückdrücken', cue: 'Mit den Händen abstoßen', breath: 'aus' },
      HOLD(0.6, 'Kniestand'),
    ],
  };
})();

M.pogo_jumps = {
  view: 'side', start: 'ground', holdS: 20, focus: ['shin'],
  keys: {
    ground: stand({ drop: -2, legs: pair(onToes(2, 55), onToes(-2, 55)), arms: pair(ang(10, 80), ang(6, 76)) }),
    air: stand({ drop: -9, legs: pair(at(4, -13, { foot: 40 }), at(0, -13, { foot: 40 })), arms: pair(ang(10, 80), ang(6, 76)) }),
  },
  seq: [{ to: 'air', s: 0.25, label: 'Hoch', cue: 'Nur aus dem Fußgelenk, kurze Kontakte' }, { to: 'ground', s: 0.25, label: 'Landen' }],
};

/* ------------------------------ Rumpf ------------------------------ */

M.plank = {
  view: 'side', start: 'hold', holdS: 30, focus: ['torso', 'hip'], props: { mat: [-64, 80] },
  keys: { hold: { ...PL_FA, legs: TOES(), arms: pair(ang(0, 90), ang(-2, 88)) } },
  seq: STILL('Bauch fest, Po nicht hochschieben'),
};

M.side_plank = (() => {
  const hip = [-2, -26];
  const t = torsoForLowShoulder(hip, [37, -27]);
  return {
    view: 'front', start: 'hold', holdS: 25, sides: 'each', focus: ['torso', 'hip'],
    keys: {
      hold: { hip, torso: t, legs: pair(at(-62, FY - 1, { bend: 'down' }), at(-63, FY - 7, { bend: 'down' })), arms: pair(ang(150, 172), ang(0, 70)) },
    },
    seq: STILL('Becken hoch, Körper bleibt gerade'),
  };
})();

M.copenhagen = (() => {
  const shL = [36, -27];
  const upHip = [-4, -28];
  const dnHip = [shL[0] - Math.sqrt(39.85 ** 2 - (shL[1] + 14) ** 2), -14];
  const arms = pair(ang(168, 176), ang(0, 72));
  return {
    view: 'front', start: 'down', reps: 6, sides: 'each', focus: ['thigh', 'torso'], props: { box: [-92, -20, 30] },
    keys: {
      down: { hip: dnHip, torso: torsoForLowShoulder(dnHip, shL), legs: pair(at(-70, -24, { bend: 'up' }), at(-58, FY, { bend: 'down' })), arms },
      up: { hip: upHip, torso: torsoForLowShoulder(upHip, shL), legs: pair(at(-70, -24, { bend: 'up' }), at(-58, FY, { bend: 'down' })), arms },
    },
    seq: [
      { to: 'up', s: 1.4, label: 'Hüfte heben', cue: 'Oberes Bein drückt in die Bank', breath: 'aus' },
      HOLD(2, 'Halten'),
      { to: 'down', s: 1.6, label: 'Absenken', breath: 'ein' },
      HOLD(0.4, 'Unten'),
    ],
  };
})();

M.dead_bug = {
  view: 'side', start: 'base', reps: 8, sides: 'alternate', focus: ['torso'], props: { mat: [-70, 52] },
  keys: {
    base: supine({ legs: pair(ang(180, 90), ang(178, 88)), arms: pair(ang(180, 180), ang(178, 178)) }),
    reach: supine({ legs: pair(ang(180, 90), ang(96, 96)), arms: pair(ang(-96, -96), ang(178, 178)) }),
  },
  seq: [
    { to: 'reach', s: 2, label: 'Strecken', cue: 'Unterer Rücken bleibt am Boden', breath: 'aus' },
    HOLD(0.5, 'Lang'),
    { to: 'base', s: 1.5, label: 'Zurück zur Mitte', breath: 'ein' },
    HOLD(0.3, 'Mitte'),
  ],
};

M.side_crunch = {
  view: 'front', start: 'base', reps: 10, sides: 'alternate', focus: ['torso'],
  keys: {
    base: standFront({ w: 9, arms: pair(at(-13, -62, { bend: 'out' }), at(13, -62, { bend: 'out' })) }),
    bend: standFront({ w: 9, lean: -24, arms: pair(at(-24, -56, { bend: 'out' }), at(6, -68, { bend: 'out' })) }),
  },
  seq: [
    { to: 'bend', s: 1.5, label: 'Zur Seite neigen', cue: 'Nicht nach vorn beugen', breath: 'ein' },
    HOLD(0.3, 'Unten'),
    { to: 'base', s: 1.2, label: 'Aufrichten', cue: 'Aus der seitlichen Bauchmuskulatur', breath: 'aus' },
    HOLD(0.3, 'Mitte'),
  ],
};

M.crunch = (() => {
  const temple = (t, h) => { const p = mv(headOf(SUP_HIP, t, h), fdir(t), 3); return pair(atP(p, { bend: 'front' }), at(p[0] - 2, p[1], { bend: 'front' })); };
  return {
    view: 'side', start: 'down', reps: 15, focus: ['torso'], props: { mat: [-70, 46] },
    keys: {
      down: supine({ arms: temple(-90, 0) }),
      up: lifted(-66, { curl: 5, head: 10, legs: FEET_UP(), arms: temple(-66, 10) }),
    },
    seq: [
      { to: 'up', s: 1, label: 'Einrollen', cue: 'Kraft aus dem Bauch, Nacken locker', breath: 'aus' },
      HOLD(0.6, 'Oben'),
      { to: 'down', s: 1.6, label: 'Ablegen', breath: 'ein' },
      HOLD(0.3, 'Unten'),
    ],
  };
})();

M.bicycle_crunch = (() => {
  const t = -66;
  const hands = () => { const p = behindHead(SUP_HIP, t); return pair(atP(p, { bend: 'front' }), at(p[0] - 2, p[1], { bend: 'front' })); };
  return {
    view: 'side', start: 'mid', reps: 10, sides: 'alternate', focus: ['torso'], props: { mat: [-70, 60] },
    keys: {
      mid: lifted(t, { curl: 4, legs: pair(ang(152, 96), ang(150, 94)), arms: hands() }),
      twist: lifted(t + 4, { curl: 6, legs: pair(ang(-170, 100), ang(97, 97)), arms: hands() }),
    },
    seq: [
      { to: 'twist', s: 0.7, label: 'Knie zum Gegenellbogen', cue: 'Schultern bleiben oben', breath: 'aus' },
      HOLD(0.2, 'Drehen'),
      { to: 'mid', s: 0.6, label: 'Wechseln', breath: 'ein' },
    ],
  };
})();

M.reverse_crunch = {
  view: 'side', start: 'down', reps: 12, focus: ['torso'], props: { mat: [-70, 40] },
  keys: {
    down: supine({ legs: pair(ang(178, 92), ang(176, 90)) }),
    up: { hip: hipFrom(SUP_SH, -110), torso: -110, head: 20, curl: 4, legs: pair(ang(-150, 140), ang(-152, 138)), arms: pair(ang(90, 90), ang(88, 88)) },
  },
  seq: [
    { to: 'up', s: 1.2, label: 'Becken einrollen', cue: 'Knie Richtung Brust, ohne Schwung', breath: 'aus' },
    HOLD(0.3, 'Oben'),
    { to: 'down', s: 1.8, label: 'Langsam ablegen', breath: 'ein' },
    HOLD(0.3, 'Unten'),
  ],
};

M.leg_raise = {
  view: 'side', start: 'down', reps: 12, focus: ['torso', 'thigh'], props: { mat: [-70, 50] },
  keys: {
    down: supine({ legs: pair(ang(96, 96), ang(95, 95)) }),
    up: supine({ legs: pair(ang(178, 178), ang(176, 176)) }),
  },
  seq: [
    { to: 'up', s: 1.5, label: 'Beine heben', cue: 'Unterer Rücken bleibt am Boden', breath: 'aus' },
    HOLD(0.4, 'Oben'),
    { to: 'down', s: 2.5, label: 'Langsam absenken', cue: 'Fersen nicht ganz ablegen', breath: 'ein' },
    HOLD(0.3, 'Unten'),
  ],
};

M.flutter_kicks = {
  view: 'side', start: 'mid', holdS: 30, sides: 'alternate', focus: ['torso', 'thigh'], props: { mat: [-70, 60] },
  keys: {
    mid: lifted(-84, { legs: pair(ang(100, 100), ang(100, 100)) }),
    kick: lifted(-84, { legs: pair(ang(108, 108), ang(94, 94)) }),
  },
  seq: [{ to: 'kick', s: 0.34, label: 'Kleine Schläge', cue: 'Unterer Rücken am Boden' }, { to: 'mid', s: 0.34, label: 'Wechsel' }],
};

M.hollow_hold = {
  view: 'side', start: 'hold', holdS: 20, focus: ['torso'], props: { mat: [-80, 60] },
  intro: { from: 'flat', seq: [{ to: 'hold', s: 1.6, label: 'Schultern und Beine heben' }] },
  keys: {
    flat: supine({ legs: pair(ang(92, 92), ang(91, 91)), arms: pair(ang(-92, -92), ang(-91, -91)) }),
    hold: lifted(-80, { curl: 4, head: 8, legs: pair(ang(103, 103), ang(102, 102)), arms: pair(ang(-108, -108), ang(-107, -107)) }),
  },
  seq: STILL('Unterer Rücken fest am Boden'),
};

M.v_up = {
  view: 'side', start: 'down', reps: 10, focus: ['torso', 'thigh'], props: { mat: [-80, 60] },
  keys: {
    down: supine({ legs: pair(ang(92, 92), ang(91, 91)), arms: pair(ang(-92, -92), ang(-91, -91)) }),
    up: supine({ torso: -40, curl: 4, legs: pair(ang(136, 136), ang(134, 134)), arms: pair(ang(132, 132), ang(130, 130)) }),
  },
  seq: [
    { to: 'up', s: 1, label: 'Zusammenklappen', cue: 'Hände Richtung Füße', breath: 'aus' },
    HOLD(0.3, 'Oben'),
    { to: 'down', s: 1.6, label: 'Langsam ablegen', breath: 'ein' },
    HOLD(0.3, 'Unten'),
  ],
};

M.superman = {
  view: 'side', start: 'down', reps: 10, focus: ['torso', 'hip'], props: { mat: [-70, 90] },
  keys: {
    down: prone(),
    up: prone({ torso: 77, curl: -4, legs: pair(ang(-105, -105, { foot: -105 }), ang(-106, -106, { foot: -105 })), arms: pair(ang(106, 106), ang(105, 105)) }),
  },
  seq: [
    { to: 'up', s: 1.2, label: 'Abheben', cue: 'Blick zum Boden, Nacken lang', breath: 'aus' },
    HOLD(1.5, 'Halten'),
    { to: 'down', s: 1.5, label: 'Ablegen', breath: 'ein' },
    HOLD(0.5, 'Unten'),
  ],
};

M.bird_dog = {
  view: 'side', start: 'base', reps: 8, sides: 'alternate', focus: ['torso', 'hip'],
  keys: {
    base: quad(),
    reach: quad({
      arms: pair(ang(98, 100), at(QUAD_SH_X - 2, HY)),
      legs: pair(at(-31, -5, { bend: 'down', foot: -90 }), ang(-84, -88, { foot: -100 })),
    }),
  },
  seq: [
    { to: 'reach', s: 1.5, label: 'Strecken', cue: 'Arm und Gegenbein lang machen', breath: 'aus' },
    HOLD(1.5, 'Halten', { cue: 'Becken bleibt waagerecht' }),
    { to: 'base', s: 1.5, label: 'Zurück', breath: 'ein' },
    HOLD(0.4, 'Vierfüßler'),
  ],
};

M.shoulder_tap = (() => {
  const sh = PU_TOP.sh;
  return {
    view: 'side', start: 'plank', reps: 10, sides: 'alternate', focus: ['torso', 'upper'],
    keys: {
      plank: plankTop(),
      tap: plankTop({ arms: pair(at(sh[0] - 3, sh[1] + 5, { bend: 'down' }), at(PU_HAND - 3, HY)) }),
    },
    seq: [
      { to: 'tap', s: 0.6, label: 'Schulter tippen', cue: 'Hüfte bleibt ruhig' },
      HOLD(0.2, 'Tippen'),
      { to: 'plank', s: 0.5, label: 'Hand zurück' },
      HOLD(0.2, 'Stütz'),
    ],
  };
})();

M.bear_plank = {
  view: 'side', start: 'hold', holdS: 30, focus: ['torso', 'thigh'],
  intro: { from: 'quad', seq: [{ to: 'hold', s: 1.5, label: 'Knie anheben' }] },
  keys: { quad: quad({ legs: pair(at(-30, -5, { bend: 'down', foot: 25 }), at(-33, -5, { bend: 'down', foot: 25 })) }), hold: bear() },
  seq: STILL('Knie schweben, Rücken bleibt flach'),
};

M.glute_bridge_march = {
  view: 'side', start: 'bridge', reps: 8, sides: 'alternate', focus: ['hip', 'torso'], props: { mat: [-62, 46] },
  intro: { from: 'down', seq: [{ to: 'bridge', s: 1.2, label: 'Becken heben' }] },
  keys: {
    down: supine(),
    bridge: { ...bridgeTorso(-30), legs: FEET_UP(), arms: pair(ang(90, 90), ang(88, 88)) },
    march: { ...bridgeTorso(-30), legs: pair(ang(172, 94), at(27, FY)), arms: pair(ang(90, 90), ang(88, 88)) },
  },
  seq: [
    { to: 'march', s: 0.8, label: 'Knie heben', cue: 'Becken bleibt oben und gerade', breath: 'aus' },
    HOLD(0.4, 'Oben'),
    { to: 'bridge', s: 0.8, label: 'Fuß absetzen', breath: 'ein' },
  ],
};

M.russian_twist = (() => {
  const hip = [0, -12];
  const legs = pair(at(-9, -26, { fs: [0.55, 0.62], bend: 'out' }), at(9, -26, { fs: [0.55, 0.62], bend: 'out' }));
  return {
    view: 'front', start: 'mid', reps: 10, sides: 'alternate', focus: ['torso'],
    keys: {
      mid: { hip, torso: 0, legs, arms: pair(at(-3, -32, { bend: 'out' }), at(3, -32, { bend: 'out' })) },
      side: { hip, torso: -8, legs, arms: pair(at(-30, -24, { bend: 'out' }), at(-25, -24, { bend: 'out' })) },
    },
    seq: [
      { to: 'side', s: 0.7, label: 'Zur Seite drehen', cue: 'Oberkörper dreht, Füße bleiben ruhig', breath: 'aus' },
      HOLD(0.2, 'Seite'),
      { to: 'mid', s: 0.6, label: 'Zur Mitte', breath: 'ein' },
    ],
  };
})();

/* ------------------------------ Beweglichkeit ------------------------------ */

M.hip_flexor_stretch = {
  view: 'side', start: 'stretch', holdS: 30, sides: 'each', focus: ['hip', 'thigh'], props: { mat: [-56, 40] },
  intro: { from: 'base', seq: [{ to: 'stretch', s: 2.5, label: 'Hüfte nach vorn schieben', cue: 'Po anspannen, kein Hohlkreuz' }] },
  keys: {
    base: { hip: [-12, -37], torso: 0, legs: pair(at(-44, -5, { bend: 'down', foot: -90 }), at(26, FY)), arms: pair(ang(4, 8), ang(-2, 2)) },
    stretch: { hip: [-2, -34], torso: -4, legs: pair(at(-44, -5, { bend: 'down', foot: -90 }), at(26, FY)), arms: pair(ang(176, 180), ang(10, 20)) },
  },
  seq: STILL('Vorne in der Hüfte zieht es'),
};

M.hamstring_stretch = {
  view: 'side', start: 'stretch', holdS: 30, sides: 'each', focus: ['thigh'],
  intro: { from: 'base', seq: [{ to: 'stretch', s: 2, label: 'Hüfte nach hinten', cue: 'Mit geradem Rücken nach vorn neigen' }] },
  keys: {
    base: { hip: [0, -63], torso: 0, legs: pair(at(16, FY, { foot: 125 }), at(-8, FY)), arms: pair(ang(4, 8), ang(-2, 2)) },
    stretch: { hip: [-12, -60], torso: 50, legs: pair(at(16, FY, { foot: 125 }), at(-8, FY)), arms: pair(at(16, -44, { bend: 'back' }), at(14, -46, { bend: 'back' })) },
  },
  seq: STILL('Rücken lang, nicht rund machen'),
};

M.calf_stretch = {
  view: 'side', start: 'stretch', holdS: 30, sides: 'each', focus: ['shin'], props: { wall: 44 },
  intro: { from: 'base', seq: [{ to: 'stretch', s: 2, label: 'Hüfte nach vorn', cue: 'Hintere Ferse bleibt am Boden' }] },
  keys: {
    base: { hip: [0, -62], torso: 10, legs: pair(at(-26, FY), at(18, FY)), arms: pair(at(42, -96, { bend: 'down' }), at(41, -98, { bend: 'down' })) },
    stretch: { hip: [6, -59], torso: 20, legs: pair(at(-26, FY), at(18, FY)), arms: pair(at(42, -96, { bend: 'down' }), at(41, -98, { bend: 'down' })) },
  },
  seq: STILL('Hinteres Bein gestreckt, Ferse unten'),
};

M.quad_stretch = (() => {
  const hip = [0, STAND];
  const leg = fk(hip, -6, -175, B.thigh, B.shin);
  return {
    view: 'side', start: 'hold', holdS: 30, sides: 'each', focus: ['thigh'],
    intro: { from: 'base', seq: [{ to: 'hold', s: 1.5, label: 'Ferse zum Po' }] },
    keys: {
      base: stand(),
      hold: { hip, torso: 0, legs: pair(ang(-6, -175, { foot: -150 }), at(-2, FY)), arms: pair(at(leg.end[0] - 1, leg.end[1] + 1, { bend: 'down' }), ang(80, 86)) },
    },
    seq: STILL('Knie zeigt nach unten, Hüfte nach vorn'),
  };
})();

M.cat_cow = {
  view: 'side', start: 'cat', reps: 8, focus: ['torso'], props: { mat: [-48, 56] },
  keys: { cow: quad({ curl: -14, head: -26 }), cat: quad({ curl: 17, head: 34 }) },
  seq: [
    { to: 'cow', s: 2, label: 'Kuh', cue: 'Rücken sinkt, Blick nach vorn oben', breath: 'ein' },
    HOLD(0.5, 'Kuh'),
    { to: 'cat', s: 2, label: 'Katze', cue: 'Rücken rund, Kinn zur Brust', breath: 'aus' },
    HOLD(0.5, 'Katze'),
  ],
};

M.chest_opener = {
  view: 'side', start: 'open', holdS: 25, crop: -40, focus: ['torso', 'upper'],
  intro: { from: 'base', seq: [{ to: 'open', s: 1.5, label: 'Hände hinter dem Rücken fassen' }] },
  keys: { base: stand(), open: stand({ head: -8, arms: pair(ang(-38, -34), ang(-40, -36)) }) },
  seq: STILL('Brustbein hoch, Schultern tief', 'ruhig atmen'),
};

M.child_pose = {
  view: 'side', start: 'rest', holdS: 30, focus: ['torso'], props: { mat: [-30, 80] },
  intro: { from: 'kneel', seq: [{ to: 'rest', s: 2.5, label: 'Nach vorn ablegen' }] },
  keys: {
    kneel: { hip: [-10, -17], torso: 0, legs: pair(at(-11, -5, { bend: 'down', foot: -90 }), at(-13, -5, { bend: 'down', foot: -90 })), arms: pair(ang(20, 40), ang(16, 36)) },
    rest: { hip: [-10, -17], torso: 106, head: -14, curl: 6, legs: pair(at(-11, -5, { bend: 'down', foot: -90 }), at(-13, -5, { bend: 'down', foot: -90 })), arms: pair(ang(93, 93), ang(92, 92)) },
  },
  seq: STILL('Stirn ruht, tief in den Rücken atmen'),
};

M.supine_twist = {
  view: 'front', top: true, floor: false, start: 'twist', holdS: 30, sides: 'each', focus: ['torso'], props: { topMat: [-64, -138, 128, 126] },
  intro: { from: 'base', seq: [{ to: 'twist', s: 2.5, label: 'Knie zur Seite ablegen' }] },
  keys: {
    base: { hip: [0, -66], torso: 0, legs: pair(at(-6, -24, { fs: [0.68, 0.68], bend: 'out' }), at(6, -24, { fs: [0.68, 0.68], bend: 'out' })), arms: pair(ang(-90, -90), ang(90, 90)) },
    twist: { hip: [0, -66], torso: 0, head: -16, legs: pair(ang(55, -10, { fs: 0.9 }), ang(50, -5, { fs: 0.9 })), arms: pair(ang(-90, -90), ang(90, 90)) },
  },
  seq: STILL('Beide Schultern bleiben am Boden'),
};

M.figure_four = (() => {
  const K1 = ik(SUP_HIP, [24, FY], B.thigh, B.shin, [0, -1]).joint;
  const K2 = fk(SUP_HIP, -150, 90, B.thigh, B.shin).joint;
  // Die Hände fassen hinter den Oberschenkel, nah an der Hüfte (dort reichen die Arme hin).
  const mid = (K) => [SUP_HIP[0] + (K[0] - SUP_HIP[0]) * 0.35, SUP_HIP[1] + (K[1] - SUP_HIP[1]) * 0.35];
  return {
    view: 'side', start: 'pull', holdS: 30, sides: 'each', focus: ['hip'], props: { mat: [-70, 50] },
    intro: { from: 'base', seq: [{ to: 'pull', s: 2.5, label: 'Unteres Bein heranziehen' }] },
    keys: {
      base: supine({ legs: pair(at(K1[0] + 2, K1[1] - 5, { bend: 'up', fs: [0.75, 0.9] }), at(24, FY)), arms: pair(atP(mid(K1), { bend: 'up' }), atP(mid(K1), { bend: 'up' })) }),
      pull: supine({ legs: pair(at(K2[0] + 3, K2[1] - 5, { bend: 'up', fs: [0.75, 0.9] }), ang(-150, 90)), arms: pair(atP(mid(K2), { bend: 'up' }), atP(mid(K2), { bend: 'up' })) }),
    },
    seq: STILL('Es zieht im Gesäß, Kopf bleibt liegen'),
  };
})();

M.butterfly_stretch = {
  view: 'front', start: 'hold', holdS: 30, focus: ['thigh'],
  keys: {
    hold: { hip: [0, -10], torso: 0, legs: pair(ang(-78, 84, { fs: 0.8 }), ang(78, -84, { fs: 0.8 })), arms: pair(at(-8, -12, { bend: 'out' }), at(8, -12, { bend: 'out' })) },
  },
  seq: STILL('Aufrecht sitzen, nicht federn'),
};

M.pigeon_pose = {
  view: 'side', start: 'fold', holdS: 30, sides: 'each', focus: ['hip'], props: { mat: [-76, 80] },
  intro: { from: 'up', seq: [{ to: 'fold', s: 2.5, label: 'Oberkörper ablegen' }] },
  keys: {
    up: { hip: [0, -14], torso: 4, legs: pair(ang(70, -95, { fs: [0.8, 0.5] }), ang(-80, -88, { foot: -90 })), arms: pair(ang(8, 12), ang(4, 8)) },
    fold: { hip: [0, -14], torso: 80, curl: 4, legs: pair(ang(70, -95, { fs: [0.8, 0.5] }), ang(-80, -88, { foot: -90 })), arms: pair(ang(92, 92), ang(91, 91)) },
  },
  seq: STILL('Hüfte sinkt Richtung Boden'),
};

M.downward_dog = (() => {
  const A = [-34, -6]; const Hd = [40, HY];
  const hip = apex(A, B.thigh + B.shin - 0.5, Hd, B.torso + B.upper + B.fore - 0.5);
  const t = tFromDir([Hd[0] - hip[0], Hd[1] - hip[1]]);
  return {
    view: 'side', start: 'dog', holdS: 30, focus: ['thigh', 'upper'], props: { mat: [-48, 56] },
    intro: { from: 'quad', seq: [{ to: 'dog', s: 2, label: 'Hüfte nach oben schieben' }] },
    keys: {
      quad: { ...quad({ legs: pair(at(-31, -5, { bend: 'down', foot: 25 }), at(-33, -5, { bend: 'down', foot: 25 })) }), arms: pair(at(40, HY), at(38, HY)) },
      dog: { hip, torso: t, legs: pair(atP(A, { foot: 62 }), at(A[0] - 3, A[1], { foot: 62 })), arms: pair(atP(Hd), at(Hd[0] - 2, HY)) },
    },
    seq: STILL('Fersen Richtung Boden, Rücken lang'),
  };
})();

M.cobra = {
  view: 'side', start: 'down', reps: 6, focus: ['torso'], props: { mat: [-70, 64] },
  keys: {
    down: prone({ arms: pair(at(28, HY, { bend: 'back' }), at(26, HY, { bend: 'back' })) }),
    up: prone({ torso: 58, curl: -8, head: -10, arms: pair(at(28, HY, { bend: 'back' }), at(26, HY, { bend: 'back' })) }),
  },
  seq: [
    { to: 'up', s: 2, label: 'Brust heben', cue: 'Becken bleibt am Boden, Schultern tief', breath: 'ein' },
    HOLD(3, 'Halten'),
    { to: 'down', s: 2, label: 'Ablegen', breath: 'aus' },
    HOLD(0.5, 'Unten'),
  ],
};

M.worlds_greatest_stretch = (() => {
  const hip = [-8, -30]; const t = 72;
  const legs = pair(at(26, FY), at(-56, TY, { foot: 30 }));
  return {
    view: 'side', start: 'base', reps: 4, sides: 'alternate', focus: ['hip', 'torso'],
    keys: {
      base: { hip, torso: t, legs, arms: pair(at(20, HY), at(17, HY)) },
      elbow: { hip, torso: t + 4, legs, arms: pair(at(16, -14, { bend: 'back' }), at(17, HY)) },
      open: { hip, torso: t - 8, head: -40, legs, arms: pair(ang(178, 180), at(17, HY)) },
    },
    seq: [
      { to: 'elbow', s: 1.5, label: 'Ellbogen zum Fuß', cue: 'Hinteres Bein lang', breath: 'aus' },
      HOLD(1, 'Halten'),
      { to: 'base', s: 1, label: 'Hand zurück' },
      { to: 'open', s: 1.6, label: 'Arm zur Decke drehen', cue: 'Blick folgt der Hand', breath: 'ein' },
      HOLD(1.5, 'Offen'),
      { to: 'base', s: 1.2, label: 'Zurück' },
      HOLD(0.4, 'Ausfallschritt'),
    ],
  };
})();

M.leg_swings = {
  view: 'side', start: 'front', reps: 12, sides: 'each', focus: ['thigh', 'hip'], props: { wall: 42 },
  keys: {
    front: { hip: [0, STAND], torso: -4, legs: pair(ang(58, 58, { foot: 100 }), at(-2, FY)), arms: pair(ang(-20, -10), at(40, -98, { bend: 'down' })) },
    back: { hip: [0, STAND], torso: 6, legs: pair(ang(-32, -32, { foot: 30 }), at(-2, FY)), arms: pair(ang(25, 35), at(40, -98, { bend: 'down' })) },
  },
  seq: [{ to: 'back', s: 0.55, label: 'Nach hinten', cue: 'Locker pendeln, Oberkörper ruhig' }, { to: 'front', s: 0.55, label: 'Nach vorn' }],
};

M.arm_circles = {
  view: 'side', start: 'down', reps: 10, crop: -40, focus: ['upper'],
  keys: {
    down: stand({ arms: pair(ang(2, 2), ang(0, 0)) }),
    fwd: stand({ arms: pair(ang(90, 92), ang(88, 90)) }),
    up: stand({ arms: pair(ang(178, 180), ang(176, 178)) }),
    back: stand({ arms: pair(ang(-90, -88), ang(-92, -90)) }),
  },
  seq: [
    { to: 'fwd', s: 0.4, label: 'Große Kreise', cue: 'Arme lang, Schultern locker' },
    { to: 'up', s: 0.4, label: 'Große Kreise' },
    { to: 'back', s: 0.4, label: 'Große Kreise' },
    { to: 'down', s: 0.4, label: 'Große Kreise' },
  ],
};

M.ankle_rocks = {
  view: 'side', start: 'back', reps: 10, sides: 'each', focus: ['shin'], props: { wall: 36 },
  keys: {
    back: { hip: [-10, -37], torso: 4, legs: pair(at(16, FY), at(-40, -5, { bend: 'down', foot: -90 })), arms: pair(at(34, -70, { bend: 'down' }), at(33, -72, { bend: 'down' })) },
    fwd: { hip: [-1, -36], torso: 10, legs: pair(at(16, FY), at(-40, -5, { bend: 'down', foot: -90 })), arms: pair(at(34, -70, { bend: 'down' }), at(33, -72, { bend: 'down' })) },
  },
  seq: [
    { to: 'fwd', s: 1.2, label: 'Knie Richtung Wand', cue: 'Ferse bleibt am Boden', breath: 'aus' },
    HOLD(0.8, 'Vorn'),
    { to: 'back', s: 1.2, label: 'Zurück', breath: 'ein' },
  ],
};

M.neck_stretch = (() => {
  const h = -26;
  const head = mv(mv([0, STAND], tdir(0), B.torso), tdir(h), B.neck + B.head);
  return {
    view: 'front', start: 'tilt', holdS: 20, sides: 'each', crop: -60, focus: [],
    intro: { from: 'base', seq: [{ to: 'tilt', s: 2, label: 'Ohr zur Schulter' }] },
    keys: {
      base: standFront(),
      tilt: standFront({ head: h, arms: pair(at(head[0] - 3, head[1] - 8, { bend: 'out' }), ang(8, 6)) }),
    },
    seq: STILL('Gegenschulter bleibt tief, sanft ziehen'),
  };
})();

M.side_bend_stretch = {
  view: 'front', start: 'base', reps: 4, sides: 'alternate', focus: ['torso'],
  keys: {
    base: standFront({ w: 9, arms: pair(ang(-6, -4), at(14, -62, { bend: 'out' })) }),
    bend: standFront({ w: 9, lean: 18, arms: pair(ang(176, 140), at(14, -62, { bend: 'out' })) }),
  },
  seq: [
    { to: 'bend', s: 1.6, label: 'Zur Seite strecken', cue: 'Lang machen, nicht nach vorn kippen', breath: 'aus' },
    HOLD(2, 'Halten'),
    { to: 'base', s: 1.4, label: 'Aufrichten', breath: 'ein' },
    HOLD(0.3, 'Mitte'),
  ],
};

M.inchworm = (() => {
  const A = [0, TY];
  const pl = bodyLine(A, lineDeg(A, -47.5));
  const hx = pl.sh[0] - 2;
  return {
    view: 'side', start: 'stand', reps: 5, focus: ['thigh', 'torso'],
    keys: {
      stand: stand(),
      fold: { hip: [-6, -63], torso: 125, legs: pair(at(2, FY), at(-2, FY)), arms: pair(at(28, HY), at(25, HY)) },
      plank: { ...pl, legs: TOES(A[0]), arms: pair(at(hx, HY), at(hx - 3, HY)) },
    },
    seq: [
      { to: 'fold', s: 1.5, label: 'Nach vorn abrollen', breath: 'aus' },
      { to: 'plank', s: 2, label: 'Hände nach vorn laufen', cue: 'Beine bleiben möglichst gestreckt' },
      HOLD(0.5, 'Brett'),
      { to: 'fold', s: 2, label: 'Hände zurücklaufen' },
      { to: 'stand', s: 1.5, label: 'Aufrollen', breath: 'ein' },
      HOLD(0.3, 'Stand'),
    ],
  };
})();

M.deep_squat_hold = (() => {
  const hip = [-10, -22]; const t = 30;
  const c = chestPt(hip, t, 14, 16);
  return {
    view: 'side', start: 'deep', holdS: 30, focus: ['hip', 'thigh'],
    intro: { from: 'base', seq: [{ to: 'deep', s: 2, label: 'Tief in die Hocke' }] },
    keys: {
      base: stand(),
      deep: { hip, torso: t, legs: pair(at(2, FY), at(-2, FY)), arms: pair(atP(c, { bend: 'down' }), at(c[0] - 2, c[1], { bend: 'down' })) },
    },
    seq: STILL('Fersen am Boden, Brust offen'),
  };
})();

M.running_drills = {
  view: 'side', start: 'base', holdS: 20, sides: 'alternate', focus: ['thigh', 'shin'],
  keys: {
    base: stand({ drop: -2, legs: pair(onToes(2, 55), onToes(-2, 55)), arms: pair(ang(0, 70), ang(0, 70)) }),
    knee: stand({ drop: -3, legs: pair(ang(88, 4, { foot: 60 }), onToes(-2, 55)), arms: pair(ang(-38, 40), ang(40, 118)) }),
  },
  seq: [{ to: 'knee', s: 0.3, label: 'Knie hoch', cue: 'Aufrecht, schnelle Frequenz' }, { to: 'base', s: 0.3, label: 'Wechsel' }],
};

M.fifa11 = {
  view: 'side', start: 'base', holdS: 30, sides: 'alternate', focus: ['thigh', 'hip'],
  keys: {
    base: stand({ drop: -1, legs: pair(onToes(2, 60), onToes(-2, 60)), arms: pair(ang(0, 70), ang(0, 70)) }),
    knee: stand({ drop: -4, legs: pair(ang(62, 10, { foot: 70 }), onToes(-2, 55)), arms: pair(ang(-30, 40), ang(34, 110)) }),
  },
  seq: [{ to: 'knee', s: 0.32, label: 'Lockeres Laufen mit Knieheben', cue: 'Knie zeigen nach vorn, nicht nach innen' }, { to: 'base', s: 0.32, label: 'Wechsel' }],
};

/* ------------------------------ Kondition ------------------------------ */

M.jumping_jack = {
  view: 'front', start: 'closed', thumb: 'open', reps: 20, focus: ['shin', 'thigh'],
  keys: {
    closed: standFront({ w: 5 }),
    air: { hip: [0, STAND_HIP - 6], torso: 0, legs: pair(at(-15, -9), at(15, -9)), arms: pair(ang(-95, -100), ang(95, 100)) },
    open: { hip: [0, STAND_HIP + 2], torso: 0, legs: pair(at(-24, FY), at(24, FY)), arms: pair(ang(-160, -168), ang(160, 168)) },
  },
  seq: [
    { to: 'air', s: 0.29, label: 'Springen' },
    { to: 'open', s: 0.29, label: 'Auf', cue: 'Leicht auf dem Vorfuß landen', breath: 'ein' },
    { to: 'air', s: 0.29, label: 'Springen' },
    { to: 'closed', s: 0.29, label: 'Zu', breath: 'aus' },
    HOLD(0.1, 'Zu'),
  ],
};

M.high_knees = {
  view: 'side', start: 'base', holdS: 20, sides: 'alternate', focus: ['thigh'],
  keys: {
    base: stand({ drop: -2, legs: pair(onToes(2, 55), onToes(-2, 55)), arms: pair(ang(0, 80), ang(0, 80)) }),
    knee: stand({ drop: -5, legs: pair(ang(96, 2, { foot: 55 }), onToes(-2, 55)), arms: pair(ang(-40, 46), ang(46, 128)) }),
  },
  seq: [{ to: 'knee', s: 0.3, label: 'Knie hoch', cue: 'Knie bis Hüfthöhe, schnelle Schritte' }, { to: 'base', s: 0.3, label: 'Wechsel' }],
};

M.butt_kicks = {
  view: 'side', start: 'base', holdS: 20, sides: 'alternate', focus: ['thigh'],
  keys: {
    base: stand({ drop: -2, legs: pair(onToes(2, 55), onToes(-2, 55)), arms: pair(ang(0, 80), ang(0, 80)) }),
    kick: stand({ drop: -3, legs: pair(ang(-10, -168, { foot: -110 }), onToes(-2, 55)), arms: pair(ang(30, 110), ang(-30, 50)) }),
  },
  seq: [{ to: 'kick', s: 0.31, label: 'Ferse zum Po', cue: 'Oberkörper aufrecht, schnelle Frequenz' }, { to: 'base', s: 0.31, label: 'Wechsel' }],
};

M.burpee = (() => {
  const H = [26, HY];
  const shP = [26, -47.5];
  const deg = lineDeg([0, TY], shP[1]);
  const A = [shP[0] - Math.cos(deg * RAD) * (B.thigh + B.shin + B.torso), TY];
  const pl = bodyLine(A, deg);
  return {
    view: 'side', start: 'stand', reps: 8, focus: ['thigh', 'torso'],
    keys: {
      stand: stand(),
      squat: { hip: [-12, -30], torso: 70, legs: pair(at(2, FY), at(-2, FY)), arms: pair(atP(H), at(H[0] - 3, HY)) },
      plank: { ...pl, legs: TOES(A[0]), arms: pair(atP(H), at(H[0] - 3, HY)) },
      air: { hip: [0, STAND_HIP - 10], torso: 0, legs: pair(at(2, -15, { foot: 40 }), at(-2, -15, { foot: 40 })), arms: pair(ang(172, 176), ang(170, 174)) },
    },
    seq: [
      { to: 'squat', s: 0.6, label: 'Hocke, Hände auf den Boden', breath: 'ein' },
      { to: 'plank', s: 0.45, label: 'Füße zurückspringen' },
      HOLD(0.3, 'Brett', { cue: 'Körper bleibt gerade' }),
      { to: 'squat', s: 0.45, label: 'Füße heranspringen' },
      { to: 'air', s: 0.45, label: 'Strecksprung', breath: 'aus' },
      { to: 'stand', s: 0.35, label: 'Landen', cue: 'Weich landen' },
      HOLD(0.3, 'Stand'),
    ],
  };
})();

M.mountain_climber = (() => {
  const hip = PU_TOP.hip;
  return {
    view: 'side', start: 'plank', holdS: 30, sides: 'alternate', focus: ['torso', 'thigh'],
    keys: {
      plank: plankTop(),
      drive: plankTop({ legs: pair(at(hip[0] - 10, -13, { bend: 'down', foot: 30 }), at(PL_A[0] + 2, TY, { foot: 20 })) }),
    },
    seq: [{ to: 'drive', s: 0.31, label: 'Knie zur Brust', cue: 'Hüfte bleibt tief und ruhig' }, { to: 'plank', s: 0.31, label: 'Wechsel' }],
  };
})();

M.skater_jump = {
  view: 'front', start: 'air', thumb: 'land', holdS: 30, sides: 'alternate', focus: ['thigh', 'hip'],
  keys: {
    air: { hip: [0, -78], torso: 0, legs: pair(at(-7, -16, { foot: -60 }), at(7, -16, { foot: 60 })), arms: pair(ang(-20, -14), ang(20, 14)) },
    land: { hip: [-30, -54], torso: -10, legs: pair(at(-34, FY, { bend: 'out' }), at(-50, -16, { bend: 'down' })), arms: pair(ang(-62, -72), ang(-22, -40)) },
  },
  seq: [
    { to: 'land', s: 0.32, label: 'Seitlich springen', cue: 'Auf einem Bein weich landen' },
    HOLD(0.2, 'Landen'),
    { to: 'air', s: 0.3, label: 'Abspringen' },
  ],
};

M.bear_crawl = {
  view: 'side', start: 'base', holdS: 30, sides: 'alternate', focus: ['torso', 'thigh'],
  keys: {
    base: bear(),
    step: bear({ arms: pair(at(BEAR_SH_X + 12, -9), at(BEAR_SH_X - 3, HY)), legs: pair(at(-30, -7, { bend: 'down', foot: 25 }), at(-22, -13, { bend: 'down', foot: 25 })) }),
  },
  seq: [{ to: 'step', s: 0.35, label: 'Hand und Gegenfuß vor', cue: 'Knie knapp über dem Boden' }, { to: 'base', s: 0.35, label: 'Absetzen' }],
};

export const MOTIONS = M;

/** Ablauf einer Übung (oder null, wenn keiner hinterlegt ist). */
export function motionFor(id) { return MOTIONS[id] || null; }

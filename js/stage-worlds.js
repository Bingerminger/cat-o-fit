/* =========================================================================
   stage-worlds.js — the places the trainer works out in (since 4.2). Each world is
   a small fragment shader that paints sky, ground and distance for every pixel of
   the stage (stage-gl.js casts one ray per pixel), plus the light that falls on
   the figure there. Nothing is loaded: no textures, no models – all arithmetic.

   A world gives `glsl` with `vec3 world(vec3 ro, vec3 rd)` (linear colour) and may
   use the helpers of PRELUDE: noise(), fbm(), ground() (mat and soft contact
   shadows on a floor colour, the ring of a finished repetition), uTime, uBeat
   (0…1, the pulse of the music), uSun.
   ========================================================================= */

export const PRELUDE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vRay;
uniform vec3 uEye;
uniform vec3 uSun;
uniform float uTime;
uniform float uBeat;
uniform vec2 uRes;
uniform vec4 uMat;      // centre x, centre z, half length (x), half width (z)
uniform vec3 uMatCol;
uniform vec4 uBlob[6];  // x, z, radius, strength: soft shadows where the body touches the floor
uniform float uPulse;   // 0…1: a ring that runs out over the floor when a repetition is done
uniform vec2 uPulseAt;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }

/* The mat the trainer stands on, and the soft shadows under the body, on a floor colour. */
vec3 ground(vec3 col, vec2 p) {
  vec2 q = abs(p - uMat.xy) - uMat.zw + 9.0;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 9.0;
  float edge = fwidth(d) + 0.35;
  float on = 1.0 - smoothstep(-edge, edge, d);
  // A little shadow around the mat lifts it off the floor.
  col *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 7.0, d)) * (1.0 - on);
  vec3 mat = uMatCol * (0.93 + 0.07 * noise(p * 1.7));
  mat *= 1.0 - 0.18 * smoothstep(-5.0, 0.0, d);
  mat += (0.05 + 0.1 * uBeat * uBeat) * smoothstep(0.6, 0.0, abs(d + 4.5));
  col = mix(col, mat, on);
  float ring = smoothstep(3.2, 0.0, abs(length(p - uPulseAt) - (24.0 + 96.0 * uPulse))) * (1.0 - uPulse) * step(0.001, uPulse);
  col += vec3(1.0, 0.86, 0.5) * ring * 0.6;
  float sh = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 b = uBlob[i];
    float k = 1.0 - smoothstep(0.0, b.z, length(p - b.xy));
    sh = max(sh, k * k * b.w);
  }
  return col * (1.0 - 0.5 * sh);
}
`;

export const FINISH = `
void main() {
  vec3 rd = normalize(vRay);
  vec3 col = world(uEye, rd);
  vec2 uv = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.55 * dot(uv, uv);
  col = col / (1.0 + 0.12 * col);
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`;

const dir = (azDeg, elDeg) => {
  const a = azDeg * Math.PI / 180; const e = elDeg * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};

export const WORLDS = {
  /* Morning on the beach: the sun low over the sea behind the trainer, long shadows towards the viewer. */
  beach: {
    sun: dir(-38, 21),
    key: [1.25, 0.9, 0.62], sky: [0.5, 0.56, 0.74], bounce: [0.62, 0.47, 0.34], fill: [0.34, 0.3, 0.3], rim: [1.5, 1.0, 0.62],
    shadow: [0.5, 0.47, 0.62], mat: [0.1, 0.5, 0.52], glow: [1.0, 0.82, 0.3],
    glsl: `
vec3 sky(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 c = mix(vec3(1.0, 0.62, 0.34), vec3(0.93, 0.42, 0.36), smoothstep(0.0, 0.16, h));
  c = mix(c, vec3(0.36, 0.42, 0.72), smoothstep(0.08, 0.42, h));
  c = mix(c, vec3(0.1, 0.2, 0.5), smoothstep(0.35, 0.95, h));
  float sd = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.6, 0.3) * pow(sd, 5.0) * 0.5;
  c += vec3(1.0, 0.85, 0.6) * pow(sd, 60.0) * 0.9;
  c += vec3(1.0, 0.97, 0.9) * smoothstep(0.9992, 0.9996, sd) * 6.0;
  vec2 q = d.xz / (d.y + 0.16) * 1.3 + vec2(uTime * 0.004, 0.0);
  float cl = smoothstep(0.46, 0.82, fbm(q * vec2(1.0, 2.2))) * smoothstep(0.015, 0.2, h);
  vec3 lit = mix(vec3(0.95, 0.5, 0.42), vec3(1.0, 0.86, 0.66), pow(sd, 3.0));
  c = mix(c, lit, cl * 0.8);
  // Headlands far out, in the haze.
  float az = atan(d.x, -d.z);
  float hill = (0.012 + 0.05 * fbm(vec2(az * 2.6 + 3.0, 1.0))) * smoothstep(0.25, 0.9, abs(az - 0.5));
  c = mix(c, vec3(0.42, 0.3, 0.42), (1.0 - smoothstep(hill - 0.004, hill + 0.004, d.y)) * 0.75);
  return c;
}

vec3 world(vec3 ro, vec3 rd) {
  if (rd.y > -0.0005) return sky(rd);
  float t = -ro.y / rd.y;
  vec3 p = ro + rd * t;
  float haze = 1.0 - exp(-t * 0.00042);
  // The shore: a wavy line behind the trainer; the water breathes in and out.
  float tide = 14.0 * sin(uTime * 0.45) + 6.0 * sin(uTime * 0.83 + 1.7);
  float shore = -330.0 + 26.0 * sin(p.x * 0.006 + 0.6) + 12.0 * sin(p.x * 0.021) + tide;
  float wet = smoothstep(shore + 95.0, shore + 8.0, p.z);
  vec3 col;
  if (p.z > shore) {
    float grain = noise(p.xz * 2.3);
    float dune = fbm(p.xz * 0.012);
    float ripple = sin(p.z * 0.33 + 3.0 * fbm(p.xz * 0.02)) * 0.5 + 0.5;
    col = mix(vec3(0.74, 0.55, 0.38), vec3(0.92, 0.74, 0.52), dune);
    col *= 0.9 + 0.1 * grain;
    col *= 1.0 - 0.07 * ripple * (1.0 - wet);
    // Low light rakes over the sand: warm where it faces the sun.
    col *= vec3(1.12, 0.98, 0.86);
    // Wet sand mirrors the sky.
    vec3 refl = sky(reflect(rd, vec3(0.0, 1.0, 0.0)));
    col = mix(col, col * 0.5 + refl * 0.5, wet * 0.75);
    float foam = smoothstep(7.0, 0.0, p.z - shore) * (0.6 + 0.4 * noise(p.xz * 0.35 + uTime * 0.3));
    col = mix(col, vec3(1.0, 0.94, 0.88), foam * 0.8);
    col = ground(col, p.xz);
  } else {
    float far = clamp((shore - p.z) / 2600.0, 0.0, 1.0);
    vec2 w = p.xz * 0.02;
    float n1 = noise(w * vec2(1.0, 3.2) + vec2(0.0, uTime * 0.5));
    float n2 = noise(w * vec2(2.3, 6.1) - vec2(uTime * 0.18, uTime * 0.7));
    vec3 n = normalize(vec3((n1 - 0.5) * 0.5, 1.0, (n2 - 0.5) * 0.9));
    vec3 r = reflect(rd, n);
    r.y = abs(r.y);
    vec3 water = mix(vec3(0.06, 0.36, 0.42), vec3(0.03, 0.12, 0.3), smoothstep(0.0, 0.25, far));
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
    col = mix(water, sky(r), 0.25 + 0.7 * fres);
    col += vec3(1.0, 0.8, 0.5) * pow(max(dot(r, uSun), 0.0), 90.0) * 2.4;
    // Waves roll in: bright lines that travel to the shore.
    float line = smoothstep(0.86, 1.0, sin((shore - p.z) * 0.05 - uTime * 0.9 + n1 * 2.5)) * (1.0 - smoothstep(0.0, 260.0, shore - p.z));
    col = mix(col, vec3(1.0, 0.95, 0.9), line * 0.5 + smoothstep(5.0, 0.0, shore - p.z) * 0.7);
  }
  return mix(col, sky(vec3(rd.x, 0.004, rd.z)), haze);
}
`,
  },

  /* A night arena: a dark, mirroring floor with a grid of light that beats with the music, a striped sun low
     behind far ridges, stars. Light in two colours from the sides. */
  neon: {
    sun: dir(-20, 16),
    key: [0.5, 0.3, 0.55], sky: [0.16, 0.14, 0.34], bounce: [0.2, 0.06, 0.24], fill: [0.62, 0.56, 0.7], rim: [2.2, 0.25, 1.5], rimB: [0.15, 1.5, 2.1],
    shadow: [0.42, 0.36, 0.6], mat: [0.03, 0.2, 0.26], glow: [1.0, 0.4, 0.9],
    glsl: `
vec3 sky(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 c = mix(vec3(0.42, 0.06, 0.4), vec3(0.015, 0.012, 0.07), pow(h, 0.42));
  float sd = dot(d, uSun);
  // The sun: a disc in two colours, cut into stripes towards the horizon.
  float disc = smoothstep(0.972, 0.974, sd);
  vec3 sun = mix(vec3(1.0, 0.16, 0.5), vec3(1.0, 0.82, 0.3), smoothstep(0.02, 0.36, d.y));
  float cut = mix(step(0.42, fract(d.y * 34.0 - uTime * 0.03)), 1.0, smoothstep(0.16, 0.3, d.y));
  c = mix(c, sun, disc * cut);
  c += sun * pow(max(sd, 0.0), 22.0) * 0.3;
  vec2 q = d.xz / (d.y + 0.25) * 46.0;
  c += vec3(0.8, 0.85, 1.0) * step(0.9965, hash(floor(q))) * smoothstep(0.12, 0.5, h) * (0.6 + 0.4 * sin(uTime * 2.0 + q.x));
  float az = atan(d.x, -d.z);
  float ridge = 0.02 + 0.07 * noise(vec2(az * 5.0, 2.0)) * smoothstep(0.1, 0.7, abs(az + 0.35));
  c = mix(c, vec3(0.03, 0.012, 0.08), 1.0 - smoothstep(ridge - 0.003, ridge + 0.003, d.y));
  return c;
}

vec3 world(vec3 ro, vec3 rd) {
  if (rd.y > -0.0005) return sky(rd);
  float t = -ro.y / rd.y;
  vec3 p = ro + rd * t;
  float far = 1.0 - exp(-t * 0.0007);
  vec3 col = vec3(0.022, 0.016, 0.06);
  // The floor mirrors the sky a little.
  float fres = pow(1.0 - max(-rd.y, 0.0), 4.0);
  col += sky(reflect(rd, vec3(0.0, 1.0, 0.0))) * (0.1 + 0.5 * fres);
  // The grid: lines of light, brighter on the beat.
  vec2 cell = p.xz / 58.0;
  vec2 g = abs(fract(cell) - 0.5);
  vec2 w = fwidth(cell) * 1.5 + 0.012;
  float line = max(smoothstep(0.5 - w.x, 0.5, g.x), smoothstep(0.5 - w.y, 0.5, g.y));
  col += vec3(1.0, 0.12, 0.78) * line * (0.75 + 0.7 * uBeat * uBeat) * (1.0 - far);
  col = ground(col, p.xz);
  return mix(col, vec3(0.42, 0.06, 0.4), far * 0.9);
}
`,
  },

  /* A bright studio as from a comic: a warm wall of colour with a big disc and halftone dots, a mint floor. */
  pop: {
    sun: dir(-28, 34),
    key: [1.15, 1.05, 0.95], sky: [0.92, 0.88, 0.96], bounce: [0.7, 0.62, 0.6], fill: [0.3, 0.28, 0.3], rim: [1.2, 1.1, 1.0],
    shadow: [0.56, 0.5, 0.72], mat: [0.98, 0.42, 0.4], glow: [1.0, 0.85, 0.3],
    glsl: `
vec3 wall(vec3 d) {
  vec3 c = mix(vec3(1.0, 0.8, 0.56), vec3(0.98, 0.48, 0.6), smoothstep(0.0, 0.55, d.y));
  c = mix(c, vec3(0.6, 0.4, 0.86), smoothstep(0.45, 1.0, d.y));
  float sd = dot(d, uSun);
  c = mix(c, vec3(1.0, 0.95, 0.74), smoothstep(0.9, 0.902, sd));
  c = mix(c, vec3(1.0, 0.62, 0.5), smoothstep(0.9605, 0.9625, sd));
  // Halftone dots, largest at the horizon.
  vec2 cellp = fract(gl_FragCoord.xy / (uRes.y / 46.0)) - 0.5;
  float size = 0.36 * (1.0 - smoothstep(0.0, 0.5, d.y));
  c = mix(c, c * vec3(0.86, 0.8, 0.9), 1.0 - smoothstep(size - 0.04, size, length(cellp)));
  return c;
}

vec3 world(vec3 ro, vec3 rd) {
  if (rd.y > -0.0005) return wall(rd);
  float t = -ro.y / rd.y;
  vec3 p = ro + rd * t;
  float far = 1.0 - exp(-t * 0.0009);
  vec3 col = mix(vec3(0.34, 0.8, 0.74), vec3(0.24, 0.62, 0.66), smoothstep(0.0, 700.0, length(p.xz)));
  // Rings round the mat that swell on the beat.
  float ring = sin(length(p.xz) * 0.035 - uTime * 0.8) * 0.5 + 0.5;
  col = mix(col, col * 1.08, smoothstep(0.6, 0.62, ring) * (0.5 + 0.5 * uBeat));
  col = ground(col, p.xz);
  return mix(col, wall(vec3(rd.x, 0.002, rd.z)), far);
}
`,
  },
};

export const DEFAULT_WORLD = 'beach';

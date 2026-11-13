/* =========================================================================
   stage-gl.js — the 3D stage: draws a world, the figures and their shadows with
   WebGL (since 4.2). No library, no textures, no files to load – the app stays
   self-contained and works offline.

   One frame: the world as one full-screen pass (a ray per pixel, stage-worlds.js),
   the shadows of the meshes flattened onto the floor (each pixel darkened once),
   then the meshes themselves, lit by the light of the world: sun, sky from above,
   bounce from the floor, a fill from the camera and a rim against the sun.

   `createStage(canvas)` returns null where WebGL is missing – the caller keeps the
   drawn (SVG) stage then. A lost context (iOS takes it away in the background) is
   rebuilt on return.
   ========================================================================= */

import { STRIDE } from './stage-mesh.js';
import { PRELUDE, FINISH, WORLDS, DEFAULT_WORLD } from './stage-worlds.js';

const QUAD_VS = `
attribute vec2 aPos;
uniform vec3 uCamR; uniform vec3 uCamU; uniform vec3 uCamF; uniform vec2 uShift;
varying vec3 vRay;
void main() { vRay = uCamF + (aPos.x - uShift.x) * uCamR + (aPos.y - uShift.y) * uCamU; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const BODY_VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol; attribute float aGlow;
uniform mat4 uVP;
varying vec3 vPos; varying vec3 vNor; varying vec3 vCol; varying float vGlow;
void main() { vPos = aPos; vNor = aNor; vCol = aCol; vGlow = aGlow; gl_Position = uVP * vec4(aPos, 1.0); }
`;

const BODY_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vPos; varying vec3 vNor; varying vec3 vCol; varying float vGlow;
uniform vec3 uEye; uniform vec3 uSun;
uniform vec3 uKey; uniform vec3 uSky; uniform vec3 uBounce; uniform vec3 uFill; uniform vec3 uRim;
uniform vec3 uGlowCol; uniform float uGlow; uniform float uFlat;
void main() {
  vec3 n = normalize(vNor);
  vec3 v = normalize(uEye - vPos);
  float nl = dot(n, uSun);
  float key = smoothstep(-0.3, 0.8, nl);
  vec3 amb = mix(uBounce, uSky, n.y * 0.5 + 0.5);
  float fill = max(dot(n, normalize(v + vec3(0.0, 0.5, 0.0))), 0.0);
  vec3 lit = vCol * (amb + uKey * key + uFill * fill);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  lit += uRim * fr * (0.2 + 0.8 * smoothstep(-0.4, 0.6, nl)) * (0.25 + 0.75 * vCol);
  lit += uKey * pow(max(dot(n, normalize(uSun + v)), 0.0), 36.0) * 0.14;
  // Close to the floor less sky reaches the body.
  lit *= mix(0.74, 1.0, smoothstep(0.0, 16.0, vPos.y));
  // The muscles at work: a warm light from inside, strongest at the edge.
  float g = vGlow * uGlow;
  lit += uGlowCol * g * (0.05 + fr * 0.75);
  lit = mix(lit, vCol, uFlat);
  lit = lit / (1.0 + 0.12 * lit);
  gl_FragColor = vec4(pow(max(lit, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`;

const SHADOW_VS = `
attribute vec3 aPos;
uniform mat4 uVP; uniform vec3 uSun;
varying float vH;
void main() {
  vec3 p = aPos - uSun * (max(aPos.y, 0.0) / uSun.y);
  p.y = 0.06; vH = aPos.y;
  gl_Position = uVP * vec4(p, 1.0);
}
`;
const SHADOW_FS = `
precision mediump float;
uniform vec3 uShadow; varying float vH;
void main() { gl_FragColor = vec4(mix(uShadow, vec3(1.0), 0.45 * smoothstep(30.0, 150.0, vH)), 1.0); }
`;

/* ------------------------------ Matrices ------------------------------ */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** View-projection (column-major) and the camera axes for a camera { eye, target, fov (degrees, vertical), shift? [x, y] in −1…1 }. */
export function cameraOf(cam, aspect, near = 8, far = 6000) {
  const f = norm(sub(cam.target, cam.eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const t = Math.tan((cam.fov * Math.PI / 180) / 2);
  const sy = 1 / t; const sx = sy / aspect;
  const a = (far + near) / (near - far); const b = (2 * far * near) / (near - far);
  const e = cam.eye;
  // P · V, written out (V rows: r, u, −f).
  const vp = new Float32Array([
    sx * r[0], sy * u[0], -a * f[0], f[0],
    sx * r[1], sy * u[1], -a * f[1], f[1],
    sx * r[2], sy * u[2], -a * f[2], f[2],
    -sx * dot(r, e), -sy * dot(u, e), a * dot(f, e) + b, -dot(f, e),
  ]);
  // A shifted picture (the subject off the middle of the canvas): x and y move by a share of w.
  const sh = cam.shift || [0, 0];
  for (let c = 0; c < 4; c++) { vp[c * 4] += sh[0] * vp[c * 4 + 3]; vp[c * 4 + 1] += sh[1] * vp[c * 4 + 3]; }
  return { vp, f, shift: sh, r: [r[0] * t * aspect, r[1] * t * aspect, r[2] * t * aspect], u: [u[0] * t, u[1] * t, u[2] * t] };
}

/** Where a point lands on the screen: [x, y] in 0…1 from the top left, and whether it is in front of the camera. */
export function projectPoint(vp, p) {
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  const x = (vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12]) / w;
  const y = (vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13]) / w;
  return { x: x * 0.5 + 0.5, y: 0.5 - y * 0.5, front: w > 0 };
}

/* ------------------------------ Stage ------------------------------ */

let lastError = '';
/** Why the last `createStage()` gave no stage (empty when it did). */
export const stageError = () => lastError;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`shader: ${log}`); }
  return s;
}
function program(gl, vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

/**
 * The stage on a canvas. `draw(frame)` paints one picture:
 *   frame = { cam: { eye, target, fov, shift? }, world: id, time, beat 0…1, pulse 0…1 + pulseAt [x, z] (a ring on the
 *             floor), meshes: [mesh…] (stage-mesh.js; `flat` = unlit, `noShadow`), glow 0…1,
 *             mat: [cx, cz, halfX, halfZ], blobs: [[x, z, radius, strength]…] }
 */
export function createStage(canvas) {
  const opts = { alpha: false, antialias: true, stencil: true, depth: true, powerPreference: 'high-performance' };
  let gl = null;
  lastError = '';
  try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch { gl = null; }
  if (!gl) { lastError = 'WebGL'; return null; }
  let res = null; let lost = false;
  const blobs = new Float32Array(24);

  function build() {
    gl.getExtension('OES_standard_derivatives');
    const r = { worlds: {} };
    r.body = program(gl, BODY_VS, BODY_FS, ['aPos', 'aNor', 'aCol', 'aGlow']);
    r.shadow = program(gl, SHADOW_VS, SHADOW_FS, ['aPos']);
    r.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, r.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    r.vbo = gl.createBuffer(); r.ibo = gl.createBuffer();
    return r;
  }
  function worldProgram(id) {
    const key = WORLDS[id] ? id : DEFAULT_WORLD;
    if (!res.worlds[key]) {
      res.worlds[key] = program(gl, QUAD_VS, `#extension GL_OES_standard_derivatives : enable\n${PRELUDE}${WORLDS[key].glsl}${FINISH}`, ['aPos']);
    }
    return { prog: res.worlds[key], def: WORLDS[key] };
  }
  try { res = build(); worldProgram(DEFAULT_WORLD); } catch (e) { lastError = String(e.message || e); console.warn('[stage]', lastError); return null; }

  const onLost = (e) => { e.preventDefault(); lost = true; };
  const onBack = () => { try { res = build(); lost = false; } catch { lost = true; } };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onBack);

  function resize(cssW, cssH, dpr = 1) {
    const w = Math.max(2, Math.round(cssW * dpr)); const h = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function draw(frame) {
    if (lost || gl.isContextLost()) return null;
    const W = canvas.width; const H = canvas.height;
    const cam = cameraOf(frame.cam, W / H);
    const { prog, def } = worldProgram(frame.world);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    gl.clearStencil(0); gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // 1 · World.
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
    gl.uniform3fv(prog.u.uCamR, cam.r); gl.uniform3fv(prog.u.uCamU, cam.u); gl.uniform3fv(prog.u.uCamF, cam.f); gl.uniform2fv(prog.u.uShift, cam.shift);
    gl.uniform1f(prog.u.uPulse, frame.pulse || 0); gl.uniform2fv(prog.u.uPulseAt, frame.pulseAt || [0, 0]);
    gl.uniform3fv(prog.u.uEye, frame.cam.eye); gl.uniform3fv(prog.u.uSun, def.sun);
    gl.uniform1f(prog.u.uTime, frame.time || 0); gl.uniform1f(prog.u.uBeat, frame.beat || 0);
    gl.uniform2f(prog.u.uRes, W, H);
    gl.uniform4fv(prog.u.uMat, frame.mat || [0, 0, 0, 0]); gl.uniform3fv(prog.u.uMatCol, frame.matCol || def.mat);
    blobs.fill(0);
    (frame.blobs || []).slice(0, 6).forEach((b, i) => blobs.set(b, i * 4));
    gl.uniform4fv(prog.u.uBlob, blobs);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const stride = STRIDE * 4;
    const meshes = frame.meshes || [];
    const bind = (m, full) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, res.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, m.v.subarray(0, m.nv * STRIDE), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.i.subarray(0, m.ni), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      if (full) {
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
      }
    };

    // 2 · Shadows on the floor: multiply, each pixel once.
    gl.useProgram(res.shadow.p);
    gl.uniformMatrix4fv(res.shadow.u.uVP, false, cam.vp); gl.uniform3fv(res.shadow.u.uSun, def.sun);
    gl.uniform3fv(res.shadow.u.uShadow, def.shadow);
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    for (const m of meshes) { if (!m.ni || m.noShadow) continue; bind(m, false); gl.drawElements(gl.TRIANGLES, m.ni, gl.UNSIGNED_SHORT, 0); }
    gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);

    // 3 · Figures.
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(res.body.p);
    const u = res.body.u;
    gl.uniformMatrix4fv(u.uVP, false, cam.vp);
    gl.uniform3fv(u.uEye, frame.cam.eye); gl.uniform3fv(u.uSun, def.sun);
    gl.uniform3fv(u.uKey, def.key); gl.uniform3fv(u.uSky, def.sky); gl.uniform3fv(u.uBounce, def.bounce);
    gl.uniform3fv(u.uFill, def.fill); gl.uniform3fv(u.uRim, def.rim); gl.uniform3fv(u.uGlowCol, def.glow);
    gl.uniform1f(u.uGlow, frame.glow == null ? 1 : frame.glow);
    for (const m of meshes) {
      if (!m.ni) continue;
      gl.uniform1f(u.uFlat, m.flat ? 1 : 0);
      bind(m, true); gl.drawElements(gl.TRIANGLES, m.ni, gl.UNSIGNED_SHORT, 0);
    }
    return cam;
  }

  function destroy() {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onBack);
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  return { draw, resize, destroy, get lost() { return lost; } };
}

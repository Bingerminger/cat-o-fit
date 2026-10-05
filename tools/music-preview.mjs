/* Listening samples of the training music (js/music.js): computes the loops for rest,
   build-up and exercise per style (four bars each, as in the session) and writes them one after another
   as WAV – with level (peak/RMS) and computation time per loop. For listening, to
   detect clipping and to estimate how fast a device computes the loops.

   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tools/music-preview.mjs [--out <dir>] [--style power,flow]
   Needs PHP (like render-screenshots.mjs) for a short-lived local server. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './render-screenshots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const out = opt('out', join(ROOT, '.playwright-mcp', 'music'));
const styles = opt('style', 'power,groove,flow,hiit').split(',');
mkdirSync(out, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const srv = await startServer();
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
const page = await browser.newPage();
await page.goto(`${srv.base}/js/version.js`);

for (const style of styles) {
  const res = await page.evaluate(async (style) => {
    const { renderLoop, STYLES } = await import('/js/music.js');
    const rate = 44100;
    const bpm = Math.round((STYLES[style].bpm[0] + STYLES[style].bpm[1]) / 2);
    const parts = []; const ms = [];
    for (const intensity of [0, 1, 2]) {
      const t0 = performance.now();
      const buf = await renderLoop({ style, bpm, intensity, sampleRate: rate });
      ms.push(Math.round(performance.now() - t0));
      parts.push(buf.getChannelData(0));
    }
    const level = (d) => { let peak = 0; let sum = 0; for (const v of d) { const a = Math.abs(v); peak = Math.max(peak, a); sum += v * v; } return { peak: Math.round(peak * 1000) / 1000, rms: Math.round(Math.sqrt(sum / d.length) * 1000) / 1000 }; };
    const L = new Float32Array(parts.reduce((a, d) => a + d.length * 2, 0));
    let o = 0; for (const d of parts) { L.set(d, o); o += d.length; L.set(d, o); o += d.length; }   // each loop twice (seam audible)
    const pcm = new Int16Array(L.length);
    for (let i = 0; i < L.length; i++) pcm[i] = Math.max(-1, Math.min(1, L[i])) * 32767;
    let bin = ''; const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { bpm, ms, rest: level(parts[0]), build: level(parts[1]), work: level(parts[2]), rate, data: btoa(bin) };
  }, style);
  const pcm = Buffer.from(res.data, 'base64');
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(res.rate, 24); head.writeUInt32LE(res.rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  const file = join(out, `musik-${style}.wav`);
  writeFileSync(file, Buffer.concat([head, pcm]));
  console.log(`${style.padEnd(7)} ${res.bpm} BPM · compute time ${res.ms.join('/')} ms · rest ${JSON.stringify(res.rest)} · build-up ${JSON.stringify(res.build)} · exercise ${JSON.stringify(res.work)}`);
}
await browser.close();
srv.stop();

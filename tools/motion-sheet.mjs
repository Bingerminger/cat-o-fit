/* Check sheet for the exercise animations: per exercise the still image (start pale, target bold)
   and individual frames at the start of each section and in the middle of each transition.

   node tools/motion-sheet.mjs [--only id,id] [--out <dir>] [--per 8] [--size 150] [--dark]
   With PLAYWRIGHT_MODULE=<…/playwright/index.mjs>, PNG sheets are produced in addition
   (one image per `--per` exercises) – for proofreading every pose before it goes into the app. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MOTIONS } from '../js/exercise-motions.js';
import { frameSVG, motionSVG, thumbKeys } from '../js/motion-figure.js';
import { cycleOf, introOf } from '../js/motion-rig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const only = opt('only', '') ? opt('only', '').split(',') : null;
const out = opt('out', join(ROOT, '.playwright-mcp', 'motion-sheet'));
const per = Number(opt('per', 8));
const dark = args.includes('--dark');
const size = Number(opt('size', 150));
mkdirSync(out, { recursive: true });

const ids = Object.keys(MOTIONS).filter((id) => !only || only.includes(id));

/** Frames at the start of each section and in the middle of each transition – entry, pass-through, and for "per side" exercises also side 2. */
function frames(m) {
  const out = [];
  const sides = m.sides === 'each' ? ['a', 'b'] : ['a'];
  for (const side of sides) {
    for (const [kind, phases] of [['Einstieg', introOf(m, side)], ['', cycleOf(m, side)]]) {
      let t = 0;
      for (const ph of phases) {
        const tag = `${kind ? `${kind} ` : ''}${side === 'b' ? '② ' : ''}`;
        out.push({ t: t + 0.0001, list: phases, side, label: tag + (ph.hold ? `${ph.label} (${ph.dur}s)` : `${ph.from}→${ph.to}`) });
        if (!ph.hold && ph.dur > 0) out.push({ t: t + ph.dur / 2, list: phases, side, label: `${tag}½` });
        t += ph.dur;
      }
    }
  }
  return out;
}

const css = `
:root { --text: ${dark ? '#eef2f6' : '#161b21'}; --text-2: ${dark ? '#9aa7b4' : '#58646f'}; --text-3: ${dark ? '#8a96a3' : '#626c78'}; --accent: #7c5cff; }
body { font: 13px system-ui, sans-serif; margin: 12px; background: ${dark ? '#0c0f13' : '#fff'}; color: var(--text); }
section { margin: 0 0 14px; } h3 { margin: 0 0 4px; font-size: 14px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; }
.cell { width: ${size}px; border: 1px solid #8884; border-radius: 6px; padding: 3px; }
.cell .art { width: ${size - 6}px; height: ${Math.round((size - 6) / 1.5)}px; } .cell small { display: block; text-align: center; color: var(--text-2); }
.thumb { border-color: #7c5cff; }
${readFileSync(join(ROOT, 'css', 'motion.css'), 'utf8')}`;

function section(id) {
  const m = MOTIONS[id];
  const cells = [`<div class="cell thumb"><div class="art">${motionSVG(m, thumbKeys(m))}</div><small>Standbild</small></div>`];
  for (const f of frames(m)) cells.push(`<div class="cell"><div class="art">${frameSVG(m, f.t, { list: f.list, side: f.side })}</div><small>${f.label}</small></div>`);
  return `<section><h3>${id} · ${m.view}${m.sides ? ` · ${m.sides}` : ''}</h3><div class="row">${cells.join('')}</div></section>`;
}

const pages = [];
for (let i = 0; i < ids.length; i += per) pages.push(ids.slice(i, i + per));
const files = pages.map((chunk, i) => {
  const file = join(out, `motion-sheet-${String(i + 1).padStart(2, '0')}.html`);
  writeFileSync(file, `<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"><meta charset="utf-8"><style>${css}</style>${chunk.map(section).join('')}`);
  return file;
});
console.log(`${ids.length} Übungen auf ${files.length} Bögen in ${out}`);

if (process.env.PLAYWRIGHT_MODULE) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  for (const f of files) {
    await page.goto(pathToFileURL(f).href);
    await page.screenshot({ path: f.replace(/\.html$/, '.png'), fullPage: true });
    console.log('✓', f.replace(/\.html$/, '.png'));
  }
  await browser.close();
}

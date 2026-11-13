/* =========================================================================
   plan-share.js — a plan as a document to pass on (since 4.2): one self-contained HTML file (opens in
   any browser, without the app, and prints to PDF there) and the same view printed right from the app.
   Week by week, each session with its day, title, target and description – in the person's language
   and units. Nothing leaves the device unless the person shares the file.
   ========================================================================= */

import {
  el, icon, openSheet, closeSheet, saveFile, savedFileMessage, alertDialog, toast,
  fmtDate, fmtKmAuto, fmtPace, localizeUnits, typeMeta, todayStr,
} from './ui.js';
import { distanceUnit } from './units.js';
import { t, locale } from './i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Target of a session as text: distance, pace, duration (without a distance), HR zone. */
export function unitTargetText(u) {
  const parts = [];
  if (u.targetDistanceKm) parts.push(fmtKmAuto(u.targetDistanceKm));
  if (u.targetPaceSecPerKm) parts.push(`${fmtPace(u.targetPaceSecPerKm)}/${distanceUnit()}`);
  if (u.targetDurationMin && !u.targetDistanceKm) parts.push(`${u.targetDurationMin} min`);
  if (u.targetHrZone) parts.push(t('planShare.hrZone', { zone: u.targetHrZone }));
  return parts.join(' · ');
}

/** The plan's sessions by week: [{ week, phase, units }] – rest days and deleted sessions left out. */
export function planWeeks(plan) {
  const units = (plan.units || []).filter((u) => u && !u.deleted && u.type !== 'rest' && u.date)
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  const phaseOf = (w) => (plan.phases || []).find((p) => w >= p.startWeek && w <= p.endWeek) || null;
  const byWeek = new Map();
  for (const u of units) {
    const w = Number(u.week) || 1;
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(u);
  }
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([week, list]) => ({ week, phase: phaseOf(week), units: list }));
}

/** The body of the document (HTML, everything escaped) – shared by the file and the print view. */
export function planBodyHtml(plan, name) {
  const weeks = planWeeks(plan);
  const range = plan.startDate && plan.endDate ? `${fmtDate(plan.startDate)} – ${fmtDate(plan.endDate)}` : '';
  const rows = weeks.map(({ week, phase, units }) => `
    <h2>${esc(t('planShare.week', { n: week }))}${phase && phase.name ? ` · ${esc(phase.name)}` : ''}</h2>
    <table>${units.map((u) => `
      <tr>
        <td class="day">${esc(fmtDate(u.date))}</td>
        <td><strong>${esc(localizeUnits(u.title || typeMeta(u.type).label))}</strong>${u.description ? `<br><span class="desc">${esc(localizeUnits(u.description))}</span>` : ''}</td>
        <td class="target">${esc(unitTargetText(u))}</td>
      </tr>`).join('')}
    </table>`).join('');
  return `<h1>${esc(name)}</h1>
    <p class="meta">${esc(range)}${range ? ' · ' : ''}${esc(t('planShare.created', { date: fmtDate(todayStr()) }))}</p>${rows}
    <p class="foot">${esc(t('planShare.footer'))}</p>`;
}

const STYLE = `body{font:14px/1.45 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;color:#1d2433;margin:24px;max-width:860px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;padding-bottom:3px;border-bottom:2px solid #18b48a}
.meta,.foot{color:#5b6475;font-size:12px}table{width:100%;border-collapse:collapse}
td{vertical-align:top;padding:6px 8px;border-bottom:1px solid #e3e7ee}td.day{white-space:nowrap;width:1%;color:#5b6475}
td.target{white-space:nowrap;width:1%;text-align:right}.desc{color:#4a5363;font-size:12.5px}
@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}`;

/** The whole plan as one self-contained HTML document. */
export function planDocument(plan, name) {
  return `<!doctype html>
<html lang="${esc(locale())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title><style>${STYLE}</style></head>
<body>${planBodyHtml(plan, name)}</body></html>
`;
}

/** File name from the plan name ("Halbmarathon Dresden" → "Halbmarathon-Dresden.html"). */
export function planFileName(name) {
  const base = String(name || 'plan').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'plan'}.html`;
}

/** Print the plan from the app (the print dialog also saves it as a PDF). */
function printPlan(plan, name) {
  if (typeof window === 'undefined' || typeof window.print !== 'function') return;
  const box = el('div', { id: 'report-print', class: 'plan-print', html: planBodyHtml(plan, name) });
  document.body.appendChild(box);
  const done = () => { box.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 60000);   // browsers without afterprint
}

/** Sheet "Share plan": as a file (share sheet or download) or print / save as PDF. */
export function openPlanShare(plan, name) {
  openSheet({
    title: t('planShare.title'),
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.86rem' }, text: t('planShare.intro') }),
      el('button', { class: 'btn btn--primary btn--block mt-3', type: 'button', onclick: async () => {
        const fileName = planFileName(name);
        const res = await saveFile(fileName, new Blob([planDocument(plan, name)], { type: 'text/html' }));
        if (res === 'cancelled') { toast(t('planShare.notShared')); return; }
        closeSheet();
        alertDialog({ title: t('planShare.ready'), tone: 'good', message: savedFileMessage(res, fileName) });
      } }, [icon('download'), t('planShare.asFile')]),
      el('button', { class: 'btn btn--soft btn--block mt-2', type: 'button', onclick: () => { closeSheet(); printPlan(plan, name); } }, [icon('download'), t('planShare.print')]),
    ]),
  });
}

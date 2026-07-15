/* =========================================================================
   family.js — Team-/Familien-Dashboard (Menüpunkt „Team/Familie").
   NUR im angemeldeten Zustand sichtbar (Login/Profilauswahl liegt in login.js,
   Verwaltung in den Einstellungen). Reine Übersicht: Mitglieder-Kacheln plus
   Team-Badges (Monats-km & Meilenstein, Wochen-Aktivität, anstehende Wettkämpfe,
   Team-Erfolge). Zyklusdaten kommen hier nie vor.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, diffDays, todayStr, fmtDate,
  weekStartMonday, addDays, fmtKm, sectionHead,
} from './ui.js';
import { setHeader } from './router.js';
import { momentum, computeStats } from './badges.js';
import { teamStats, filterTeamMembers, teamlessMembers } from './teamstats.js';

const METRIC_DEFS = { momentum: 'Momentum', weekKm: 'Woche', streak: 'Serie' };
const DEFAULT_METRICS = ['momentum', 'weekKm'];
const hex = (c) => (typeof c === 'string' && c[0] === '#' ? c : 'var(--accent)');
let teamFilter = null; // null = alle Mitglieder, teamId = ein Team, '__none__' = ohne Team

/** Gefilterte Mitgliederliste nach aktueller Team-Auswahl. */
function filterMembersByTeam(members, teamList, filter) {
  if (!filter) return members;
  if (filter === '__none__') return teamlessMembers(members, teamList);
  const t = teamList.find((x) => x.id === filter);
  return t ? filterTeamMembers(members, t) : members;
}

/** Auswahlleiste: Alle · je Team · Ohne Team. Wechsel rendert die Ansicht neu. */
function teamFilterBar(view, teamList, allMembers) {
  const bar = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', margin: '2px 0 10px' } });
  const chip = (id, label) => el('button', {
    class: `chip ${teamFilter === id ? 'chip--accent' : ''}`, style: { cursor: 'pointer' }, text: label,
    onclick: () => { teamFilter = id; view.innerHTML = ''; render(view); },
  });
  bar.appendChild(chip(null, 'Alle'));
  teamList.forEach((t) => bar.appendChild(chip(t.id, `${t.emoji || '👥'} ${t.name}`)));
  if (teamlessMembers(allMembers, teamList).length) bar.appendChild(chip('__none__', 'Ohne Team'));
  return bar;
}

/** Nächstes Hauptziel (Event) aus der Event-Liste eines Mitglieds. */
function nextGoal(events) {
  const today = todayStr();
  return (events || [])
    .filter((e) => e && !e.deleted && e.kind !== 'program' && e.status !== 'abgeschlossen' && e.date >= today)
    .sort((a, b) => (a.priority || 'Z').localeCompare(b.priority || 'Z') || a.date.localeCompare(b.date))[0] || null;
}

export function render(view) {
  const allMembers = store.members();
  const teamList = store.teams();
  if (teamFilter && teamFilter !== '__none__' && !teamList.some((t) => t.id === teamFilter)) teamFilter = null;
  if (teamFilter === '__none__' && !teamlessMembers(allMembers, teamList).length) teamFilter = null;
  const members = filterMembersByTeam(allMembers, teamList, teamFilter);
  const filterName = teamFilter === '__none__' ? 'Ohne Team' : (teamList.find((t) => t.id === teamFilter)?.name || null);
  setHeader({ title: 'Team/Familie', subtitle: filterName ? `Team „${filterName}"` : (allMembers.length > 1 ? 'Eure gemeinsame Übersicht' : 'Deine Übersicht') });

  view.appendChild(el('div', { class: 'team-intro' }, [
    el('span', { html: iconSvg('activity'), style: { width: '22px', color: 'var(--accent)' } }),
    el('span', { class: 'team-intro__txt', text: fmtDate(todayStr()) }),
  ]));

  if (teamList.length) view.appendChild(teamFilterBar(view, teamList, allMembers));

  const summarySlot = el('div'); view.appendChild(summarySlot);
  const badgesSlot = el('div', { class: 'col gap-3' }); view.appendChild(badgesSlot);

  view.appendChild(sectionHead('Mitglieder'));
  const metrics = store.familySettings().dashboardMetrics || DEFAULT_METRICS;
  const grid = el('div', { class: 'member-grid' });
  const refs = {};
  members.forEach((m) => {
    const goalSlot = el('div', { class: 'member-card__goal muted', text: ' ' });
    const metricSlot = el('div', { class: 'member-card__metrics' });
    grid.appendChild(el('div', { class: 'member-card member-card--static' }, [
      el('span', { class: 'member-card__avatar', style: { background: hex(m.color) + '22', color: hex(m.color) }, text: m.emoji || '🏃' }),
      el('div', { class: 'member-card__name', text: m.name || 'Mitglied' }),
      el('div', { class: 'member-card__meta' }, [
        el('span', { class: `chip ${m.role === 'admin' ? 'chip--accent' : ''}`, text: m.role === 'admin' ? 'Admin' : 'Mitglied' }),
      ]),
      goalSlot, metricSlot,
    ]));
    refs[m.id] = { goalSlot, metricSlot };
  });
  view.appendChild(grid);

  // Daten aller Mitglieder laden -> Kacheln, Wochenzusammenfassung und Team-Badges füllen.
  loadAll(members).then(({ byId, buckets }) => {
    let totalKm = 0, totalSessions = 0;
    members.forEach((m) => {
      const s = byId[m.id]; if (!s || !refs[m.id]) return;
      totalKm += s.weekKm; totalSessions += s.weekSessions;
      refs[m.id].goalSlot.textContent = s.goalText;
      fillMetrics(refs[m.id].metricSlot, s, metrics);
    });
    summarySlot.appendChild(familySummary(totalKm, totalSessions, members.length));

    const ts = teamStats(buckets, todayStr());
    badgesSlot.appendChild(monthKmCard(ts.monthKm));
    badgesSlot.appendChild(weekActivityCard(ts.weekActivity));
    if (ts.upcomingRaces.length) badgesSlot.appendChild(upcomingRacesCard(ts.upcomingRaces));
    badgesSlot.appendChild(achievementsCard(ts.achievements));
  }).catch(() => { /* offline: Kacheln/Badges bleiben leer */ });
}

/** Daten aller Mitglieder einsammeln (aktiver Nutzer lokal, Rest read-only). */
async function loadAll(members) {
  const today = todayStr();
  const weekStart = weekStartMonday(today), weekEnd = addDays(weekStart, 6);
  const byId = {}; const buckets = [];
  await Promise.all(members.map(async (m) => {
    const isSelf = m.id === store.activeUserId();
    const grab = async (area) => (isSelf ? store.get(area) : ((await store.peekUserArea(m.id, area)) || []));
    const [sessions, plans, events] = await Promise.all([grab('sessions'), grab('plans'), grab('events')]);
    const profile = isSelf ? store.profile() : ((await store.peekUserArea(m.id, 'profile')) || {});
    const prefs = (profile && profile.settings) || {};
    const shareGoal = prefs.shareGoal !== false;
    const shareMetrics = prefs.shareMetrics !== false;

    const data = { sessions, plans, health: [], events, profile: {} };
    const mom = momentum(data, today);
    const stats = computeStats(data, today);
    let weekKm = 0, weekSessions = 0;
    (sessions || []).forEach((s) => {
      if (s && !s.deleted && s.date >= weekStart && s.date <= weekEnd) { weekKm += s.distanceKm || 0; weekSessions++; }
    });
    const g = nextGoal(events);
    byId[m.id] = {
      momentum: mom.score, flames: mom.flames, streak: stats.streak, weekKm, weekSessions, shareMetrics,
      goalText: !shareGoal ? '🔒 privat' : (g ? `🎯 ${g.name} · in ${diffDays(today, g.date)} ${diffDays(today, g.date) === 1 ? 'Tag' : 'Tagen'}` : 'kein Wettkampf geplant'),
    };
    buckets.push({ id: m.id, name: m.name, color: m.color, emoji: m.emoji, role: m.role, shareMetrics, shareGoal, sessions, plans, events });
  }));
  return { byId, buckets };
}

function fillMetrics(slot, s, metrics) {
  slot.innerHTML = '';
  if (!s.shareMetrics) return;
  (metrics || []).forEach((key) => {
    let val;
    if (key === 'momentum') val = `${s.flames} ${s.momentum}`;
    else if (key === 'weekKm') val = fmtKm(s.weekKm, 0);
    else if (key === 'streak') val = `${s.streak} ${s.streak === 1 ? 'Tag' : 'Tage'}`;
    else return;
    slot.appendChild(el('div', { class: 'member-metric' }, [
      el('div', { class: 'member-metric__val', text: val }),
      el('div', { class: 'member-metric__label', text: METRIC_DEFS[key] }),
    ]));
  });
}

/* ------------------------------- Team-Badges ---------------------------- */
function familySummary(totalKm, totalSessions, count) {
  return el('div', { class: 'family-summary' }, [
    el('div', { class: 'family-summary__title', text: 'Diese Woche zusammen' }),
    el('div', { class: 'family-summary__stats' }, [
      summaryStat(fmtKm(totalKm, 0), 'gelaufen'),
      summaryStat(String(totalSessions), totalSessions === 1 ? 'Training' : 'Trainings'),
      summaryStat(String(count), count === 1 ? 'Mitglied' : 'Mitglieder'),
    ]),
  ]);
}
function summaryStat(big, label) {
  return el('div', { class: 'family-summary__stat' }, [
    el('div', { class: 'family-summary__num num', text: big }),
    el('div', { class: 'family-summary__lbl', text: label }),
  ]);
}

function badgeCard(title, emoji, children) {
  return el('div', { class: 'card team-badge' }, [
    el('div', { class: 'team-badge__head' }, [
      el('span', { class: 'team-badge__emoji', text: emoji }),
      el('span', { class: 'team-badge__title', text: title }),
    ]),
    ...children,
  ]);
}

/** Monats-km zusammen + Fortschritt zum nächsten Meilenstein. */
function monthKmCard(mk) {
  const remaining = Math.max(0, Math.round((mk.milestone - mk.km) * 10) / 10);
  return badgeCard('Diesen Monat zusammen', '🛣️', [
    el('div', { class: 'row row--between', style: { alignItems: 'baseline' } }, [
      el('div', { class: 'num', style: { fontSize: '1.6rem', fontWeight: '820' }, text: fmtKm(mk.km, 0) }),
      el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: `Ziel ${fmtKm(mk.milestone, 0)}` }),
    ]),
    el('div', { class: 'milestone-bar' }, [el('div', { class: 'milestone-bar__fill', style: { width: Math.round(mk.pct * 100) + '%' } })]),
    el('div', { class: 'dim', style: { fontSize: '.78rem', marginTop: '4px' }, text: remaining > 0 ? `Noch ${fmtKm(remaining, 0)} bis zum nächsten Team-Meilenstein.` : 'Meilenstein erreicht – stark!' }),
  ]);
}

/** Wer hat diese Woche schon trainiert + aktivste Person. */
function weekActivityCard(wa) {
  const chips = el('div', { class: 'row wrap gap-2', style: { marginTop: '8px' } });
  wa.rows.forEach((r) => {
    const isTop = r.id === wa.mostActiveId;
    chips.appendChild(el('span', { class: `activity-chip ${r.trained ? 'is-on' : ''} ${isTop ? 'is-top' : ''}` }, [
      el('span', { class: 'activity-chip__ava', style: { background: hex(r.color) + '22', color: hex(r.color) }, text: r.emoji || '🏃' }),
      el('span', { text: r.name }),
      el('span', { class: 'activity-chip__mark', text: r.trained ? (isTop ? '🔥' : '✓') : '·' }),
    ]));
  });
  const top = wa.rows.find((r) => r.id === wa.mostActiveId);
  return badgeCard('Diese Woche aktiv', '✅', [
    chips,
    el('div', { class: 'dim', style: { fontSize: '.78rem', marginTop: '6px' }, text: top ? `🔥 Aktivste:r diese Woche: ${top.name} (${top.sessions} ${top.sessions === 1 ? 'Training' : 'Trainings'}).` : 'Noch keine Trainings diese Woche – los geht’s!' }),
  ]);
}

/** Anstehende Wettkämpfe aller Mitglieder. */
function upcomingRacesCard(races) {
  const today = todayStr();
  const list = el('div', { class: 'col gap-2', style: { marginTop: '6px' } });
  races.forEach((r) => {
    const d = diffDays(today, r.date);
    list.appendChild(el('div', { class: 'race-row' }, [
      el('span', { class: 'race-row__dot', style: { background: hex(r.color) } }),
      el('div', { class: 'grow', style: { minWidth: '0' } }, [
        el('div', { class: 'race-row__name', text: r.name }),
        el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: `${r.memberName} · ${fmtDate(r.date)}` }),
      ]),
      el('div', { class: 'race-row__cd' }, [
        el('div', { class: 'num', style: { fontWeight: '800', lineHeight: '1' }, text: String(d) }),
        el('div', { class: 'dim', style: { fontSize: '.62rem' }, text: d === 1 ? 'Tag' : 'Tage' }),
      ]),
    ]));
  });
  return badgeCard('Anstehende Wettkämpfe', '🏁', [list]);
}

/** Gesammelte Team-Abzeichen + längste aktuelle Aktiv-Serie. */
function achievementsCard(a) {
  return badgeCard('Team-Erfolge', '🏆', [
    el('div', { class: 'row gap-4', style: { marginTop: '6px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '820' }, text: String(a.badges) }),
        el('div', { class: 'dim', style: { fontSize: '.72rem' }, text: a.badges === 1 ? 'Abzeichen zusammen' : 'Abzeichen zusammen' }),
      ]),
      el('div', { class: 'grow' }, [
        el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '820' }, text: `${a.longestStreak} ${a.longestStreak === 1 ? 'Tag' : 'Tage'}` }),
        el('div', { class: 'dim', style: { fontSize: '.72rem' }, text: a.streakHolder ? `längste Serie (${a.streakHolder})` : 'längste Aktiv-Serie' }),
      ]),
    ]),
  ]);
}

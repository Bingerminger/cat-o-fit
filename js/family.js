/* =========================================================================
   family.js — team/family dashboard (menu item "Team/family").
   Visible ONLY when signed in (login/profile selection lives in login.js,
   management in the settings). Pure overview: member tiles plus
   team badges (monthly km & milestone, weekly activity, upcoming competitions,
   team achievements). Cycle data never appears here.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, diffDays, todayStr, fmtDate,
  weekStart, addDays, fmtKm, sectionHead,
  fmtDec, fmtInt,
  safeAccent, colorTint,
} from './ui.js';
import { setHeader } from './router.js';
import { momentum, computeStats } from './badges.js';
import { teamStats, filterTeamMembers, teamlessMembers, teamLoad } from './teamstats.js';

import { t, tp } from './i18n.js';

const METRIC_DEFS = {
  get momentum() { return t('family.metricMomentum'); },
  get weekKm() { return t('family.metricWeek'); },
  get streak() { return t('family.metricStreak'); },
};
const DEFAULT_METRICS = ['momentum', 'weekKm'];
let teamFilter = null; // null = all members, teamId = one team, '__none__' = without a team

/** Member list filtered by the current team selection. */
function filterMembersByTeam(members, teamList, filter) {
  if (!filter) return members;
  if (filter === '__none__') return teamlessMembers(members, teamList);
  const found = teamList.find((x) => x.id === filter);
  return found ? filterTeamMembers(members, found) : members;
}

/** Selection bar: All · per team · No team. Changing it re-renders the view. */
function teamFilterBar(view, teamList, allMembers) {
  const bar = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', margin: '2px 0 10px' } });
  const chip = (id, label) => el('button', {
    class: `chip ${teamFilter === id ? 'chip--accent' : ''}`, style: { cursor: 'pointer' }, text: label,
    onclick: () => { teamFilter = id; view.innerHTML = ''; render(view); },
  });
  bar.appendChild(chip(null, t('common.all')));
  teamList.forEach((tm) => bar.appendChild(chip(tm.id, `${tm.emoji || '👥'} ${tm.name}`)));
  if (teamlessMembers(allMembers, teamList).length) bar.appendChild(chip('__none__', t('family.noTeam')));
  return bar;
}

/** Next main goal (event) from a member's event list. */
function nextGoal(events) {
  const today = todayStr();
  return (events || [])
    .filter((e) => e && !e.deleted && e.kind !== 'program' && e.status !== 'abgeschlossen' && e.date >= today)
    .sort((a, b) => (a.priority || 'Z').localeCompare(b.priority || 'Z') || a.date.localeCompare(b.date))[0] || null;
}

export function render(view) {
  const allMembers = store.members();
  const teamList = store.teams();
  if (teamFilter && teamFilter !== '__none__' && !teamList.some((tm) => tm.id === teamFilter)) teamFilter = null;
  if (teamFilter === '__none__' && !teamlessMembers(allMembers, teamList).length) teamFilter = null;
  const members = filterMembersByTeam(allMembers, teamList, teamFilter);
  const filterName = teamFilter === '__none__' ? t('family.noTeam') : (teamList.find((tm) => tm.id === teamFilter)?.name || null);
  setHeader({ title: t('nav.family'), subtitle: filterName ? t('family.teamSubtitle', { name: filterName }) : (allMembers.length > 1 ? t('family.sharedOverview') : t('family.yourOverview')) });

  view.appendChild(el('div', { class: 'team-intro' }, [
    el('span', { html: iconSvg('activity'), style: { width: '22px', color: 'var(--accent-text)' } }),
    el('span', { class: 'team-intro__txt', text: fmtDate(todayStr()) }),
  ]));

  if (teamList.length) view.appendChild(teamFilterBar(view, teamList, allMembers));

  const summarySlot = el('div'); view.appendChild(summarySlot);
  const badgesSlot = el('div', { class: 'col gap-3' }); view.appendChild(badgesSlot);

  view.appendChild(sectionHead(t('family.members')));
  const metrics = store.familySettings().dashboardMetrics || DEFAULT_METRICS;
  const grid = el('div', { class: 'member-grid' });
  const refs = {};
  members.forEach((m) => {
    const goalSlot = el('div', { class: 'member-card__goal muted', text: ' ' });
    const metricSlot = el('div', { class: 'member-card__metrics' });
    grid.appendChild(el('div', { class: 'member-card member-card--static' }, [
      el('span', { class: 'member-card__avatar', style: { background: colorTint(m.color), color: safeAccent(m.color) }, text: m.emoji || '🏃' }),
      el('div', { class: 'member-card__name', text: m.name || t('family.roleMember') }),
      el('div', { class: 'member-card__meta' }, [
        el('span', { class: `chip ${m.role === 'admin' ? 'chip--accent' : ''}`, text: m.role === 'admin' ? t('family.roleAdmin') : t('family.roleMember') }),
      ]),
      goalSlot, metricSlot,
    ]));
    refs[m.id] = { goalSlot, metricSlot };
  });
  view.appendChild(grid);

  // Load the data of all members -> fill tiles, weekly summary and team badges.
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
    // Coach view: only for admins and only with the respective person's consent (TRAIN-53).
    const tl = store.isAdmin() ? teamLoad(buckets, todayStr()) : [];
    if (tl.length) badgesSlot.appendChild(teamLoadCard(tl));
  }).catch(() => { /* offline: tiles/badges stay empty */ });
}

/** Collect the data of all members (active user locally, the rest read-only). */
async function loadAll(members) {
  const today = todayStr();
  const weekFrom = weekStart(today), weekTo = addDays(weekFrom, 6);   // the viewer's week, as on their own pages
  const byId = {}; const buckets = [];
  await Promise.all(members.map(async (m) => {
    const isSelf = m.id === store.activeUserId();
    const grab = async (area) => (isSelf ? store.get(area) : ((await store.peekUserArea(m.id, area)) || []));
    const [sessions, plans, events] = await Promise.all([grab('sessions'), grab('plans'), grab('events')]);
    const profile = isSelf ? store.profile() : ((await store.peekUserArea(m.id, 'profile')) || {});
    const prefs = (profile && profile.settings) || {};
    const shareGoal = prefs.shareGoal !== false;
    const shareMetrics = prefs.shareMetrics !== false;
    const shareLoad = prefs.shareLoad === true;   // Coach view only with explicit consent
    const health = shareLoad ? await grab('health') : [];

    // Cycle data of other members does not exist here (and must not) –
    // their plan adherence/momentum is calculated without protected days.
    const data = { sessions, plans, health: [], events, profile: {}, ...(isSelf ? {} : { isProtectedDay: () => false }) };
    const mom = momentum(data, today);
    const stats = computeStats(data, today);
    let weekKm = 0, weekSessions = 0;
    (sessions || []).forEach((s) => {
      if (s && !s.deleted && s.date >= weekFrom && s.date <= weekTo) { weekKm += s.distanceKm || 0; weekSessions++; }
    });
    const g = nextGoal(events);
    byId[m.id] = {
      momentum: mom.score, flames: mom.flames, streak: stats.streak, weekKm, weekSessions, shareMetrics,
      goalText: !shareGoal ? t('family.goalPrivate') : (g ? tp('family.goalIn', diffDays(today, g.date), { name: g.name }) : t('family.noRace')),
    };
    buckets.push({ id: m.id, name: m.name, color: m.color, emoji: m.emoji, role: m.role, shareMetrics, shareGoal, shareLoad, maxHr: profile && profile.maxHr, health, sessions, plans, events });
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
    else if (key === 'streak') val = tp('family.weeks', s.streak);
    else return;
    slot.appendChild(el('div', { class: 'member-metric' }, [
      el('div', { class: 'member-metric__val', text: val }),
      el('div', { class: 'member-metric__label', text: METRIC_DEFS[key] }),
    ]));
  });
}

/* ------------------------------- Team badges ---------------------------- */
function familySummary(totalKm, totalSessions, count) {
  return el('div', { class: 'family-summary' }, [
    el('div', { class: 'family-summary__title', text: t('family.summaryTitle') }),
    el('div', { class: 'family-summary__stats' }, [
      summaryStat(fmtKm(totalKm, 0), t('family.summaryMoving')),
      summaryStat(String(totalSessions), tp('family.sessionNoun', totalSessions)),
      summaryStat(String(count), tp('family.memberNoun', count)),
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

/** Combined monthly km + progress towards the next milestone. */
function monthKmCard(mk) {
  const remaining = Math.max(0, Math.round((mk.milestone - mk.km) * 10) / 10);
  return badgeCard(t('family.monthTitle'), '🛣️', [
    el('div', { class: 'row row--between', style: { alignItems: 'baseline' } }, [
      el('div', { class: 'num', style: { fontSize: '1.6rem', fontWeight: '820' }, text: fmtKm(mk.km, 0) }),
      el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: t('family.milestoneGoal', { km: fmtKm(mk.milestone, 0) }) }),
    ]),
    el('div', { class: 'milestone-bar' }, [el('div', { class: 'milestone-bar__fill', style: { width: Math.round(mk.pct * 100) + '%' } })]),
    el('div', { class: 'dim', style: { fontSize: '.78rem', marginTop: '4px' }, text: `${remaining > 0 ? t('family.milestoneRemaining', { km: fmtKm(remaining, 0) }) : t('family.milestoneReached')} ${t('family.milestoneNote')}` }),
  ]);
}

/** Who has already trained this week + most active person. */
function weekActivityCard(wa) {
  const chips = el('div', { class: 'row wrap gap-2', style: { marginTop: '8px' } });
  wa.rows.forEach((r) => {
    const isTop = r.id === wa.mostActiveId;
    chips.appendChild(el('span', { class: `activity-chip ${r.trained ? 'is-on' : ''} ${isTop ? 'is-top' : ''}` }, [
      el('span', { class: 'activity-chip__ava', style: { background: colorTint(r.color), color: safeAccent(r.color) }, text: r.emoji || '🏃' }),
      el('span', { text: r.name }),
      el('span', { class: 'activity-chip__mark', text: r.trained ? (isTop ? '🔥' : '✓') : '·' }),
    ]));
  });
  const top = wa.rows.find((r) => r.id === wa.mostActiveId);
  return badgeCard(t('family.weekActive'), '✅', [
    chips,
    el('div', { class: 'dim', style: { fontSize: '.78rem', marginTop: '6px' }, text: top ? tp('family.mostActive', top.sessions, { name: top.name }) : t('family.noSessionsYet') }),
  ]);
}

/** Upcoming competitions of all members. */
/** Load in the team (coach view): weekly load, load ratio and the most recent well-being. */
const LOAD_ZONE_TEXT = {
  get optimal() { return t('family.zoneOptimal'); },
  get niedrig() { return t('family.zoneLow'); },
  get 'erhöht'() { return t('family.zoneRaised'); },
  get hoch() { return t('family.zoneHigh'); },
  get aufbau() { return t('family.zoneBuilding'); },
  unklar: '–',
};
const TONE_VAR = { good: 'var(--good-text)', warn: 'var(--warn-text)', bad: 'var(--bad-text)', neutral: 'var(--text-2)' };
function teamLoadCard(rows) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: t('family.loadTitle') }),
    el('div', { class: 'muted', style: { fontSize: '.78rem', margin: '2px 0 6px' }, text: t('family.loadHint') }),
    ...rows.map((r) => el('div', { class: 'row gap-2', style: { padding: '6px 0', borderTop: '1px solid var(--border)', alignItems: 'center' } }, [
      el('span', { class: 'member-card__avatar', style: { width: '28px', height: '28px', fontSize: '.9rem' }, text: r.emoji || '🏃' }),
      el('div', { class: 'grow', style: { minWidth: '0' } }, [
        el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: r.name }),
        el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: [t('family.loadPoints', { points: fmtInt(r.load7) }), r.energy != null ? t('family.energyOf10', { value: r.energy }) : null, r.mood != null ? t('family.moodOf10', { value: r.mood }) : null].filter(Boolean).join(' · ') }),
      ]),
      el('span', { style: { fontSize: '.78rem', fontWeight: '650', color: TONE_VAR[r.tone] || 'var(--text-2)', textAlign: 'right' }, text: r.ratio != null && !r.sparse ? `${fmtDec(Math.round(r.ratio * 100) / 100)} · ${LOAD_ZONE_TEXT[r.zone] || r.zone}` : LOAD_ZONE_TEXT[r.zone] || '–' }),
    ])),
  ]);
}

function upcomingRacesCard(races) {
  const today = todayStr();
  const list = el('div', { class: 'col gap-2', style: { marginTop: '6px' } });
  races.forEach((r) => {
    const d = diffDays(today, r.date);
    list.appendChild(el('div', { class: 'race-row' }, [
      el('span', { class: 'race-row__dot', style: { background: safeAccent(r.color) } }),
      el('div', { class: 'grow', style: { minWidth: '0' } }, [
        el('div', { class: 'race-row__name', text: r.name }),
        el('div', { class: 'muted', style: { fontSize: '.76rem' }, text: `${r.memberName} · ${fmtDate(r.date)}` }),
      ]),
      el('div', { class: 'race-row__cd' }, [
        el('div', { class: 'num', style: { fontWeight: '800', lineHeight: '1' }, text: String(d) }),
        el('div', { class: 'dim', style: { fontSize: '.62rem' }, text: tp('family.dayNoun', d) }),
      ]),
    ]));
  });
  return badgeCard(t('family.upcomingRaces'), '🏁', [list]);
}

/** Collected training badges of the team + longest current weekly streak. */
function achievementsCard(a) {
  return badgeCard(t('family.achievements'), '🏆', [
    el('div', { class: 'row gap-4', style: { marginTop: '6px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '820' }, text: String(a.badges) }),
        el('div', { class: 'dim', style: { fontSize: '.72rem' }, text: t('family.badgesTogether') }),
      ]),
      el('div', { class: 'grow' }, [
        el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '820' }, text: tp('family.weeks', a.longestStreak) }),
        el('div', { class: 'dim', style: { fontSize: '.72rem' }, text: a.streakHolder ? t('family.longestStreakBy', { name: a.streakHolder }) : t('family.longestStreak') }),
      ]),
    ]),
    el('div', { class: 'dim', style: { fontSize: '.72rem', marginTop: '6px' }, text: t('family.achievementsNote') }),
  ]);
}

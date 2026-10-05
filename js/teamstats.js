/* =========================================================================
   teamstats.js — team/family metrics for the team dashboard (DOM-free, testable).

   From the data buckets of all members it computes the badge groups:
     • teamMonthKm        – anonymous monthly km + progress to the next milestone
     • teamWeekActivity   – who trained this week + most active person
     • teamUpcomingRaces  – upcoming races of all members
     • teamAchievements   – collected badges + longest current activity streak

   Privacy: `shareMetrics`/`shareGoal` are respected for PERSONAL badges
   (hidden members do not appear by name). Anonymous sums
   (monthly km) count everyone. Cycle data never appear here.
   ========================================================================= */
import { computeStats, evaluateBadges, TRAINING_BADGE_CATS } from './badges.js';
import { todayStr, addDays, weekStartMonday } from './ui.js';
import { acwr, trainingLoad } from './load.js';

const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000];

const monthStartOf = (today) => today.slice(0, 8) + '01';

/** Member buckets that belong to `team` (from a loaded member list with .id). */
export function filterTeamMembers(members = [], team) {
  const ids = new Set((team && team.memberIds) || []);
  return members.filter((m) => ids.has(m.id));
}
/** Members who are in NO team. */
export function teamlessMembers(members = [], teams = []) {
  const inTeam = new Set((teams || []).flatMap((t) => t.memberIds || []));
  return members.filter((m) => !inTeam.has(m.id));
}

/** Anonymous team sum of the kilometres in the current month + next milestone – all
    sports with a distance ("km in motion", as labelled too), not only running. */
export function teamMonthKm(members, today = todayStr()) {
  const ms = monthStartOf(today);
  let km = 0;
  members.forEach((m) => (m.sessions || []).forEach((s) => {
    if (s && !s.deleted && s.date >= ms && s.date <= today) km += s.distanceKm || 0;
  }));
  km = Math.round(km * 10) / 10;
  const milestone = MILESTONES.find((x) => x > km) || (Math.ceil((km + 1) / 1000) * 1000);
  return { km, milestone, pct: milestone ? Math.min(1, km / milestone) : 0 };
}

/**
 * Per member: has it trained this week? + most active person.
 * Respects `shareMetrics` (hidden members are not shown).
 */
export function teamWeekActivity(members, today = todayStr()) {
  const ws = weekStartMonday(today), we = addDays(ws, 6);
  const rows = members
    .filter((m) => m.shareMetrics !== false)
    .map((m) => {
      let sessions = 0, km = 0;
      (m.sessions || []).forEach((s) => {
        if (s && !s.deleted && s.date >= ws && s.date <= we) { sessions++; km += s.distanceKm || 0; }
      });
      return { id: m.id, name: m.name, color: m.color, emoji: m.emoji, trained: sessions > 0, sessions, km: Math.round(km * 10) / 10 };
    });
  const best = rows.reduce((b, r) => (!b || r.sessions > b.sessions || (r.sessions === b.sessions && r.km > b.km) ? r : b), null);
  return { rows, mostActiveId: best && best.sessions > 0 ? best.id : null };
}

/** Upcoming races of all members (shareGoal respected), by date. */
export function teamUpcomingRaces(members, today = todayStr(), limit = 6) {
  const out = [];
  members.forEach((m) => {
    if (m.shareGoal === false) return;
    (m.events || []).forEach((e) => {
      if (!e || e.deleted || e.kind === 'program') return;
      if (e.status === 'abgeschlossen' || !e.date || e.date < today) return;
      out.push({ memberId: m.id, memberName: m.name, color: m.color, name: e.name, date: e.date, priority: e.priority || null });
    });
  });
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.priority || 'Z').localeCompare(b.priority || 'Z'));
  return out.slice(0, limit);
}

/**
 * Collected TRAINING badges of the team + longest current weekly streak (holder only
 * if shared). Health and cycle badges deliberately do not count: this data of
 * other members is not available to the team dashboard – formerly they were silently counted as
 * "not achieved", and the team total was smaller than the personal achievements.
 */
export function teamAchievements(members, today = todayStr()) {
  let badges = 0, longestStreak = 0, streakHolder = null;
  members.forEach((m) => {
    const data = { sessions: m.sessions || [], plans: m.plans || [], health: [], events: m.events || [], profile: {}, isProtectedDay: () => false };
    badges += evaluateBadges(data, today).filter((b) => b.unlocked && TRAINING_BADGE_CATS.has(b.cat)).length;
    const st = computeStats(data, today).streak;
    if (st > longestStreak) { longestStreak = st; streakHolder = m.shareMetrics !== false ? m.name : null; }
  });
  return { badges, longestStreak, streakHolder };
}

/** Everything at once (convenient for the view). */
export function teamStats(members, today = todayStr()) {
  return {
    monthKm: teamMonthKm(members, today),
    weekActivity: teamWeekActivity(members, today),
    upcomingRaces: teamUpcomingRaces(members, today),
    achievements: teamAchievements(members, today),
  };
}

/**
 * Coach view (TRAIN-53): load of those who explicitly release it (`shareLoad`,
 * off by default) – weekly load in load points, load ratio and the latest
 * wellbeing (energy/mood of the last three days). The HR estimate uses the
 * max HR of the respective person, never that of the viewer. Cycle, lab and supplements
 * do not appear here.
 * @returns {Array<{id, name, emoji, color, load7, ratio, zone, tone, sparse, energy, mood}>}
 */
export function teamLoad(members = [], today = todayStr()) {
  return (members || [])
    .filter((m) => m && m.shareLoad === true)
    .map((m) => {
      const ref = Number(m.maxHr) > 0 ? { maxHr: Number(m.maxHr) } : null;
      const ac = acwr(m.sessions || [], today, { ref });
      const recent = (m.health || []).filter((h) => h && !h.deleted && h.date && h.date <= today && h.date >= addDays(today, -2)
        && (h.energy != null || h.mood != null)).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
      return {
        id: m.id, name: m.name, emoji: m.emoji, color: m.color,
        load7: trainingLoad(m.sessions || [], today, 7, ref),
        ratio: ac.ratio, zone: ac.zone, tone: ac.tone, sparse: ac.sparse,
        energy: recent && recent.energy != null ? recent.energy : null,
        mood: recent && recent.mood != null ? recent.mood : null,
      };
    })
    .sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
}

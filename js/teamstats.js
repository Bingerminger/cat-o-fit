/* =========================================================================
   teamstats.js — Team-/Familien-Kennzahlen fürs Team-Dashboard (DOM-frei, testbar).

   Rechnet aus den Daten-Buckets aller Mitglieder die Badge-Gruppen:
     • teamMonthKm        – anonyme Monats-km + Fortschritt zum nächsten Meilenstein
     • teamWeekActivity   – wer hat diese Woche trainiert + aktivste Person
     • teamUpcomingRaces  – anstehende Wettkämpfe aller Mitglieder
     • teamAchievements   – gesammelte Abzeichen + längste aktuelle Aktiv-Serie

   Datenschutz: `shareMetrics`/`shareGoal` werden für PERSONENBEZOGENE Badges
   respektiert (verborgene Mitglieder erscheinen nicht namentlich). Anonyme Summen
   (Monats-km) zählen alle. Zyklusdaten kommen hier nie vor.
   ========================================================================= */
import { computeStats, evaluateBadges } from './badges.js';
import { todayStr, addDays, weekStartMonday } from './ui.js';

const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000];

const monthStartOf = (today) => today.slice(0, 8) + '01';

/** Mitglieder-Buckets, die zu `team` gehören (aus einer geladenen Mitgliederliste mit .id). */
export function filterTeamMembers(members = [], team) {
  const ids = new Set((team && team.memberIds) || []);
  return members.filter((m) => ids.has(m.id));
}
/** Mitglieder, die in KEINEM Team sind. */
export function teamlessMembers(members = [], teams = []) {
  const inTeam = new Set((teams || []).flatMap((t) => t.memberIds || []));
  return members.filter((m) => !inTeam.has(m.id));
}

/** Anonyme Team-Summe der Kilometer im laufenden Monat + nächster Meilenstein. */
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
 * Pro Mitglied: hat es diese Woche trainiert? + aktivste Person.
 * Respektiert `shareMetrics` (verborgene Mitglieder werden nicht gezeigt).
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

/** Anstehende Wettkämpfe aller Mitglieder (shareGoal respektiert), nach Datum. */
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

/** Gesammelte Abzeichen des Teams + längste aktuelle Aktiv-Serie (Halter nur wenn geteilt). */
export function teamAchievements(members, today = todayStr()) {
  let badges = 0, longestStreak = 0, streakHolder = null;
  members.forEach((m) => {
    const data = { sessions: m.sessions || [], plans: m.plans || [], health: [], events: m.events || [], profile: {} };
    badges += evaluateBadges(data, today).filter((b) => b.unlocked).length;
    const st = computeStats(data, today).streak;
    if (st > longestStreak) { longestStreak = st; streakHolder = m.shareMetrics !== false ? m.name : null; }
  });
  return { badges, longestStreak, streakHolder };
}

/** Alles auf einmal (bequem für die View). */
export function teamStats(members, today = todayStr()) {
  return {
    monthKm: teamMonthKm(members, today),
    weekActivity: teamWeekActivity(members, today),
    upcomingRaces: teamUpcomingRaces(members, today),
    achievements: teamAchievements(members, today),
  };
}

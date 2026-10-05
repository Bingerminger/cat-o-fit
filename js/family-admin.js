/* =========================================================================
   family-admin.js — Familienverwaltung (nur Admin):
   Mitglieder anlegen/bearbeiten/entfernen/öffnen + gemeinsame Einstellungen.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, openSheet, closeSheet, toast, sectionHead, select, segmented, input, field, toggle, confirmDialog,
  safeAccent, colorTint,
} from './ui.js';
import { setHeader, refresh } from './router.js';
import { weekdayNames } from './format.js';

import { t } from './i18n.js';

const EMOJIS = ['🏃', '🏃‍♀️', '🧔', '👩', '🧒', '👦', '👧', '👵', '👴', '🐱', '🐶', '🦊', '⚡', '🔥', '🌟', '🚴'];
const COLORS = ['#18b48a', '#3d8bff', '#ff8a3d', '#f5b300', '#7c5cff', '#ff5d8f', '#19b9c9', '#43c59e'];
const TEAM_EMOJIS = ['👥', '🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚽', '🏃', '🚴', '💪', '🔥'];

export function render(view) {
  setHeader({ title: t('familyAdmin.title'), back: '#/settings' });

  if (!store.isAdmin()) {
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('user') }),
      el('div', { class: 'empty__title', text: t('familyAdmin.adminsOnly') }),
      el('div', { class: 'muted', text: t('familyAdmin.adminsOnlyHint') }),
    ]));
    return;
  }

  /* ----- Mitglieder ----- */
  const canAdd = store.members().length < store.MAX_MEMBERS;
  view.appendChild(sectionHead(t('family.members'), canAdd ? { label: t('familyAdmin.add'), onClick: () => openMemberSheet(null) } : null));
  const list = el('div', { class: 'col gap-2' });
  store.members().forEach((m) => list.appendChild(memberRow(m)));
  view.appendChild(list);
  view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('familyAdmin.memberCount', { n: store.members().length, max: store.MAX_MEMBERS }) }));

  /* ----- Teams ----- */
  view.appendChild(sectionHead(t('familyAdmin.teams'), { label: t('familyAdmin.createTeam'), onClick: () => openTeamSheet(null) }));
  const teamList = store.teams();
  if (!teamList.length) {
    view.appendChild(el('div', { class: 'card card--flat muted', style: { fontSize: '.84rem' }, text: t('familyAdmin.noTeams') }));
  } else {
    const tl = el('div', { class: 'col gap-2' });
    teamList.forEach((team) => tl.appendChild(teamRow(team)));
    view.appendChild(tl);
  }

  /* ----- Gemeinsame Einstellungen ----- */
  view.appendChild(sectionHead(t('familyAdmin.sharedSettings')));
  const sd = store.familySettings().shoppingDay ?? 2;
  view.appendChild(el('div', { class: 'card' }, [
    field(t('familyAdmin.shoppingDay'), select(
      weekdayNames(true).map((w, i) => ({ value: String(i), label: w })),
      String(sd),
      { onchange: (e) => { store.setFamilySetting('shoppingDay', parseInt(e.target.value, 10)); toast(t('familyAdmin.shoppingDaySaved'), 'good'); } },
    )),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('familyAdmin.shoppingDayHint') }),
  ]));

  /* ----- Team/Familie-Dashboard ----- */
  view.appendChild(sectionHead(t('familyAdmin.dashboardTitle')));
  view.appendChild(metricsCard());
}

const dashMetrics = () => [['momentum', t('family.metricMomentum')], ['weekKm', t('familyAdmin.metricWeekKm')], ['streak', t('familyAdmin.metricStreak')]];
const DEFAULT_DASH = ['momentum', 'weekKm'];

/** Auswahl, welche Kennzahlen pro Mitglied im Familiendashboard erscheinen. */
function metricsCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.8rem' }, text: t('familyAdmin.dashboardHint') }));
  dashMetrics().forEach(([key, label]) => {
    const on = (store.familySettings().dashboardMetrics || DEFAULT_DASH).includes(key);
    card.appendChild(el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
      el('span', { text: label }),
      toggle(on, (v) => {
        const set = new Set(store.familySettings().dashboardMetrics || DEFAULT_DASH);
        if (v) set.add(key); else set.delete(key);
        store.setFamilySetting('dashboardMetrics', [...set]);
        toast(t('familyAdmin.saved'), 'good');
      }, t('familyAdmin.showOnDashboard', { label })),
    ]));
  });
  return card;
}

function teamRow(team) {
  const mem = store.teamMembers(team.id);
  return el('div', { class: 'card' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { class: 'member-card__avatar', style: { width: '40px', height: '40px', fontSize: '1.3rem', background: colorTint(team.color), color: safeAccent(team.color) }, text: team.emoji || '👥' }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: team.name }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: mem.length ? mem.map((m) => m.name).join(', ') : t('familyAdmin.noMembers') }),
      ]),
      el('span', { class: 'chip', text: `${mem.length}` }),
    ]),
    el('button', { class: 'btn btn--ghost btn--block mt-3', onclick: () => openTeamSheet(team) }, [icon('edit'), t('familyAdmin.edit')]),
  ]);
}

function openTeamSheet(team) {
  const editing = !!team;
  const st = { name: team?.name || '', emoji: team?.emoji || '👥', color: team?.color || COLORS[1], memberIds: new Set(team?.memberIds || []) };

  const nameInp = input({ value: st.name, placeholder: t('familyAdmin.teamNamePlaceholder'), maxlength: '24', oninput: (e) => { st.name = e.target.value; } });

  const emojiWrap = el('div', { class: 'picker-row' });
  TEAM_EMOJIS.forEach((e) => {
    const b = el('button', { class: 'picker-chip' + (e === st.emoji ? ' is-sel' : ''), text: e });
    b.onclick = () => { st.emoji = e; emojiWrap.querySelectorAll('.picker-chip').forEach((x) => x.classList.remove('is-sel')); b.classList.add('is-sel'); };
    emojiWrap.appendChild(b);
  });

  const colorWrap = el('div', { class: 'picker-row' });
  COLORS.forEach((c) => {
    const b = el('button', { class: 'picker-dot' + (c === st.color ? ' is-sel' : ''), style: { background: c } });
    b.onclick = () => { st.color = c; colorWrap.querySelectorAll('.picker-dot').forEach((x) => x.classList.remove('is-sel')); b.classList.add('is-sel'); };
    colorWrap.appendChild(b);
  });

  // Mitglieder-Zuordnung per Checkbox – erlaubt Mehrfach-Mitgliedschaft und Teamwechsel.
  const memWrap = el('div', { class: 'col' });
  store.members().forEach((m) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = st.memberIds.has(m.id);
    cb.onchange = () => { if (cb.checked) st.memberIds.add(m.id); else st.memberIds.delete(m.id); };
    const row = el('label', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' } }, [
      el('span', { class: 'row gap-2', style: { alignItems: 'center' } }, [
        el('span', { text: m.emoji || '🙂' }),
        el('span', { text: m.name }),
        m.role === 'admin' ? el('span', { class: 'chip chip--accent', style: { fontSize: '.62rem' }, text: t('family.roleAdmin') }) : null,
      ]),
      cb,
    ]);
    memWrap.appendChild(row);
  });

  const save = () => {
    if (!st.name.trim()) { toast(t('familyAdmin.teamNameRequired'), 'bad'); return; }
    const fields = { name: st.name.trim(), emoji: st.emoji, color: st.color, memberIds: [...st.memberIds] };
    if (editing) store.updateTeam(team.id, fields); else store.addTeam(fields);
    closeSheet();
    toast(editing ? t('familyAdmin.teamSaved') : t('familyAdmin.teamCreated'), 'good');
    refresh();
  };

  const body = el('div', { class: 'col gap-3' }, [
    field(t('familyAdmin.teamName'), nameInp),
    field(t('familyAdmin.symbol'), emojiWrap),
    field(t('familyAdmin.colour'), colorWrap),
    el('label', { class: 'field__label', text: t('familyAdmin.teamMembersLabel') }), memWrap,
    el('button', { class: 'btn btn--primary btn--block', onclick: save }, [icon('check'), editing ? t('familyAdmin.save') : t('familyAdmin.createTeam')]),
    editing ? el('button', {
      class: 'btn btn--ghost btn--block', style: { color: 'var(--bad-text)' },
      onclick: async () => {
        const ok = await confirmDialog({ title: t('familyAdmin.deleteTeamTitle'), message: t('familyAdmin.deleteTeamText', { name: team.name }), confirmLabel: t('familyAdmin.deleteTeam'), danger: true });
        if (!ok) return;
        store.removeTeam(team.id); closeSheet(); toast(t('familyAdmin.teamDeleted')); refresh();
      },
    }, [icon('trash'), t('familyAdmin.deleteTeam')]) : null,
  ]);
  openSheet({ title: editing ? t('familyAdmin.editTeam') : t('familyAdmin.newTeam'), body });
  setTimeout(() => nameInp.focus(), 120);
}

function memberRow(m) {
  const isMe = store.identityId() === m.id;
  return el('div', { class: 'card' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { class: 'member-card__avatar', style: { width: '40px', height: '40px', fontSize: '1.3rem', background: colorTint(m.color), color: safeAccent(m.color) }, text: m.emoji || '🙂' }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: m.name + (isMe ? ` (${t('familyAdmin.you')})` : '') }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: m.role === 'admin' ? t('familyAdmin.roleAdminLong') : t('family.roleMember') }),
      ]),
      m.role === 'admin' ? el('span', { class: 'chip chip--accent', text: t('family.roleAdmin') }) : null,
    ]),
    el('div', { class: 'row gap-2 mt-3' }, [
      el('button', { class: 'btn btn--ghost grow', onclick: () => openMemberSheet(m) }, [icon('edit'), t('familyAdmin.edit')]),
      isMe ? null : el('button', { class: 'btn btn--ghost grow', onclick: async () => { await store.enterMember(m.id); navigate('#/'); } }, [icon('arrowRight'), t('familyAdmin.open')]),
    ]),
  ]);
}

function openMemberSheet(m) {
  const editing = !!m;
  const st = { name: m?.name || '', role: m?.role || 'user', emoji: m?.emoji || '🙂', color: m?.color || COLORS[1] };

  const nameInp = input({ value: st.name, placeholder: t('familyAdmin.firstName'), maxlength: '24', oninput: (e) => { st.name = e.target.value; } });

  const emojiWrap = el('div', { class: 'picker-row' });
  EMOJIS.forEach((e) => {
    const b = el('button', { class: 'picker-chip' + (e === st.emoji ? ' is-sel' : ''), text: e });
    b.onclick = () => { st.emoji = e; emojiWrap.querySelectorAll('.picker-chip').forEach((x) => x.classList.remove('is-sel')); b.classList.add('is-sel'); };
    emojiWrap.appendChild(b);
  });

  const colorWrap = el('div', { class: 'picker-row' });
  COLORS.forEach((c) => {
    const b = el('button', { class: 'picker-dot' + (c === st.color ? ' is-sel' : ''), style: { background: c } });
    b.onclick = () => { st.color = c; colorWrap.querySelectorAll('.picker-dot').forEach((x) => x.classList.remove('is-sel')); b.classList.add('is-sel'); };
    colorWrap.appendChild(b);
  });

  const roleCtl = segmented([{ value: 'user', label: t('family.roleMember') }, { value: 'admin', label: t('family.roleAdmin') }], st.role, (v) => { st.role = v; });

  // Anlegen, Rollen ändern und Entfernen prüft der Server – dafür braucht es die
  // Admin-Anmeldung mit Serververbindung (sonst lehnt er die Änderung ab).
  const needsServer = (msg) => {
    if (store.serverSessionActive()) return false;
    toast(msg, 'bad', 5000);
    return true;
  };
  const save = async () => {
    if (!st.name.trim()) { toast(t('familyAdmin.nameRequired'), 'bad'); return; }
    if (!editing && needsServer(t('familyAdmin.needsServerAdd'))) return;
    if (editing && st.role !== m.role && needsServer(t('familyAdmin.needsServerRole'))) return;
    if (editing) { store.updateMember(m.id, st); } else { await store.addMember(st); }
    closeSheet();
    toast(editing ? t('familyAdmin.saved') : t('familyAdmin.memberAdded'), 'good', editing ? 2200 : 4800);
    refresh();
  };

  const body = el('div', { class: 'col gap-3' }, [
    field(t('familyAdmin.name'), nameInp),
    field(t('familyAdmin.symbol'), emojiWrap),
    field(t('familyAdmin.colour'), colorWrap),
    field(t('familyAdmin.role'), roleCtl),
    editing ? null : el('div', { class: 'dim', style: { fontSize: '.78rem', marginTop: '-4px' }, text: t('familyAdmin.pinHint') }),
    el('button', { class: 'btn btn--primary btn--block', onclick: save }, [icon('check'), editing ? t('familyAdmin.save') : t('familyAdmin.add')]),
    editing ? el('button', {
      class: 'btn btn--ghost btn--block', style: { color: 'var(--bad-text)' },
      onclick: async () => {
        const ok = await confirmDialog({
          title: t('familyAdmin.removeMemberTitle'),
          message: t('familyAdmin.removeMemberText', { name: m.name }),
          confirmLabel: t('familyAdmin.removeConfirm'), danger: true,
        });
        if (!ok) return;
        if (needsServer(t('familyAdmin.needsServerRemove'))) return;
        if (store.removeMember(m.id)) { closeSheet(); toast(t('familyAdmin.memberRemoved')); refresh(); }
        else toast(t('familyAdmin.lastAdmin'), 'bad');
      },
    }, [icon('trash'), t('familyAdmin.remove')]) : null,
  ]);
  openSheet({ title: editing ? t('familyAdmin.editMember') : t('familyAdmin.newMember'), body });
  setTimeout(() => nameInp.focus(), 120);
}

/* =========================================================================
   family-admin.js — Familienverwaltung (nur Admin):
   Mitglieder anlegen/bearbeiten/entfernen/öffnen + gemeinsame Einstellungen.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, openSheet, closeSheet, toast, sectionHead, select, segmented, input, field, toggle, confirmDialog,
} from './ui.js';
import { setHeader, refresh } from './router.js';

const EMOJIS = ['🏃', '🏃‍♀️', '🧔', '👩', '🧒', '👦', '👧', '👵', '👴', '🐱', '🐶', '🦊', '⚡', '🔥', '🌟', '🚴'];
const COLORS = ['#18b48a', '#3d8bff', '#ff8a3d', '#f5b300', '#7c5cff', '#ff5d8f', '#19b9c9', '#43c59e'];
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const TEAM_EMOJIS = ['👥', '🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚽', '🏃', '🚴', '💪', '🔥'];
const hex = (c) => (typeof c === 'string' && c[0] === '#' ? c : 'var(--accent)');

export function render(view) {
  setHeader({ title: 'Team/Familie verwalten', back: '#/settings' });

  if (!store.isAdmin()) {
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('user') }),
      el('div', { class: 'empty__title', text: 'Nur für Admins' }),
      el('div', { class: 'muted', text: 'Die Team-/Familienverwaltung ist Administrator:innen vorbehalten.' }),
    ]));
    return;
  }

  /* ----- Mitglieder ----- */
  const canAdd = store.members().length < store.MAX_MEMBERS;
  view.appendChild(sectionHead('Mitglieder', canAdd ? { label: 'Hinzufügen', onClick: () => openMemberSheet(null) } : null));
  const list = el('div', { class: 'col gap-2' });
  store.members().forEach((m) => list.appendChild(memberRow(m)));
  view.appendChild(list);
  view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: `${store.members().length} von ${store.MAX_MEMBERS} Mitgliedern` }));

  /* ----- Teams ----- */
  view.appendChild(sectionHead('Teams', { label: 'Team anlegen', onClick: () => openTeamSheet(null) }));
  const teamList = store.teams();
  if (!teamList.length) {
    view.appendChild(el('div', { class: 'card card--flat muted', style: { fontSize: '.84rem' }, text: 'Noch keine Teams. Lege Teams an, um Mitglieder zu gruppieren – ein Mitglied kann in mehreren Teams sein. Das Team/Familie-Dashboard lässt sich dann je Team auswerten.' }));
  } else {
    const tl = el('div', { class: 'col gap-2' });
    teamList.forEach((t) => tl.appendChild(teamRow(t)));
    view.appendChild(tl);
  }

  /* ----- Gemeinsame Einstellungen ----- */
  view.appendChild(sectionHead('Gemeinsame Einstellungen'));
  const sd = store.familySettings().shoppingDay ?? 2;
  view.appendChild(el('div', { class: 'card' }, [
    field('Gemeinsamer Einkaufstag', select(
      WD.map((w, i) => ({ value: String(i), label: w })),
      String(sd),
      { onchange: (e) => { store.setFamilySetting('shoppingDay', parseInt(e.target.value, 10)); toast('Einkaufstag gespeichert', 'good'); } },
    )),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'Gilt künftig für die gemeinsame Einkaufsliste.' }),
  ]));

  /* ----- Team/Familie-Dashboard ----- */
  view.appendChild(sectionHead('Team/Familie-Dashboard'));
  view.appendChild(metricsCard());
}

const DASH_METRICS = [['momentum', 'Momentum'], ['weekKm', 'Wochen-Kilometer'], ['streak', 'Aktiv-Serie']];
const DEFAULT_DASH = ['momentum', 'weekKm'];

/** Auswahl, welche Kennzahlen pro Mitglied im Familiendashboard erscheinen. */
function metricsCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'muted mb-2', style: { fontSize: '.8rem' }, text: 'Welche Kennzahlen pro Mitglied im Team/Familie-Dashboard erscheinen:' }));
  DASH_METRICS.forEach(([key, label]) => {
    const on = (store.familySettings().dashboardMetrics || DEFAULT_DASH).includes(key);
    card.appendChild(el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
      el('span', { text: label }),
      toggle(on, (v) => {
        const set = new Set(store.familySettings().dashboardMetrics || DEFAULT_DASH);
        if (v) set.add(key); else set.delete(key);
        store.setFamilySetting('dashboardMetrics', [...set]);
        toast('Gespeichert', 'good');
      }),
    ]));
  });
  return card;
}

function teamRow(t) {
  const mem = store.teamMembers(t.id);
  return el('div', { class: 'card' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { class: 'member-card__avatar', style: { width: '40px', height: '40px', fontSize: '1.3rem', background: hex(t.color) + '22', color: hex(t.color) }, text: t.emoji || '👥' }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: t.name }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: mem.length ? mem.map((m) => m.name).join(', ') : 'Noch keine Mitglieder' }),
      ]),
      el('span', { class: 'chip', text: `${mem.length}` }),
    ]),
    el('button', { class: 'btn btn--ghost btn--block mt-3', onclick: () => openTeamSheet(t) }, [icon('edit'), 'Bearbeiten']),
  ]);
}

function openTeamSheet(t) {
  const editing = !!t;
  const st = { name: t?.name || '', emoji: t?.emoji || '👥', color: t?.color || COLORS[1], memberIds: new Set(t?.memberIds || []) };

  const nameInp = input({ value: st.name, placeholder: 'z. B. Team Rot', maxlength: '24', oninput: (e) => { st.name = e.target.value; } });

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
        m.role === 'admin' ? el('span', { class: 'chip chip--accent', style: { fontSize: '.62rem' }, text: 'Admin' }) : null,
      ]),
      cb,
    ]);
    memWrap.appendChild(row);
  });

  const save = () => {
    if (!st.name.trim()) { toast('Bitte einen Teamnamen eingeben', 'bad'); return; }
    const fields = { name: st.name.trim(), emoji: st.emoji, color: st.color, memberIds: [...st.memberIds] };
    if (editing) store.updateTeam(t.id, fields); else store.addTeam(fields);
    closeSheet();
    toast(editing ? 'Team gespeichert' : 'Team angelegt', 'good');
    refresh();
  };

  const body = el('div', { class: 'col gap-3' }, [
    field('Teamname', nameInp),
    field('Symbol', emojiWrap),
    field('Farbe', colorWrap),
    el('label', { class: 'field__label', text: 'Mitglieder (Mehrfach-Mitgliedschaft möglich)' }), memWrap,
    el('button', { class: 'btn btn--primary btn--block', onclick: save }, [icon('check'), editing ? 'Speichern' : 'Team anlegen']),
    editing ? el('button', {
      class: 'btn btn--ghost btn--block', style: { color: 'var(--bad)' },
      onclick: async () => {
        const ok = await confirmDialog({ title: 'Team löschen?', message: `„${t.name}" wird gelöscht. Die Mitglieder selbst bleiben erhalten.`, confirmLabel: 'Team löschen', danger: true });
        if (!ok) return;
        store.removeTeam(t.id); closeSheet(); toast('Team gelöscht'); refresh();
      },
    }, [icon('trash'), 'Team löschen']) : null,
  ]);
  openSheet({ title: editing ? 'Team bearbeiten' : 'Neues Team', body });
  setTimeout(() => nameInp.focus(), 120);
}

function memberRow(m) {
  const isMe = store.identityId() === m.id;
  return el('div', { class: 'card' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { class: 'member-card__avatar', style: { width: '40px', height: '40px', fontSize: '1.3rem', background: hex(m.color) + '22', color: hex(m.color) }, text: m.emoji || '🙂' }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: m.name + (isMe ? ' (du)' : '') }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: m.role === 'admin' ? 'Administrator:in' : 'Mitglied' }),
      ]),
      el('span', { class: `chip ${m.role === 'admin' ? 'chip--accent' : ''}`, text: m.role === 'admin' ? 'Admin' : 'User' }),
    ]),
    el('div', { class: 'row gap-2 mt-3' }, [
      el('button', { class: 'btn btn--ghost grow', onclick: () => openMemberSheet(m) }, [icon('edit'), 'Bearbeiten']),
      isMe ? null : el('button', { class: 'btn btn--ghost grow', onclick: async () => { await store.enterMember(m.id); navigate('#/'); } }, [icon('arrowRight'), 'Öffnen']),
    ]),
  ]);
}

function openMemberSheet(m) {
  const editing = !!m;
  const st = { name: m?.name || '', role: m?.role || 'user', emoji: m?.emoji || '🙂', color: m?.color || COLORS[1] };

  const nameInp = input({ value: st.name, placeholder: 'Vorname', maxlength: '24', oninput: (e) => { st.name = e.target.value; } });

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

  const roleCtl = segmented([{ value: 'user', label: 'Mitglied' }, { value: 'admin', label: 'Admin' }], st.role, (v) => { st.role = v; });

  const save = async () => {
    if (!st.name.trim()) { toast('Bitte einen Namen eingeben', 'bad'); return; }
    if (editing) { store.updateMember(m.id, st); } else { await store.addMember(st); }
    closeSheet();
    toast(editing ? 'Gespeichert' : 'Mitglied hinzugefügt – PIN ist 0000 (in den Einstellungen änderbar)', 'good', editing ? 2200 : 4200);
    refresh();
  };

  const body = el('div', { class: 'col gap-3' }, [
    field('Name', nameInp),
    field('Symbol', emojiWrap),
    field('Farbe', colorWrap),
    field('Rolle', roleCtl),
    editing ? null : el('div', { class: 'dim', style: { fontSize: '.78rem', marginTop: '-4px' }, text: '🔒 Start-PIN ist 0000. Das Mitglied kann ihn in den Einstellungen ändern.' }),
    el('button', { class: 'btn btn--primary btn--block', onclick: save }, [icon('check'), editing ? 'Speichern' : 'Hinzufügen']),
    editing ? el('button', {
      class: 'btn btn--ghost btn--block', style: { color: 'var(--bad)' },
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Mitglied entfernen?',
          message: `„${m.name}" wird mit allen Daten (Plänen, Trainings, Werten, Ernährung …) unwiderruflich gelöscht.`,
          confirmLabel: 'Endgültig entfernen', danger: true,
        });
        if (!ok) return;
        if (store.removeMember(m.id)) { closeSheet(); toast('Mitglied entfernt'); refresh(); }
        else toast('Die letzte Admin-Person kann nicht entfernt werden', 'bad');
      },
    }, [icon('trash'), 'Entfernen']) : null,
  ]);
  openSheet({ title: editing ? 'Mitglied bearbeiten' : 'Neues Mitglied', body });
  setTimeout(() => nameInp.focus(), 120);
}

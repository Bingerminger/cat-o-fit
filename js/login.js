/* =========================================================================
   login.js — Abgemeldet-Ansicht (Route /login).
     • Leere Installation -> Ersteinrichtung (Admin anlegen -> Demo/leer).
     • Sonst -> Profilauswahl (Kacheln + optional PIN).
   Nur sichtbar, solange niemand angemeldet ist (siehe session-gate.js).
   ========================================================================= */
import * as store from './storage.js';
import { el, icon, iconSvg, navigate, openSheet, closeSheet, todayStr, fmtDate, toast, field, scopeKey, safeAccent, colorTint } from './ui.js';
import { setHeader } from './router.js';
import { APP_VERSION } from './version.js';
import { needsSetup, safeReturnTo } from './session-gate.js';

/** Nach erfolgreicher Anmeldung: zum gemerkten Ziel (Deep-Link), sonst „Heute“ (FE-25). */
function afterLogin() {
  let target = null;
  try {
    target = safeReturnTo(sessionStorage.getItem(scopeKey('returnTo')));
    sessionStorage.removeItem(scopeKey('returnTo'));
  } catch { /* kein sessionStorage */ }
  navigate(target || '#/');
}


function hero(title, sub) {
  return el('div', { class: 'family-hero' }, [
    el('div', { class: 'family-hero__brand' }, [
      el('span', { html: iconSvg('activity'), style: { width: '26px', color: 'var(--accent-text)' } }),
      el('span', { text: 'Cat-O-Fit' }),
      el('span', { class: 'family-hero__v', text: `v${APP_VERSION}` }),
    ]),
    el('div', { class: 'family-hero__title', text: title }),
    el('div', { class: 'muted', text: sub }),
  ]);
}

export function render(view) {
  if (store.activeUserId()) { navigate('#/'); return; }   // angemeldet -> Dashboard
  setHeader({ title: 'Anmelden', subtitle: '' });

  const members = store.members();
  if (members.length) { renderPicker(view, members); return; }

  // Familie evtl. nur noch nicht synchronisiert -> erst laden, dann entscheiden,
  // damit nicht fälschlich die Ersteinrichtung erscheint.
  view.appendChild(hero('Cat-O-Fit', 'Einen Moment …'));
  view.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'muted', text: 'Daten werden geladen …' })]));
  store.refreshFamily().then((m) => {
    if (!location.hash.startsWith('#/login')) return;     // weggewechselt
    if (store.activeUserId()) { navigate('#/'); return; }
    view.innerHTML = '';
    if (m.length) renderPicker(view, m);
    else renderSetup(view);                               // wirklich leer -> Ersteinrichtung
  }).catch(() => { view.innerHTML = ''; renderSetup(view); });
}

/* ----------------------------- Ersteinrichtung -------------------------- */
function renderSetup(view) {
  const st = { name: '', pin: '', pin2: '' };
  const frame = (children) => {
    view.innerHTML = '';
    view.appendChild(hero('Willkommen!', 'Richte deine App in zwei Schritten ein.'));
    // Gerät kannte eine Familie, der Server ist aber leer (neu aufgesetzt oder zurückgesetzt).
    if (store.serverWasReset()) {
      view.appendChild(el('div', { class: 'card card--flat mb-3', role: 'status' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: 'Der Server ist leer' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Er wurde neu aufgesetzt oder zurückgesetzt, die frühere Familie gibt es dort nicht mehr. Richte Cat-O-Fit neu ein – eine Sicherung spielst du danach unter Einstellungen → Daten & Sicherung ein.' }),
      ]));
    }
    view.appendChild(el('div', { class: 'card setup-card' }, children));
  };
  const stepLabel = (n) => el('div', { class: 'dim', style: { fontSize: '.72rem', fontWeight: '700', letterSpacing: '.04em' }, text: `SCHRITT ${n} VON 2` });

  function step1() {
    const nameInp = el('input', { class: 'input', type: 'text', value: st.name, placeholder: 'Dein Name', maxlength: '24', autocomplete: 'off' });
    const pinInp = el('input', { class: 'input', type: 'password', inputmode: 'numeric', value: st.pin, placeholder: '4 bis 8 Ziffern', maxlength: '8', autocomplete: 'new-password' });
    const pin2Inp = el('input', { class: 'input', type: 'password', inputmode: 'numeric', value: st.pin2, placeholder: 'PIN wiederholen', maxlength: '8', autocomplete: 'new-password' });
    const err = el('div', { class: 'pin-err', role: 'alert', hidden: true });
    const showErr = (msg, focusEl) => { err.textContent = msg; err.hidden = false; if (focusEl) focusEl.focus(); };
    const next = () => {
      st.name = nameInp.value.trim(); st.pin = pinInp.value.trim(); st.pin2 = pin2Inp.value.trim();
      if (!st.name) { showErr('Bitte gib einen Namen ein.', nameInp); return; }
      // Die Admin-PIN schützt die Verwaltung aller Profile – daher Pflicht und nicht 0000.
      const problem = store.pinProblem(st.pin);
      if (problem) { showErr(problem, pinInp); return; }
      if (st.pin !== st.pin2) { showErr('Die beiden PINs stimmen nicht überein.', pin2Inp); return; }
      step2();
    };
    nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pinInp.focus(); });
    pinInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pin2Inp.focus(); });
    pin2Inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    frame([
      stepLabel(1),
      el('h3', { style: { margin: '4px 0 6px' }, text: 'Administrator:in anlegen' }),
      el('div', { class: 'muted mb-3', style: { fontSize: '.86rem' }, text: 'Die erste Person ist Administrator:in und kann später weitere Mitglieder anlegen. Ihre PIN schützt die Verwaltung aller Profile.' }),
      // Beschriftungen per field() mit den Feldern verknüpft – vorher las VoiceOver nur den Platzhalter (UI-18).
      field('Name', nameInp),
      field('PIN', pinInp),
      field('PIN wiederholen', pin2Inp),
      err,
      el('button', { class: 'btn btn--primary btn--block mt-3', onclick: next }, [icon('arrowRight'), 'Weiter']),
    ]);
    setTimeout(() => nameInp.focus(), 120);
  }

  function step2() {
    let busy = false;
    const choose = async (withDemo) => {
      if (busy) return; busy = true;
      frame([el('div', { class: 'center', style: { padding: '28px 8px' } }, [
        el('div', { class: 'muted', text: withDemo ? 'Demodaten werden geladen …' : 'App wird eingerichtet …' }),
      ])]);
      try {
        const id = await store.createFirstAdmin({ name: st.name, pin: st.pin });
        if (!id) {
          // Server hat bereits eine Familie (anderes Gerät / später Pull) -> keine
          // Doppelanlage, sondern zum vorhandenen Login/Familien-Dashboard.
          if ((store.members() || []).length) { busy = false; navigate('#/'); return; }
          const why = store.lastLoginError();
          toast(why && why.message ? why.message : 'Einrichtung fehlgeschlagen', 'bad', 4000); busy = false; step1(); return;
        }
        if (withDemo) await store.seedDemo(todayStr());
      } catch (e) { toast('Fehler: ' + (e.message || e), 'bad'); }
      navigate('#/');
    };
    const choice = (emoji, title, sub, onClick) => el('button', { class: 'card card--link setup-choice', onclick: onClick }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { style: { fontSize: '1.7rem' }, text: emoji }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'card__title', text: title }),
          el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: sub }),
        ]),
      ]),
    ]);
    frame([
      stepLabel(2),
      el('h3', { style: { margin: '4px 0 10px' }, text: `Hallo ${st.name}! Wie möchtest du starten?` }),
      el('div', { class: 'col gap-3' }, [
        choice('✨', 'Mit Demodaten starten', 'Beispiel-Wettkampf, Trainingshistorie und eine komplette Beispiel-Familie mit Teams – ideal zum Ausprobieren.', () => choose(true)),
        choice('📭', 'Leer starten', 'Nur dein Konto. Mitglieder und Ziele legst du selbst an.', () => choose(false)),
      ]),
      el('button', { class: 'btn btn--ghost btn--block mt-3', onclick: step1 }, [icon('arrowLeft'), 'Zurück']),
    ]);
  }

  step1();
}

/* ----------------------------- Profilauswahl ---------------------------- */
function renderPicker(view, members) {
  view.appendChild(hero(members.length > 1 ? 'Wer trainiert?' : 'Anmelden', fmtDate(todayStr())));
  const grid = el('div', { class: 'member-grid' });
  members.forEach((m) => {
    grid.appendChild(el('button', { class: 'member-card', onclick: () => pickMember(m) }, [
      el('span', { class: 'member-card__avatar', style: { background: colorTint(m.color), color: safeAccent(m.color) }, text: m.emoji || '🏃' }),
      el('div', { class: 'member-card__name', text: m.name || 'Mitglied' }),
      el('div', { class: 'member-card__meta' }, [
        el('span', { class: `chip ${m.role === 'admin' ? 'chip--accent' : ''}`, text: m.role === 'admin' ? 'Admin' : 'Mitglied' }),
        store.memberHasPin(m.id) ? el('span', { class: 'member-card__lock', text: '🔒' }) : null,
      ]),
    ]));
  });
  view.appendChild(grid);
}

function pickMember(m) {
  if (!store.memberHasPin(m.id)) {
    store.login(m.id, '').then((ok) => {
      if (ok) afterLogin();
      else toast(loginErrorText(store.lastLoginError()), 'bad', 4000);
    });
    return;
  }
  openPinDialog(m);
}

/** Verständlicher Text zum Grund einer gescheiterten Anmeldung. */
export function loginErrorText(e) {
  if (!e) return 'Anmeldung fehlgeschlagen.';
  if (e.code === 'pin') return e.left ? `Falsche PIN – noch ${e.left} Versuch${e.left === 1 ? '' : 'e'}, dann folgt eine kurze Pause.` : 'Falsche PIN – nochmal versuchen.';
  if (e.code === 'locked') {
    const min = Math.max(1, Math.ceil((e.retryAfter || 900) / 60));
    return `Zu viele Fehlversuche. Bitte in etwa ${min} Minute${min === 1 ? '' : 'n'} erneut versuchen.`;
  }
  if (e.code === 'offline-first') return 'Die erste Anmeldung auf diesem Gerät braucht eine Verbindung zum Server.';
  return e.message || 'Anmeldung fehlgeschlagen.';
}

function openPinDialog(m) {
  const inp = el('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: '••••', 'aria-label': 'PIN' });
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true, text: 'Falsche PIN – nochmal versuchen.' });
  let busy = false;
  const submit = async () => {
    if (busy) return;
    busy = true;
    const ok = await store.login(m.id, inp.value);
    busy = false;
    if (ok) { closeSheet(); afterLogin(); }
    else { err.textContent = loginErrorText(store.lastLoginError()); err.hidden = false; inp.value = ''; inp.focus(); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  const body = el('div', { class: 'pin-dialog' }, [
    el('div', { class: 'pin-dialog__who' }, [
      el('span', { class: 'member-card__avatar', style: { background: colorTint(m.color), color: safeAccent(m.color) }, text: m.emoji || '🏃' }),
      el('div', { class: 'pin-dialog__name', text: m.name }),
    ]),
    inp, err,
    el('button', { class: 'btn btn--primary btn--block', onclick: submit }, [icon('check'), 'Anmelden']),
  ]);
  openSheet({ title: 'PIN eingeben', body });
  setTimeout(() => inp.focus(), 120);
}

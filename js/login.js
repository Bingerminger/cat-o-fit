/* =========================================================================
   login.js — signed-out view (route /login).
     • Empty installation -> initial setup (create admin -> demo/empty).
     • Otherwise -> profile selection (tiles + optional PIN).
   Only visible as long as nobody is signed in (see session-gate.js).
   ========================================================================= */
import * as store from './storage.js';
import { el, icon, iconSvg, navigate, openSheet, closeSheet, todayStr, fmtDate, toast, field, scopeKey, safeAccent, colorTint } from './ui.js';
import { setHeader } from './router.js';
import { APP_VERSION } from './version.js';
import { needsSetup, safeReturnTo } from './session-gate.js';

import { t, tp } from './i18n.js';

/** After a successful sign-in: to the remembered target (deep link), otherwise "Today" (FE-25). */
function afterLogin() {
  let target = null;
  try {
    target = safeReturnTo(sessionStorage.getItem(scopeKey('returnTo')));
    sessionStorage.removeItem(scopeKey('returnTo'));
  } catch { /* no sessionStorage */ }
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
  if (store.activeUserId()) { navigate('#/'); return; }   // if (store.activeUserId()) { navigate('#/'); return; }   // signed in -> dashboard
  setHeader({ title: t('login.signIn'), subtitle: '' });

  const members = store.members();
  if (members.length) { renderPicker(view, members); return; }

  // The family may just not be synced yet -> load first, then decide,
  // so that the initial setup does not appear by mistake.
  view.appendChild(hero('Cat-O-Fit', t('login.oneMoment')));
  view.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'muted', text: t('login.loadingData') })]));
  store.refreshFamily().then((m) => {
    if (!location.hash.startsWith('#/login')) return;     // if (!location.hash.startsWith('#/login')) return;     // navigated away
    if (store.activeUserId()) { navigate('#/'); return; }
    view.innerHTML = '';
    if (m.length) renderPicker(view, m);
    else renderSetup(view);                               // else renderSetup(view);                               // really empty -> initial setup
  }).catch(() => { view.innerHTML = ''; renderSetup(view); });
}

/* ----------------------------- Initial setup ---------------------------- */
function renderSetup(view) {
  const st = { name: '', pin: '', pin2: '' };
  const frame = (children) => {
    view.innerHTML = '';
    view.appendChild(hero(t('setup.welcome'), t('setup.intro')));
    // The device knew a family, but the server is empty (set up anew or reset).
    if (store.serverWasReset()) {
      view.appendChild(el('div', { class: 'card card--flat mb-3', role: 'status' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: t('setup.serverEmptyTitle') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('setup.serverEmptyText') }),
      ]));
    }
    view.appendChild(el('div', { class: 'card setup-card' }, children));
  };
  const stepLabel = (n) => el('div', { class: 'dim', style: { fontSize: '.72rem', fontWeight: '700', letterSpacing: '.04em' }, text: t('setup.step', { n }) });

  function step1() {
    const nameInp = el('input', { class: 'input', type: 'text', value: st.name, placeholder: t('setup.yourName'), maxlength: '24', autocomplete: 'off' });
    const pinInp = el('input', { class: 'input', type: 'password', inputmode: 'numeric', value: st.pin, placeholder: t('setup.pinDigits'), maxlength: '8', autocomplete: 'new-password' });
    const pin2Inp = el('input', { class: 'input', type: 'password', inputmode: 'numeric', value: st.pin2, placeholder: t('setup.repeatPin'), maxlength: '8', autocomplete: 'new-password' });
    const err = el('div', { class: 'pin-err', role: 'alert', hidden: true });
    const showErr = (msg, focusEl) => { err.textContent = msg; err.hidden = false; if (focusEl) focusEl.focus(); };
    const next = () => {
      st.name = nameInp.value.trim(); st.pin = pinInp.value.trim(); st.pin2 = pin2Inp.value.trim();
      if (!st.name) { showErr(t('setup.nameMissing'), nameInp); return; }
      // The admin PIN protects the management of all profiles – hence mandatory and not 0000.
      const problem = store.pinProblem(st.pin);
      if (problem) { showErr(problem, pinInp); return; }
      if (st.pin !== st.pin2) { showErr(t('setup.pinsDiffer'), pin2Inp); return; }
      step2();
    };
    nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pinInp.focus(); });
    pinInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pin2Inp.focus(); });
    pin2Inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    frame([
      stepLabel(1),
      el('h3', { style: { margin: '4px 0 6px' }, text: t('setup.createAdmin') }),
      el('div', { class: 'muted mb-3', style: { fontSize: '.86rem' }, text: t('setup.adminIntro') }),
      // Labels linked to the fields via field() – previously VoiceOver read only the placeholder (UI-18).
      field(t('setup.name'), nameInp),
      field('PIN', pinInp),
      field(t('setup.repeatPin'), pin2Inp),
      err,
      el('button', { class: 'btn btn--primary btn--block mt-3', onclick: next }, [icon('arrowRight'), t('common.next')]),
    ]);
    setTimeout(() => nameInp.focus(), 120);
  }

  function step2() {
    let busy = false;
    const choose = async (withDemo) => {
      if (busy) return; busy = true;
      frame([el('div', { class: 'center', style: { padding: '28px 8px' } }, [
        el('div', { class: 'muted', text: withDemo ? t('setup.loadingDemo') : t('setup.settingUp') }),
      ])]);
      try {
        const id = await store.createFirstAdmin({ name: st.name, pin: st.pin });
        if (!id) {
          // The server already has a family (another device / later pull) -> no
          // duplicate creation, instead go to the existing login/family dashboard.
          if ((store.members() || []).length) { busy = false; navigate('#/'); return; }
          const why = store.lastLoginError();
          toast(why && why.message ? why.message : t('setup.failed'), 'bad', 4000); busy = false; step1(); return;
        }
        if (withDemo) await store.seedDemo(todayStr());
      } catch (e) { toast(t('common.errorPrefix') + (e.message || e), 'bad'); }
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
      el('h3', { style: { margin: '4px 0 10px' }, text: t('setup.hello', { name: st.name }) }),
      el('div', { class: 'col gap-3' }, [
        choice('✨', t('setup.startDemo'), t('setup.startDemoText'), () => choose(true)),
        choice('📭', t('setup.startEmpty'), t('setup.startEmptyText'), () => choose(false)),
      ]),
      el('button', { class: 'btn btn--ghost btn--block mt-3', onclick: step1 }, [icon('arrowLeft'), t('common.back')]),
    ]);
  }

  step1();
}

/* ----------------------------- Profile selection ------------------------ */
function renderPicker(view, members) {
  view.appendChild(hero(members.length > 1 ? t('login.whoTrains') : t('login.signIn'), fmtDate(todayStr())));
  const grid = el('div', { class: 'member-grid' });
  members.forEach((m) => {
    grid.appendChild(el('button', { class: 'member-card', onclick: () => pickMember(m) }, [
      el('span', { class: 'member-card__avatar', style: { background: colorTint(m.color), color: safeAccent(m.color) }, text: m.emoji || '🏃' }),
      el('div', { class: 'member-card__name', text: m.name || t('account.member') }),
      el('div', { class: 'member-card__meta' }, [
        el('span', { class: `chip ${m.role === 'admin' ? 'chip--accent' : ''}`, text: m.role === 'admin' ? t('account.admin') : t('account.member') }),
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

/** Understandable text for the reason a sign-in failed. */
export function loginErrorText(e) {
  if (!e) return t('login.failed');
  if (e.code === 'pin') return e.left ? tp('login.wrongPinLeft', e.left) : t('login.wrongPinRetry');
  if (e.code === 'locked') {
    const min = Math.max(1, Math.ceil((e.retryAfter || 900) / 60));
    return tp('login.locked', min);
  }
  if (e.code === 'offline-first') return t('login.firstNeedsServer');
  return e.message || t('login.failed');
}

function openPinDialog(m) {
  const inp = el('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: '••••', 'aria-label': 'PIN' });
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true, text: t('login.wrongPinRetry') });
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
    el('button', { class: 'btn btn--primary btn--block', onclick: submit }, [icon('check'), t('login.signIn')]),
  ]);
  openSheet({ title: t('login.enterPin'), body });
  setTimeout(() => inp.focus(), 120);
}

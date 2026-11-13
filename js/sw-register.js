/* =========================================================================
   sw-register.js — service worker (app shell available offline) + reliable updates.
   Problem without this: an app installed as a home-screen PWA kept showing the
   old version after a new release. Solution:
    - updateViaCache:'none' -> the SW script itself is never served
      from the HTTP cache, so a new release is detected.
    - regular reg.update() -> even long-open PWAs check for updates.
    - controllerchange -> the new SW (skipWaiting+claim) takes over; reload the page
      ONCE so that the new shell (JS/CSS) runs immediately. Do not reload on the
      very first install (there was no controller before).
   ========================================================================= */

/** Registers the service worker. The environment is passed in for the tests; resolves with the
    registration (null without support or on failure). */
export function registerServiceWorker({
  serviceWorker = globalThis.navigator?.serviceWorker,
  doc = globalThis.document,
  win = globalThis.window,
  reload = () => globalThis.location.reload(),
} = {}) {
  if (!serviceWorker) return Promise.resolve(null);
  const hadController = !!serviceWorker.controller;
  let reloaded = false;
  serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    reload();
  });
  let swReg = null;
  // When returning to the foreground (tab switch, reactivation of the PWA,
  // bfcache) check for a new release IMMEDIATELY – otherwise a paused
  // PWA shows the old version until the 30-minute timer or a manual close. If
  // update() finds a new SW, it takes over (skipWaiting+claim) and controllerchange
  // reloads once -> fresh shell.
  const checkUpdate = () => { if (doc.visibilityState !== 'hidden') swReg?.update?.(); };
  const register = async () => {
    try {
      swReg = await serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
      swReg.update?.();
      setInterval(checkUpdate, 30 * 60 * 1000)?.unref?.();   // unref: Node (tests) does not wait for it
      doc.addEventListener('visibilitychange', checkUpdate);
      win.addEventListener('focus', checkUpdate);
      win.addEventListener('pageshow', checkUpdate);
      return swReg;
    } catch { return null; /* SW is optional – the app also runs without it */ }
  };
  // The app starts asynchronously (catalogs, store): by the time it gets here the page has usually
  // finished loading, and a `load` listener would never fire (v4.0–4.1: no service worker at all).
  if (doc.readyState === 'complete') return register();
  return new Promise((resolve) => { win.addEventListener('load', () => register().then(resolve), { once: true }); });
}

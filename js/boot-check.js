/* =========================================================================
   boot-check.js — start-up diagnosis: turns a "white page" into an explaining
   message when the ES modules do not run (common on servers: wrong MIME type
   for .js or a missing file).
   Deliberately a CLASSIC script (not a module) and its own file instead of
   inline code, so the Content Security Policy needs no 'unsafe-inline'.
   It cannot rely on the translation catalogs (they may be the thing that failed),
   so it carries its two texts itself: German for German browsers, else English.
   ========================================================================= */
(function () {
  var nav = typeof navigator !== 'undefined' ? navigator : {};
  var de = /^de\b/i.test((nav.languages && nav.languages[0]) || nav.language || '');
  var T = de ? {
    couldNotLoad: 'Konnte nicht laden: ', error: 'Fehler: ', unknown: 'unbekannt',
    title: 'Die App konnte nicht starten',
    crashed: 'Das Programm wurde geladen, brach aber beim Start ab. Bitte die Seite neu laden; bleibt es so, hilft die Meldung unten weiter.',
    notRun: 'Die App-Seite wurde geladen, aber der Programmcode (JavaScript) wurde <b>nicht ausgeführt</b>. Auf einem Server (z. B. Synology) sind die häufigsten Ursachen:',
    mime: '<b>Falscher Dateityp (MIME):</b> Die <code>.js</code>-Dateien müssen als <code>text/javascript</code> ausgeliefert werden. Die mitgelieferte <code>.htaccess</code> stellt das für Apache ein; bei Nginx im Web-Station-Profil den MIME-Typ für <code>js</code> ergänzen.',
    missing: '<b>Fehlende Datei:</b> Beim Hochladen <u>alle</u> Dateien übertragen, auch die Ordner <code>js/</code> und <code>locales/</code>.',
    technical: 'Technische Meldung:', reload: 'Neu laden',
  } : {
    couldNotLoad: 'Could not load: ', error: 'Error: ', unknown: 'unknown',
    title: 'The app could not start',
    crashed: 'The program was loaded but stopped while starting. Please reload the page; if it stays like this, the message below helps.',
    notRun: 'The app page was loaded, but its program code (JavaScript) did <b>not run</b>. On a server (e.g. Synology) the most common causes are:',
    mime: '<b>Wrong file type (MIME):</b> the <code>.js</code> files must be served as <code>text/javascript</code>. The included <code>.htaccess</code> sets this for Apache; with Nginx add the MIME type for <code>js</code> in the Web Station profile.',
    missing: '<b>Missing file:</b> upload <u>all</u> files, including the <code>js/</code> and <code>locales/</code> folders.',
    technical: 'Technical message:', reload: 'Reload',
  };
  var errs = [];
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
      errs.push(T.couldNotLoad + (e.target.src || e.target.href || ''));
    } else if (e && e.message) { errs.push(e.message); }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    errs.push(T.error + ((e.reason && e.reason.message) || e.reason || T.unknown));
  });
  window.addEventListener('load', function () {
    setTimeout(function check() {
      if (window.__catofitBooted) return;                    // app is running – all good
      var view = document.getElementById('view');
      if (view && view.children.length) return;              // it did render after all
      var ranScript = !!window.__catofitModuleLoaded;
      // Program loaded and no error yet: it is just slow (e.g. a weak network) –
      // no error page, look again later (FE-08; it used to show after 8 s regardless).
      if (ranScript && !errs.length) { setTimeout(check, 4000); return; }
      var esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
      var box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;inset:0;padding:24px;max-width:680px;margin:0 auto;font:15px/1.55 -apple-system,system-ui,sans-serif;background:#fff;color:#1a1a1a;overflow:auto;z-index:99999');
      box.innerHTML =
        '<h2 style="margin:0 0 10px">' + T.title + '</h2>'
        + (ranScript
          ? '<p>' + T.crashed + '</p>'
          : '<p>' + T.notRun + '</p><ul style="padding-left:1.2em"><li>' + T.mime + '</li><li>' + T.missing + '</li></ul>')
        + (errs.length ? '<p style="margin-top:14px"><b>' + T.technical + '</b></p><pre style="white-space:pre-wrap;background:#f3f3f3;padding:10px;border-radius:8px;font-size:13px">' + esc(errs.join('\n')) + '</pre>' : '')
        + '<p style="margin-top:14px"><button type="button" style="padding:10px 18px;border:0;border-radius:10px;background:#18b48a;color:#fff;font-weight:600;font-size:15px">' + T.reload + '</button></p>';
      var btn = box.querySelector('button');
      if (btn) btn.addEventListener('click', function () { location.reload(); });
      document.body.appendChild(box);
      // If the app starts after all, the message disappears again.
      var watch = setInterval(function () {
        if (window.__catofitBooted) { clearInterval(watch); if (box.parentNode) box.parentNode.removeChild(box); }
      }, 1000);
    }, 8000);
  });
})();

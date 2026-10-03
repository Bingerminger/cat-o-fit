/* =========================================================================
   boot-check.js — Diagnose beim Start: macht aus einer „weißen Seite“ eine
   erklärende Meldung, falls die ES-Module nicht ausgeführt werden (häufig auf
   Servern: falscher MIME-Typ für .js oder eine fehlende Datei).
   Bewusst ein KLASSISCHES Skript (kein Modul) und eine eigene Datei statt Inline-
   Code, damit die Content-Security-Policy ohne 'unsafe-inline' auskommt.
   ========================================================================= */
(function () {
  var errs = [];
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
      errs.push('Konnte nicht laden: ' + (e.target.src || e.target.href || ''));
    } else if (e && e.message) { errs.push(e.message); }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    errs.push('Fehler: ' + ((e.reason && e.reason.message) || e.reason || 'unbekannt'));
  });
  window.addEventListener('load', function () {
    setTimeout(function check() {
      if (window.__catofitBooted) return;                    // App läuft – alles gut
      var view = document.getElementById('view');
      if (view && view.children.length) return;              // hat doch gerendert
      var ranScript = !!window.__catofitModuleLoaded;
      // Programm geladen, noch kein Fehler: Es startet nur langsam (z. B. schwaches Netz) –
      // keine Fehlerseite, später erneut schauen (FE-08; vorher nach 8 s immer die Fehlerseite).
      if (ranScript && !errs.length) { setTimeout(check, 4000); return; }
      var esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
      var box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;inset:0;padding:24px;max-width:680px;margin:0 auto;font:15px/1.55 -apple-system,system-ui,sans-serif;background:#fff;color:#1a1a1a;overflow:auto;z-index:99999');
      box.innerHTML =
        '<h2 style="margin:0 0 10px">Die App konnte nicht starten</h2>'
        + (ranScript
          ? '<p>Das Programm wurde geladen, brach aber beim Start ab. Bitte die Seite neu laden; bleibt es so, hilft die Meldung unten weiter.</p>'
          : '<p>Die App-Seite wurde geladen, aber der Programmcode (JavaScript) wurde <b>nicht ausgeführt</b>. Auf einem Server (z. B. Synology) sind die häufigsten Ursachen:</p>'
            + '<ul style="padding-left:1.2em">'
            + '<li><b>Falscher Dateityp (MIME):</b> Die <code>.js</code>-Dateien müssen als <code>text/javascript</code> ausgeliefert werden. Die mitgelieferte <code>.htaccess</code> stellt das für Apache ein; bei Nginx im Web-Station-Profil den MIME-Typ für <code>js</code> ergänzen.</li>'
            + '<li><b>Fehlende Datei:</b> Beim Hochladen <u>alle</u> Dateien im Ordner <code>js/</code> übertragen (auch neue wie <code>exercises.js</code>, <code>goals.js</code>, <code>sha256.js</code>).</li>'
            + '</ul>')
        + (errs.length ? '<p style="margin-top:14px"><b>Technische Meldung:</b></p><pre style="white-space:pre-wrap;background:#f3f3f3;padding:10px;border-radius:8px;font-size:13px">' + esc(errs.join('\n')) + '</pre>' : '')
        + '<p style="margin-top:14px"><button type="button" style="padding:10px 18px;border:0;border-radius:10px;background:#18b48a;color:#fff;font-weight:600;font-size:15px">Neu laden</button></p>';
      var btn = box.querySelector('button');
      if (btn) btn.addEventListener('click', function () { location.reload(); });
      document.body.appendChild(box);
      // Startet die App doch noch, verschwindet die Meldung wieder.
      var watch = setInterval(function () {
        if (window.__catofitBooted) { clearInterval(watch); if (box.parentNode) box.parentNode.removeChild(box); }
      }, 1000);
    }, 8000);
  });
})();

## Was ändert dieser PR?
<!-- Kurze Zusammenfassung der Änderung und des Motivs. -->

## Art der Änderung
- [ ] 🐛 Bugfix
- [ ] ✨ Neue Funktion
- [ ] 🧹 Refactoring / Aufräumen
- [ ] 📖 Dokumentation
- [ ] 🔒 Sicherheit

## Checkliste
- [ ] `npm test` und die PHP-Tests (`php tools/test-*.php`) laufen grün
- [ ] Neue/angepasste Logik ist durch Tests abgedeckt
- [ ] Bei veröffentlichter Änderung: `js/version.js` **und** `package.json` angehoben
      und `service-worker.js` (`VERSION`) gebumpt
- [ ] Neue Daten-Area? In `js/storage.js` (`AREAS`) **und** `api/storage.php`
      (`user_areas`) eingetragen
- [ ] `CHANGELOG.md` und ggf. `docs/ROADMAP.md`, die Seiten unter `docs/` und die In-App-Hilfe (`js/helpcontent.js`) aktualisiert
- [ ] Datenschutz gewahrt: private Bereiche (Zyklus, Labor, Ergänzung) bleiben privat
- [ ] Keine neuen externen Abhängigkeiten / kein Build-Schritt eingeführt

## Test-Hinweise
<!-- Wie wurde getestet? Geräte/Ansichten? -->

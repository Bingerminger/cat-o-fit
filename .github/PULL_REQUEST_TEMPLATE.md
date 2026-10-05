## What does this PR change?
<!-- A short summary of the change and the reason for it. -->

## Type of change
- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 🧹 Refactoring / clean-up
- [ ] 📖 Documentation
- [ ] 🔒 Security

## Checklist
- [ ] `npm test` and the PHP tests (`php tools/test-*.php`) pass
- [ ] New/changed logic is covered by tests
- [ ] For a released change: `js/version.js` **and** `package.json` raised
      and `service-worker.js` (`VERSION`) bumped
- [ ] New data area? Added to `js/storage.js` (`AREAS`) **and** `api/storage.php`
      (`user_areas`)
- [ ] `CHANGELOG.md` and, where relevant, `docs/ROADMAP.md`, the pages under `docs/` and the in-app help (`js/helpcontent.js`, `locales/*/help.json`) updated
- [ ] Privacy preserved: private areas (cycle, labs, supplements) stay private
- [ ] No new external dependencies / no build step introduced

## Testing notes
<!-- How was it tested? Which devices/views? -->

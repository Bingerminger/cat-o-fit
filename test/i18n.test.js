import test from 'node:test';
import assert from 'node:assert/strict';
import {
  t, tp, tList, has, locale, setLocale, register, matchLanguage, resolveLanguage, languages, onLocaleChange,
} from '../js/i18n.js';
import { fmtDate, fmtDateLong, fmtDayMonth, fmtDayMonthNumeric, fmtWeekday, fmtNum, fmtKm, fmtDec, fmtInt, monthName } from '../js/format.js';

test('languages.json lists the seven languages by their own names', () => {
  assert.deepEqual(Object.keys(languages()), ['en', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl']);
  assert.equal(languages()['pt-BR'], 'Português (Brasil)');
});

test('matchLanguage: exact, by base language, or nothing', () => {
  assert.equal(matchLanguage('de-AT'), 'de');
  assert.equal(matchLanguage(['zh-CN', 'en-US']), 'en');
  assert.equal(matchLanguage('pt-PT'), 'pt-BR');
  assert.equal(matchLanguage('pt_br'), 'pt-BR');
  assert.equal(matchLanguage(['zh-CN', 'ja']), null);
  assert.equal(matchLanguage(null), null);
});

test('resolveLanguage: person, then instance, then German for old instances, then browser, then English', () => {
  assert.equal(resolveLanguage({ person: 'fr', instance: 'de', legacy: true, browser: 'nl' }), 'fr');
  assert.equal(resolveLanguage({ person: null, instance: 'es', legacy: true, browser: 'nl' }), 'es');
  assert.equal(resolveLanguage({ person: 'xx', instance: null, legacy: true, browser: 'nl' }), 'de');
  assert.equal(resolveLanguage({ legacy: false, browser: ['nl-BE', 'en'] }), 'nl');
  assert.equal(resolveLanguage({ browser: 'ja' }), 'en');
  assert.equal(resolveLanguage(), 'en');
});

test('tests run in German; t() fills placeholders and returns unknown keys unchanged', () => {
  assert.equal(locale(), 'de');
  assert.equal(t('settings.language.label'), 'Sprache');
  assert.equal(t('settings.language.instance', { language: 'Deutsch' }), 'Wie die Instanz (Deutsch)');
  assert.equal(t('settings.language.instance'), 'Wie die Instanz ({language})');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(has('settings.language.label'), true);
  assert.equal(has('no.such.key'), false);
  assert.equal(tList('format.weekdaysShort').length, 7);
});

test('a key missing in the active language falls back to English', () => {
  register('en', 'health', { probe: { only: 'Only in {lang}' } });
  try {
    assert.equal(t('health.probe.only', { lang: 'English' }), 'Only in English');
  } finally { register('en', 'health', undefined); }
});

test('tp() picks the plural form and formats the count for the language', async () => {
  register('en', 'health', { probe: { days: { one: '{count} day', other: '{count} days' } } });
  register('de', 'health', { probe: { days: { one: '{count} Tag', other: '{count} Tage' } } });
  try {
    assert.equal(tp('health.probe.days', 1), '1 Tag');
    assert.equal(tp('health.probe.days', 1234), '1.234 Tage');
    await setLocale('en');
    assert.equal(tp('health.probe.days', 1), '1 day');
    assert.equal(tp('health.probe.days', 2), '2 days');
  } finally {
    await setLocale('de');
    register('en', 'health', undefined); register('de', 'health', undefined);
  }
});

test('German formats stay exactly as before v4.0.0', () => {
  assert.equal(fmtDate('2026-07-18'), 'Sa, 18. Juli');
  assert.equal(fmtDate('2026-09-01'), 'Di, 1. Sept.');
  assert.equal(fmtDateLong('2026-07-18'), 'Samstag, 18. Juli 2026');
  assert.equal(fmtDayMonth('2026-03-05'), '5. März');
  assert.equal(fmtDayMonthNumeric('2026-08-26'), '26.08.');
  assert.equal(fmtWeekday('2026-07-19'), 'So');
  assert.equal(fmtWeekday('2026-07-19', true), 'Sonntag');
  assert.equal(monthName(11), 'Dezember');
  assert.equal(monthName(11, false), 'Dez.');
  assert.equal(fmtNum(7.25, 1), '7,3');
  assert.equal(fmtNum(1234.5, 1), '1234,5');
  assert.equal(fmtKm(21.0975, 2), '21,10 km');
  assert.equal(fmtDec(7.5), '7,5');
  assert.equal(fmtInt(1234567), '1.234.567');
  assert.equal(fmtInt(-1234.4), '-1.234');
  assert.equal(fmtInt(null), '–');
});

test('other languages: names, patterns and separators from their catalogs', async () => {
  const seen = [];
  const off = onLocaleChange((l) => seen.push(l));
  try {
    await setLocale('en');
    assert.equal(fmtDate('2026-07-18'), 'Sat 18 Jul');
    assert.equal(fmtDateLong('2026-07-18'), 'Saturday 18 July 2026');
    assert.equal(fmtNum(7.25, 1), '7.3');
    assert.equal(fmtInt(1234567), '1,234,567');
    assert.equal(fmtDayMonthNumeric('2026-08-26'), '26/08');
    await setLocale('pt-BR');
    assert.equal(fmtDate('2026-07-18'), 'sáb., 18 de jul.');
    assert.equal(fmtDateLong('2026-07-18'), 'sábado, 18 de julho de 2026');
    assert.equal(fmtKm(5, 1), '5,0 km');
    await setLocale('fr');
    assert.equal(fmtDayMonth('2026-08-02'), '2 août');
    assert.match(fmtInt(12345), /^12\s345$/u);
    await setLocale('nl');
    assert.equal(fmtDate('2026-03-01'), 'zo 1 mrt');
    assert.deepEqual(seen, ['en', 'pt-BR', 'fr', 'nl']);
  } finally {
    off();
    await setLocale('de');
  }
});

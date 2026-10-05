import { t } from './i18n.js';
/* =========================================================================
   labsources.js — Woher bekomme ich als Sportler:in meine Laborwerte?
   Reine Daten, DOM-frei – von der Labor-Ansicht und der In-App-Hilfe genutzt,
   damit beide dieselbe Auskunft geben.

   Bezug: Deutschland. Kosten und Kassenleistungen sind Anhaltspunkte und können
   sich ändern; verbindlich ist immer die Auskunft der eigenen Krankenkasse bzw.
   der Praxis.
   ========================================================================= */

/** Wege zu einem Laborbefund – vom naheliegendsten zum ergänzenden. */
export const LAB_SOURCES = [
  {
    key: 'sportmedizin',
    get title() { return t('labSources.sportsMedicine.title'); },
    best: true,
    get what() { return t('labSources.sportsMedicine.what'); },
    get cost() { return t('labSources.sportsMedicine.cost'); },
    get tip() { return t('labSources.sportsMedicine.tip'); },
  },
  {
    key: 'hausarzt',
    get title() { return t('labSources.gp.title'); },
    get what() { return t('labSources.gp.what'); },
    get cost() { return t('labSources.gp.cost'); },
    get tip() { return t('labSources.gp.tip'); },
  },
  {
    key: 'checkup',
    get title() { return t('labSources.checkup.title'); },
    get what() { return t('labSources.checkup.what'); },
    get cost() { return t('labSources.checkup.cost'); },
    get tip() { return t('labSources.checkup.tip'); },
  },
  {
    key: 'einsendelabor',
    get title() { return t('labSources.mailInLab.title'); },
    get what() { return t('labSources.mailInLab.what'); },
    get cost() { return t('labSources.mailInLab.cost'); },
    get tip() { return t('labSources.mailInLab.tip'); },
  },
  {
    key: 'blutspende',
    get title() { return t('labSources.bloodDonation.title'); },
    get what() { return t('labSources.bloodDonation.what'); },
    get cost() { return t('labSources.bloodDonation.cost'); },
    get tip() { return t('labSources.bloodDonation.tip'); },
  },
];

/** Was in Deutschland genormt ist – und was ausdrücklich nicht. */
export const LAB_STANDARDS = {
  get regulated() { return [
    t('labSources.standards.rilibaek'),
    t('labSources.standards.isoAccreditation'),
    t('labSources.standards.dataExchange'),
  ]; },
  get notRegulated() { return [
    t('labSources.standards.referenceRanges'),
    t('labSources.standards.sportRanges'),
  ]; },
};

/** Kurzfassung für die Anzeige im leeren Modul. */
export const labSourcesTeaser = () =>
  t('labSources.teaser');

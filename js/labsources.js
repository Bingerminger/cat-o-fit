import { t } from './i18n.js';
/* =========================================================================
   labsources.js — Where do athletes get their lab values?
   Plain data, DOM-free – used by the labs view and the in-app help so that
   both give the same answer.

   Scope: Germany. Costs and insurance coverage are rough guides and may change;
   what counts is always the information from your own health insurer or the
   practice.
   ========================================================================= */

/** Routes to a lab report – from the most obvious to the supplementary. */
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

/** What is standardised in Germany – and what explicitly is not. */
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

/** Short version for display in the empty module. */
export const labSourcesTeaser = () =>
  t('labSources.teaser');

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
    title: 'Sportmedizinische Untersuchung',
    best: true,
    what: 'Der eigentlich passende Weg: Ärztin oder Arzt mit der Zusatzbezeichnung Sportmedizin, oft an sportmedizinischen Instituten, Unikliniken oder in größeren Praxen. Meist Blutbild, Eisenstatus, Leber- und Nierenwerte – häufig zusammen mit einer Leistungsdiagnostik.',
    cost: 'etwa 100–300 €',
    tip: 'Viele gesetzliche Krankenkassen bezuschussen den Sportcheck als freiwillige Satzungsleistung – oft rund 100–150 € alle ein bis zwei Jahre. Das wissen die wenigsten: Einfach vorher bei deiner Kasse nachfragen.',
  },
  {
    key: 'hausarzt',
    title: 'Haus- oder Facharztpraxis',
    what: 'Auf Kassenkosten nur bei medizinischer Indikation – also bei Beschwerden oder einem konkreten Verdacht. „Ferritin, weil ich viel laufe" ist keine Indikation; das läuft dann als Selbstzahlerleistung (IGeL) nach der Gebührenordnung für Ärzte.',
    cost: 'Kasse bei Indikation, sonst etwa 20–60 €',
    tip: 'Wenn du ohnehin wegen etwas anderem Blut abgeben musst: frag, ob die für dich interessanten Werte gleich mitbestimmt werden können.',
  },
  {
    key: 'checkup',
    title: 'Check-up 35 (gesetzliche Vorsorge)',
    what: 'Einmalig zwischen 18 und 34, danach alle drei Jahre. Enthält Cholesterin, Blutzucker und Urinstatus – aber weder Ferritin noch Vitamin D.',
    cost: 'Kassenleistung',
    tip: 'Gut als Basis-Check, deckt die sportrelevanten Werte aber nur teilweise ab.',
  },
  {
    key: 'einsendelabor',
    title: 'Einsende- und Selbstzahlerlabore',
    what: 'Testkits für zu Hause (Kapillarblut aus der Fingerbeere) oder Selbstzahler-Angebote klassischer Labore mit venöser Blutentnahme.',
    cost: 'etwa 30–150 €',
    tip: 'Kapillarblut ist empfindlicher in der Vorbereitung als eine venöse Blutentnahme. Für Verlaufsvergleiche möglichst beim selben Verfahren und Labor bleiben.',
  },
  {
    key: 'blutspende',
    title: 'Blutspende',
    what: 'Bei jeder Spende wird der Hämoglobinwert bestimmt; manche Spendedienste messen bei regelmäßigen Spenderinnen und Spendern zusätzlich das Ferritin.',
    cost: 'kostenlos',
    tip: 'Regelmäßiges Spenden senkt die Eisenspeicher spürbar – als Ausdauersportler:in lohnt der Blick aufs Ferritin besonders.',
  },
];

/** Was in Deutschland genormt ist – und was ausdrücklich nicht. */
export const LAB_STANDARDS = {
  regulated: [
    'Die **RiliBÄK** (Richtlinie der Bundesärztekammer) ist für alle deutschen Labore verbindlich und regelt die Qualitätssicherung samt Ringversuchen.',
    'Viele Labore sind zusätzlich nach **DIN EN ISO 15189** akkreditiert.',
    'Für die Übermittlung an Praxen gibt es **LDT** als deutschen Standard, international **HL7 FHIR**. Über die **elektronische Patientenakte (ePA)** kommen Befunde zunehmend digital bei den Versicherten an.',
  ],
  notRegulated: [
    '**Referenzbereiche sind nicht bundesweit einheitlich.** Jedes Labor gibt eigene an – abhängig von Messmethode, Gerät und Referenzkollektiv. Bei Ferritin, fT3 oder Vitamin B12 unterscheiden sie sich deutlich. Deshalb steht der Bereich immer auf dem Befund: Er gehört zum Wert dazu.',
    '**Sportspezifische Referenzwerte gibt es offiziell nicht.** Was Cat-O-Fit als Sport-Zielkorridor zeigt, stammt aus sportmedizinischer Fachliteratur und internationalen Positionspapieren – nicht aus einer deutschen Norm.',
  ],
};

/** Kurzfassung für die Anzeige im leeren Modul. */
export const LAB_SOURCES_TEASER =
  'Die meisten Werte bekommst du über eine sportmedizinische Untersuchung (von vielen Kassen bezuschusst), über die Hausarztpraxis oder über ein Einsendelabor.';

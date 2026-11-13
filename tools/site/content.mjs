/* =========================================================================
   content.mjs — the texts of the project site (built by tools/build-site.mjs).

   English at the site root, German under de/. Every factual statement carries a claim id (`c`);
   tools/site/claims.md says what each one claims and where it is backed, and
   `node tools/build-site.mjs --check` fails when a page uses an id the register lacks, the register
   has a row no page uses, or English and German back different ids.

   Numbers in braces come from the code at build time, never typed:
   {exercises} (js/exercises.js), {people} (MAX_MEMBERS in js/storage.js), {languages}
   (locales/languages.json). Images are copied from docs/assets/<lang>/ when the site is built.
   ========================================================================= */

/** Where each language lives, relative to the site root. */
export const PAGE_PATHS = { en: '', de: 'de/' };
export const SITE_URL = 'https://bingerminger.github.io/cat-o-fit/';
export const REPO_URL = 'https://github.com/Bingerminger/cat-o-fit';

export const TEXT = {
  en: {
    htmlLang: 'en',
    ogLocale: 'en_GB',
    title: 'Cat-O-Fit – the self-hosted training planner for the whole family',
    description: 'Periodized plans and load management with nutrition, cycle and lab values in context. No subscription, no account, on your own hardware. Try the demo in your browser.',
    banner: { file: 'banner.png', alt: 'Cat-O-Fit – training planning for the whole family' },
    skip: 'Skip to content',
    nav: { demo: 'Demo', install: 'Install', docs: 'Documentation', github: 'GitHub', other: 'Deutsch', otherLabel: 'Diese Seite auf Deutsch' },
    hero: {
      tagline: { c: 'tagline', t: 'The subscription-free, self-hosted training planner for the whole family.' },
      lead: { c: 'context', t: 'Periodized plans and load management with nutrition, cycle and lab values in context – on your own hardware, without an account.' },
      demo: 'Try the demo',
      demoNote: { c: 'demo-browser', t: 'The demo runs in your browser and saves nothing.' },
      install: 'Install it',
      image: { file: 'ipad-01-dashboard.png', alt: '“Today” on an iPad: countdown, today\'s session, coach and load & form' },
    },
    featuresTitle: 'What it does',
    features: [
      {
        id: 'plans', h: 'Plans that fit',
        points: [
          { c: 'plans', t: 'Periodized race plans from 5 km to the marathon, or programmes without a race – set up by level and running days, volume starting from your history.' },
          { c: 'plans-today', t: 'Recalculated from today without touching the past; club sessions are fixed appointments the plan works around.' },
          { c: 'plans-beta', t: 'Triathlon and Hyrox plans are in beta.' },
        ],
        image: { file: '04-plan.png', alt: 'Training plan with phases' },
      },
      {
        id: 'load', h: 'Load you can read',
        points: [
          { c: 'load', t: 'Session-RPE load (minutes × effort) across all sports, an acute:chronic ratio and fitness, fatigue and form.' },
          { c: 'coach', t: 'One coach recommendation per day, with its “why” – and no injury-prevention promises.' },
        ],
        image: { file: '45-load-form.png', alt: '“Load & form” card on “Today”' },
      },
      {
        id: 'strength', h: 'Follow along',
        points: [
          { c: 'exercises', t: '{exercises} animated exercises to follow along in time.' },
          { c: 'non-stop', t: 'Or play a whole session hands-free like a workout video, with music on the beat and recorded voice cues.' },
          { c: 'strength-import', t: 'Your strength history comes along from Strong, Hevy or FitNotes.' },
        ],
        image: { file: '40-exercises.png', alt: 'Exercise library' },
      },
      {
        id: 'family', h: 'For the whole family',
        points: [
          { c: 'family', t: 'Up to {people} people with their own goals and plans, teams, a shared dashboard and admins who can plan for kids.' },
          { c: 'private', t: 'Cycle, lab values and supplements stay private – also on the server, which hands them out only after that person\'s PIN sign-in.' },
        ],
        image: { file: '51-team-dashboard.png', alt: 'Team/family dashboard with team badges' },
      },
      {
        id: 'health', h: 'Health in context',
        points: [
          { c: 'health-import', t: 'Body values from Apple Health or Android Health Connect, activity files from your watch (GPX, TCX, FIT) – even a whole Garmin or Strava export.' },
          { c: 'labs', t: 'Lab values judged against your lab\'s reference range plus a sports corridor, cycle-aware planning and an energy-availability estimate.' },
          { c: 'not-diagnosis', t: 'For documentation and general information – not a diagnosis.' },
        ],
        image: { file: '60-labs.png', alt: 'Labs & supplements: energy availability and overview of values' },
      },
      {
        id: 'kitchen', h: 'Kitchen included',
        points: [
          { c: 'kitchen', t: 'Recipes, calorie balance, a food diary with barcode lookup and a shared shopping list with pantry.' },
        ],
        image: { file: '32-family-shopping.png', alt: 'Shared shopping list' },
      },
    ],
    yours: {
      h: 'Truly yours',
      points: [
        { c: 'own-server', t: 'JSON files on your own server – no database, no account, no telemetry.' },
        { c: 'offline', t: 'Offline-first on every device, installable from the browser as an app.' },
        { c: 'languages', t: '{languages} languages, one per person: {languageList}.' },
        { c: 'units', t: 'Units per person: kilometres or miles, kilograms or pounds, °C or °F, the first day of the week, lab values in SI or conventional units.' },
        { c: 'open-source', t: 'Open source under the AGPL-3.0-or-later, without third-party dependencies.' },
      ],
    },
    install: {
      h: 'Install',
      lead: { c: 'docker', t: 'One container for amd64 and arm64 – or any web server with PHP 8.1 or newer.' },
      after: 'Then open http://localhost:8080: a setup wizard creates the first admin and can load a demo family.',
      guide: 'Installation guide',
      security: { c: 'home-network', t: 'Built for your own, trusted network. Reachable from the internet, it needs a sign-in in front (VPN, a reverse proxy with login, or the built-in Basic Auth) and HTTPS.' },
    },
    limits: {
      h: 'Good to know',
      points: [
        { c: 'pwa', t: 'A web app you install from the browser – not an app from the App Store or Google Play.' },
        { c: 'no-cloud', t: 'No direct connection to the Garmin or Strava cloud: activities come as files or exports.' },
        { c: 'translations', t: 'French, Spanish, Italian, Portuguese and Dutch were machine-translated and checked against the app, but not yet by native speakers.' },
      ],
    },
    demoLangs: 'The demo in your language:',
    footer: {
      docs: 'Documentation', roadmap: 'Roadmap', changelog: 'Changelog', security: 'Security',
      licence: 'Licence (AGPL-3.0-or-later)', support: 'Support the project',
      privacy: { c: 'site-privacy', t: 'This page sets no cookies, stores nothing and loads nothing from other servers.' },
    },
    notFound: { h: 'Page not found', text: 'This address does not exist here.', home: 'To the start page', demo: 'to the demo' },
  },

  de: {
    htmlLang: 'de',
    ogLocale: 'de_DE',
    title: 'Cat-O-Fit – der selbst gehostete Trainingsplaner für die ganze Familie',
    description: 'Periodisierte Pläne und Belastungssteuerung mit Ernährung, Zyklus und Laborwerten im Zusammenhang. Ohne Abo, ohne Konto, auf eigener Hardware. Probier die Demo im Browser aus.',
    banner: { file: 'banner.de.png', alt: 'Cat-O-Fit – Trainingsplanung für die ganze Familie' },
    skip: 'Zum Inhalt',
    nav: { demo: 'Demo', install: 'Installieren', docs: 'Dokumentation', github: 'GitHub', other: 'English', otherLabel: 'This page in English' },
    hero: {
      tagline: { c: 'tagline', t: 'Der abofreie, selbst gehostete Trainingsplaner für die ganze Familie.' },
      lead: { c: 'context', t: 'Periodisierte Pläne und Belastungssteuerung mit Ernährung, Zyklus und Laborwerten im Zusammenhang – auf eigener Hardware, ohne Konto.' },
      demo: 'Demo ausprobieren',
      demoNote: { c: 'demo-browser', t: 'Die Demo läuft in deinem Browser und speichert nichts.' },
      install: 'Installieren',
      image: { file: 'ipad-01-dashboard.png', alt: '„Heute“ auf dem iPad: Countdown, Einheit des Tages, Coach sowie Belastung & Form' },
    },
    featuresTitle: 'Was es kann',
    features: [
      {
        id: 'plans', h: 'Pläne, die passen',
        points: [
          { c: 'plans', t: 'Periodisierte Wettkampfpläne von 5 km bis zum Marathon oder Programme ohne Rennen – eingerichtet nach Niveau und Lauftagen, der Umfang beginnt bei deiner Vorgeschichte.' },
          { c: 'plans-today', t: 'Neu berechnet ab heute, ohne die Vergangenheit anzufassen; Vereinstrainings sind feste Termine, um die der Plan herum plant.' },
          { c: 'plans-beta', t: 'Pläne für Triathlon und Hyrox sind in der Beta.' },
        ],
        image: { file: '04-plan.png', alt: 'Trainingsplan mit Phasen' },
      },
      {
        id: 'load', h: 'Belastung, die man lesen kann',
        points: [
          { c: 'load', t: 'Belastung nach Session-RPE (Minuten × Anstrengung) über alle Sportarten, ein Verhältnis akut zu chronisch sowie Fitness, Ermüdung und Form.' },
          { c: 'coach', t: 'Eine Coach-Empfehlung pro Tag, mit ihrem „Warum“ – und ohne Versprechen, Verletzungen zu verhindern.' },
        ],
        image: { file: '45-load-form.png', alt: 'Karte „Belastung & Form“ auf „Heute“' },
      },
      {
        id: 'strength', h: 'Mitmachen',
        points: [
          { c: 'exercises', t: '{exercises} animierte Übungen zum Mitmachen im Takt.' },
          { c: 'non-stop', t: 'Oder eine ganze Einheit am Stück abspielen wie ein Workout-Video, mit Musik im Takt und eingesprochenen Ansagen.' },
          { c: 'strength-import', t: 'Deine Kraft-Historie kommt aus Strong, Hevy oder FitNotes mit.' },
        ],
        image: { file: '40-exercises.png', alt: 'Übungs-Bibliothek' },
      },
      {
        id: 'family', h: 'Für die ganze Familie',
        points: [
          { c: 'family', t: 'Bis zu {people} Personen mit eigenen Zielen und Plänen, Teams, ein gemeinsames Dashboard und Admins, die für Kinder planen können.' },
          { c: 'private', t: 'Zyklus, Laborwerte und Ergänzungen bleiben privat – auch auf dem Server, der sie nur nach der PIN-Anmeldung dieser Person herausgibt.' },
        ],
        image: { file: '51-team-dashboard.png', alt: 'Team/Familie-Dashboard mit Team-Abzeichen' },
      },
      {
        id: 'health', h: 'Gesundheit im Zusammenhang',
        points: [
          { c: 'health-import', t: 'Körperwerte aus Apple Health oder Android Health Connect, Aktivitätsdateien deiner Uhr (GPX, TCX, FIT) – sogar ein ganzer Garmin- oder Strava-Export.' },
          { c: 'labs', t: 'Laborwerte gegen den Referenzbereich deines Labors und einen Sportkorridor bewertet, zyklusbewusste Planung und eine Schätzung der Energieverfügbarkeit.' },
          { c: 'not-diagnosis', t: 'Zur Dokumentation und allgemeinen Information – keine Diagnose.' },
        ],
        image: { file: '60-labs.png', alt: 'Labor & Ergänzung: Energieversorgung und Werte-Übersicht' },
      },
      {
        id: 'kitchen', h: 'Küche inklusive',
        points: [
          { c: 'kitchen', t: 'Rezepte, Kalorienbilanz, ein Ernährungstagebuch mit Barcode-Suche und eine gemeinsame Einkaufsliste mit Vorrat.' },
        ],
        image: { file: '32-family-shopping.png', alt: 'Gemeinsame Einkaufsliste' },
      },
    ],
    yours: {
      h: 'Wirklich deins',
      points: [
        { c: 'own-server', t: 'JSON-Dateien auf deinem eigenen Server – keine Datenbank, kein Konto, keine Telemetrie.' },
        { c: 'offline', t: 'Offline-first auf jedem Gerät, aus dem Browser als App installierbar.' },
        { c: 'languages', t: '{languages} Sprachen, eine je Person: {languageList}.' },
        { c: 'units', t: 'Einheiten je Person: Kilometer oder Meilen, Kilogramm oder Pfund, °C oder °F, der erste Tag der Woche, Laborwerte in SI- oder konventionellen Einheiten.' },
        { c: 'open-source', t: 'Open Source unter der AGPL-3.0-or-later, ohne Abhängigkeiten von Dritten.' },
      ],
    },
    install: {
      h: 'Installieren',
      lead: { c: 'docker', t: 'Ein Container für amd64 und arm64 – oder ein beliebiger Webserver mit PHP 8.1 oder neuer.' },
      after: 'Dann http://localhost:8080 öffnen: Ein Einrichtungsassistent legt die erste Admin-Person an und kann eine Demo-Familie laden.',
      guide: 'Installationsanleitung',
      security: { c: 'home-network', t: 'Gebaut für dein eigenes, vertrauenswürdiges Netz. Aus dem Internet erreichbar braucht es eine Anmeldung davor (VPN, ein Reverse Proxy mit Login oder das eingebaute Basic Auth) und HTTPS.' },
    },
    limits: {
      h: 'Gut zu wissen',
      points: [
        { c: 'pwa', t: 'Eine Web-App, die du aus dem Browser installierst – keine App aus dem App Store oder von Google Play.' },
        { c: 'no-cloud', t: 'Keine direkte Verbindung zur Garmin- oder Strava-Cloud: Aktivitäten kommen als Datei oder Export.' },
        { c: 'translations', t: 'Französisch, Spanisch, Italienisch, Portugiesisch und Niederländisch sind maschinell übersetzt und gegen die App geprüft, aber noch nicht von Muttersprachlern.' },
      ],
    },
    demoLangs: 'Die Demo in deiner Sprache:',
    footer: {
      docs: 'Dokumentation', roadmap: 'Roadmap', changelog: 'Changelog', security: 'Sicherheit',
      licence: 'Lizenz (AGPL-3.0-or-later)', support: 'Das Projekt unterstützen',
      privacy: { c: 'site-privacy', t: 'Diese Seite setzt keine Cookies, speichert nichts und lädt nichts von anderen Servern.' },
    },
    notFound: { h: 'Seite nicht gefunden', text: 'Diese Adresse gibt es hier nicht.', home: 'Zur Startseite', demo: 'zur Demo' },
  },
};

/** Links per language: the German pages point to the German documentation where it exists. */
export const LINKS = {
  en: {
    docs: `${REPO_URL}/blob/main/docs/README.md`,
    install: `${REPO_URL}/blob/main/docs/operations/installation.md`,
    roadmap: `${REPO_URL}/blob/main/docs/ROADMAP.md`,
  },
  de: {
    docs: `${REPO_URL}/blob/main/docs/de/README.md`,
    install: `${REPO_URL}/blob/main/docs/de/operations/installation.md`,
    roadmap: `${REPO_URL}/blob/main/docs/de/ROADMAP.md`,
  },
  common: {
    github: REPO_URL,
    changelog: `${REPO_URL}/blob/main/CHANGELOG.md`,
    security: `${REPO_URL}/blob/main/SECURITY.md`,
    licence: `${REPO_URL}/blob/main/LICENSE`,
    support: 'https://buymeacoffee.com/bingerminger',
  },
};

/** The command of the install section (as in the README's quick start). */
export const DOCKER_RUN = `docker run -d --name cat-o-fit -p 8080:80 \\
  -v cat-o-fit-data:/var/www/html/data \\
  -e TZ=Europe/Berlin \\
  ghcr.io/bingerminger/cat-o-fit:latest`;

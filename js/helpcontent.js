/* =========================================================================
   helpcontent.js — Inhalte der In-App-Hilfe als reine Daten (DOM-frei).
   help.js rendert sie; Tests prüfen sie gegen Routen, Handbuch und Oberfläche.
   Jeder Artikel hat eine stabile ID – adressierbar als #/hilfe/<id> und über
   die ⓘ-Knöpfe an den Kennzahlen (infoButton in ui.js).
   ========================================================================= */

import { LAB_SOURCES, LAB_STANDARDS } from './labsources.js';

/** labsources.js hebt Begriffe mit **…** hervor – die Hilfe zeigt reinen Text. */
const plain = (s) => String(s).replace(/\*\*/g, '');

/* -------------------------------------------------------------------------
   Inhalte. Jeder Artikel hat eine ID, eine Frage/Überschrift (q) und einen
   Body aus Blöcken: {p}=Absatz, {steps}=Schritte, {tip}=Hinweis,
   {link}=Verknüpfung. Optional `aliases` (Suchbegriffe und Synonyme, werden
   nicht angezeigt). `name` ist der Anzeigename der aktiven Person – ohne Namen
   spricht die Hilfe neutral an.
   ------------------------------------------------------------------------- */
export function helpSections(name = '') {
  const hi = name ? `, ${name}` : '';
  return [
    {
      id: 'start', title: 'Erste Schritte', icon: 'sparkles',
      articles: [
        {
          id: 'willkommen',
          q: `Willkommen${hi}!`,
          body: [
            { p: `Cat-O-Fit plant und begleitet dein Training${hi} – für dich und deine ganze Familie. Du verfolgst damit deine Ziele – einen Zielwettkampf oder ein Trainingsprogramm ohne Wettkampf (Fitness, Kraft, Abnehmen, Beweglichkeit): Du legst dein Ziel an, bekommst dafür einen Plan, trainierst – und siehst Schritt für Schritt deinen Fortschritt.` },
            { p: 'Jede Änderung speichert die App sofort auf deinem Gerät und gleicht sie mit eurem eigenen Server oder NAS ab – ohne Verbindung einfach später, auch mitten im Training.' },
            { tip: 'Du kannst die App auf den Home-Bildschirm legen (Teilen-Symbol in Safari → „Zum Home-Bildschirm“). Dann startet sie wie eine echte App im Vollbild.' },
          ],
        },
        {
          id: 'aufbau',
          q: 'Wie ist alles aufgebaut?',
          body: [
            { p: 'Cat-O-Fit trennt klar zwischen Planung und Ausführung:' },
            { steps: [
              'Ziel – ein Wettkampf (z. B. dein Halbmarathon) oder ein Trainingsprogramm ohne Wettkampf.',
              'Trainingsplan – automatisch in Phasen bis zum Wettkampf bzw. über die Programmdauer.',
              'Geplante Einheiten – im Kalender, verschiebbar.',
              'Durchgeführte Trainings – das, was du tatsächlich gemacht hast (Soll-Ist).',
            ] },
            { link: { label: 'Zu „Heute“', hash: '#/' } },
          ],
        },
        {
          id: 'anmelden',
          q: 'Anmelden, wechseln & abmelden',
          aliases: ['Login', 'PIN', 'Abmelden', 'Gemeinsames Gerät'],
          body: [
            { p: 'Beim allerersten Start richtet ein kurzer Assistent die App ein: zuerst die Admin-Person mit eigener PIN anlegen (4 bis 8 Ziffern, nicht 0000), dann Demodaten laden oder leer starten. Danach zeigt Cat-O-Fit abgemeldet nur die Anmeldung – die Menüs erscheinen erst danach.' },
            { steps: [
              'Tippe auf deine Kachel und gib deine PIN ein. Der Server prüft sie; nach fünf Fehlversuchen folgt eine kurze Pause.',
              'Profil wechseln gibt es nicht separat: einfach abmelden – du landest direkt wieder bei der Anmeldung.',
              'Abmelden: am iPhone über „Mehr“ (oben bei deinem Namen), am iPad und Mac unten in der Seitenleiste – oder in Einstellungen → Konto.',
            ] },
            { tip: 'Neu laden hält dich angemeldet; erst das Schließen der App bzw. des Tabs meldet ab. Auf einem gemeinsam genutzten iPad deshalb immer „Abmelden“ tippen – oder in Einstellungen → Konto „Gemeinsames Gerät“ einschalten: Dann räumt das Abmelden alle persönlichen Daten vom Gerät.' },
            { tip: 'Ohne Serververbindung kannst du dich nur auf einem Gerät anmelden, auf dem du dich schon einmal online angemeldet hast. Zyklus, Labor und Ergänzungen gleicht die App erst ab, wenn der Server deine Anmeldung bestätigt hat – bis dahin bleibt alles sicher auf dem Gerät. Fehlt die Bestätigung (etwa nach einem Update), fragt die App einmal nach deiner PIN.' },
            { p: 'Der Menüpunkt „Team/Familie“ ist eure gemeinsame Übersicht mit Team-Abzeichen. Die Verwaltung (Mitglieder anlegen, Rollen, Teams) liegt unter Mehr → „Team verwalten“ und ist nur für Admins sichtbar; „App zurücksetzen“ steht ganz unten in den Einstellungen.' },
          ],
        },
      ],
    },
    {
      id: 'usecases', title: 'So erreichst du dein Ziel', icon: 'target',
      articles: [
        {
          id: 'diagramme',
          q: 'Werte aus einem Diagramm ablesen',
          body: [
            { p: 'Jedes Verlaufsdiagramm gibt dir konkrete Zahlen – du musst nicht schätzen, was die Kurve gerade zeigt.' },
            { steps: [
              'Fahre mit dem Finger (oder am Rechner mit der Maus) über das Diagramm.',
              'Eine Führungslinie springt zum nächstgelegenen Messpunkt, eine kleine Blase zeigt Datum und Wert.',
              'Bei mehreren Kurven – etwa Fitness, Ermüdung und Form – siehst du alle drei Werte desselben Tages gleichzeitig.',
              'Am Rechner geht es auch per Tastatur: mit den Pfeiltasten wandern, mit Escape schließen.',
            ] },
            { tip: 'Die Y-Achse zeigt runde Orientierungswerte mit dünnen Hilfslinien – so erkennst du den Bereich schon auf einen Blick, ohne das Diagramm anzufassen.' },
          ],
        },
        {
          id: 'belastung-pruefen',
          q: 'Prüfen, ob deine Belastung noch gesund ist',
          body: [
            { p: 'Die Karte „Belastung & Form“ auf „Heute“ beantwortet drei Fragen – in Klartext statt in Fachbegriffen.' },
            { steps: [
              'Steigerst du zu schnell? Das Lastverhältnis vergleicht deine letzten 7 Tage mit dem Schnitt der drei Wochen davor (ACWR). 1,3 heißt „30 % mehr als gewohnt“; zwischen 0,8 und 1,3 bist du nah an deinem Schnitt.',
              'Bist du erholt? Fitness minus Ermüdung ergibt deine Form – eingeordnet relativ zur Fitness: frisch, ausgeglichen, im Training oder deutlich ermüdet. Bewertet erst ab rund drei Monaten Daten.',
              'Trainierst du zu gleichförmig? Ein Hinweis kommt nur, wenn sich deine Trainingstage stark ähneln und die Woche deutlich über deinem Schnitt liegt; Spazierengehen und Mobility zählen dabei nicht.',
            ] },
            { tip: 'Die Grenzen sind eine Orientierung aus Beobachtungsdaten im Teamsport – kein Verletzungsbarometer und kein Schutzversprechen. In den ersten vier Wochen sagt die Karte ehrlich „Datenbasis wächst noch“. Kraft, Fußball und Radfahren zählen genauso mit wie Laufen; die Werte sind Belastungspunkte (AU = Minuten × Anstrengung).' },
          ],
        },
        {
          id: 'wettkampf-anlegen',
          q: 'Einen Wettkampf anlegen und den Plan erstellen',
          body: [
            { steps: [
              'Öffne „Ziele“ und tippe auf „+“ → wähle „Wettkampf“.',
              'Gib Name, Datum, Distanz und Zielzeit ein und wähle die Priorität: A – Saisonhöhepunkt, B – wichtiger Wettkampf, C – Vorbereitungs- oder Spaßrennen.',
              'Speichern – du landest auf der Ziel-Seite.',
              'Tippe auf „Plan erstellen“ und wähle Niveau (Einsteiger, Fortgeschritten, Leistung), Lauftage pro Woche (3–6) und ob es feste Termine gibt (z. B. Vereinstraining) – standardmäßig keine.',
              'Cat-O-Fit verteilt die Wochen in die Phasen Grundlage → Aufbau → Spitze → Tapering: Umfang ab deinem aktuellen Stand, höchstens 8–12 % mehr je Woche, jede 4. Woche leichter, der Long Run gedeckelt, die Renneinheit an deinem Wettkampftag – egal welcher Wochentag.',
            ] },
            { tip: `Die Zielpaces leitet Cat-O-Fit aus deiner Zielzeit ab – du musst nichts rechnen${hi}. Ist die Zielzeit sehr ambitioniert oder die Vorbereitung knapp, sagt die App es ehrlich und nennt Alternativen.` },
            { p: 'Laufende Pläne lassen sich über ↻ „Ab heute aktualisieren“ mit der aktuellen Planlogik neu berechnen – alles vor heute bleibt, wie es ist.' },
            { link: { label: 'Zu deinen Zielen', hash: '#/events' } },
          ],
        },
        {
          id: 'programm-starten',
          q: 'Ein Trainingsprogramm ohne Wettkampf starten',
          body: [
            { p: 'Du willst einfach fit, kräftig oder gesünder werden – ohne Wettkampf? Dann lege ein Trainingsprogramm an.' },
            { steps: [
              'Öffne „Ziele“ und tippe auf „+“ → wähle „Trainingsprogramm“.',
              'Wähle einen Schwerpunkt: Allgemeine Fitness, Kraft & Muskelaufbau, Abnehmen & Gewicht oder Beweglichkeit & Gesundheit.',
              'Lege Trainingstage pro Woche (3–5) und die Dauer (4, 8 oder 12 Wochen) fest.',
              'Speichern & Plan erstellen – der Wochenplan steht sofort.',
            ] },
            { tip: 'Die Ausdauer steigt Woche für Woche bis in den WHO-Bereich (ab 150 Minuten, Gehen zählt mit), dazu Kraft an zwei Tagen – von der Eingewöhnung bis zu schwereren Varianten. Jede 4. Woche ist leichter. Mit „Plan ab heute neu erstellen“ erzeugst du die kommenden Wochen frisch; Erledigtes bleibt.' },
            { link: { label: 'Zu deinen Zielen', hash: '#/events' } },
          ],
        },
        {
          id: 'training-durchfuehren',
          q: 'Ein Training durchführen',
          body: [
            { steps: [
              'Tippe auf dem Dashboard oder im Kalender auf die heutige Einheit.',
              'Du siehst das Soll (Distanz, Zielpace, HF-Zone). Tippe „Training starten“.',
              'Im Workout-Modus läuft die Uhr; bei Intervallen führt dich Cat-O-Fit mit Ton durch Einlaufen, Belastung, Pause und Auslaufen – mit Zielpace und HF-Zone der Phase.',
              'Am Ende „Beenden“ → Distanz, Anstrengung (RPE) und Gefühl eintragen → fertig. Verwerfen ohne Speichern fragt noch einmal nach.',
            ] },
            { tip: 'Bei langen Läufen erinnert dich Cat-O-Fit automatisch ans Trinken. Auf dem iPhone: Bildschirm nicht sperren (sonst pausieren die Signale, die Zeit läuft aber richtig weiter), Stummschalter aus – vibrieren kann Safari nicht.' },
          ],
        },
        {
          id: 'training-nachtragen',
          q: 'Ein Training ohne Uhr nachtragen',
          body: [
            { p: 'Du bist ohne Handy gelaufen oder hast es vergessen? Kein Problem.' },
            { steps: [
              'Öffne die Einheit (Dashboard, Kalender oder Plan).',
              'Tippe „Als erledigt erfassen“.',
              'Trage ein, was du weißt (Distanz, Zeit, Gefühl) – alles ist optional.',
            ] },
            { tip: 'Der Soll-Ist-Vergleich ist ehrlich: Ein lockerer Lauf deutlich zu schnell gilt nicht als „erreicht“; Intervalle werden nicht über den Schnitt der ganzen Einheit bewertet.' },
          ],
        },
        {
          id: 'training-ohne-plan',
          q: 'Ein Training ohne Plan erfassen',
          body: [
            { p: 'Spontane Radtour, Lauf am Ruhetag oder Training ganz ohne Ziel – auch das gehört ins Trainingstagebuch.' },
            { steps: [
              'Auf „Heute“ „Training erfassen“ tippen – oder im Kalender (Woche) auf das „+“ im Tageskopf.',
              'Sportart, Datum, Dauer, Distanz, Herzfrequenz und Anstrengung eintragen.',
              'Passt eine geplante Einheit desselben Tages, bietet die App an, das Training ihr zuzuordnen.',
            ] },
            { tip: 'Freie Trainings stehen im Kalender, auf „Heute“ und in der Statistik unter „Trainings ohne Plan“ – dort öffnen, bearbeiten oder löschen. Importierte Trainings (Apple Health, GPX/TCX) schlägt „Heute“ zum Zuordnen vor.' },
          ],
        },
        {
          id: 'einheit-verschieben',
          q: 'Eine Einheit verschieben, ohne die Woche zu sprengen',
          aliases: ['Verschieben', 'Drag & Drop', 'What-if', 'Morgen', 'Übermorgen'],
          body: [
            { p: 'Etwas kommt dazwischen – das ist normal. Wichtig ist, dass die Woche danach noch aufgeht.' },
            { steps: [
              'Einheit öffnen → „Verschieben“: „Morgen“, „Übermorgen“ oder „Nächster freier Tag“ mit einem Tipp – oder ein Datum wählen.',
              'Im Kalender (Woche) geht es auch per Ziehen: die Einheit am Griff (⠿) halten und auf einen anderen Tag ziehen.',
              'Cat-O-Fit prüft sofort: Liegt dort schon etwas? Steht am Tag davor oder danach eine fordernde Einheit (Tempo, Intervalle, Kraft, Long Run)? Darunter siehst du die Auswirkung auf die Wochenbelastung – vorher und nachher.',
              'Bestätige, wenn es passt. Die Einheit trägt danach den Vermerk „Verschoben“; das Ziehen im Kalender lässt sich per „Rückgängig“ zurücknehmen.',
            ] },
            { tip: 'Die Hinweise blockieren nichts – du verschiebst trotzdem, wenn du willst. Die verschobene Einheit zählt weiter in Wochenbelastung und Wochen-Check mit.' },
            { link: { label: 'Zum Kalender', hash: '#/calendar' } },
          ],
        },
        {
          id: 'einheiten-anpassen',
          q: 'Einheiten anpassen, ergänzen oder aufholen',
          body: [
            { p: 'Dein Plan gehört dir – passe ihn an, wann immer du willst.' },
            { steps: [
              'Öffne eine Einheit und tippe oben aufs Stift-Symbol: Art, Zielpace, HF-Zone, Intervallstruktur, Distanz und Beschreibung sind editierbar.',
              'Über das „+“ im Trainingsplan legst du eine ganz neue Einheit an – mit großer Auswahl an Sportarten: Schwimmen, Wandern, Rudern, Tennis, Badminton, Squash, Tischtennis, Indoor-Cycling, Crosstrainer, Gerätetraining und mehr.',
              'Im Bearbeiten-Dialog kannst du eine Einheit auch löschen.',
            ] },
            { tip: 'Legst du eine Einheit selbst an und liegt in derselben Woche schon eine ähnlich intensive, bietet Cat-O-Fit an, diese aus dem Plan zu nehmen – so bleibt die Wochenbelastung konstant. Du entscheidest: „Aus Plan nehmen“ oder „Beide behalten“.' },
            { tip: 'Hat sich für eine Woche etwas grundlegend geändert (z. B. Saisonstart, Trainingslager)? In der Wochenübersicht des Plans berechnet „Diese Woche neu berechnen“ nur diese eine Woche frisch – bereits erledigte Trainings bleiben erhalten.' },
            { tip: 'Verpasst? Vergangene, offene Einheiten erscheinen als „überfällig“. Im Dashboard erinnert dich ein Hinweis ans Verschieben, Nachtragen oder Abhaken.' },
            { tip: 'Hast du eine Schlüsseleinheit (Tempo, Intervalle, Long Run, Kraft) als verpasst markiert, bietet das Dashboard an, sie auf einen freien Tag der nächsten Woche nachzuholen – statt sie verfallen zu lassen.' },
          ],
        },
        {
          id: 'koerperwerte',
          q: 'Deine Körperwerte pflegen',
          body: [
            { steps: [
              'Tippe auf „＋ Erfassen“ → „Körperwerte“ (oder Fortschritt → Körper → „+“).',
              'Trage z. B. Gewicht, Ruhepuls oder Schlaf ein – nur was du möchtest.',
              'Die Verläufe zeigen deinen Trend mit Y-Skala, beim Gewicht mit Ziellinie.',
              '„Muskelmasse“ ist der Wert einer Körperanalyse-Waage; die „fettfreie Masse“ (Lean Body Mass, z. B. aus Apple Health) ist deutlich höher und fließt in die Energieversorgung ein.',
              'HRV mit Messart: Apple speichert SDNN, viele Uhren und Ringe zeigen RMSSD. Die Zahlen sind nicht vergleichbar – Verlauf, Ziele und Bereitschaft vergleichen nur Werte derselben Messart.',
            ] },
            { tip: 'Genauer Wert gefällig? Zieh den Finger über ein Diagramm (am Rechner: Maus darüber) – eine Führungslinie springt zum nächsten Punkt und zeigt Datum + Wert.' },
            { tip: 'Die Darstellung ist bewusst wertfrei: Es geht um den Trend, nicht um tägliche Schwankungen. Einzelne Werte kannst du in den Einstellungen ausblenden.' },
            { link: { label: 'Zu den Körperwerten', hash: '#/health' } },
          ],
        },
        {
          id: 'apple-health',
          q: 'Apple Health übernehmen: automatisch oder kostenlos per Datei',
          aliases: ['Health Auto Export', 'Apple Watch', 'Import', 'Kurzbefehle', 'Garmin', 'Withings'],
          body: [
            { p: `Deine Quellen (Garmin, Apple Watch, Withings …) schreiben nach Apple Health. Von dort kommen die wichtigsten Werte zu Cat-O-Fit${hi} – Gewicht, Ruhepuls, HRV, VO₂max, Schlaf, Schritte, aktive Energie und Workouts. Es gibt drei Wege:` },
            { steps: [
              'Automatisch per „Health Auto Export – JSON+CSV“ (App Store): Die App selbst ist kostenlos, die nötige automatische Übertragung (REST-API) gibt es aber nur mit Premium – laut App Store etwa 8 € im Jahr oder 30 € einmalig. Einrichtung: In Cat-O-Fit unter Health-Import „Auto-Import aktivieren“ und die Endpunkt-URL kopieren; in Health Auto Export unter Automations → + → „REST API“ die URL einfügen, Methode POST, Format JSON (Export-Version 2), Metriken + Workouts wählen, Aggregation „Daily“, Zeitraum „Since last sync“ → speichern → „Run now“.',
              'Kostenlos und automatisch per Kurzbefehl: Mit der Apple-App „Kurzbefehle“ lassen sich Gesundheitswerte lesen und an dieselbe Adresse schicken – die Anleitung steht in der Doku (Apple Health). Ob die Automation bei gesperrtem iPhone zuverlässig läuft, hängt von iOS ab.',
              'Kostenlos von Hand: iPhone → Health-App → Profilbild → „Alle Gesundheitsdaten exportieren“ und die ZIP unter Health-Import hochladen (Voll-Import). Einzelne Aufzeichnungen als GPX- oder TCX-Datei (Garmin, Strava …) gehen ebenfalls – mit Sportart, Bewegungszeit, Kilometer-Splits und Zeit in HF-Zonen.',
            ] },
            { tip: 'Eine zusätzliche Anmeldung („Authorization“-Header) brauchst du nur, falls deine Instanz hinter einer vorgeschalteten Anmeldung liegt – die eingebaute Basic-Auth des Containers lässt den Health-Eingang ohnehin durch. Kontrolle: In Health-Import zeigt „Zuletzt importiert“ die übernommenen Tageswerte; manuelle Einträge bleiben erhalten, doppelte Workouts werden erkannt.' },
            { link: { label: 'Zum Health-Import', hash: '#/import' } },
          ],
        },
        {
          id: 'health-connect',
          q: 'Android: Werte aus Health Connect übernehmen',
          aliases: ['Android', 'Google Fit', 'Samsung Health', 'HC Webhook', 'Pixel Watch', 'Galaxy Watch'],
          body: [
            { p: 'Auf Android sammelt Health Connect die Werte deiner Uhr und Apps. Webseiten können dort nicht lesen – eine kleine Brücken-App auf dem Gerät schickt die Daten deshalb an Cat-O-Fit, etwa das quelloffene „HC Webhook“.' },
            { steps: [
              'In Cat-O-Fit unter Health-Import „Auto-Import aktivieren“ und Endpunkt-URL und Schlüssel kopieren.',
              'In der Brücken-App die URL als Webhook-Adresse eintragen und den Schlüssel als Header „X-Catofit-Token“ mitschicken (geht das nicht: „&token=<Schlüssel>“ an die Adresse hängen).',
              'Datentypen freigeben: Gewicht, Körperfett, fettfreie Masse, Ruhepuls, HRV, Schlaf, Schritte, aktive Kalorien, Trainings und Herzfrequenz. Den Zyklus nur, wenn du ihn übernehmen möchtest – er bleibt privat.',
            ] },
            { tip: 'Doppelt geschickte Tage und Trainings erkennt Cat-O-Fit. Die HRV aus Health Connect ist RMSSD und wird getrennt von Apple-Werten (SDNN) ausgewertet.' },
            { link: { label: 'Zum Health-Import', hash: '#/import' } },
          ],
        },
        {
          id: 'erinnerungen',
          q: 'Erinnerungen aufs iPhone bekommen',
          body: [
            { p: 'Der zuverlässigste Weg auf iPhone/iPad ist der native Kalender.' },
            { steps: [
              'Öffne eine Einheit oder den Plan und tippe auf das Export-Symbol.',
              'Wähle „Kompletter Plan“, „Diese Einheit“ oder „Nur Wettkampf“.',
              'Die .ics-Datei öffnet sich im iOS-Kalender – inklusive Erinnerung 1 Std. vorher und am Vorabend.',
            ] },
          ],
        },
        {
          id: 'fortschritt',
          q: 'Deinen Fortschritt verstehen',
          body: [
            { p: 'Unter „Statistik“ siehst du auf einen Blick, wo du stehst – ganz oben die Ampel „Bin ich auf Plan?“.' },
            { steps: [
              'Ampel (grün/gelb/rot): fasst Einhaltung, Last und Ausfälle der letzten 4 Wochen zusammen – mit Begründung.',
              'Plan-Einhaltung: wie viele fällige Einheiten du im 4-Wochen-Fenster erledigt hast.',
              'Wochenumfang & Trainingslast: deine Belastung im Verlauf (7 vs. 28 Tage).',
              'Ausgefallene Einheiten: nach Grund – verletzungs-/krankheitsbedingte zählen nicht gegen dich.',
              'Werte & Ziele: Gewicht, Umfang, Tempo, Ruhepuls & VO₂max mit Trendpfeil und „halten/verbessern“.',
              'Trainingsjahr: eine Heatmap der letzten 12 Monate (wie bei GitHub) – je dunkler ein Tag, desto mehr Trainingszeit.',
              'Wettkampfprognose: eine grobe Schätzung deiner möglichen Zeit.',
            ] },
            { link: { label: 'Zur Statistik', hash: '#/stats' } },
          ],
        },
      ],
    },
    {
      id: 'views', title: 'Die Bereiche im Überblick', icon: 'grid',
      articles: [
        { id: 'navigation', q: 'Navigation', body: [{ p: 'Unten (iPhone) bzw. links (iPad, Mac): Heute · Kalender · ＋ Erfassen · Fortschritt · Mehr. „＋ Erfassen“ ist der feste Platz für Training, Körperwerte, Mahlzeit, Laborwert, Periode und Checklisten-Punkt. „Fortschritt“ bündelt Training (Statistik), Körper, Erfolge und Berichte als Reiter. „Mehr“ ist nach Themen gegliedert und zeigt oben, wer angemeldet ist – beim Verwalten eines Mitglieds mit „Zurück zu mir“.' }] },
        { id: 'heute', q: 'Heute (Dashboard)', body: [{ p: 'Dein Startbildschirm für den Tag: heutige Einheit (der ▶ startet sie direkt), Countdown zum nächsten Wettkampf, ein Coach-Hinweis (weitere aufklappbar), Belastung & Form, Wochenüberblick und deine Wochen- und Gesundheitsziele. Ab Querformat am iPad oder Mac in zwei Spalten.' }, { link: { label: 'Öffnen', hash: '#/' } }] },
        { id: 'kalender', q: 'Kalender', body: [{ p: 'Monats- und Wochenansicht aller geplanten Einheiten und freien Trainings. In der Woche kannst du per Ziehen verschieben. Jeder Eintrag führt zur Einheit.' }, { link: { label: 'Öffnen', hash: '#/calendar' } }] },
        { id: 'ziele', q: 'Ziele & Pläne', aliases: ['Wettkampf', 'Programm', 'Event', 'Priorität'], body: [{ p: 'Deine Wettkämpfe und Trainingsprogramme an einem Ort – anlegen, bearbeiten, Plan erstellen. Wettkämpfe mit Countdown und Priorität (A – Saisonhöhepunkt, B – wichtig, C – Vorbereitung), Programme mit Schwerpunkt und Trainingstagen pro Woche.' }, { link: { label: 'Öffnen', hash: '#/events' } }] },
        { id: 'trainingsplan', q: 'Trainingsplan', body: [{ p: 'Der Plan eines Wettkampfs oder Programms: Phasen-Zeitstrahl, Eckdaten (Niveau, Lauftage, Zielpaces), Wochenübersicht und alle Einheiten. Über „…“ oben aktualisierst du ihn ab heute, legst feste Termine fest oder exportierst ihn in den Kalender.' }] },
        { id: 'einheit-ansicht', q: 'Einheit (Ansicht)', aliases: ['Session', 'Auswertung', 'Soll-Ist'], body: [{ p: 'Eine einzelne Einheit in drei Zuständen: geplant (Soll, unten „Starten · Erledigt erfassen“), in Ausführung (Workout-Modus) und absolviert (Auswertung mit Soll-Ist-Vergleich; aus GPX/TCX auch Splits und Zeit in HF-Zonen).' }] },
        { id: 'workout-modus', q: 'Workout-Modus', body: [{ p: 'Vollbild fürs Training: große Bedienelemente, Stoppuhr bzw. Intervall-Steuerung mit Zielpace und HF-Zone je Phase, Satz-Zähler mit Pausen-Countdown fürs Krafttraining, Trinkpausen-Erinnerung.' }] },
        { id: 'fortschritt-koerper', q: 'Fortschritt → Körper', body: [{ p: 'Deine Körperwerte als Trends mit Y-Skala und Zielmarkierung – nach Datum gezeichnet, Zeitraum 3 Monate, 1 Jahr oder alles; lange Reihen als Wochenmittel. Finger oder Maus übers Diagramm zeigt Datum + Wert. Erfassen, bearbeiten, importieren.' }, { link: { label: 'Öffnen', hash: '#/health' } }] },
        { id: 'fortschritt-training', q: 'Fortschritt → Training', body: [{ p: 'Ampel „Bin ich auf Plan?“, Plan-Einhaltung, Wochenumfang, Trainingsjahr-Heatmap, Trainingslast, ausgefallene Einheiten nach Grund, Einheiten-Verteilung, Werte & Ziele (halten/verbessern), Wettkampfprognose sowie aktuelle Form und Trainingsbereiche.' }, { link: { label: 'Öffnen', hash: '#/stats' } }] },
        { id: 'erfolge', q: 'Fortschritt → Erfolge', aliases: ['Abzeichen', 'Badges', 'Momentum'], body: [{ p: 'Dein Momentum (Schwung) und alle Abzeichen mit Fortschritt – erreichte farbig, offene mit Fortschrittsbalken.' }, { link: { label: 'Öffnen', hash: '#/badges' } }] },
        { id: 'uebungen', q: 'Übungs-Bibliothek', aliases: ['Übungen', 'Animation', 'Mitmachen'], body: [
          { p: '93 Übungen für Kraft, Rumpf, Beweglichkeit, Kondition und Prävention – jede als Animation im Takt der Ausführung, dazu Schritt-für-Schritt-Anleitung, Muskelgruppen, Equipment, Schwierigkeit, Tipp, Steigerung und Vorsichtshinweis. Darunter u. a. Hyrox-Übungen wie Wall Ball und Kettlebell-Swing, Rücken-/Hüft-Dehnungen und Präventionsübungen für Laufen und Fußball (Nordic Hamstring, Copenhagen, Aufwärmen nach FIFA 11+). Fußballtermine schlagen sie direkt vor.' },
          { steps: [
            'Oben nach Kategorie (Kraft/Rumpf/Beweglichkeit/Kondition) UND nach Körperregion (Rücken, Hüfte, Bauch, Beine, Oberkörper) filtern – oder im Textfeld suchen.',
            'Übung antippen: Die Figur zeigt die Bewegung im Takt der Ausführung, die arbeitenden Muskeln sind farbig hervorgehoben.',
            'Wiederholungen (bei Halteübungen Sekunden) und Sätze einstellen, dann „Mitmachen“: Die Animation zählt Sätze und Wiederholungen, zeigt Technik-Hinweis und Atmung, hält die Pausen und zeigt den Seitenwechsel. „Langsam“ hilft beim Lernen, „Ton“ gibt den Takt hörbar vor.',
            'Am Ende zählt die Übung als gemacht – oder du zählst im Detail per „Gemacht (+1)“ hoch. Auch eine erledigte Trainingseinheit zählt ihre Übungen automatisch.',
            'In Kraft- und Mobility-/Regenerations-Einheiten stehen die Übungen aus der Beschreibung oben („im Plan“), danach Vorschläge nach deiner Nutzungshäufigkeit. Mit „+“ hängst du eine Übung an die Einheit.',
          ] },
          { p: 'Die Animationen sind bewusst schematisch und ersetzen keine individuelle Anleitung.' },
          { link: { label: 'Öffnen', hash: '#/uebungen' } },
        ] },
        { id: 'durchgehend', q: 'Durchgehend mitmachen – mit Musik und Ansagen', aliases: ['Workout', 'Workouts', 'Musik', 'Ansagen', 'Video', 'Session', 'Am Stück'], body: [
          { p: 'Eine ganze Einheit am Stück – wie ein Video zum Mitmachen: Die Vorturnerin macht jede Übung im Takt vor, dazwischen Pause mit Vorschau, Seitenwechsel und Rundenpause. Gedacht fürs iPad oder Handy auf dem Boden; du musst nichts antippen.' },
          { steps: [
            'Starten: in einer Kraft- oder Mobility-Einheit „Durchgehend mitmachen“ – die Mengen kommen aus der Beschreibung („12×“, „30 s/Seite“, „3 Runden“) – oder in der Übungs-Bibliothek unter „Workouts“ eines aus dem Katalog wählen (Suche und Filter nach Kraft, Rumpf, Beweglichkeit, Kondition, Laufen & Fußball).',
            'In der Übersicht Runden und Pause einstellen, Musik und Ansagen wählen, dann „Los geht’s“.',
            'Musik: ein Beat passend zur Übung, jede Bewegung auf dem Beat; in Pausen leiser. „Eigene Musik“ lässt z. B. Spotify weiterlaufen – dafür darf das Gerät nicht auf lautlos stehen.',
            'Ansagen kommen in den Pausen (nächste Übung, Seitenwechsel). In der Übung führen Töne: drei Töne vor dem Einsatz, die letzten drei Wiederholungen bzw. Sekunden ticken, ein Doppelton bei „noch 10 Sekunden“, ein tiefer Ton zum Ende.',
            'Antippen zeigt die Bedienleiste: Pause, zurück, weiter, Musik und Ansagen an/aus, beenden. Die Abschnittsleiste springt per Antippen.',
            'Am Ende zählen alle Übungen als gemacht; aus einer Plan-Einheit heraus erfasst „Als erledigt erfassen“ sie gleich mit der Dauer.',
          ] },
          { tip: 'Kein Ton? Lautstärke hochstellen. Mit „Musik“ klingt es auch, wenn das Gerät auf lautlos steht; bei „Eigene Musik“ nicht.' },
          { link: { label: 'Workouts öffnen', hash: '#/uebungen' } },
        ] },
        { id: 'laborwerte-woher', q: 'Woher bekomme ich meine Laborwerte?', body: [
          { p: 'In Deutschland führen mehrere Wege zu einem Befund – sie unterscheiden sich vor allem darin, wer zahlt und wie sportnah die Auswahl der Werte ist.' },
          // Eine Quelle für Labor-Ansicht und Hilfe (DOC-12): labsources.js.
          { steps: LAB_SOURCES.map((s) => `${s.title}${s.best ? ' (passt am besten)' : ''}: ${s.what} ${s.cost.charAt(0).toUpperCase()}${s.cost.slice(1)}.`) },
          { tip: LAB_SOURCES.find((s) => s.best).tip },
          { p: 'Für Verlaufsvergleiche möglichst beim selben Labor und Verfahren bleiben. Blut aus der Fingerbeere ist empfindlicher in der Vorbereitung als eine venöse Blutentnahme; kleine Sprünge zwischen zwei Anbietern sind oft Messunterschiede und keine echte Veränderung.' },
        ] },
        { id: 'referenzbereich', q: 'Warum trage ich den Referenzbereich meines Labors ein?', body: [
          { p: 'Weil es in Deutschland KEINE bundesweit einheitlichen Referenzbereiche gibt: Jedes Labor legt eigene fest – abhängig von Messmethode, Gerät und Vergleichsgruppe. Bei Ferritin, fT3 oder Vitamin B12 unterscheiden sie sich spürbar. Deshalb steht der Bereich immer auf deinem Befund neben dem Wert.' },
          { steps: [
            'Beim Erfassen eines Werts steht in den Feldern „Referenzbereich deines Labors“ ein üblicher Bereich nur grau angedeutet – in der Einheit, die du gewählt hast.',
            'Tipp den Bereich von deinem Befund ab. Gespeichert wird nur, was du selbst einträgst; leer gelassen gilt der übliche Bereich.',
            'Cat-O-Fit bewertet den Wert dann gegen DEIN Labor. Der sportliche Zielkorridor bleibt als zweite Ebene daneben bestehen.',
          ] },
          { p: 'Bis v3.19.0 wurde der vorbelegte Standard mitgespeichert (und beim Einheitenwechsel falsch umgerechnet). Solche älteren Werte erkennt die App und bewertet sie wieder gegen den üblichen Bereich – nichts musst du nachtragen.' },
          { p: 'Was normiert ist – und was nicht:' },
          { steps: [...LAB_STANDARDS.regulated, ...LAB_STANDARDS.notRegulated].map(plain) },
        ] },
        { id: 'labor', q: 'Labor & Ergänzung', body: [
          { p: 'Werte aus deinem Laborbefund erfassen, ihren Verlauf verfolgen und sportbezogen einordnen lassen. Der Clou: Laborbereiche gelten für die Allgemeinbevölkerung – ein Ferritin von 25 µg/l ist „normal“, für Ausdauertraining aber knapp. Cat-O-Fit zeigt dir beide Korridore.' },
          { steps: [
            'Beim ersten Öffnen ein paar kurze Fragen zur Abgrenzung – sie gelten für die ganze App: Cat-O-Fit ist für gesunde Erwachsene gedacht. Bei Erkrankung, Medikamenten, Schwangerschaft, Stillzeit oder Essstörung bleibt das Modul beim reinen Dokumentieren, ohne Empfehlungen. Kinder und Jugendliche erkennt die App am Geburtsjahr: Ihre Werte werden nur dokumentiert, nicht bewertet.',
            '„+ Wert erfassen“: Analyt, Datum, Messwert und Einheit direkt daneben – für fast jeden Wert gibt es die in Deutschland üblichen Einheiten (z. B. CRP in mg/l oder mg/dl, Vitamin D in nmol/l oder ng/ml); die App rechnet um und zeigt den Wert so, wie er auf dem Befund stand. Weit außerhalb des Üblichen fragt sie: „Stimmt die Einheit?“',
            'Magnesium gibt es als Vollblut- und als Serumwert – bitte den passenden wählen. Für B12 gibt es Holo-TC und Gesamt-B12.',
            'Unter „Umstände der Blutentnahme“ kannst du harte Belastung in den 48 Stunden davor, nüchtern, Biotin und bei Frauen den Zyklustag notieren. CK, Harnstoff und CRP nach harter Belastung bewertet die App dann nicht, Östradiol nur mit dem Bereich deines Labors für die Zyklusphase.',
            'Antippen zeigt den Verlauf mit beiden Bereichen (Referenz gestrichelt, Sport-Zielbereich als Fläche), die Quelle der Bereiche und alle Messungen – dort lassen sich Werte bearbeiten und löschen.',
            'Einen Trend zeigt die App erst ab drei Messungen über mindestens zwei Monate und wenn die Änderung größer ist als die natürliche Schwankung des Werts. Eine Projektion („wann verlässt der Wert den günstigen Bereich“) gibt es nur in die ungünstige Richtung und höchstens ein Jahr voraus.',
            'Ferritin wird mit dem CRP derselben Blutentnahme eingeordnet: Bei einer Entzündung ist ein hoher Wert nicht beurteilbar, ein niedriger aber trotzdem auffällig.',
            'Ältere Werte (Vitamin D nach vier Monaten oder aus einer anderen Jahreszeit, die meisten anderen nach einem Jahr) bleiben im Verlauf, tragen aber keine Vorschläge mehr – dann rät die App zur neuen Messung.',
            'Unter „Ergänzung“ stehen allgemeine Informationen mit Begründung, üblicher Menge (ausgerichtet an den Höchstmengen des BfR und den Obergrenzen der EFSA), Zeitpunkt und Wechselwirkungen – immer zuerst der Weg über die Ernährung. Ein zu hoher Wert führt nie zu „ergänzen“, sondern zum Rat, die Einnahme zu prüfen. Bei Leistungspräparaten steht der Hinweis auf chargengeprüfte Produkte (Kölner Liste).',
            'Was du regelmäßig nimmst, trägst du unter „Dein Plan“ ein und hakst es ab. Mittel, die du nur bei Bedarf nimmst (z. B. Koffein vor Wettkämpfen), markierst du so – sie zählen nicht in die Einnahmetreue.',
          ] },
          { tip: 'Ganz oben schätzt die App deine Energieversorgung: ob du genug isst für das, was du trainierst. Gerechnet wird nur mit Tagen, die du in der Ernährung als „Tag vollständig“ bestätigt hast, und das Ergebnis ist eine Spanne, keine Messung. Dafür braucht die App die fettfreie Masse – gemessen (Waage, Apple Health) oder aus einem Körperfettwert der letzten vier Monate. Zu wenig Energie ist im Ausdauersport das häufigere Problem als ein fehlendes Präparat – und eine häufige Ursache für Leistungsabfall, Verletzungen und Zyklusstörungen.' },
          { p: 'Eisen wird nie ohne Laborwert vorgeschlagen – auf Verdacht eingenommen ist es bei vollen Speichern schädlich. Cat-O-Fit dient der Dokumentation und allgemeinen Information für gesunde Erwachsene – kein Medizinprodukt, keine Diagnose: Bei auffälligen Werten verweist die App ausdrücklich an eine Ärztin oder einen Arzt. Deine Werte sind privat: in der App für Admins nicht sichtbar, und der Server gibt sie nur nach deiner PIN-Anmeldung heraus. Wer den Server betreibt, kann die gespeicherten Dateien allerdings lesen.' },
          { link: { label: 'Öffnen', hash: '#/labor' } },
        ] },
        {
          id: 'energieverfuegbarkeit',
          q: 'Energieversorgung (Energieverfügbarkeit, RED-S)',
          aliases: ['RED-S', 'Energieverfügbarkeit', 'EA', 'LEA', 'Energy Availability', 'fettfreie Masse', 'zu wenig gegessen'],
          body: [
            { p: 'Die Energieversorgung schätzt, ob du genug isst für das, was du trainierst. Fachlich heißt das Energieverfügbarkeit: die gegessene Energie minus Trainingsverbrauch, geteilt durch die fettfreie Masse in kg.' },
            { steps: [
              'Gerechnet wird nur mit Tagen, die du in der Ernährung als „Tag vollständig“ bestätigt hast – bis genug Tage beisammen sind, sagt die App das, statt einen Mangel zu behaupten.',
              'Richtwert rund 45 kcal je kg fettfreier Masse. Mit Abnehmziel gilt 30–45 vorübergehend als vertretbar; unter 30 (bei Männern unter 25) wird es für Hormone, Knochen und Regeneration kritisch.',
              'Die fettfreie Masse kommt aus einer Messung (Waage, Apple Health) oder aus einem Körperfettwert der letzten vier Monate. Weil alle Eingangswerte Schätzungen sind, zeigt die App eine Spanne.',
            ] },
            { tip: 'Anhaltend zu wenig Energie heißt in der Sportmedizin RED-S (relatives Energiedefizit im Sport). Cat-O-Fit stellt keine Diagnose – bei Zyklusstörungen, häufigen Verletzungen oder anhaltender Müdigkeit gehört das in ärztliche Hände.' },
            { link: { label: 'Zu Labor & Ergänzung', hash: '#/labor' } },
          ],
        },
        {
          id: 'trendprojektion',
          q: 'Trend und Projektion bei Laborwerten',
          aliases: ['Projektion', 'Verlauf', 'Schwankung', 'RCV'],
          body: [
            { steps: [
              'Ein Trend erscheint erst ab drei Messungen über mindestens zwei Monate – und nur, wenn die Änderung größer ist als die natürliche Schwankung des Werts (etwa Ferritin 48 %, Vitamin D 30 %, Hämoglobin 9 %, sonst 25 %).',
              'Die Projektion rechnet den Verlauf gerade weiter und nennt, wann der günstige Bereich verlassen würde – nur in die ungünstige Richtung und höchstens ein Jahr voraus.',
              'Vitamin D schwankt mit der Jahreszeit: Ein Sommerwert sagt im Winter wenig.',
            ] },
            { tip: 'Eine Projektion ist ein Anlass für die nächste Kontrolle, keine Vorhersage.' },
          ],
        },
        { id: 'berichte', q: 'Berichte & Urkunden', body: [{ p: 'Erzeuge unveränderliche Belege deiner Entwicklung: Monatsbericht, Wettkampf-Bericht (Vorbereitung + Ergebnis) oder eine Urkunde für ein erreichtes Ziel. Vor dem Speichern siehst du eine Vorschau; einmal gespeichert, bleiben sie erhalten und lassen sich drucken oder als PDF speichern – alles lokal.' }, { link: { label: 'Öffnen', hash: '#/reports' } }] },
        { id: 'ernaehrung-einkauf', q: 'Ernährung, Einkauf & Checkliste', body: [{ p: 'Proteinbetonte Mahlzeiten-Ideen mit Rezept-Vorschlägen, eine Kalorienbilanz für heute, eine automatische Einkaufsliste mit Lager (aus dem Wochen-Speiseplan) und „Checkliste & Erinnerungen“: tägliche Routinen oder Termine mit Datum/Uhrzeit. Termine erscheinen automatisch auch im Kalender (Wochen- und Monatsansicht) und lassen sich zusätzlich als .ics exportieren – plus Vorlagen wie die Wettkampf-Vorbereitung. In den Einstellungen abschaltbar.' }] },
        { id: 'einstellungen', q: 'Einstellungen', body: [{ p: 'Profil, Herzfrequenz-Zonen, Pace-Bereiche, Theme & Akzentfarbe, Module, sichtbare Werte sowie „Daten & Sicherung“ (persönliches Backup für alle, Familien-Vollbackup & Wiederherstellung für Admins).' }, { link: { label: 'Öffnen', hash: '#/settings' } }] },
      ],
    },
    {
      id: 'knowledge', title: 'Trainingswissen', icon: 'info',
      articles: [
        {
          id: 'periodisierung',
          q: 'Die Trainingsphasen (Periodisierung)',
          body: [
            { p: 'Ein guter Plan baut in Phasen auf – das schont und steigert gleichzeitig:' },
            { steps: [
              'Grundlage: viel lockerer Umfang, aerobe Basis.',
              'Aufbau: Schwellenläufe, Tempohärte.',
              'Spitze: kurze, schnelle Reize (VO₂max) und Wettkampftempo.',
              'Tapering: Umfang runter, Spritzigkeit halten – frisch an den Start.',
            ] },
          ],
        },
        {
          id: 'hf-zonen',
          q: 'Herzfrequenz-Zonen',
          body: [
            { p: 'Cat-O-Fit nutzt fünf Zonen, abgeleitet aus deiner maximalen Herzfrequenz – wahlweise mit Ruhepuls über die Herzfrequenzreserve (Karvonen) oder aus deiner Schwellen-HF („Schwelle“): aus einer Leistungsdiagnostik oder einem 30-Minuten-Feldtest (Ø-HF der letzten 20 Minuten), Zonen nach Friel. Kennst du deine Max-HF nicht, schätzt die App sie in den Einstellungen aus dem Alter (Tanaka: 208 − 0,7 × Alter); ein gemessener Wert ist immer besser.' },
            { steps: [
              'Z1 Regeneration – ganz locker.',
              'Z2 Grundlage – „unterhaltsames“ Tempo, hier passiert die Ausdauer.',
              'Z3 Tempo – zügig, aber kontrolliert.',
              'Z4 Schwelle – schnell, „komfortabel hart“.',
              'Z5 VO₂max – sehr hart, nur kurz.',
            ] },
            { tip: 'Max-HF und Ruhepuls kannst du in den Einstellungen anpassen – die Zonen rechnen sich neu.' },
          ],
        },
        {
          id: 'pace-bereiche',
          q: 'Pace-Bereiche (Tempo)',
          body: [{ p: 'Jeder Einheitstyp hat einen Tempobereich in min/km, abgeleitet aus deiner Zielzeit. Sie sind ein Vorschlag, kein Muss – Tagesform zählt.' }],
        },
        {
          id: 'rpe',
          q: 'RPE – wie anstrengend war\'s?',
          aliases: ['Anstrengung', 'Borg'],
          body: [
            { p: 'RPE (1–10) ist dein subjektives Belastungsempfinden. Es ergänzt Herzfrequenz und Pace – gerade an Tagen, an denen sich Zahlen „anders anfühlen“.' },
            { steps: [
              '1–2 sehr leicht bis leicht – Spazierengehen, lockeres Ausrollen.',
              '3–4 locker bis moderat – du könntest dich die ganze Zeit unterhalten.',
              '5–6 mittel bis fordernd – Sprechen geht noch in kurzen Sätzen.',
              '7–8 hart bis sehr hart – Tempo, Intervalle, Wettkampf über längere Strecken.',
              '9–10 extrem hart bis maximal – nur kurz haltbar, ein Endspurt.',
            ] },
            { tip: 'Mit der Dauer ergibt die Anstrengung deine Belastungspunkte (Minuten × RPE).' },
          ],
        },
        {
          id: 'trainingslast',
          q: 'Trainingslast & Erholung',
          body: [
            { p: 'Die Statistik zeigt deine Lauf-Kilometer der letzten 7 und 28 Tage – nur Läufe; Rad, Gehen und Schwimmen zählen dort nicht. Steigt die Belastung sehr schnell, plane bewusst Erholung ein. Cat-O-Fit gibt keine Versprechen zu Verletzungsschutz, sondern Anhaltspunkte.' },
            { tip: 'Die Kennzahl „Belastungspunkte · 7 Tage“ rechnet Minuten × Anstrengung über alle Sportarten – so zählen auch Kraft, Fußball, Rad oder ein Testspiel mit, nicht nur die Lauf-km. Ohne erfasste Dauer zählt die geplante Dauer, erst dann 30 Minuten.' },
            { tip: 'Der Coach passt sich in beide Richtungen an: Waren deine Einheiten seit Wochen sehr anstrengend, schlägt das Dashboard eine Entlastungswoche vor (Umfang runter, feste Termine bleiben); waren sie eher locker und spricht nichts dagegen, kannst du die kommende Woche etwas steigern.' },
          ],
        },
        {
          id: 'vdot',
          q: 'Aktuelle Form & Zielpaces (VDOT) – so nutzt du sie',
          body: [
            { p: 'Auf „Heute“ schätzt die Karte „Aktuelle Form“ aus deinen jüngsten Lauf-Leistungen einen VDOT (eine Form-/Leistungskennzahl nach Jack Daniels) und leitet daraus passende Trainingsbereiche ab. Direkt darüber steht die Karte „Deine Trainingsbereiche“ mit den aktuellen Plan-Zielpaces – so kannst du beide unmittelbar vergleichen.' },
            { p: 'So liest du die Karte:' },
            { steps: [
              'Der VDOT-Chip (z. B. „VDOT 41,9“) ist deine geschätzte aktuelle Leistung.',
              '„geglättet über 7 Wochen · zuletzt 8,0 km in 38:00 am Mi, 1. Juli“ heißt: Die Form ist NICHT ein einzelner Lauf, sondern ein geglätteter Wert aus deinen letzten Wochen – je Woche zählt dein bester harter Lauf (Wettkampf, Tempo, Intervalle oder Anstrengung ab 7), jüngere Wochen mehr, und einzelne Ausreißer werden gekappt. „zuletzt …“ nennt deinen jüngsten Qualitätslauf. Lockere Läufe unterschätzen die Form – läufst du nur locker, sagt die Karte das und rät nicht zu langsameren Paces.',
              'So springt die Form NICHT bei einem einzelnen sehr schnellen (oder langsamen) Tag – sie bildet deinen stabilen Trend ab.',
              'Locker / Schwelle / Intervalle sind die Paces, die zu dieser Form passen.',
              'Die Zeile darunter vergleicht Form und Plan, z. B. „Deine Form ist rund 7 s/km schneller als deine Plan-Zielpaces – Zeit, sie zu schärfen.“ Passt beides zusammen, steht dort „passen gut zu deiner aktuellen Form“.',
            ] },
            { p: 'Anpassen mit einem Tap:' },
            { steps: [
              'Tippe auf „Trainingsbereiche an deine Form anpassen“.',
              'Cat-O-Fit übernimmt die Form-Paces sofort in deine Trainingsbereiche UND in alle offenen, künftigen Lauf-Einheiten deines Plans – jede Einheit bekommt den Bereich ihrer Art (Long Run → Long Run, Schwelle → Schwelle). Mit Zielzeit bleibt das Renntempo dein Ziel.',
              'Danach zeigt die Karte „passen gut“ – Form und Plan sind wieder deckungsgleich.',
            ] },
            { tip: 'Ein einzelner Ausreißer-Tag verschiebt die Form nicht – sie wird über mehrere Wochen geglättet. Sie ersetzt keine Leistungsdiagnostik: Hast du dort deine maximale Herzfrequenz bestimmt, trag sie in den Einstellungen ein.' },
          ],
        },
        {
          id: 'trinkpausen',
          q: 'Trinkpausen im Long Run',
          body: [
            { p: 'Bei langen Läufen blendet der Workout-Modus regelmäßig eine Trink-Erinnerung ein (mit Ton, wo möglich auch Vibration) – damit du auf langen Strecken das Trinken nicht vergisst. Tipp: lieber oft kleine Schlucke als selten viel.' },
            { tip: 'Du kannst das Intervall pro Einheit selbst setzen: im Bearbeiten-Dialog unter „Trinkpause alle (min)“. Leer = automatisch je Typ, 0 = aus.' },
          ],
        },
        {
          id: 'coach',
          q: 'Was zeigt mir der Coach?',
          body: [
            { p: `Der Coach gibt dir auf „Heute“ genau eine Empfehlung, ${name} – in fester Reihenfolge, damit sich zwei Karten nie widersprechen:` },
            { steps: [
              'Warnsignale zuerst: behutsamer Wiedereinstieg nach Krankheit/Verletzung, Erholungstag bei deutlich mehr Last als geplant, heute lockerer bei niedriger Bereitschaft, lockerer nach fordernd gespieltem Fußball, Entlastungswoche nach Wochen sehr anstrengender Einheiten.',
              'Dann dein Plan: zwei Einheiten an einem Tag entzerren, eine verpasste Schlüsseleinheit nachholen, liegen gebliebene Lauf-km behutsam ausgleichen – nie nach Krankheit oder Verletzung.',
              'Zuletzt Steigerung („Noch Reserven“) – nur ohne Warnsignal, mit Belastung im üblichen Rahmen und nicht in den 14 Tagen nach einem Ausfall.',
              'Darunter Informationen ohne eigenes Urteil: Bereitschaft (HRV, Ruhepuls, Schlaf), Formprognose, Herzfrequenz lockerer Läufe, Anstrengung der letzten Einheiten (Ø RPE).',
            ] },
            { tip: '„Warum diese Empfehlung?“ unter der Karte zeigt, was sonst noch gepasst hätte. Plangemäßes Training ist kein Warnsignal, und feste Termine fasst der Coach nie an. Änderungen am Plan passieren nur, wenn du sie auslöst.' },
          ],
        },
        {
          id: 'belastung-form',
          q: 'Belastung & Form verstehen (ACWR, Fitness/Form)',
          body: [
            { p: 'Die Karte „Belastung & Form“ auf „Heute“ fasst deine Trainingslast zusammen – über alle Sportarten hinweg (Laufen, Kraft, Fußball …), berechnet als Belastungspunkte (AU): Minuten × Anstrengung (RPE 1–10).' },
            { steps: [
              'Lastverhältnis (ACWR) – deine letzten 7 Tage im Verhältnis zum Schnitt der 21 Tage davor (entkoppelt: die akuten Tage stecken nicht im eigenen Vergleichswert). 0,8–1,3 heißt: nah an deinem Schnitt.',
              'Fitness / Ermüdung / Form – langfristige Fitness (CTL) minus kurzfristige Ermüdung (ATL) ergibt deine Form (TSB), eingeordnet relativ zur Fitness: frisch (über +10 %), ausgeglichen, im Training (bis −30 %), deutlich ermüdet. In den ersten rund drei Monaten schwingt die Fitnesskurve noch ein – so lange gibt es keine Bewertung.',
              'Monotonie & Strain – ein Hinweis nur, wenn gleichförmige Trainingstage mit einer Woche deutlich über deinem Schnitt zusammenkommen; sehr leichte Aktivität zählt nicht.',
            ] },
            { tip: 'Grenzen der Kennzahl: Die Werte 0,8/1,3/1,5 stammen aus Beobachtungsdaten im Teamsport. Dass Training nach dieser Ampel Verletzungen verhindert, ist nicht belegt – nimm sie als Hinweis, wie stark deine Last gegenüber deinem eigenen Schnitt gestiegen ist. Diese Werte speisen auch den automatischen Erholungstag.' },
          ],
        },
        {
          id: 'belastungspunkte',
          q: 'Belastungspunkte: Minuten × Anstrengung',
          aliases: ['sRPE', 'Session-RPE', 'AU', 'Trainingslast', 'Last', 'Foster'],
          body: [
            { p: 'Cat-O-Fit misst die Belastung aller Sportarten mit einer Zahl: Belastungspunkte (AU) = Dauer in Minuten × Anstrengung (RPE 1–10). Die Methode heißt Session-RPE und stammt von Carl Foster.' },
            { steps: [
              'Beispiel: 45 Minuten locker (RPE 4) ergeben 180 Punkte, 60 Minuten Intervalle (RPE 8) 480 Punkte.',
              'Fehlt die Dauer, rechnet die App aus der Strecke (je Sportart), dann aus der geplanten Dauer, zuletzt mit 30 Minuten.',
              'Fehlt die Anstrengung, schätzt die App sie aus deiner Ø-Herzfrequenz im Verhältnis zu deiner Max-HF (Einstellungen → „Herzfrequenz-Zonen“) – bei Intervallen, Tempo und Wettkampf nie unter dem typischen Wert, weil die Pausen den Schnitt drücken. Ohne Herzfrequenz nimmt sie einen typischen Wert für die Art der Einheit.',
              'Importierte Trainings ohne Anstrengung fragt „Heute“ kurz nach („Wie hart war’s?“) – dein Empfinden ist genauer als jede Schätzung.',
            ] },
            { tip: 'Aus den Belastungspunkten entstehen Lastverhältnis (ACWR), Fitness/Ermüdung/Form und Monotonie – alle Belastungsurteile haben dieselbe Quelle.' },
          ],
        },
        {
          id: 'monotonie',
          q: 'Monotonie und Strain',
          aliases: ['Strain', 'Gleichförmigkeit'],
          body: [
            { p: 'Monotonie beschreibt, wie gleichförmig deine Trainingstage sind: der Wochenschnitt der Belastungspunkte geteilt durch ihre Schwankung (nach Foster). Strain ist die Wochenlast mal Monotonie.' },
            { steps: [
              'Ein Hinweis erscheint nur, wenn beides zusammenkommt: Monotonie ab 2 UND eine Woche mindestens 10 % über deiner üblichen Wochenlast.',
              'Sehr leichte Aktivität (Anstrengung bis 3, etwa Spazierengehen oder Mobility) zählt dabei nicht.',
            ] },
            { tip: 'Abwechslung aus harten und lockeren Tagen senkt die Monotonie – ein echter Ruhetag wirkt stärker als eine weitere lockere Einheit.' },
          ],
        },
        {
          id: 'bereitschaft',
          q: 'Bereitschaft: Ruhepuls, HRV und Schlaf',
          aliases: ['Readiness', 'Erholung', 'HRV', 'Ruhepuls', 'Schlaf'],
          body: [
            { p: 'Die Bereitschaft (0–100) vergleicht deine jüngsten Erholungswerte mit deinem eigenen Normalbereich: ein Ruhepuls über deinem Schnitt senkt sie, gut sieben Stunden Schlaf und mehr helfen, unter sechseinhalb Stunden kostet es. Bei der HRV zählt nicht der einzelne Tag, sondern das Mittel der letzten sieben Tage im Vergleich zu deinen vier Wochen davor – liegt es darunter, sinkt die Bereitschaft; ein einzelner schlechter Morgen kippt nichts.' },
            { steps: [
              '75 und mehr: hoch · 55–74: solide · 40–54: mäßig · darunter: niedrig.',
              'HRV zählt ab drei Werten in sieben Tagen und zehn in vier Wochen – und nur innerhalb einer Messart (SDNN oder RMSSD).',
              'Sind die letzten Werte älter als vier Tage, zeigt die App keine Bereitschaft.',
            ] },
            { tip: 'Bei niedriger Bereitschaft schlägt der Coach vor, heute lockerer zu trainieren – eine Empfehlung, keine Diagnose.' },
          ],
        },
        {
          id: 'feste-termine',
          q: 'Feste Termine einplanen (Fußball & Spiele)',
          body: [
            { p: 'Wiederkehrende feste Termine trägst du einmal ein – der Trainingsplan legt sich dann darum herum. Neue Pläne haben keine Standardtermine; beim Anlegen fragt die App danach. Steht derselbe Termin in zwei Plänen, erscheint er nur einmal am Tag.' },
            { steps: [
              'Fußball-Trainingstage wählen (z. B. Mo & Mi), Dauer und Intensität (leicht/normal/intensiv) angeben.',
              'Wiederkehrende Spiele mit Startdatum eintragen (z. B. „ab 19.08. jeden Sonntag, 2 h“) – sie zählen als harte Belastung.',
              'An einem Spieltag entfällt die geplante Trainingseinheit; die Woche wird um die festen Termine herum geplant.',
            ] },
            { tip: 'Fußball ist HIIT-artig und kostet viel Energie: Ab „normal“ zählt ein Fußballtag als fordernder Tag (fließt voll in Belastung & Form ein). Der Plan legt Qualitätseinheit und Long Run nie direkt neben einen fordernden Termin – gibt es keinen ruhigen Tag, wird die Qualitätseinheit „Locker mit Steigerungen“. Hast du fordernd gespielt und steht danach doch eine harte Einheit an, schlägt der Coach vor, sie lockerer anzugehen.' },
          ],
        },
        {
          id: 'erholungstag',
          q: 'Automatischer Erholungstag & rollierende Planung',
          body: [
            { p: 'Cat-O-Fit plant rollierend: Statt eines starren Blocks passt sich die kommende Woche an das an, was du tatsächlich getan hast.' },
            { steps: [
              'Liegt deine Belastung deutlich über dem Geplanten oder häufen sich harte Tage, die so nicht im Plan standen, schlägt der Coach einen Erholungstag für die nächste harte Einheit der kommenden zwei Tage vor. Plangemäßes Training ist kein Warnsignal.',
              'Liegen an dem Tag zwei Einheiten (etwa aus zwei Zielen), wird der ganze Tag ruhig gestellt – oder du verschiebst eine auf einen freien Tag (entzerren).',
              'Trägst du einen Periodenbeginn für heute oder morgen ein, fragt die App, ob du es lockerer angehen möchtest – nur dann wird angepasst.',
              'Jede automatische Anpassung steht transparent im Log „Zuletzt automatisch angepasst“ und ist rückgängig, solange die Einheit noch offen ist.',
            ] },
            { tip: 'Nichts ändert sich heimlich – Anpassungen sind sichtbar und umkehrbar. Auf „Heute“ steht immer nur eine Empfehlung; „Warum diese Empfehlung?“ zeigt, was zurückgestellt wurde.' },
          ],
        },
        {
          id: 'wochen-check',
          q: 'Wochen-Check: Kollisionen & Priorisierung',
          body: [
            { p: 'Der Wochen-Check im Plan zeigt, wenn sich in einer Woche zu viel überlagert – und in welcher Reihenfolge Cat-O-Fit triagiert.' },
            { steps: [
              'Feste Termine (Fußball/Spiele) haben Vorrang.',
              'Dann die Schlüssel-Läufe (Tempo/Intervalle, Long Run).',
              'Danach Kraft und zuletzt zusätzlicher Umfang.',
              'Vorschau (What-if): Bevor du eine Einheit hinzufügst oder verschiebst, zeigt die App die Auswirkung auf die Wochenbelastung.',
            ] },
          ],
        },
        {
          id: 'ziel-cockpit',
          q: 'Ziel-Cockpit: Halbmarathon + Abnehmen zusammen',
          body: [
            { p: 'Zwei Ziele gleichzeitig? Das Ziel-Cockpit bündelt Leistungsziel (z. B. Halbmarathon) und Abnehmen in einem Blick.' },
            { steps: [
              'Der Schwerpunkt wandert mit der Trainingsphase: In der Grundlagenphase ist das Defizit am größten (rund 450 kcal), im Aufbau kleiner (rund 300 kcal), in der Spitzenphase klein und im Tapering null – dann wird aufgefüllt.',
              'Die Defizit-Empfehlung koppelt an deine Kalorienbilanz – mit Untergrenzen: nie unter dem Grundumsatz und nie so tief, dass nach dem Training weniger als 30 kcal je kg fettfreier Masse bleiben. Ohne Körperfettwert ist das Defizit auf 15 % begrenzt.',
              'Ein ehrlicher Reiz-Check warnt, wenn zu wenig Trainingsreiz für Fortschritt gesetzt wird.',
            ] },
            { tip: 'So nimmst du ab, ohne die Schlüsseleinheiten zu ruinieren.' },
          ],
        },
        {
          id: 'gesundheitsziel',
          q: 'Wie setze ich ein Gesundheitsziel?',
          body: [
            { p: 'Neben den Wochenzielen (aktive Minuten & Trainingstage) kannst du dedizierte Zielwerte für Körperwerte festlegen.' },
            { steps: [
              'Einstellungen → Gesundheitsziele → „+ Ziel“.',
              'Metrik wählen (Gewicht, Körperfett, Ruhepuls, HRV oder VO₂max), Zielwert und optional ein Zieldatum eintragen.',
              'Dein aktueller Wert wird als Startpunkt gemerkt; der Fortschritt zählt von dort zum Ziel.',
              'Auf „Heute“ erscheint die Karte „Gesundheitsziele“ mit Fortschrittsbalken je Ziel.',
            ] },
            { tip: 'Der Fortschritt aktualisiert sich mit jedem neuen Körperwert (＋ Erfassen → Körperwerte) oder per Apple-Health-Import.', link: { label: 'Zu den Einstellungen', hash: '#/settings' } },
          ],
        },
        {
          id: 'momentum',
          q: 'Wie funktionieren Erfolge & Momentum?',
          body: [
            { p: 'Für durchgeführte Trainings und erreichte Ziele schaltest du Abzeichen frei – automatisch und mit einer kleinen Feier.' },
            { p: 'Das Momentum ist deine „Schwung-Flamme“: Sie wächst, wenn du dranbleibst, und schrumpft sanft bei Lücken. Sie ist als Anstoß gedacht, nie als Strafe.' },
            { steps: [
              'Serien zählen in Wochen: Eine Kalenderwoche mit mindestens drei Trainingstagen setzt die Serie fort – Ruhetage gehören dazu.',
              'Das Momentum steigt mit bis zu fünf Trainingstagen pro Woche; mehr bringt keinen zusätzlichen Schwung.',
              'Krank oder verletzt? Trag den Ausfall mit Grund ein – das Momentum pausiert, und die Serie bricht nicht.',
            ] },
            { link: { label: 'Zu Erfolge & Momentum', hash: '#/badges' } },
          ],
        },
        {
          id: 'vorlieben',
          q: 'Wie lernt Cat-O-Fit meine Vorlieben?',
          body: [
            { p: 'In der Ernährung markierst du Lieblingsgerichte mit ♥ und tippst nach dem Kochen auf „Gekocht“. Daraus lernt Cat-O-Fit, welche Tags (z. B. proteinreich, vegetarisch) du bevorzugst, und schlägt Passendes unter „Für dich“ vor.' },
            { p: 'Auch die Tages-Checkliste merkt sich häufig Genutztes und bietet es als Schnell-Hinzufügen an.' },
          ],
        },
        {
          id: 'kalorienbilanz',
          q: 'Wie funktioniert die Kalorienbilanz?',
          body: [
            { p: 'Oben in der Ernährung siehst du deine Tagesbilanz: verbraucht gegen eingenommen.' },
            { steps: [
              'Verbraucht = Grundumsatz (aus Größe, Gewicht, Geburtsjahr, Geschlecht) + Alltag + dein heutiges Training.',
              'Eingenommen = die Einträge deines Ess-Tagebuchs für heute. „Gekocht“ und „Gegessenes erfassen“ schreiben dort hinein; „Heute gegessen“ listet sie (einzeln löschbar).',
              'Das Tagesziel richtet sich nach deinem Zielgewicht (abnehmen/halten/zunehmen) – gerechnet mit dem Wochenmittel deiner Waage, nicht mit einer einzelnen Messung. Bis 0,5 kg um das Ziel heißt „halten“; wer ein Abnehmziel unterschreitet, bekommt „halten“, nie automatisch „zunehmen“.',
              'Beim Abnehmen bleibt das Tagesziel über dem Grundumsatz und über deinem Trainingsbedarf. Liegt das Zielgewicht unter einem BMI von 18,5, rechnet die App kein Defizit.',
              'Hast du alles für den Tag erfasst, tippe unter „Heute gegessen“ auf „Tag vollständig“ – nur solche Tage zählen für die Energieversorgung im Labor-Modul.',
            ] },
            { tip: 'Beim Anlegen einer Mahlzeit schätzt der Knopf „schätzen“ die kcal grob aus den Zutaten. Alles ist als Orientierung gedacht – keine Diät-Beratung.' },
            { p: 'Für die Bilanz brauchst du im Profil Größe, Gewicht und Geburtsjahr; Geschlecht macht den Grundumsatz genauer.' },
          ],
        },
        {
          id: 'eignung',
          q: 'Abgrenzung, Kinder- und Jugendprofil und „Kalorienzahlen ausblenden“',
          body: [
            { p: 'Cat-O-Fit dient der Dokumentation und allgemeinen Information für gesunde Erwachsene – es ist kein Medizinprodukt. Eine kurze Abgrenzung (Einstellungen → Gesundheit & Eignung) gilt für die ganze App:' },
            { steps: [
              'Erkrankung oder Medikamente: Labor und Ergänzung nur zum Dokumentieren, ohne Empfehlungen.',
              'Schwangerschaft, Stillzeit oder Essstörung: zusätzlich keine Abnehm- oder Defizitziele, kein Abnehmprogramm.',
              'Unter 18 (aus dem Geburtsjahr): Kinder- und Jugendprofil – keine Kalorien- und Gewichtsziele, kein Abnehmprogramm, keine Leistungspräparate, Laborwerte nur dokumentiert, Kalorienzahlen ausgeblendet.',
              '„Kalorienzahlen ausblenden“ verbirgt kcal-Angaben in Ernährung, auf „Heute“ und bei der Energieversorgung – für alle, denen Zahlen beim Essen nicht guttun.',
            ] },
            { tip: 'Solange die Abgrenzung nicht beantwortet ist, schlägt die App kein Abnehm-Defizit vor. Die Fragen sind bewusst nicht vorbelegt.' },
            { link: { label: 'Einstellungen öffnen', hash: '#/settings' } },
          ],
        },
        {
          id: 'einkaufsliste',
          q: 'Wie funktioniert die Einkaufsliste?',
          body: [
            { p: 'Die Einkaufsliste ist gemeinsam und entsteht automatisch aus den Speiseplänen aller Mitglieder:' },
            { steps: [
              'Jedes Mitglied plant in der Ernährung Gerichte mit Portionen für die Woche (Warenkorb-Symbol).',
              'Cat-O-Fit zieht alle geplanten Gerichte zusammen, aggregiert die Zutaten (z. B. Haferflocken mehrerer Personen zu einer Menge) und zieht das gemeinsame Lager ab – die Liste zeigt genau, was ihr braucht.',
              'Beim Einkauf „Alles eingekauft“ tippen: Die Mengen wandern ins gemeinsame Lager. „Gekocht“ bucht sie wieder ab.',
            ] },
            { tip: 'Der Einkaufstag gilt für alle und wird von Admins in der Team-/Familienverwaltung gesetzt (Standard Dienstag).' },
            { link: { label: 'Zur Einkaufsliste', hash: '#/shopping' } },
          ],
        },
        {
          id: 'wetter',
          q: 'Wie nutze ich das Wetter im Plan?',
          body: [
            { steps: [
              'Einstellungen → „Standort & Wetter“ öffnen und deine Stadt suchen.',
              'Im Kalender erscheinen für die nächsten Tage kleine Wettersymbole mit Temperatur.',
              'Bei Hitze, Regen oder Sturm zeigt die jeweilige Einheit einen passenden Hinweis.',
            ] },
            { tip: 'Wetterdaten kommen von Open-Meteo. Ohne Internet bleibt der zuletzt geladene Stand – die App läuft normal weiter.' },
          ],
        },
        {
          id: 'zyklus',
          q: 'Was macht der Zykluskalender?',
          body: [
            { p: 'Trag deinen Periodenbeginn ein („＋ Erfassen“ → „Periode“ oder auf der Zyklusseite). Cat-O-Fit berechnet daraus deine Zykluslänge, die aktuelle Phase (Menstruation/Follikel/Ovulation/Luteal) und die Prognose der nächsten Periode. Wer den Zyklus nicht braucht, schaltet das Modul unter Einstellungen → Module aus.' },
            { p: 'An deinen Menstruationstagen sind Einheiten „geschützt“: Du kannst sie ohne Wertung verschieben oder auslassen – sie zählen nicht als verpasst und schmälern weder Plan-Einhaltung noch Momentum. Die Phasentipps sind bewusst neutral: Die Studienlage zu Leistungsunterschieden im Zyklus ist schwach – maßgeblich ist dein Befinden.' },
            { p: 'Unter hormoneller Verhütung (Pille, Hormonspirale, Implantat …) gibt es keine natürlichen Phasen: Mit dem Schalter auf der Zyklusseite zeigt Cat-O-Fit nur deine Blutungstage. Ohne neuen Eintrag seit rund drei Monaten pausiert die Prognose.' },
            { tip: 'Sensible Daten bleiben lokal auf deinem eigenen Server – das Modul ist jederzeit abschaltbar.' },
            { link: { label: 'Zum Zykluskalender', hash: '#/zyklus' } },
          ],
        },
      ],
    },
    {
      id: 'faq', title: 'Gut zu wissen', icon: 'bell',
      articles: [
        { id: 'offline', q: 'Funktioniert die App offline?', body: [{ p: 'Ja. Cat-O-Fit speichert jede Änderung sofort lokal und synchronisiert im Hintergrund, sobald wieder Verbindung besteht – ideal fürs Training unterwegs.' }] },
        { id: 'datenschutz', q: 'Sind meine Daten sicher? Was liegt wo?', aliases: ['Datenschutz', 'Privat', 'Server', 'Cloud', 'Open Food Facts', 'Open-Meteo'], body: [
          { steps: [
            'Auf deinem Gerät: eine Kopie deiner Daten, damit die App offline läuft. Mit „Gemeinsames Gerät“ (Einstellungen → Konto) räumt das Abmelden sie wieder ab.',
            'Auf eurem Server: alle Daten aller Personen als Dateien im Ordner „data“ – das ist auch die vollständige Sicherung.',
            'Nach außen: nur die Wetterabfrage und – falls eingeschaltet – die Nährwertsuche (siehe unten). Kein Konto, keine Werbung, kein Tracking.',
          ] },
          { p: 'Deine Daten liegen als Dateien auf deinem eigenen Server oder NAS, nicht in einer fremden Cloud. Zyklus, Labor und Ergänzungen gibt der Server nur nach deiner PIN-Anmeldung heraus – auch nicht an Admins. Alle anderen Daten (Trainings, Pläne, Körperwerte) kann jedes Gerät lesen, das deinen Server erreicht; die App gehört deshalb ins eigene Heimnetz (von außen nur mit einer Anmeldung davor). Wer den Server betreibt, kann alle Dateien lesen.' },
          { p: 'Nach außen gehen nur zwei abschaltbare Zusatzdienste: die Wetterabfrage bei Open-Meteo (vom Gerät, mit Ort bzw. Koordinaten) und – falls eingeschaltet – die Nährwertsuche bei Open Food Facts (vom Server, nur mit dem Zutatennamen).' },
          { p: 'Über die Einstellungen → „Daten & Sicherung“ exportierst du jederzeit dein persönliches Backup (inkl. Zyklus, Labor und Ergänzungen). Admins können zusätzlich ein Familien-Vollbackup aller Mitglieder sichern und im Notfall wiederherstellen – aus Datenschutzgründen ohne die privaten Bereiche.' },
        ] },
        {
          id: 'familie',
          q: 'Können mehrere Personen Cat-O-Fit nutzen?',
          body: [
            { p: 'Ja! Cat-O-Fit ist für dein ganzes Team oder deine Familie (bis zu 32 Personen). Beim Start erscheint die Anmeldung – tippe auf deine Kachel und gib deine PIN ein.' },
            { p: 'Jedes Mitglied hat eigene Pläne, Trainings, Körperwerte und Einstellungen.' },
            { p: 'Admins verwalten Team bzw. Familie (Mehr → „Team verwalten“: Mitglieder anlegen, Rollen, Teams, Einkaufstag) und können ein Mitglied „öffnen“, um z. B. für Kinder oder das Team zu planen – oben steht dann „Du verwaltest gerade …“ mit „Zurück zu mir“. Zyklus, Labor und Ergänzungen bleiben dabei immer privat. Anlegen, Rollen ändern und Entfernen gehen nur mit Verbindung zum Server.' },
            { tip: 'In Einstellungen → Konto legst du selbst fest, ob dein Hauptziel und deine Kennzahlen im gemeinsamen Dashboard sichtbar sind – verborgene Ziele erscheinen dort als „🔒 privat“.' },
            { tip: 'Neu angelegte Mitglieder starten mit der PIN „0000“; bis sie in Einstellungen → Konto eine eigene festlegen (mit der bisherigen PIN), erinnert „Heute“ daran. PIN vergessen? Eine Admin-Person öffnet das Mitglied und setzt sie unter Einstellungen → Konto neu. Hat die einzige Admin-Person ihre PIN vergessen, hilft nur der Betrieb am Server (siehe Fehlersuche).' },
            { link: { label: 'Zum Team/Familie-Dashboard', hash: '#/family' } },
          ],
        },
        {
          id: 'teams',
          q: 'Teams bilden, Mitglieder zuordnen und je Team auswerten',
          body: [
            { p: 'Neben der ganzen Familie kannst du als Admin Teams bilden – z. B. „Team Rot“, „Team Blau“, „Team Grün“. Ein Mitglied kann in MEHREREN Teams gleichzeitig sein, und manche bleiben ganz ohne Team.' },
            { p: 'Teams legst du unter Mehr → „Team verwalten“ an: „Team anlegen“, Name und Symbol wählen und die Mitglieder per Häkchen zuordnen. Für einen Teamwechsel setzt du die Häkchen einfach um – so nimmst du jemanden aus einem Team heraus und ordnest ihn einem anderen (oder zusätzlich einem zweiten) zu.' },
            { p: 'Im Team/Familie-Dashboard schaltest du oben zwischen „Alle“, den einzelnen Teams und „Ohne Team“ um. Alle Kennzahlen – Wochen-Kilometer, Monats-km & Meilenstein, „diese Woche aktiv“ und die Team-Erfolge – werden dann genau für die Mitglieder des gewählten Teams zusammengerechnet.' },
            { tip: 'Ein Mitglied in zwei Teams zählt in beiden mit – praktisch, wenn jemand z. B. in der Laufgruppe UND im Fußballteam ist.' },
            { tip: 'Wird ein Mitglied entfernt, verschwindet es automatisch aus allen Teams – es bleiben keine „Geister“ zurück.' },
            { link: { label: 'Teams verwalten', hash: '#/familie-verwalten' } },
          ],
        },
        { id: 'erinnerungen-zuverlaessig', q: 'Wie zuverlässig sind Erinnerungen?', body: [{ p: 'In-App-Hinweise greifen nur bei geöffneter App. Für verlässliche Erinnerungen exportiere die Einheit in den iOS-Kalender (.ics) – die enthaltene Erinnerung funktioniert auch bei geschlossener App.' }] },
        {
          id: 'kalender-abo',
          q: 'Den Plan im Kalender abonnieren',
          aliases: ['Abo', 'abonnieren', 'webcal', 'ics', 'iCal', 'Kalenderabo', 'Outlook', 'Google Kalender'],
          body: [
            { p: 'Statt einzelne .ics-Dateien zu öffnen, kann dein Kalender einen ganzen Plan abonnieren – alle Einheiten und den Wettkampf. Änderungen holt er sich dann selbst. Abonniert wird immer ein Plan, nicht der Kalender der App.' },
            { steps: [
              'Mehr → „Ziele & Pläne“ → Wettkampf oder Programm öffnen → oben auf das Download-Symbol „Export“ – oder im Plan „…“ → „In Kalender übernehmen (.ics)“.',
              'Im Fenster „In Kalender exportieren“ auf „Abo-Link kopieren“ tippen. Den Knopf gibt es nur mit Verbindung zum Server und nach deiner PIN-Anmeldung.',
              'Den Link in deinem Kalender als Abonnement einfügen:',
            ] },
            { p: 'iPhone/iPad: Kalender-App → „Kalender“ → „Hinzufügen“ → „Kalenderabonnement hinzufügen“.' },
            { p: 'Mac: Kalender → Ablage → „Neues Kalenderabonnement“.' },
            { p: 'Google: im Browser am Computer neben „Weitere Kalender“ auf + → „Per URL“ (in der Google-App geht das nicht).' },
            { p: 'Outlook: „Kalender hinzufügen“ → „Vom Web abonnieren“.' },
            { tip: 'Nur im Heimnetz erreichbar? iCloud, Google und Outlook holen Abos über das Internet ab – einen Server, den sie nicht erreichen, können sie nicht abonnieren. Leg das Abo dann direkt aufs Gerät: am iPhone über iOS-Einstellungen → Apps → Kalender → Kalender-Accounts → Account hinzufügen → Andere → „Kalenderabo hinzufügen“, am Mac mit „Ort: Auf meinem Mac“. Ist eine Anmeldung vorgeschaltet (Basic Auth), trägst du am iPhone dort Benutzername und Passwort ein; Google und Outlook können das nicht.' },
            { tip: 'Der Link zeigt auf den Server, von dem du ihn kopierst, und enthält deinen persönlichen Kalender-Schlüssel – jede Person holt sich ihren eigenen. Wer den Link kennt, kann die Termine lesen: Teile ihn nur mit Menschen, die deinen Plan sehen dürfen.' },
            { tip: 'Kalender fragen Abos in ihrem eigenen Takt ab; bei Outlook kann eine Änderung laut Microsoft über 24 Stunden brauchen. Links aus Versionen vor 3.20.0 (ohne Schlüssel) gelten noch bis 30.11.2026 – danach das Abo einmal neu einrichten.' },
            { link: { label: 'Zu Ziele & Pläne', hash: '#/events' } },
          ],
        },
        {
          id: 'module',
          q: 'Module ein- und ausschalten',
          aliases: ['Modul', 'ausblenden', 'abschalten'],
          body: [
            { p: 'Unter Einstellungen → Module blendest du Bereiche aus, die du nicht brauchst. Alle Module sind anfangs eingeschaltet. Ausgeschaltet verschwinden Menüpunkt und Eintrag unter „＋ Erfassen“; deine Daten bleiben erhalten.' },
            { steps: [
              'Ernährung – Rezepte, Speiseplan, Ess-Tagebuch und Kalorienbilanz.',
              'Einkaufsliste – gemeinsame Einkaufsliste und Vorrat.',
              'Tages-Checkliste – Checkliste & Erinnerungen, auch ihre Termine im Kalender.',
              'Zykluskalender – Zyklus, Phasen im Kalender und die Frage am ersten Periodentag.',
              'Labor & Ergänzung – Laborwerte, Energieversorgung und Ergänzung, auch die Hinweise darauf in der Ernährung.',
            ] },
            { tip: 'Die Schalter gelten pro Person. Beim Verwalten eines Mitglieds bleiben Zyklus und Labor ohnehin verborgen – sie sind privat.' },
            { link: { label: 'Einstellungen öffnen', hash: '#/settings' } },
          ],
        },
        {
          id: 'backup',
          q: 'Datensicherung: drei Ebenen',
          aliases: ['Backup', 'Sicherung', 'Vollbackup', 'Wiederherstellen', 'Mein Backup', '3-2-1'],
          body: [
            { steps: [
              'Der Server-Ordner „data“ ist die vollständige Sicherung – alle Personen, auch Zyklus, Labor und Ergänzungen. Er gehört in die regelmäßige Datensicherung des Servers (z. B. Hyper Backup auf der Synology).',
              'Vollbackup (nur Admins, Einstellungen → Daten & Sicherung): alle Mitglieder, Rollen, Teams, Berichte und Trainingsdaten – ohne die privaten Bereiche.',
              'Mein Backup (alle): deine eigenen Daten inklusive Zyklus, Labor und Ergänzungen. Auf iPhone und iPad über das Teilen-Menü („In Dateien sichern“).',
            ] },
            { tip: 'Bewährt ist die 3-2-1-Regel: drei Kopien, auf zwei verschiedenen Medien, eine davon außer Haus. Das Vollbackup ersetzt die Sicherung des Server-Ordners nicht – nach einem Serververlust fehlten sonst die privaten Bereiche aller, die kein eigenes Backup haben.' },
            { link: { label: 'Zu „Daten & Sicherung“', hash: '#/settings' } },
          ],
        },
        {
          id: 'fehlersuche',
          q: 'Etwas klappt nicht? Fehlersuche',
          aliases: ['Problem', 'Fehler', 'Update', 'PIN vergessen', 'Cache', 'offline', 'weiße Seite', 'Synchronisieren'],
          body: [
            { steps: [
              'Neue Version erscheint nicht: App ganz schließen (iPhone: vom unteren Rand nach oben wischen und wegschieben) und neu öffnen. Die App holt Updates beim Öffnen und wenn sie wieder in den Vordergrund kommt.',
              'Status bleibt „Offline“: Ist der Server im Heimnetz erreichbar (WLAN, VPN)? Änderungen bleiben auf dem Gerät und gehen automatisch raus, sobald er antwortet – nichts geht verloren. „Jetzt synchronisieren“ in Einstellungen → Daten & Sicherung stößt es von Hand an.',
              '„Bitte PIN bestätigen“: Die Anmeldung am Server ist abgelaufen oder nach einem Update neu nötig. Mit der PIN gleichen Zyklus, Labor und Ergänzungen wieder ab; „Später“ verschiebt es bis zum nächsten Öffnen.',
              'PIN vergessen: Eine Admin-Person öffnet das Mitglied und setzt unter Einstellungen → Konto eine neue PIN. Für die einzige Admin-Person gibt es ein Werkzeug für den Server-Betrieb (Doku „Fehlersuche“).',
              '„Die App konnte nicht starten“: Meist liefert der Server eine Datei nicht oder mit falschem Dateityp aus (etwa nach einem unvollständigen Update). Die Meldung nennt die betroffene Datei; die Betriebs-Doku erklärt die Ursachen.',
              'Health-Import meldet einen Fehler: 401 heißt falscher Schlüssel, 403 fehlender Schlüssel – in Health-Import den Schlüssel neu kopieren.',
            ] },
          ],
        },
      ],
    },
    {
      id: 'glossar', title: 'Glossar', icon: 'list',
      articles: [
        {
          id: 'glossar',
          q: 'Begriffe von A bis Z',
          aliases: ['ACWR', 'CTL', 'ATL', 'TSB', 'AU', 'sRPE', 'RPE', 'VDOT', 'HRV', 'RMSSD', 'SDNN', 'FFM', 'RED-S', 'Taper', 'Long Run', 'Momentum', 'Z1', 'Z5', 'Soll-Ist', 'RCV'],
          body: [
            { steps: [
              'Abzeichen – Auszeichnungen für Trainings und erreichte Ziele (Fortschritt → Erfolge).',
              'ACWR (Lastverhältnis) – Belastung der letzten 7 Tage im Verhältnis zum Schnitt der 21 Tage davor.',
              'Belastungspunkte (AU, sRPE) – Minuten × Anstrengung; die gemeinsame Einheit aller Belastungsurteile.',
              'Bereitschaft – Tageswert aus Ruhepuls, HRV und Schlaf im Vergleich zu deinen letzten zwei Wochen.',
              'Einheit – ein geplantes Training im Plan; Training – was du tatsächlich gemacht hast.',
              'Energieversorgung (Energieverfügbarkeit, RED-S) – was nach dem Training von der gegessenen Energie übrig bleibt, je kg fettfreier Masse.',
              'Fettfreie Masse (FFM, Lean Body Mass) – Körpergewicht ohne Fett; gemessen oder aus dem Körperfettwert gerechnet.',
              'Fitness, Ermüdung, Form (CTL, ATL, TSB) – langfristige und kurzfristige Belastung und ihre Differenz.',
              'HF-Zonen (Z1–Z5) – Herzfrequenzbereiche von Regeneration bis VO₂max.',
              'HRV – Herzfrequenzvariabilität; als SDNN (Apple) oder RMSSD (viele Uhren) gemessen – nicht untereinander vergleichbar.',
              'Long Run – der lange, lockere Lauf der Woche.',
              'Momentum – dein Schwung aus den letzten Wochen; pausiert bei Krankheit.',
              'RPE (Anstrengung) – wie anstrengend eine Einheit war, 1 (sehr leicht) bis 10 (maximal).',
              'Soll-Ist – Vergleich von Plan und tatsächlichem Training.',
              'Tapering – die Wochen vor dem Wettkampf mit weniger Umfang, damit du frisch startest.',
              'VDOT – Formwert nach Jack Daniels; daraus entstehen Prognose und Trainingstempo.',
              'Ziel – ein Wettkampf oder ein Trainingsprogramm; beides mit eigenem Plan.',
            ] },
          ],
        },
      ],
    },
  ];
}

/** Artikel samt Abschnitt zu einer ID (oder null). */
export function findArticle(sections, id) {
  for (const section of sections || []) {
    const article = (section.articles || []).find((a) => a.id === id);
    if (article) return { section, article };
  }
  return null;
}

/** Durchsuchbarer Text eines Artikels – inklusive Synonymen (aliases), die nicht angezeigt werden. */
export function articleText(a) {
  const parts = [a.q, ...(a.aliases || [])];
  (a.body || []).forEach((b) => {
    if (b.p) parts.push(b.p);
    if (b.tip) parts.push(b.tip);
    if (b.steps) parts.push(b.steps.join(' '));
    if (b.link) parts.push(b.link.label);
  });
  return parts.join(' ');
}

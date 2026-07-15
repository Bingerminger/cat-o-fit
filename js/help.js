/* =========================================================================
   help.js — Wissensbasis & Hilfe in der App (#/hilfe).
   Use-Case-orientiert + View-Beschreibungen + Trainingswissen.
   Sprache: persönlich, mit Namensansprache über profile.name (Variable!),
   damit die Doku in einer späteren Mehrbenutzer-Version pro Person passt.
   ========================================================================= */

import * as store from './storage.js';
import { el, icon, iconSvg, navigate, debounce } from './ui.js';
import { setHeader } from './router.js';

/** Liefert den Anzeigenamen der aktuell aktiven Person (Mandanten-tauglich). */
function userName() {
  const n = ((store.profile() && store.profile().name) || store.activeMember()?.name || '').trim();
  return n || 'Sportlerin';
}

/* -------------------------------------------------------------------------
   Inhalte. Jeder Artikel hat eine Frage/Überschrift (q) und einen Body aus
   Blöcken: {p}=Absatz, {steps}=Schritte, {tip}=Hinweis, {link}=Verknüpfung.
   {name} wird beim Rendern durch den Namen der aktiven Person ersetzt.
   ------------------------------------------------------------------------- */
function content(name) {
  return [
    {
      id: 'start', title: 'Erste Schritte', icon: 'sparkles',
      articles: [
        {
          q: `Willkommen, ${name}!`,
          body: [
            { p: `Cat-O-Fit ist deine persönliche Fitness- & Health-App, ${name}. Du verfolgst damit deine Ziele – einen Zielwettkampf oder ein Trainingsprogramm ohne Wettkampf (Fitness, Kraft, Abnehmen, Beweglichkeit): Du legst dein Ziel an, bekommst dafür einen Plan, trainierst – und siehst Schritt für Schritt deinen Fortschritt.` },
            { p: 'Alles läuft auf deinem eigenen Server oder NAS und speichert sofort lokal – auch ohne Internet, mitten im Training.' },
            { tip: 'Du kannst die App auf den Home-Bildschirm legen (Teilen-Symbol in Safari → „Zum Home-Bildschirm"). Dann startet sie wie eine echte App im Vollbild.' },
          ],
        },
        {
          q: 'Wie ist alles aufgebaut?',
          body: [
            { p: 'Cat-O-Fit trennt klar zwischen Planung und Ausführung:' },
            { steps: [
              'Veranstaltung (z. B. dein Halbmarathon) – das Ziel.',
              'Trainingsplan – automatisch in Phasen bis zum Wettkampf.',
              'Geplante Einheiten – im Kalender, verschiebbar.',
              'Durchgeführte Trainings – das, was du tatsächlich gelaufen bist (Soll-Ist).',
            ] },
            { link: { label: 'Zum Dashboard', hash: '#/' } },
          ],
        },
        {
          q: 'Anmelden, wechseln & abmelden',
          body: [
            { p: 'Beim allerersten Start richtet ein kurzer Assistent die App ein: zuerst eine:n Admin anlegen, dann Demodaten laden oder leer starten. Danach zeigt Cat-O-Fit abgemeldet nur den Anmelde-Dialog – die Menüs erscheinen erst nach der Anmeldung.' },
            { steps: [
              'Tippe auf deine Kachel und gib – falls gesetzt – deine PIN ein. Danach erscheinen die Menüs und du landest auf „Heute".',
              'Profil wechseln gibt es nicht mehr separat: einfach abmelden – du landest direkt wieder beim Anmelde-Dialog.',
              'Abmelden: am iPhone über „Mehr → Abmelden", am iPad unten in der Seitenleiste – oder in Einstellungen → Konto.',
            ] },
            { tip: 'Aus Sicherheitsgründen meldet ein Neuladen oder Neustart der App immer ab – du wählst dann wieder dein Profil. Auf einem gemeinsam genutzten iPad bleibt so nichts offen.' },
            { p: 'Der Menüpunkt „Team/Familie" ist (nach dem Login) eure gemeinsame Übersicht mit Team-Badges. Die Verwaltung (Mitglieder anlegen, App zurücksetzen) liegt in Einstellungen → Team/Familie und ist nur für Admins sichtbar.' },
          ],
        },
      ],
    },
    {
      id: 'usecases', title: 'So erreichst du dein Ziel', icon: 'target',
      articles: [
        {
          q: 'Einen Wettkampf anlegen und den Plan erstellen',
          body: [
            { steps: [
              'Öffne „Ziele" und tippe auf „+" → wähle „Wettkampf".',
              'Gib Name, Datum, Distanz und Zielzeit ein, wähle die Priorität (A = Hauptwettkampf).',
              'Speichern – du landest auf der Ziel-Seite.',
              'Tippe auf „Plan erstellen". Cat-O-Fit verteilt die Wochen automatisch in die Phasen Grundlage → Aufbau → Spitze → Tapering – und startet den Long-Run-Aufbau bei deinem aktuellen Niveau, wenn du schon längere Läufe absolviert hast.',
            ] },
            { tip: `Die Zielpaces für die Einheiten leitet Cat-O-Fit aus deiner Zielzeit ab – du musst nichts rechnen, ${name}.` },
            { link: { label: 'Zu deinen Zielen', hash: '#/events' } },
          ],
        },
        {
          q: 'Ein Trainingsprogramm ohne Wettkampf starten',
          body: [
            { p: 'Du willst einfach fit, kräftig oder gesünder werden – ohne Wettkampf? Dann lege ein Trainingsprogramm an.' },
            { steps: [
              'Öffne „Ziele" und tippe auf „+" → wähle „Trainingsprogramm".',
              'Wähle einen Schwerpunkt: Allgemeine Fitness, Kraft & Muskelaufbau, Abnehmen & Gewicht oder Beweglichkeit & Gesundheit.',
              'Lege Trainingstage pro Woche (3–5) und die Dauer (4, 8 oder 12 Wochen) fest.',
              'Speichern & Plan erstellen – der wiederkehrende Wochenplan steht sofort.',
            ] },
            { tip: 'Die Einheiten erscheinen überall wie gewohnt: Kalender, „Heute", Session-Ansicht mit Workout-Modus und Statistik. Mit „Plan neu erstellen" erzeugst du die Wochen jederzeit frisch.' },
            { link: { label: 'Zu deinen Zielen', hash: '#/events' } },
          ],
        },
        {
          q: 'Ein Training durchführen',
          body: [
            { steps: [
              'Tippe auf dem Dashboard oder im Kalender auf die heutige Einheit.',
              'Du siehst das Soll (Distanz, Zielpace, HF-Zone). Tippe „Training starten".',
              'Im Workout-Modus läuft die Uhr; bei Intervallen führt dich Cat-O-Fit mit Ton durch Belastung und Pause.',
              'Am Ende „Beenden" → Distanz, Anstrengung (RPE) und Gefühl eintragen → fertig.',
            ] },
            { tip: 'Bei langen Läufen erinnert dich Cat-O-Fit automatisch ans Trinken. Der Bildschirm bleibt während des Trainings an.' },
          ],
        },
        {
          q: 'Ein Training ohne Uhr nachtragen',
          body: [
            { p: 'Du bist ohne Handy gelaufen oder hast es vergessen? Kein Problem.' },
            { steps: [
              'Öffne die Einheit (Dashboard, Kalender oder Plan).',
              'Tippe „Als erledigt erfassen".',
              'Trage ein, was du weißt (Distanz, Zeit, Gefühl) – alles ist optional.',
            ] },
          ],
        },
        {
          q: 'Eine Einheit verschieben',
          body: [
            { p: 'Das Leben kommt dazwischen – verschiebe Einheiten einfach.' },
            { steps: [
              'Öffne den Kalender und wechsle zur Wochenansicht.',
              'Halte eine Einheit am Griff (⠿) gedrückt und zieh sie auf einen anderen Tag.',
              'Alternativ: Einheit öffnen → „Verschieben" → neues Datum.',
            ] },
            { tip: 'Im „Verschieben"-Dialog warnt Cat-O-Fit, wenn am Zieltag schon eine Einheit liegt oder direkt daneben eine fordernde Einheit (Tempo, Intervalle, Kraft, Long Run) steht – damit Erholung nicht untergeht. Der Hinweis blockiert nichts; du verschiebst trotzdem, wenn du willst.' },
            { link: { label: 'Zum Kalender', hash: '#/calendar' } },
          ],
        },
        {
          q: 'Einheiten anpassen, ergänzen oder aufholen',
          body: [
            { p: 'Dein Plan gehört dir – passe ihn an, wann immer du willst.' },
            { steps: [
              'Öffne eine Einheit und tippe oben aufs Stift-Symbol: Art, Zielpace, HF-Zone, Intervallstruktur, Distanz und Beschreibung sind editierbar.',
              'Über das „+" im Trainingsplan legst du eine ganz neue Einheit an – mit großer Auswahl an Sportarten: Schwimmen, Wandern, Rudern, Tennis, Badminton, Squash, Tischtennis, Indoor-Cycling, Crosstrainer, Gerätetraining und mehr.',
              'Im Bearbeiten-Dialog kannst du eine Einheit auch löschen.',
            ] },
            { tip: 'Legst du eine Einheit selbst an und liegt in derselben Woche schon eine ähnlich intensive, bietet Cat-O-Fit an, diese aus dem Plan zu nehmen – so bleibt die Wochenbelastung konstant. Du entscheidest: „Aus Plan nehmen" oder „Beide behalten".' },
            { tip: 'Hat sich für eine Woche etwas grundlegend geändert (z. B. Saisonstart, Trainingslager)? In der Wochenübersicht des Plans berechnet „Diese Woche neu berechnen" nur diese eine Woche frisch – bereits erledigte Trainings bleiben erhalten.' },
            { tip: 'Verpasst? Vergangene, offene Einheiten erscheinen als „überfällig". Im Dashboard erinnert dich ein Hinweis ans Verschieben, Nachtragen oder Abhaken.' },
            { tip: 'Hast du eine Schlüsseleinheit (Tempo, Intervalle, Long Run, Kraft) als verpasst markiert, bietet das Dashboard an, sie auf einen freien Tag der nächsten Woche nachzuholen – statt sie verfallen zu lassen.' },
          ],
        },
        {
          q: 'Deine Körperwerte pflegen',
          body: [
            { steps: [
              'Öffne „Werte" und tippe „+".',
              'Trage z. B. Gewicht, Ruhepuls oder Schlaf ein – nur was du möchtest.',
              'Die Verläufe zeigen deinen Trend mit Y-Skala, beim Gewicht mit Ziellinie.',
            ] },
            { tip: 'Genauer Wert gefällig? Zieh den Finger über ein Diagramm (am Rechner: Maus darüber) – eine Führungslinie springt zum nächsten Punkt und zeigt Datum + Wert.' },
            { tip: 'Die Darstellung ist bewusst wertfrei: Es geht um den Trend, nicht um tägliche Schwankungen. Einzelne Werte kannst du in den Einstellungen ausblenden.' },
            { link: { label: 'Zu den Körperwerten', hash: '#/health' } },
          ],
        },
        {
          q: 'Apple Health automatisch importieren (empfohlen)',
          body: [
            { p: `Deine Quellen (Garmin, Apple Watch, Withings …) schreiben nach Apple Health. Dein iPhone kann die wichtigsten Werte dann täglich und automatisch an Cat-O-Fit schicken, ${name} – Gewicht, Ruhepuls, HRV, VO₂max, Schlaf, Schritte, aktive Energie und Workouts. Kein großer Upload.` },
            { p: 'Möglich macht das die App „Health Auto Export – JSON+CSV" (App Store). Einrichtung:' },
            { steps: [
              'In Cat-O-Fit: Mehr → Health-Import → „Auto-Import aktivieren" → Endpunkt-URL kopieren.',
              'In „Health Auto Export": Automations → + → „REST API"; die URL einfügen, POST, Format JSON (v2).',
              'Unter „Headers" die Web-Anmeldung als „Authorization: Basic …" ergänzen (dieselbe wie beim Öffnen der Seite).',
              'Metriken + Workouts wählen, Aggregation „Daily", Zeitraum „Since last sync" → speichern → „Run now".',
            ] },
            { tip: 'Kontrolle: In Health-Import zeigt „Zuletzt importiert" die übernommenen Tageswerte. Vorhandene manuelle Einträge bleiben erhalten (Werte werden gemergt, doppelte Workouts erkannt). Für die 10-Jahre-Historie einmalig größere Zeiträume in Monats-Batches senden.' },
            { p: 'Alternativ – manueller Voll-Import: iPhone → Health-App → Profilbild → „Alle Gesundheitsdaten exportieren", die ZIP unter Health-Import hochladen. Oder eine einzelne GPX-/TCX-Datei (Garmin/Strava) direkt hochladen – wird als absolvierter Lauf erfasst.' },
            { link: { label: 'Zum Health-Import', hash: '#/import' } },
          ],
        },
        {
          q: 'Erinnerungen aufs iPhone bekommen',
          body: [
            { p: 'Der zuverlässigste Weg auf iPhone/iPad ist der native Kalender.' },
            { steps: [
              'Öffne eine Einheit oder den Plan und tippe auf das Export-Symbol.',
              'Wähle „Kompletter Plan", „Diese Einheit" oder „Nur Wettkampf".',
              'Die .ics-Datei öffnet sich im iOS-Kalender – inklusive Erinnerung 1 Std. vorher und am Vorabend.',
            ] },
          ],
        },
        {
          q: 'Deinen Fortschritt verstehen',
          body: [
            { p: 'Unter „Statistik" siehst du auf einen Blick, wo du stehst – ganz oben die Ampel „Bin ich auf Plan?".' },
            { steps: [
              'Ampel (grün/gelb/rot): fasst Einhaltung, Last und Ausfälle der letzten 4 Wochen zusammen – mit Begründung.',
              'Plan-Einhaltung: wie viele fällige Einheiten du im 4-Wochen-Fenster erledigt hast.',
              'Wochenumfang & Trainingslast: deine Belastung im Verlauf (7 vs. 28 Tage).',
              'Ausgefallene Einheiten: nach Grund – verletzungs-/krankheitsbedingte zählen nicht gegen dich.',
              'Werte & Ziele: Gewicht, Umfang, Tempo, Ruhepuls & VO₂max mit Trendpfeil und „halten/verbessern".',
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
        { q: 'Heute (Dashboard)', body: [{ p: 'Dein Startbildschirm: heutige Einheit, Countdown zum nächsten Wettkampf, Wochenüberblick, deine Wochenziele (aktive Minuten & Trainingstage als Ringe), deine Gesundheitsziele mit Fortschrittsbalken und Schnellzugriffe.' }, { link: { label: 'Öffnen', hash: '#/' } }] },
        { q: 'Kalender', body: [{ p: 'Monats- und Wochenansicht aller geplanten Einheiten. In der Woche kannst du per Drag & Drop verschieben. Jeder Eintrag führt zur Session.' }, { link: { label: 'Öffnen', hash: '#/calendar' } }] },
        { q: 'Ziele', body: [{ p: 'Deine Wettkämpfe und Trainingsprogramme an einem Ort – anlegen, bearbeiten, Plan erstellen. Wettkämpfe mit Countdown und Priorität, Programme mit Schwerpunkt und Trainingstagen pro Woche.' }, { link: { label: 'Öffnen', hash: '#/events' } }] },
        { q: 'Trainingsplan', body: [{ p: 'Der periodisierte Plan eines Events: Phasen-Zeitstrahl, Wochenübersicht und alle Einheiten. Hier kannst du auch neu generieren oder exportieren.' }] },
        { q: 'Session-Ansicht', body: [{ p: 'Eine einzelne Einheit in drei Zuständen: geplant (Soll + Start), in Ausführung (Workout) und absolviert (Auswertung mit Soll-Ist-Vergleich).' }] },
        { q: 'Workout-Modus', body: [{ p: 'Vollbild fürs Training: große Bedienelemente, Stoppuhr bzw. Intervall-Steuerung, Satz-Zähler fürs Krafttraining, Trinkpausen-Erinnerung.' }] },
        { q: 'Werte', body: [{ p: 'Deine Körperwerte als Trends mit Y-Skala und Zielmarkierung – Finger oder Maus übers Diagramm zeigt Datum + Wert. Erfassen, bearbeiten, importieren.' }, { link: { label: 'Öffnen', hash: '#/health' } }] },
        { q: 'Statistik', body: [{ p: 'Ampel „Bin ich auf Plan?", Plan-Einhaltung, Wochenumfang, Trainingsjahr-Heatmap, Trainingslast, ausgefallene Einheiten nach Grund, Einheiten-Verteilung, Werte & Ziele (halten/verbessern) und Wettkampfprognose.' }, { link: { label: 'Öffnen', hash: '#/stats' } }] },
        { q: 'Erfolge & Momentum', body: [{ p: 'Dein Schwung-Wert und alle Abzeichen mit Fortschritt – erreichte farbig, offene mit Fortschrittsbalken.' }, { link: { label: 'Öffnen', hash: '#/badges' } }] },
        { q: 'Übungs-Bibliothek', body: [
          { p: '29 Übungen für Kraft, Rumpf & Beweglichkeit – jede mit symbolhafter Illustration (Strichfigur), Schritt-für-Schritt-Anleitung, Muskelgruppen, Equipment, Schwierigkeit und Tipp. Darunter u. a. Rücken-/Hüft-Dehnungen und Bauch-/Rücken-/Bein-Kraft.' },
          { steps: [
            'Oben nach Kategorie (Kraft/Rumpf/Beweglichkeit) UND nach Körperregion (Rücken, Hüfte, Bauch, Beine, Oberkörper) filtern – oder im Textfeld suchen.',
            'Jede Übung zeigt einen Nutzungszähler („3×"), wie oft du sie schon gemacht hast.',
            'Im Detail zählst du per „Gemacht (+1)" hoch – oder es zählt automatisch, wenn du eine damit verknüpfte Trainingseinheit erledigst.',
            'Kraft- und Mobility-/Regenerations-Einheiten schlagen dir passende Übungen vor – nach deiner Nutzungshäufigkeit sortiert. Mit „+" hängst du eine Übung an die Einheit.',
          ] },
          { p: 'Die Darstellungen sind bewusst symbolisch und ersetzen keine individuelle Anleitung.' },
          { link: { label: 'Öffnen', hash: '#/uebungen' } },
        ] },
        { q: 'Berichte & Urkunden', body: [{ p: 'Erzeuge unveränderliche Belege deiner Entwicklung: Monatsbericht, Wettkampf-Bericht (Vorbereitung + Ergebnis) oder eine Urkunde für ein erreichtes Ziel. Einmal erstellt, bleiben sie erhalten und lassen sich drucken oder als PDF speichern – alles lokal.' }, { link: { label: 'Öffnen', hash: '#/reports' } }] },
        { q: 'Ernährung, Einkauf & Checkliste', body: [{ p: 'Proteinbetonte Mahlzeiten-Ideen mit Rezept-Vorschlägen, eine Kalorienbilanz für heute, eine automatische Einkaufsliste mit Lager (aus dem Wochen-Speiseplan) und „Checkliste & Erinnerungen": tägliche Routinen oder Termine mit Datum/Uhrzeit. Termine erscheinen automatisch auch im Kalender (Wochen- und Monatsansicht) und lassen sich zusätzlich als .ics exportieren – plus Vorlagen wie die Wettkampf-Vorbereitung. In den Einstellungen abschaltbar.' }] },
        { q: 'Einstellungen', body: [{ p: 'Profil, Herzfrequenz-Zonen, Pace-Bereiche, Theme & Akzentfarbe, Module, sichtbare Werte sowie „Daten & Sicherung" (persönliches Backup für alle, Familien-Vollbackup & Wiederherstellung für Admins).' }, { link: { label: 'Öffnen', hash: '#/settings' } }] },
      ],
    },
    {
      id: 'knowledge', title: 'Trainingswissen', icon: 'info',
      articles: [
        {
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
          q: 'Herzfrequenz-Zonen',
          body: [
            { p: 'Cat-O-Fit nutzt fünf Zonen, abgeleitet aus deiner maximalen Herzfrequenz:' },
            { steps: [
              'Z1 Regeneration – ganz locker.',
              'Z2 Grundlage – „unterhaltsames" Tempo, hier passiert die Ausdauer.',
              'Z3 Tempo – zügig, aber kontrolliert.',
              'Z4 Schwelle – schnell, „komfortabel hart".',
              'Z5 VO₂max – sehr hart, nur kurz.',
            ] },
            { tip: 'Max-HF und Ruhepuls kannst du in den Einstellungen anpassen – die Zonen rechnen sich neu.' },
          ],
        },
        {
          q: 'Pace-Bereiche (Tempo)',
          body: [{ p: 'Jeder Einheitstyp hat einen Tempobereich in min/km, abgeleitet aus deiner Zielzeit. Sie sind ein Vorschlag, kein Muss – Tagesform zählt.' }],
        },
        {
          q: 'RPE – wie anstrengend war\'s?',
          body: [{ p: 'RPE (1–10) ist dein subjektives Belastungsempfinden. Es ergänzt Herzfrequenz und Pace – gerade an Tagen, an denen sich Zahlen „anders anfühlen". 1 = sehr leicht, 10 = maximal.' }],
        },
        {
          q: 'Trainingslast & Erholung',
          body: [
            { p: 'Die Statistik zeigt deine Lauf-Kilometer der letzten 7 vs. 28 Tage – nur zur Orientierung. Steigt die Belastung sehr schnell, plane bewusst Erholung ein. Cat-O-Fit gibt keine Versprechen zu Verletzungsschutz, sondern Anhaltspunkte.' },
            { tip: 'Die Kennzahl „Belastung · 7 Tage" rechnet Dauer × Intensität über alle Sportarten – so zählen auch Kraft, Fußball, Rad oder ein Testspiel mit, nicht nur die Lauf-km.' },
            { tip: 'Der Coach passt sich in beide Richtungen an: Waren deine letzten Einheiten sehr fordernd, schlägt das Dashboard eine Entlastungswoche vor (Umfang runter); waren sie eher locker und du hast Reserven, kannst du die kommende Woche etwas steigern.' },
          ],
        },
        {
          q: 'Aktuelle Form & Zielpaces (VDOT) – so nutzt du sie',
          body: [
            { p: 'Auf „Heute" schätzt die Karte „Aktuelle Form" aus deinen jüngsten Lauf-Leistungen einen VDOT (eine Form-/Leistungskennzahl nach Jack Daniels) und leitet daraus passende Trainingsbereiche ab. Direkt darüber steht die Karte „Deine Trainingsbereiche" mit den aktuellen Plan-Zielpaces – so kannst du beide unmittelbar vergleichen.' },
            { p: 'So liest du die Karte:' },
            { steps: [
              'Der VDOT-Chip (z. B. „VDOT 41.9") ist deine geschätzte aktuelle Leistung.',
              '„geglättet über 7 Wochen · zuletzt 8,0 km in 38:00 am Mi, 1. Juli" heißt: Die Form ist NICHT ein einzelner Lauf, sondern ein geglätteter Wert aus deinen letzten Wochen – je Woche zählt dein bester Lauf, jüngere Wochen mehr, und einzelne Ausreißer werden gekappt. „zuletzt …" nennt deinen jüngsten Qualitätslauf.',
              'So springt die Form NICHT bei einem einzelnen sehr schnellen (oder langsamen) Tag – sie bildet deinen stabilen Trend ab.',
              'Locker / Schwelle / Intervalle sind die Paces, die zu dieser Form passen.',
              'Die Zeile darunter vergleicht Form und Plan, z. B. „Deine Form ist rund 7 s/km schneller als deine Plan-Zielpaces – Zeit, sie zu schärfen." Passt beides zusammen, steht dort „passen gut zu deiner aktuellen Form".',
            ] },
            { p: 'Anpassen mit einem Tap:' },
            { steps: [
              'Tippe auf „Trainingsbereiche an deine Form anpassen".',
              'Cat-O-Fit übernimmt die Form-Paces sofort in deine Trainingsbereiche UND in alle offenen, künftigen Lauf-Einheiten deines Plans – du musst nichts extra „neu berechnen".',
              'Danach zeigt die Karte „passen gut" – Form und Plan sind wieder deckungsgleich.',
            ] },
            { tip: 'Mit den Demodaten zum Durchspielen: Noras geglättete Form liegt bei ~VDOT 40, ihr Plan zielt noch etwas langsamer (Schwelle 5:05–5:18/km) – deshalb bietet die Karte „schärfen" an. Ein Tap übernimmt die schärferen Paces in den Plan. Ein einzelner Ausreißer-Tag verschiebt die Form NICHT – sie wird über mehrere Wochen geglättet (keine Labordiagnostik).' },
          ],
        },
        {
          q: 'Trinkpausen im Long Run',
          body: [
            { p: 'Bei langen Läufen blendet der Workout-Modus regelmäßig eine Trink-Erinnerung ein (mit Ton & Vibration) – damit du auf langen Strecken nicht aufs Trinken vergisst. Tipp: lieber oft kleine Schlucke als selten viel.' },
            { tip: 'Du kannst das Intervall pro Einheit selbst setzen: im Bearbeiten-Dialog unter „Trinkpause alle (min)". Leer = automatisch je Typ, 0 = aus.' },
          ],
        },
        {
          q: 'Was zeigt mir der Coach?',
          body: [
            { p: `Der Coach auf dem Dashboard reagiert auf dein Verhalten, ${name}:` },
            { steps: [
              'Bereitschaft – aus HRV, Ruhepuls und Schlaf: wie erholt du heute bist.',
              'Belastung – aus dem RPE deiner letzten Einheiten: zu hart, ausgewogen oder noch Luft nach oben.',
              'Formprognose & aktuelle Form (VDOT) – deine geschätzte Wettkampfzeit und passende Trainings-Paces.',
              'Tagesanpassung – ist die Bereitschaft niedrig und steht eine harte Einheit an, kannst du sie mit „Heute lockerer machen" in eine lockere Variante wandeln.',
              'Wochenumfang ausgleichen – sind Lauf-km der Woche liegen geblieben, kannst du einen Teil per Tap behutsam auf die nächste lockere Einheit legen.',
              'Bereit für mehr? – aus dem RPE-Trend empfiehlt der Coach behutsam zu steigern, den Kurs zu halten oder eine lockere Phase einzulegen.',
            ] },
            { tip: 'Das sind Empfehlungen, keine Vorschriften – Änderungen am Plan passieren nur, wenn du sie auslöst (z. B. „Heute lockerer machen" oder „an Form anpassen").' },
          ],
        },
        {
          q: 'Belastung & Form verstehen (ACWR, Fitness/Form)',
          body: [
            { p: 'Die Karte „Belastung & Form" auf „Heute" fasst deine Trainingslast nach Profisport-Standard zusammen – über alle Sportarten hinweg (Laufen, Kraft, Fußball …), berechnet aus Dauer × Anstrengung (RPE).' },
            { steps: [
              'ACWR (akut:chronisch) – deine letzten 7 Tage im Verhältnis zu den letzten 28. Der grüne Sweet-Spot liegt bei 0,8–1,3; deutlich darüber steigt das Überlastungsrisiko, darunter geht Fitness verloren.',
              'Fitness / Ermüdung / Form – langfristige Fitness (CTL) minus kurzfristige Ermüdung (ATL) ergibt deine Form (TSB): positiv = frisch, stark negativ = tief in der Ermüdung.',
              'Monotonie & Strain – zu gleichförmige Wochen erhöhen das Risiko; ein gesunder Wechsel aus harten und leichten Tagen senkt es.',
            ] },
            { tip: 'Diese Werte speisen auch den automatischen Erholungstag – siehe „Automatischer Erholungstag & rollierende Planung".' },
          ],
        },
        {
          q: 'Feste Termine einplanen (Fußball & Spiele)',
          body: [
            { p: 'Wiederkehrende feste Termine trägst du einmal ein – der Trainingsplan legt sich dann darum herum.' },
            { steps: [
              'Fußball-Trainingstage wählen (z. B. Mo & Mi), Dauer und Intensität (leicht/normal/intensiv) angeben.',
              'Wiederkehrende Spiele mit Startdatum eintragen (z. B. „ab 19.08. jeden Sonntag, 2 h") – sie zählen als harte Belastung.',
              'An einem Spieltag entfällt die geplante Trainingseinheit; die Woche wird um die festen Termine herum geplant.',
            ] },
            { tip: 'Fußball ist HIIT-artig und kostet viel Energie: Ab „normal" zählt ein Fußballtag als fordernder Tag (fließt voll in ACWR/Form ein), und nach einem intensiven Fußball schlägt der Coach vor, den Folgetag lockerer anzugehen.' },
          ],
        },
        {
          q: 'Automatischer Erholungstag & rollierende Planung',
          body: [
            { p: 'Cat-O-Fit plant rollierend: Statt eines starren Blocks passt sich die kommende Woche an das an, was du tatsächlich getan hast.' },
            { steps: [
              'Steigt deine Belastung zu schnell (ACWR-Sprung) oder häufen sich harte Tage, schlägt der Coach einen Erholungstag vor.',
              'Liegen an dem Tag zwei Einheiten (etwa aus zwei Zielen), wird der ganze Tag ruhig gestellt – oder du verschiebst eine auf einen freien Tag (entzerren).',
              'Trägst du einen Periodenbeginn ein, wird das Training am 1. Periodentag automatisch entschärft.',
              'Jede automatische Anpassung steht transparent im Log „Zuletzt automatisch angepasst" und ist mit einem Tap rückgängig.',
            ] },
            { tip: 'Nichts ändert sich heimlich – Anpassungen sind sichtbar und umkehrbar.' },
          ],
        },
        {
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
          q: 'Ziel-Cockpit: Halbmarathon + Abnehmen zusammen',
          body: [
            { p: 'Zwei Ziele gleichzeitig? Das Ziel-Cockpit bündelt Leistungsziel (z. B. Halbmarathon) und Abnehmen in einem Blick.' },
            { steps: [
              'Der Schwerpunkt wandert mit der Trainingsphase: im Aufbau darf das Kaloriendefizit etwas größer sein, in der Spitzen-/Wettkampfphase steht die Leistung vorn (kleineres Defizit).',
              'Eine Defizit-Empfehlung koppelt an deine Ernährung/Kalorienbilanz.',
              'Ein ehrlicher Reiz-Check warnt, wenn zu wenig Trainingsreiz für Fortschritt gesetzt wird oder das Defizit die Qualität der harten Einheiten gefährdet.',
            ] },
            { tip: 'So nimmst du ab, ohne die Schlüsseleinheiten zu ruinieren.' },
          ],
        },
        {
          q: 'Wie setze ich ein Gesundheitsziel?',
          body: [
            { p: 'Neben den Wochenzielen (aktive Minuten & Trainingstage) kannst du dedizierte Zielwerte für Körperwerte festlegen.' },
            { steps: [
              'Einstellungen → Gesundheitsziele → „+ Ziel".',
              'Metrik wählen (Gewicht, Körperfett, Ruhepuls, HRV oder VO₂max), Zielwert und optional ein Zieldatum eintragen.',
              'Dein aktueller Wert wird als Startpunkt gemerkt; der Fortschritt zählt von dort zum Ziel.',
              'Auf „Heute" erscheint die Karte „Gesundheitsziele" mit Fortschrittsbalken je Ziel.',
            ] },
            { tip: 'Der Fortschritt aktualisiert sich mit jedem neuen Wert unter „Werte" (oder per Apple-Health-Import).', link: { label: 'Zu den Einstellungen', hash: '#/settings' } },
          ],
        },
        {
          q: 'Wie funktionieren Erfolge & Momentum?',
          body: [
            { p: 'Für durchgeführte Trainings und erreichte Ziele schaltest du Abzeichen frei – automatisch und mit einer kleinen Feier.' },
            { p: 'Das Momentum ist deine „Schwung-Flamme": Sie wächst, wenn du dranbleibst, und schrumpft sanft bei Lücken. Sie ist als Anstoß gedacht, nie als Strafe.' },
            { link: { label: 'Zu Erfolge & Momentum', hash: '#/badges' } },
          ],
        },
        {
          q: 'Wie lernt Cat-O-Fit meine Vorlieben?',
          body: [
            { p: 'In der Ernährung markierst du Lieblingsgerichte mit ♥ und tippst nach dem Kochen auf „Gekocht". Daraus lernt Cat-O-Fit, welche Tags (z. B. proteinreich, vegetarisch) du bevorzugst, und schlägt Passendes unter „Für dich" vor.' },
            { p: 'Auch die Tages-Checkliste merkt sich häufig Genutztes und bietet es als Schnell-Hinzufügen an.' },
          ],
        },
        {
          q: 'Wie funktioniert die Kalorienbilanz?',
          body: [
            { p: 'Oben in der Ernährung siehst du deine Tagesbilanz: verbraucht gegen eingenommen.' },
            { steps: [
              'Verbraucht = Grundumsatz (aus Größe, Gewicht, Geburtsjahr, Geschlecht) + Alltag + dein heutiges Training.',
              'Eingenommen = die Einträge deines Ess-Tagebuchs für heute. „Gekocht" und „Gegessenes erfassen" schreiben dort hinein; „Heute gegessen" listet sie (einzeln löschbar).',
              'Das Tagesziel richtet sich nach deinem Zielgewicht (abnehmen/halten/zunehmen).',
            ] },
            { tip: 'Beim Anlegen einer Mahlzeit schätzt der Knopf „schätzen" die kcal grob aus den Zutaten. Alles ist als Orientierung gedacht – keine Diät-Beratung.' },
            { p: 'Für die Bilanz brauchst du im Profil Größe, Gewicht und Geburtsjahr; Geschlecht macht den Grundumsatz genauer.' },
          ],
        },
        {
          q: 'Wie funktioniert die Einkaufsliste?',
          body: [
            { p: 'Die Einkaufsliste ist gemeinsam und entsteht automatisch aus den Speiseplänen aller Mitglieder:' },
            { steps: [
              'Jedes Mitglied plant in der Ernährung Gerichte mit Portionen für die Woche (Warenkorb-Symbol).',
              'Cat-O-Fit zieht alle geplanten Gerichte zusammen, aggregiert die Zutaten (z. B. Haferflocken mehrerer Personen zu einer Menge) und zieht das gemeinsame Lager ab – die Liste zeigt genau, was ihr braucht.',
              'Beim Einkauf „Alles eingekauft" tippen: Die Mengen wandern ins gemeinsame Lager. „Gekocht" bucht sie wieder ab.',
            ] },
            { tip: 'Der Einkaufstag gilt für alle und wird von Admins in der Team-/Familienverwaltung gesetzt (Standard Dienstag).' },
            { link: { label: 'Zur Einkaufsliste', hash: '#/shopping' } },
          ],
        },
        {
          q: 'Wie nutze ich das Wetter im Plan?',
          body: [
            { steps: [
              'Einstellungen → „Standort & Wetter" öffnen und deine Stadt suchen.',
              'Im Kalender erscheinen für die nächsten Tage kleine Wettersymbole mit Temperatur.',
              'Bei Hitze, Regen oder Sturm zeigt die jeweilige Einheit einen passenden Hinweis.',
            ] },
            { tip: 'Wetterdaten kommen von Open-Meteo. Ohne Internet bleibt der zuletzt geladene Stand – die App läuft normal weiter.' },
          ],
        },
        {
          q: 'Was macht der Zykluskalender?',
          body: [
            { p: 'Aktiviere ihn in den Einstellungen (Module) und markiere deinen Periodenbeginn. Cat-O-Fit berechnet daraus deine Zykluslänge, die aktuelle Phase (Menstruation/Follikel/Ovulation/Luteal) und die Prognose der nächsten Periode.' },
            { p: 'An deinen Menstruationstagen sind Einheiten „geschützt": Du kannst sie ohne Wertung verschieben oder auslassen – sie zählen nicht als verpasst und schmälern weder Plan-Einhaltung noch Momentum. Trainierst du trotzdem, gibt es das Abzeichen „Harte Kämpferin" 🥊.' },
            { tip: 'Sensible Daten bleiben lokal auf deinem eigenen Server – das Modul ist jederzeit abschaltbar.' },
            { link: { label: 'Zum Zykluskalender', hash: '#/zyklus' } },
          ],
        },
      ],
    },
    {
      id: 'faq', title: 'Gut zu wissen', icon: 'bell',
      articles: [
        { q: 'Funktioniert die App offline?', body: [{ p: 'Ja. Cat-O-Fit speichert jede Änderung sofort lokal und synchronisiert im Hintergrund, sobald wieder Verbindung besteht – ideal fürs Training unterwegs.' }] },
        { q: 'Sind meine Daten sicher?', body: [{ p: 'Deine Daten liegen als Dateien auf deinem eigenen Server oder NAS, nicht in einer fremden Cloud. Über die Einstellungen → „Daten & Sicherung" kannst du jederzeit dein persönliches Backup exportieren (inkl. deiner privaten Zyklusdaten). Admins können zusätzlich ein Familien-Vollbackup aller Mitglieder sichern und im Notfall autoritativ wiederherstellen – aus Datenschutzgründen ohne fremde Zyklusdaten.' }] },
        {
          q: 'Können mehrere Personen Cat-O-Fit nutzen?',
          body: [
            { p: `Ja! Cat-O-Fit ist für dein ganzes Team oder deine Familie (bis zu 32 Personen). Beim Start erscheint das Team/Familie-Dashboard – tippe auf deine Kachel, um dich anzumelden, ${name}.` },
            { p: 'Jedes Mitglied hat eigene Pläne, Trainings, Körperwerte und Einstellungen.' },
            { p: 'Admins verwalten Team bzw. Familie (Mitglieder anlegen, Rollen, Einkaufstag) und können ein Mitglied „öffnen", um z. B. für Kinder oder Spielerinnen zu planen. Zyklusdaten bleiben dabei immer privat.' },
            { tip: 'In Einstellungen → Konto legst du selbst fest, ob dein Hauptziel und deine Kennzahlen im gemeinsamen Dashboard sichtbar sind – verborgene Ziele erscheinen dort als „🔒 privat".' },
            { tip: 'Neu angelegte Mitglieder bekommen einen PIN (Standard „0000"), den du in Einstellungen → Konto jederzeit änderst. Die App startet immer abgemeldet; anmelden über deine Kachel, abmelden über „Mehr → Abmelden" (iPhone), die Seitenleiste (iPad) oder Einstellungen → Konto.' },
            { link: { label: 'Zum Team/Familie-Dashboard', hash: '#/family' } },
          ],
        },
        {
          q: 'Teams bilden, Mitglieder zuordnen und je Team auswerten',
          body: [
            { p: 'Neben der ganzen Familie kannst du als Admin Teams bilden – z. B. „Team Rot", „Team Blau", „Team Grün". Ein Mitglied kann in MEHREREN Teams gleichzeitig sein, und manche bleiben ganz ohne Team.' },
            { p: 'Teams legst du in Einstellungen → Team/Familie an: „Team anlegen", Name und Symbol wählen und die Mitglieder per Häkchen zuordnen. Für einen Teamwechsel setzt du die Häkchen einfach um – so nimmst du jemanden aus einem Team heraus und ordnest ihn einem anderen (oder zusätzlich einem zweiten) zu.' },
            { p: 'Im Team/Familie-Dashboard schaltest du oben zwischen „Alle", den einzelnen Teams und „Ohne Team" um. Alle Kennzahlen – Wochen-Kilometer, Monats-km & Meilenstein, „diese Woche aktiv" und die Team-Erfolge – werden dann genau für die Mitglieder des gewählten Teams zusammengerechnet.' },
            { tip: 'Ein Mitglied in zwei Teams zählt in beiden mit – praktisch, wenn jemand z. B. in der Laufgruppe UND im Fußballteam ist.' },
            { tip: 'Wird ein Mitglied entfernt, verschwindet es automatisch aus allen Teams – es bleiben keine „Geister" zurück.' },
            { link: { label: 'Teams verwalten', hash: '#/familie-verwalten' } },
          ],
        },
        { q: 'Wie zuverlässig sind Erinnerungen?', body: [{ p: 'In-App-Hinweise greifen nur bei geöffneter App. Für verlässliche Erinnerungen exportiere die Einheit in den iOS-Kalender (.ics) – die enthaltene Erinnerung funktioniert auch bei geschlossener App.' }] },
      ],
    },
  ];
}

/* ------------------------------- Rendering ------------------------------ */
export function render(view) {
  const name = userName();
  setHeader({ title: 'Hilfe & Wissen' });
  const data = content(name);

  // Begrüßung
  view.appendChild(el('div', { class: 'card card--accent' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { html: iconSvg('sparkles'), style: { width: '26px', flex: '0 0 auto' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '800', fontSize: '1.1rem' }, text: `Hallo ${name} 👋` }),
        el('div', { style: { opacity: '0.9', fontSize: '0.88rem' }, text: 'Hier findest du Anleitungen, Erklärungen und Trainingswissen – ganz in Ruhe.' }),
      ]),
    ]),
  ]));

  // Suche
  const searchInput = el('input', { class: 'input', type: 'search', placeholder: 'Suchen … (z. B. „Plan", „Health", „Zonen")', style: { marginTop: '16px' } });
  view.appendChild(searchInput);

  const container = el('div', { class: 'help-container mt-4' });
  view.appendChild(container);

  const draw = (query = '') => {
    container.innerHTML = '';
    const q = query.trim().toLowerCase();
    let hits = 0;
    data.forEach((section) => {
      const matching = section.articles.filter((a) => !q || articleText(a).toLowerCase().includes(q) || section.title.toLowerCase().includes(q));
      if (!matching.length) return;
      hits += matching.length;
      container.appendChild(el('div', { class: 'section-head' }, [
        el('h2', { class: 'section-head__title row gap-2' }, [el('span', { html: iconSvg(section.icon), style: { width: '18px', color: 'var(--accent)' } }), section.title]),
      ]));
      matching.forEach((a) => container.appendChild(articleCard(a, !!q)));
    });
    if (!hits) {
      container.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon', html: iconSvg('info') }),
        el('div', { class: 'empty__title', text: 'Nichts gefunden' }),
        el('div', { class: 'muted', text: 'Versuch es mit einem anderen Begriff.' }),
      ]));
    }
  };

  searchInput.addEventListener('input', debounce((e) => draw(e.target.value), 180));
  draw();
}

function articleText(a) {
  const parts = [a.q];
  (a.body || []).forEach((b) => {
    if (b.p) parts.push(b.p);
    if (b.tip) parts.push(b.tip);
    if (b.steps) parts.push(b.steps.join(' '));
    if (b.link) parts.push(b.link.label);
  });
  return parts.join(' ');
}

function articleCard(a, openByDefault = false) {
  const body = el('div', { class: 'help-article__body', hidden: !openByDefault });
  (a.body || []).forEach((b) => {
    if (b.p) body.appendChild(el('p', { class: 'help-p', text: b.p }));
    if (b.steps) {
      const ol = el('ol', { class: 'help-steps' });
      b.steps.forEach((s) => ol.appendChild(el('li', { text: s })));
      body.appendChild(ol);
    }
    if (b.tip) body.appendChild(el('div', { class: 'help-tip' }, [el('span', { html: iconSvg('info'), style: { width: '16px', flex: '0 0 auto' } }), el('span', { text: b.tip })]));
    if (b.link) body.appendChild(el('button', { class: 'btn btn--soft', style: { marginTop: '10px' }, onclick: () => navigate(b.link.hash) }, [el('span', { text: b.link.label }), icon('arrowRight')]));
  });

  const chev = el('span', { class: 'list-item__chev help-article__chev', html: iconSvg('chevronDown') });
  const head = el('button', { class: 'help-article__head', onclick: () => { const open = body.hidden; body.hidden = !open; chev.style.transform = open ? 'rotate(180deg)' : ''; } }, [
    el('span', { class: 'help-article__q', text: a.q }), chev,
  ]);
  if (openByDefault) chev.style.transform = 'rotate(180deg)';
  return el('div', { class: 'card help-article', style: { padding: '0' } }, [head, body]);
}

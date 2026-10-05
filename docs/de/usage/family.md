# Team & Familie

Anmelden, PIN, Rollen, Teams und das gemeinsame Dashboard.

> Teil der [Dokumentation](../README.md) · [Alle Seiten der Nutzung](../README.md#nutzen)

**Auf dieser Seite:**

- [Team/Familie & Anmeldung](#teamfamilie--anmeldung)
- [PIN ändern oder zurücksetzen](#pin-ändern-oder-zurücksetzen)
- [Rollen, Verwaltung und Mitverwalten](#rollen-verwaltung-und-mitverwalten)
- [Privat bleibt privat](#privat-bleibt-privat)
- [Teams](#teams)

---

## Team/Familie & Anmeldung

<img src="../assets/51-team-dashboard.png" width="400" align="right" alt="Team/Familie-Dashboard mit Team-Abzeichen" />

Cat-O-Fit ist für dein **ganzes Team oder deine Familie** (bis zu 32 Personen) – ob Laufgruppe,
Sportmannschaft oder Familie. Jede Person hat eigene Ziele, Pläne, Trainings und Körperwerte.

**Ersteinrichtung (erster Start):** Beim allerersten Start führt dich ein kurzer Assistent durch zwei
Schritte: Du legst zuerst die **Admin-Person** an (Name und eine eigene PIN mit 4 bis 8 Ziffern –
nicht `0000`, denn sie schützt die Verwaltung aller Profile) und wählst dann, ob **Demodaten**
geladen werden (Beispiel-Wettkampf, Trainingshistorie und eine komplette Beispiel-Familie mit
mehreren Mitgliedern und Teams zum Ausprobieren) oder ob du **leer startest**. Als Admin legst du
danach jederzeit weitere Mitglieder an.

**Anmelden:** Solange niemand angemeldet ist, zeigt Cat-O-Fit nur die **Anmeldung** mit den
Profil-Kacheln – ganz ohne Menüs. Tippe auf dein Profil und gib deine **PIN** ein; danach
erscheinen die Menüs und du landest auf „Heute“. Der Server prüft die PIN; nach fünf Fehlversuchen
folgt eine kurze Pause. Es gibt **keinen Auto-Login**: Schließt du die App (bzw. den Tab), meldest du
dich beim nächsten Start wieder an. **Neu laden hält dich angemeldet** – auf gemeinsam genutzten
Geräten deshalb immer **„Abmelden“** tippen.

**Ohne Verbindung zum Server** kannst du dich auf einem Gerät anmelden, auf dem du dich schon einmal
online angemeldet hast. Die allererste Anmeldung auf einem neuen Gerät braucht den Server. Zyklus,
Labor und Ergänzungen werden erst abgeglichen, sobald der Server deine Anmeldung bestätigt hat –
bis dahin bleiben deine Änderungen sicher auf dem Gerät. Fehlt diese Bestätigung (etwa nach einem
Update oder nach 30 Tagen ohne Nutzung), fragt die App einmal nach deiner PIN; „Später“ verschiebt
das bis zum nächsten Öffnen.

**Gemeinsames Gerät (z. B. Familien-iPad):** In **Einstellungen → Konto** den Schalter
**„Gemeinsames Gerät“** einschalten. Dann entfernt das Abmelden alle persönlichen Daten aus dem
Browserspeicher dieses Geräts (noch nicht gesendete Änderungen bleiben, bis sie beim Server sind).

**Profil wechseln = abmelden:** Zum Wechseln einfach **abmelden** – du landest direkt wieder bei der
Anmeldung. **Abmelden** findest du am iPhone im Menü **Mehr** (oben bei deinem Namen), am iPad und
Mac **unten in der Seitenleiste** und in **Einstellungen → Konto**.

**Team/Familie-Dashboard:** Der Menüpunkt **„Team/Familie“** ist eure gemeinsame Übersicht: eine
**Wochenzusammenfassung** (gemeinsame Kilometer in Bewegung, Trainings, Mitglieder), die Monats-km
mit Meilenstein, „wer war diese Woche aktiv“ samt aktivster Person, anstehende Wettkämpfe aller,
**Team-Erfolge** (nur Trainings-Abzeichen) und eine **Kachel pro Mitglied** mit Hauptziel und
Kennzahlen.

<p align="center">
  <img src="../assets/50-ersteinrichtung.png" width="240" alt="Ersteinrichtung: Admin anlegen" />
  <img src="../assets/51-team-dashboard.png" width="240" alt="Team/Familie-Dashboard mit Team-Abzeichen" />
</p>

---

## PIN ändern oder zurücksetzen

**Eigene PIN ändern:** Einstellungen → Konto → „PIN ändern“: bisherige PIN, dann die neue zweimal
(4 bis 8 Ziffern, nicht `0000`). Dafür braucht die App eine Verbindung zum Server. Neue Mitglieder
starten mit der PIN `0000` – bis sie eine eigene festlegen, erinnert „Heute“ daran.

**PIN vergessen:** Eine Admin-Person öffnet das Mitglied (Mehr → „Team verwalten“ → „Öffnen“) und
tippt in Einstellungen → Konto auf **„PIN für … setzen“**. Hat die **einzige Admin-Person** ihre PIN
vergessen, hilft nur der Betrieb am Server – siehe
[Fehlersuche: PIN vergessen](../betrieb/fehlersuche.md#pin-vergessen).

Die PIN wird nur als Prüfwert (Hash) auf dem Server gespeichert und funktioniert gleichermaßen über
die lokale Adresse (`http://…`) oder über HTTPS.

---

## Rollen, Verwaltung und Mitverwalten

**Rollen:** Es gibt **Admins** und **Mitglieder**. Die Verwaltung liegt unter **Mehr → „Team
verwalten“** (auf dem iPad in der Seitenleiste) und ist **nur für Admins** sichtbar. Dort legst du
Mitglieder **an, bearbeitest oder entfernst** sie (Name, Symbol, Farbe, Rolle), bildest Teams, setzt
den **gemeinsamen Einkaufstag** und wählst die Dashboard-Kennzahlen. Die letzte Admin-Person ist vor
dem Entfernen geschützt. Anlegen, Rollen ändern und Entfernen gehen nur mit Verbindung zum Server.

**App zurücksetzen:** ganz unten in den Einstellungen (nur Admins). Nach einer Tipp-Bestätigung
werden **alle** Mitglieder und Daten gelöscht, und die Ersteinrichtung startet neu.

**Ein Mitglied mitverwalten:** In „Team verwalten“ tippt eine Admin-Person bei einem Mitglied auf
**„Öffnen“** und sieht dann dessen Kalender, Ziele und Einheiten – ideal, um z. B. für Kinder oder
das Team zu planen. Oben im Kopf steht dann **„Du verwaltest gerade …“** mit **„Zurück zu mir“**;
„Heute“ heißt entsprechend z. B. „Leas Übersicht“.

<img src="../assets/31-familie-verwalten.png" width="420" alt="Team-/Familienverwaltung" />

---

## Privat bleibt privat

**Zyklus, Laborwerte und Ergänzungen** sind ausschließlich für die Person selbst sichtbar – **nie**
für Admins beim Verwalten, und sie beeinflussen dann auch keine Kennzahlen. Auch der Server gibt sie
nur nach der PIN-Anmeldung der Person selbst heraus. Wer den Server betreibt, kann die gespeicherten
Dateien allerdings lesen (sie liegen unverschlüsselt) – mehr unter
[Datenschutz im Betrieb](../betrieb/datenschutz.md).

In **Einstellungen → Konto → „Sichtbarkeit im Team/Familie-Dashboard“** bestimmst du selbst, ob dein
**Hauptziel** und deine **Kennzahlen** (Momentum, Wochen-km aller Sportarten, Wochen-Serie) für die
anderen sichtbar sind. Verbirgst du sie, erscheint dort statt deines Ziels ein **🔒 privat**; Name und
Avatar bleiben für die Anmeldung sichtbar. Die Team-Erfolge zählen nur **Trainings-Abzeichen** –
Gesundheits- und Zyklusdaten der anderen sieht das Team-Dashboard nie.

**Trainer-Sicht:** Mit dem Schalter **„Meine Belastung für Trainer:innen zeigen“** (standardmäßig aus)
gibst du den Admins deine **Belastungspunkte der letzten 7 Tage**, das **Lastverhältnis** zu deinem
eigenen Schnitt und dein jüngstes **Befinden** (Energie und Stimmung der letzten drei Tage) frei. Sie
sehen das im Team/Familie-Dashboard unter **„Belastung im Team“** – etwa um vor einem Spiel zu
erkennen, wer schon viel in den Beinen hat. Eine Orientierung, keine Diagnose; Zyklus, Labor und
Ergänzungen bleiben auch hier außen vor.

---

## Teams

Innerhalb der Familie bildest du als Admin **Teams** (z. B. „Team Rot“, „Team Blau“) und ordnest
Mitglieder per Häkchen zu – unter Mehr → „Team verwalten“ → „Team anlegen“. Ein Mitglied kann in
**mehreren Teams** gleichzeitig sein, manche in keinem; ein Teamwechsel ist jederzeit möglich. Im
**Team/Familie-Dashboard** schaltest du oben zwischen **Alle · je Team · Ohne Team** um; alle
Kennzahlen (Wochen-Kilometer, Monats-km & Meilenstein, „diese Woche aktiv“, anstehende Wettkämpfe,
Team-Erfolge) gelten dann für das gewählte Team. Wird ein Mitglied entfernt, verschwindet es aus
allen Teams.

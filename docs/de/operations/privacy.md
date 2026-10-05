# Datenschutz im Betrieb

Was liegt wo, was verlässt das Haus, wer kann was lesen – ehrlich, ohne Werbesprache. Wer Cat-O-Fit
für die Familie oder ein Team betreibt, trägt die Verantwortung für die Daten der anderen mit; diese
Seite hilft, das richtig einzuschätzen.

> Teil der [Dokumentation](../README.md) · [Betreiben](../README.md#betreiben) ·
> Sicherheitslücken bitte vertraulich melden: [SECURITY.md](../../SECURITY.md)

**Auf dieser Seite:**

- [Was liegt wo](#was-liegt-wo)
- [Was das Haus verlässt](#was-das-haus-verlässt)
- [Wer kann was lesen](#wer-kann-was-lesen)
- [Empfehlungen](#empfehlungen)

---

## Was liegt wo

| Ort | Inhalt |
|---|---|
| **Gerät** (Browser-Speicher) | eine Kopie der Daten der angemeldeten Person, damit die App offline läuft, dazu noch nicht gesendete Änderungen. Mit „Gemeinsames Gerät“ (Einstellungen → Konto) räumt das Abmelden die persönlichen Daten wieder ab. |
| **Server, Ordner `data/`** | alle Daten aller Personen als unverschlüsselte JSON-Dateien: `family/` (Mitglieder, Rollen, Teams, Prüfwerte der PINs), `users/<id>/` (Pläne, Trainings, Körperwerte, Ernährung, Zyklus, Labor, Ergänzungen …), `auth/` (Anmelde-Sitzungen, Fehlversuche, Kalender-Schlüssel), `foodfacts.json` (Zwischenspeicher der Nährwertsuche). |
| **Sicherungen** | Vollbackups enthalten die Daten aller Mitglieder außer den privaten Bereichen, „Mein Backup“ die einer Person inklusive Zyklus, Labor und Ergänzungen. |

---

## Was das Haus verlässt

Nur zwei **abschaltbare** Zusatzdienste; kein Konto, keine Werbung, keine Telemetrie:

| Dienst | Wer fragt | Was übertragen wird | Abschalten |
|---|---|---|---|
| **Open-Meteo** (Wetter) | das Gerät, direkt | Ortsname bei der Suche, danach Koordinaten | Einstellungen → Standort & Wetter |
| **Open Food Facts** (Nährwerte) | euer Server | nur der Zutatenname bzw. der Strichcode einer Packung | Einstellungen → Ernährung → „Nährwerte online ergänzen“ (für neue Profile anfangs aus; gilt auch für den Strichcode) |

Rechtliches zu den Diensten: Die kostenlose Schnittstelle von Open-Meteo ist nur für nicht-kommerzielle
Nutzung gedacht (unter 10 000 Aufrufen am Tag); wer Cat-O-Fit kommerziell betreibt, braucht dort einen
eigenen Tarif. Nährwertdaten von Open Food Facts stehen unter der Open Database License (ODbL) – die
App nennt die Quelle. Details in [CREDITS](../../CREDITS.md).

Die **Kamera** zum Strichcode-Scannen startet nur auf Tipp; das Bild wertet der Browser selbst aus, es
verlässt das Gerät nicht. Auch **Aktivitätsdateien** (GPX, TCX, FIT, ZIP) liest das Gerät – zum Server
geht nur das Ergebnis, also das Training.

Optionale Anbindungen, die ihr selbst einrichtet (Apple Health über Health Auto Export oder einen
Kurzbefehl, auf Android Health Connect über eine Brücken-App), schicken vom Handy **an euren Server** –
nicht an Dritte. Diese Apps stammen von anderen Anbietern; was sie darüber hinaus tun, regelt deren
eigene Datenschutzerklärung.

---

## Wer kann was lesen

| Wer | Was |
|---|---|
| die Person selbst | alles Eigene, auch Zyklus, Labor und Ergänzungen (nach ihrer PIN-Anmeldung) |
| Admins in der App | beim „Öffnen“ eines Mitglieds dessen Pläne, Trainings und Körperwerte – **nie** Zyklus, Labor, Ergänzungen. Im Team-Dashboard die Belastung und das Befinden der Personen, die „Meine Belastung für Trainer:innen zeigen“ eingeschaltet haben (standardmäßig aus) |
| andere Mitglieder | im Team-Dashboard nur, was die Person dort freigibt (Hauptziel, Kennzahlen) |
| jedes Gerät, das den Server erreicht | Trainings, Pläne, Körperwerte, Ernährung – die gemeinsamen Bereiche sind **nicht** durch die PIN geschützt. Deshalb gehört die App ins eigene Netz oder hinter eine Anmeldung. |
| wer den Server betreibt | alle Dateien, auch die privaten Bereiche – sie liegen unverschlüsselt auf der Platte |
| wer einen Kalender-Link kennt | die Termine dieses Plans (der Link enthält einen persönlichen Schlüssel) |
| ein Werkzeug mit dem Lese-Schlüssel einer Person | nur lesend deren Trainings, Pläne, Körperwerte und Ernährung – **nie** Zyklus, Labor, Ergänzungen. Nur, wenn die Person den „Lesezugang für eigene Werkzeuge“ eingeschaltet hat (standardmäßig aus); Ausschalten macht den Schlüssel sofort ungültig |

**Strecken** aus GPS-Dateien (eine vereinfachte Linie) liegen bei den Trainings. Sie zeigen, wo jemand
unterwegs war – oft auch, wo die Runde beginnt. Wer das nicht mitspeichern möchte, schaltet beim
Datei-Import „Strecke mitspeichern“ aus.

Der Schlüssel des Health-Eingangs und des Lesezugangs gehört in den Header `X-Catofit-Token`, nicht in
die URL – URLs landen in Zugriffsprotokollen von Server und Proxy. Ältere Einrichtungen mit dem
Schlüssel in der URL funktionieren weiter; ein neuer Schlüssel (Health-Import → ⟳) macht den alten
ungültig.

---

## Empfehlungen

1. **Im eigenen Netz betreiben** oder mit Anmeldung davor (VPN, Reverse-Proxy mit Anmeldung, eingebaute
   Basic Auth) – siehe [Installation](installation.md#betrieb-außerhalb-des-heimnetzes).
2. **Jede Person eine eigene PIN** – neue Mitglieder starten mit `0000` und werden daran erinnert.
3. **„Gemeinsames Gerät“** auf Familien-iPads einschalten.
4. **Sicherungen schützen** – sie enthalten Gesundheitsdaten (siehe [Backup](backup.md)).
5. **Mitglieder entfernen**, die die App nicht mehr nutzen (Mehr → „Team verwalten“) – ihre Daten
   verschwinden damit auch vom Server.

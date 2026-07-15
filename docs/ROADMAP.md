# Roadmap

Geplante Weiterentwicklung von Cat-O-Fit. Reihenfolge = grobe Priorität.

## Geplant: v4.0.0 — Organisationen: echte Auth & Privacy (jenseits von 32 Personen)

Das aktuelle Team-/Familien-Modell ist **vertrauensbasiert**: PIN-Login (Standard `0000`) statt echter
Authentifizierung, ein Admin kann jedes Mitglied „öffnen" und verwalten, und die Team-/Familien-Kennzahlen
werden **client-seitig** über alle Mitglieder aggregiert (`teamstats.js`). Das ist genau richtig für eine
Familie oder ein kleines Team und trägt bewusst **bis zu 32 Personen**. Darüber wird aus
„Team & Familie" eine **Organisation** – und dann kippt das Modell. Für größere oder offene Gruppen
(Vereine > 32, mehrere Familien, öffentliche Nutzung) ist ein Fundamentwechsel nötig:

- **Echte Authentifizierung** – verbindliche Einzel-Accounts/-PINs (kein `0000`-Standard), Login-/Session-Härtung.
- **Privacy-Grenzen** – feingranulare Sichtbarkeit und Rollen/Rechte statt „Admin sieht und öffnet alles".
- **Skalierbare Aggregation** – Team-/Familien-Kennzahlen server-seitig oder lazy statt „alle Mitglieder in
  den Browser laden" (das aktuelle `teamstats.js`-Modell wird bei vielen Personen auf dem Gerät zäh).
- **Optional**: Einladungs-Flows, mehrere/größere Familien.

**Warum bis dahin genau 32?** Es ist die Grenze, bis zu der sich alle plausibel kennen (Vertrauen ersetzt
harte Zugriffskontrolle) und bis zu der Login-Kacheln + client-seitige Aggregation auf iPhone/iPad flüssig
bleiben. Der Server hält (im Lasttest bewiesen) mehr aus – die 32 sind eine bewusste **Produkt-/Vertrauens-
grenze**, keine technische. Ein Anheben über 32 ist erst mit dem v4.0.0-Fundament sinnvoll, vorher würde es
Sicherheit und Datenschutz verwässern.

## Weitere Ideen

- **Automatische Umfang-Nachführung im Plan** – die Statistik-Signale (Über-/Unterlastung,
  Verpasst-Gründe) nicht nur anzeigen, sondern den Wochenumfang aktiv nachführen.
- **Web-Push für installierte PWAs** (iOS 16.4+) als optionale Erweiterung der Erinnerungen.
  Braucht einen Push-Dienst + Test auf echtem iOS-Gerät – der `.ics`-Weg bleibt der robustere
  Hauptmechanismus.
- **Echte Nährwert-Datenbank** als Alternative zu den kuratierten Faustwerten und der
  optionalen Open-Food-Facts-Abfrage.
- **Inkrementelles Admin-Vollbackup** – erster Skalierungs-Hebel aus dem Lasttest: statt
  „alle Bereiche lesen" nur Änderungen seit dem letzten Stand sichern.

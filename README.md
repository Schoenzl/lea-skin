# LEA Infoscreen – FF Deutsch Haslau

Eigene Darstellung des LEA-Infoscreens (`https://lea-screen.notrufnoe.at`) als Chromium-Erweiterung für den Kiosk-Pi.

- **Einsatzansicht:** Alarmband (Stufe, Art, Alarmzeit + Timer, Uhr); links wohin (Einsatzort), was (Meldebild), mitalarmiert und große Karte; rechts wer kommt: Zusagen gereiht nach EL-Liste, Summe je Qualifikation und Funktionskürzel je Person in Farbe
- **Ruhebildschirm:** Uhr, Datum, Wetter mit Wind und Böen (Open-Meteo), Leitha-Pegel Deutsch Haslau mit Prognose und Warnstufe (Hydrographischer Dienst NÖ, Messstelle 209007), nächste Termine aus dem öffentlichen Google-Kalender „FF Deutsch Haslau“ (Serien, Ausnahmen, Zeitzonen über ical.js), letzte 4 Einsätze, aktuell ausgerückte Feuerwehren aus WASTL (Bezirk Bruck/Leitha) und der LSZ Burgenland (Bezirk Neusiedl/See), eigene FF hervorgehoben
- **Fahrzeuge:** KLF-W, MTF, VFA aus dem Fahrtenbuch (Google-Formular → Google-Tabelle, CSV-Link nur in `config.local.js`): „unterwegs bis …“ mit Name und Zweck bzw. „frei“ mit nächster Nutzung; Fahrten mit „abgesagt“/„storniert“ im Zweck oder Bis ≤ Von werden ignoriert
- **Sicherheitsnetz:** ohne frische Daten (45 s) → LEA-Original
- **Datenschutz/Sicherheit:** liest nur die Antworten auf `/events` und `/eventhistory` mit, die die Seite selbst abholt; keine eigenen Anfragen, kein Zugriff auf Token/Header; alles bleibt am Gerät

## Dateien
| Datei | Zweck |
|---|---|
| `manifest.json` | Erweiterung (nur für lea-screen.notrufnoe.at) |
| `config.js` | Farben, Ampel-Regeln, Zeiten |
| `config.local.js` | EL-Reihung mit Namen – **nur am Gerät**, nicht im Repo (Vorlage: `config.local.example.js`) |
| `inject.js` | liest die LEA-Antworten mit |
| `background.js` | holt alle 5 min Wetter, Pegel, WASTL und Kalender (getrennt von der LEA-Seite) |
| `bridge.js` | reicht diese Daten an die Anzeige weiter |
| `render.js` | baut die Ansicht |
| `lib/ical.min.js` | Mozilla ical.js 1.5.0 (MPL-2.0) für den Kalender |
| `skin.css`, `fonts/` | Design, Schrift Barlow (SIL Open Font License) |

## Testen ohne Alarm
Erweiterung laden und `https://lea-screen.notrufnoe.at/?demo=1` öffnen (fiktive Daten „Demodorf“), Ruhebildschirm: `?demo=1&ruhe=1`.

## Installation am Pi
1. Ordner nach `/home/admin/lea-skin` kopieren, `config.local.js` anlegen
2. In `start-kiosk.sh` beim Chromium-Aufruf `--load-extension=/home/admin/lea-skin` ergänzen
3. Kiosk neu starten
Zurück zum Original: Flag wieder entfernen, neu starten.

## Updates am Pi
```bash
/home/admin/lea-skin/update.sh
```
Holt den Code, beendet Chromium, leert den Service-Worker-Zwischenspeicher (sonst läuft der alte Hintergrund-Dienst weiter) und startet den Kiosk neu.

## Selbstheilung und Ausfallmeldung (ab v0.10)
- **Seite hängt:** Kommen 3 Minuten keine LEA-Daten, lädt die Erweiterung die LEA-Seite neu (nach 3 erfolglosen Versuchen nur mehr alle 30 Minuten).
- **Chromium abgestürzt:** `watchdog.sh` per cron alle 2 Minuten startet den Kiosk neu.
  Einmalig einrichten: `(crontab -l 2>/dev/null; echo "*/2 * * * * /home/admin/lea-skin/watchdog.sh") | crontab -`
- **Ausfallmeldung:** Bei healthchecks.io einen Check anlegen (Period 5 min, Grace 10 min), Benachrichtigung per E-Mail/App einstellen und die Ping-Adresse am Pi in `config.local.js` als `heartbeatUrl` eintragen. Bleibt der Ping aus (Strom, Internet, Pi weg) oder fehlen länger als 10 Minuten die LEA-Daten, kommt eine Meldung.

## Alarm-Rahmen
Bei einem neuen Einsatz pulsiert 30 Sekunden lang ein Rahmen in der Farbe der Alarmstufe (`alarmRahmenSek`).

## Weiteren Pi einrichten (ab v0.11.3)
Voraussetzung: Der LEA-Kiosk läuft dort schon mit eigenem LEA-Zugang und startet über `~/start-kiosk.sh`.
```bash
git clone https://github.com/Schoenzl/lea-skin.git ~/lea-skin
~/lea-skin/install.sh
```
Danach `config.local.js` vom ersten Pi übernehmen (EL-Liste, Fahrtenbuch) und `~/lea-skin/update.sh`.

## Handy-Ansicht nur für mich (mobil/, ab v0.17.0)
Einsatzmonitor fürs Handy (Hochformat): Reiter **Einsatz** (Alarmband mit Timer, Adresse, Karte mit Navigation, Meldebild,
KLF-W-Ampel, Zusagen gereiht nach EL-Liste, Absagen, ohne Rückmeldung), **Lage** (Uhr, Wetter, Unwetter, letzter Einsatz,
ausgerückt im Bezirk, Fahrzeuge, Termine) und **Fahrzeuge** (Status, Buchungen, Mängel, Pickerl). Bei neuem Alarm springt die
Seite auf „Einsatz“.
- **Datenweg:** `render.js` → `bridge.js` → `background.js` schickt alle 5 s den Stand an `mobil/server.py` am selben Pi
  (`127.0.0.1:8787`, nur im Arbeitsspeicher, nichts auf Platte). Erreichbar ist die Seite nur über **Tailscale**
  (`tailscale serve` → `https://<pi>.<tailnet>.ts.net`), also nur von Geräten im eigenen Tailnet. Kein fremder Server.
- Schreiben (`POST /push`) nur direkt von 127.0.0.1, nicht über Tailscale.
- **Einrichten (nur ein Pi):** `~/lea-skin/mobil/install-mobil.sh` – legt den Dienst `lea-mobil` an, setzt `mobilPush` in
  `config.local.js`, installiert Tailscale und startet den Kiosk neu. Am Handy die Tailscale-App mit demselben Konto, dann die
  angezeigte Adresse öffnen und „Zum Home-Bildschirm“.
- Kein Push bei Alarm (dafür die LEA-App); die Seite aktualisiert sich alle 5 s, solange sie offen ist.

## Buchungsseite mit Prüfung auf Doppelbuchung (apps-script/, ab v0.16.0)
Ersetzt das Google-Formular „Fahrzeugnutzung“: eigene Seite als Google-Apps-Script an der Tabelle, prüft vor dem Speichern auf Überschneidungen und schreibt in denselben Tab („Formularantworten 1“).
1. Tabelle öffnen → Erweiterungen → Apps Script
2. `Code.gs` ersetzen durch `apps-script/Code.gs`; neue HTML-Datei `Buchung` mit `apps-script/Buchung.html`
3. Projekteinstellungen → Zeitzone **Europe/Vienna**
4. Bereitstellen → Neue Bereitstellung → Web-App, Ausführen als „Ich“, Zugriff „Jeder“
5. Adresse der Web-App am Pi als `fahrtenbuchFormUrl` eintragen (QR-Code am Schirm)
Der Infoscreen markiert zusätzlich Doppelbuchungen, die direkt in der Tabelle entstehen.

### Reiter „Kommando“ auf der Buchungsseite
Eine Seite, eine Adresse: oben die Reiter „Buchen“ und „Kommando“ (direkt öffnen: `…/exec?seite=status`).
Kommando zeigt nach PIN pro Fahrzeug „frei“ / „unterwegs“ mit Name, Zweck, Rückkehrzeit, Einsatzbereitschaft und Pickerl,
eine Zeitleiste (heute & morgen) und die Fahrten der letzten 24 h und nächsten 7 Tage; aktualisiert jede Minute.
- Das Kommando kann jede Fahrt löschen, mit Begründung. Der Buchende bekommt eine Mail (E-Mail ist Pflichtfeld beim Buchen,
  Spalte „E-Mail“ wird automatisch angelegt). Der Server prüft vor dem Löschen, dass Fahrzeug, Von und Bis noch übereinstimmen.
- PIN: Apps Script → Projekteinstellungen → Skripteigenschaften → `STATUS_PIN` (mind. 4 Ziffern). Ohne richtige PIN liefert der
  Server keine Daten; nach 10 Fehlversuchen 15 Minuten Sperre. Geht die PIN nicht: im Editor `pinPruefen` ausführen (Log zeigt, ob
  `STATUS_PIN` gefunden wird, und hebt die Sperre auf).
- Mailversand einmalig freigeben: im Editor `mailTest` ausführen.

### Anwesenheit per QR-Code (apps-script/Anwesenheit.gs, Reiter „Anwesenheit“)
Ein QR-Code im Haus → `…/exec?seite=da`. Mitglied wählt seinen Namen (wird am Handy gemerkt) und tippt „Ich bin da“.
- **Welche Tätigkeit:** laufender Termin aus dem Google-Kalender „FF Deutsch Haslau“ (90 min vorher bis 60 min nachher).
  Das Stichwort im Titel bestimmt die FDISK-Art laut Tab „Zuordnung“ (erste passende Zeile gilt, frei änderbar).
  Ohne Termin: „Was machst du?“ – die erste Person wählt, weitere mit derselben Auswahl innerhalb von 4 h kommen dazu.
- **Kommando** (Reiter „Kommando“, PIN): Titel, FDISK-Art/Unterart, Beginn/Ende, Bemerkung ändern, nachtragen, entfernen,
  abschließen. Abgeschlossene Termine überträgt Claude mit dem Skill „fdisk-eintragen“ ins FDISK und setzt den Status „eingetragen“
  samt Berichtsnummer.
- **Tabelle** „Anwesenheit FF Deutsch Haslau“ (legt `anwesenheitEinrichten` an, ID in der Skripteigenschaft `ANW_ID`):
  Mitglieder (Name, Standesbuchnummer, Aktiv) · Zuordnung · Termine · Anwesenheit. Nur Namen aus „Mitglieder“ werden angenommen.
- **Einrichten:** in Apps Script neue Skriptdatei `Anwesenheit` mit `Anwesenheit.gs`, `Code.gs` und `Buchung` ersetzen,
  ▶ `anwesenheitEinrichten` ausführen (Berechtigungen für Tabellen und Kalender erlauben), Tab „Mitglieder“ befüllen,
  Bereitstellungen verwalten → Version „Neu“.
- **Push „… ist im Feuerwehrhaus“** bei jedem Einchecken per QR (nicht bei Nachtragen) über ntfy.sh: Skripteigenschaft
  `NTFY_TOPIC` (geheimer Kanalname, nicht ins Repo) und `NTFY_TOKEN` (Zugangstoken eines kostenlosen ntfy.sh-Kontos, sonst 429), einmal ▶ `pushTest` ausführen (erlaubt Versand nach außen).
  Abonnieren: App „ntfy“ → + → Kanalname. Tippen auf die Nachricht öffnet die Anwesenheit.

### „Ich bin da“ in der Handy-Ansicht (nur Pi mit mobilPush)
Reiter „Lage“ → Karte „Anwesenheit“ → „Ich bin da“ → Termin antippen. Weg: Handy → `mobil/server.py` (`/da/start`, `/da`) →
Apps Script `doPost` (Anwesenheit.gs). Schutz: Skripteigenschaft `DA_KEY`, derselbe Schlüssel samt Name und Web-App-Adresse
nur am Pi in `mobil/da.json` (nicht im Repo):
`{"url":"https://script.google.com/macros/s/…/exec","key":"…","name":"Vorname Nachname"}`

## Hydranten (hydranten.js, ab v0.18.0)
17 Hydranten aus wasserkarte.info (Export 30.10.2026). Am Infoscreen erscheinen sie als nummerierte Punkte auf der Einsatzkarte
(grau = nicht ganzjährig) mit Kasten „Nächste Hydranten“ (Entfernung, Anschlüsse); in der Handy-Ansicht ebenso, die Liste
darunter öffnet die Navigation zum Hydranten. Änderungen direkt in `hydranten.js`, dann `update.sh`.
Offen: Nr. 2 und 3 haben laut Export dieselbe Position (vor Ort prüfen); Druck/Nennweite sind in wasserkarte.info nicht erfasst.

## Handy-Ansicht: Heute im Feuerwehrhaus und Nachbar im Einsatz (ab v0.19.0)
- **Heute im Feuerwehrhaus** (Reiter „Lage“): Termine von heute bzw. noch offene mit Namen, über `mobil/server.py` → `/da/heute`
  → Apps Script `doPost` Aktion `heute` (Schlüssel `DA_KEY`). Aktualisiert jede Minute.
- **Nachbar im Einsatz**: rückt eine Wehr aus `nachbarn` (config.js) laut WASTL/LSZ aus, erscheint oben eine Karte.
  Optional Push vom Pi über ntfy (eigene IP, kein Google-Kontingent): `nachbarPushTopic` in `config.local.js` (nur ein Pi).
  Beim ersten Lauf werden schon laufende Einsätze nicht gemeldet. Abfrage alle 5 Minuten (`aktualisierenMin`).

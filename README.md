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

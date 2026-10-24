# LEA Infoscreen – FF Deutsch Haslau

Eigene Darstellung des LEA-Infoscreens (`https://lea-screen.notrufnoe.at`) als Chromium-Erweiterung für den Kiosk-Pi.

- **Einsatzansicht:** Alarmband (Stufe, Art, Alarmzeit + Timer, Uhr), Einsatzort, Meldebild, Karte, alarmierte Gruppen, Zusagen gereiht nach EL-Liste mit Funktionsfarben, Besetzungs-Ampel KLF-W
- **Ruhebildschirm:** Uhr, Datum, Wetter mit Wind und Böen (Open-Meteo), nächste Termine (fix in `config.js` und/oder iCal-Kalender), letzte 4 Einsätze, Bezirkslage aus dem WASTL-Proxy
- **Sicherheitsnetz:** ohne frische Daten (45 s) → LEA-Original
- **Datenschutz/Sicherheit:** liest nur die Antworten auf `/events` und `/eventhistory` mit, die die Seite selbst abholt; keine eigenen Anfragen, kein Zugriff auf Token/Header; alles bleibt am Gerät

## Dateien
| Datei | Zweck |
|---|---|
| `manifest.json` | Erweiterung (nur für lea-screen.notrufnoe.at) |
| `config.js` | Farben, Ampel-Regeln, Zeiten |
| `config.local.js` | EL-Reihung mit Namen – **nur am Gerät**, nicht im Repo (Vorlage: `config.local.example.js`) |
| `inject.js` | liest die LEA-Antworten mit |
| `background.js` | holt alle 5 min Wetter, WASTL und Kalender (getrennt von der LEA-Seite) |
| `bridge.js` | reicht diese Daten an die Anzeige weiter |
| `render.js` | baut die Ansicht |
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
cd /home/admin/lea-skin && git pull
pkill -f chromium; sleep 2
DISPLAY=:0 setsid /home/admin/start-kiosk.sh >/dev/null 2>&1 </dev/null &
```

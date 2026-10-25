#!/bin/bash
# Einrichtung des eigenen LEA-Infoscreens auf einem Pi, auf dem der LEA-Kiosk schon läuft.
# Voraussetzung: Repo liegt in ~/lea-skin, Kiosk startet über ~/start-kiosk.sh
set -u
D="$HOME/lea-skin"
K="$HOME/start-kiosk.sh"

[ -f "$K" ] || { echo "FEHLT: $K – Kiosk-Start bitte zuerst prüfen"; exit 1; }
grep -q 'lea-screen' "$K" || { echo "FEHLT: LEA-Adresse in $K"; exit 1; }

# 1) Startskript sichern und Erweiterung laden lassen (nur wenn noch nicht drin)
if grep -q 'lea-skin' "$K"; then
  echo "Startskript: Erweiterung ist schon eingetragen"
else
  cp "$K" "$K.bak"
  F="--load-extension=$D --disable-features=DisableLoadExtensionCommandLineSwitch"
  sed -i "/chromium.*lea-screen/s#https://lea-screen#$F https://lea-screen#" "$K"
  grep -q 'lea-skin' "$K" && echo "Startskript angepasst (Sicherung: $K.bak)" || echo "ACHTUNG: Startskript nicht angepasst"
fi

# 2) config.local.js (EL-Liste, Fahrtenbuch) – kommt nicht aus dem Repo
[ -f "$D/config.local.js" ] || { cp "$D/config.local.example.js" "$D/config.local.js"; echo "HINWEIS: config.local.js ist nur die Vorlage – Inhalt vom ersten Pi übernehmen"; }

# 3) Wächter per cron (Chromium-Absturz)
chmod +x "$D"/*.sh
if crontab -l 2>/dev/null | grep -q 'lea-skin/watchdog.sh'; then
  echo "Wächter: schon eingerichtet"
else
  (crontab -l 2>/dev/null; echo "*/2 * * * * $D/watchdog.sh") | crontab -
  echo "Wächter eingerichtet"
fi

# 4) Kiosk neu starten
"$D/update.sh"

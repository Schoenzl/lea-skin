#!/bin/bash
# Update des eigenen LEA-Infoscreens am Pi: Code holen, Chromium sauber neu starten.
# Chromium behält den Hintergrund-Dienst einer entpackten Erweiterung sonst im Zwischenspeicher.
set -u
D=/home/admin/lea-skin
P="/home/admin/.config/chromium/Default"

cd "$D" && git pull
echo "Version: $(grep '"version"' "$D/manifest.json" | head -1)"

pkill -f chromium
while pgrep -f chromium >/dev/null; do sleep 1; done
echo "Chromium beendet"

# nur den Service-Worker-Zwischenspeicher leeren (Login/Token der LEA bleibt erhalten)
rm -rf "$P/Service Worker"

DISPLAY=:0 setsid /home/admin/start-kiosk.sh >/dev/null 2>&1 </dev/null &
echo "Kiosk startet neu"

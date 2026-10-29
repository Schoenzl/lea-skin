#!/bin/bash
# Update des eigenen LEA-Infoscreens am Pi: Code holen, Chromium sauber neu starten.
# Chromium behält den Hintergrund-Dienst einer entpackten Erweiterung sonst im Zwischenspeicher.
set -u
D="$HOME/lea-skin"
P="$HOME/.config/chromium/Default"

touch /tmp/leaskin-update
cd "$D" && git pull
chmod +x "$D"/*.sh "$D"/mobil/*.sh 2>/dev/null
# Handy-Ansicht: Server neu starten, falls eingerichtet
systemctl list-unit-files lea-mobil.service >/dev/null 2>&1 && sudo -n systemctl restart lea-mobil 2>/dev/null && echo "Handy-Ansicht neu gestartet"
echo "Version: $(grep '"version"' "$D/manifest.json" | head -1)"

pkill -f chromium
while pgrep -f chromium >/dev/null; do sleep 1; done
echo "Chromium beendet"

# nur den Service-Worker-Zwischenspeicher leeren (Login/Token der LEA bleibt erhalten)
rm -rf "$P/Service Worker"

DISPLAY=:0 setsid "$HOME/start-kiosk.sh" >/dev/null 2>&1 </dev/null &
echo "Kiosk startet neu"
( sleep 60; rm -f /tmp/leaskin-update ) &

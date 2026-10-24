#!/bin/bash
# Wächter am Pi (per cron alle 2 Minuten): startet den Kiosk neu, wenn Chromium nicht läuft.
# Hängende Seiten löst die Erweiterung selbst (neu laden), das hier fängt Abstürze ab.
pgrep -f chromium >/dev/null && exit 0
[ -e /tmp/leaskin-update ] && exit 0                 # update.sh läuft gerade
[ "$(cut -d. -f1 /proc/uptime)" -lt 180 ] && exit 0  # Pi startet gerade, Autostart übernimmt
export DISPLAY=:0 XAUTHORITY=/home/admin/.Xauthority
echo "$(date '+%F %T') Chromium lief nicht – Kiosk neu gestartet" >> /home/admin/lea-skin-watchdog.log
setsid /home/admin/start-kiosk.sh >/dev/null 2>&1 </dev/null &

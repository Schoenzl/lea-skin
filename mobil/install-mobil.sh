#!/bin/bash
# Handy-Ansicht des Einsatzmonitors einrichten – nur auf EINEM Pi (dem mit dem LEA-Infoscreen).
# 1) Server als Dienst (lauscht nur auf 127.0.0.1:8787)
# 2) Erweiterung schickt den Stand an den Server (mobilPush in config.local.js)
# 3) Tailscale: privat erreichbar unter https://<pi>.<tailnet>.ts.net – nur für deine eigenen Geräte
set -u
D="$HOME/lea-skin"
U="$(id -un)"

echo "== 1/4 Dienst lea-mobil"
sudo tee /etc/systemd/system/lea-mobil.service >/dev/null <<EOF
[Unit]
Description=Einsatzmonitor Handy-Ansicht (nur 127.0.0.1)
After=network.target

[Service]
User=$U
ExecStart=/usr/bin/python3 $D/mobil/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now lea-mobil
sleep 1
curl -fsS http://127.0.0.1:8787/gesund >/dev/null && echo "Dienst läuft" || echo "ACHTUNG: Dienst antwortet nicht (sudo journalctl -u lea-mobil)"

echo "== 2/4 Erweiterung: mobilPush"
if grep -q 'mobilPush' "$D/config.local.js" 2>/dev/null; then
  echo "schon eingetragen"
else
  echo "globalThis.LEASKIN_CONFIG.mobilPush = true;" >> "$D/config.local.js"
  echo "eingetragen"
fi

echo "== 3/4 Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale status >/dev/null 2>&1; then
  echo "Gleich erscheint ein Link: am Handy oder Mac öffnen und mit DEINEM Tailscale-Konto anmelden."
  sudo tailscale up
fi
sudo tailscale serve --bg 8787 || echo "ACHTUNG: tailscale serve fehlgeschlagen – evtl. muss im Tailscale-Adminbereich HTTPS aktiviert werden (Link oben)"

echo "== 4/4 Infoscreen neu starten"
"$D/update.sh"

NAME="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null)"
echo
echo "Fertig. Am Handy (Tailscale eingeschaltet) öffnen:  https://$NAME"
echo "Dann „Zum Home-Bildschirm“ hinzufügen."

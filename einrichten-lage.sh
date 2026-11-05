#!/bin/bash
# Einrichten: Alarm-Push ans Kommando + Einsatz-Nachbereitung (nur auf EINEM Pi).
# Aufruf:  cd ~/lea-skin && git pull && ./einrichten-lage.sh
# Fragt Push-Kanal, Web-App-Adresse und Schlüssel ab, schreibt config.secret.js (nur für dich lesbar),
# setzt lageAktiv in config.local.js, schickt einen Test-Push und startet den Infoscreen neu.
set -u
D="$HOME/lea-skin"
S="$D/config.secret.js"
L="$D/config.local.js"
cd "$D" || { echo "Ordner $D fehlt"; exit 1; }

alt() { [ -f "$S" ] && grep -o "$1 = '[^']*'" "$S" | head -1 | sed "s/.*= '\(.*\)'/\1/"; }

echo "== Alarm-Push und Einsatz-Nachbereitung einrichten =="
echo "Enter ohne Eingabe übernimmt den Wert in [Klammern]."
echo

# 1) Push-Kanal
T_ALT="$(alt kommandoPushTopic)"
[ -n "$T_ALT" ] || T_ALT="ffdh-kommando-$(tr -dc 'a-z0-9' </dev/urandom | head -c 16)"
read -r -p "ntfy-Kanal fürs Kommando [$T_ALT]: " TOPIC
TOPIC="${TOPIC:-$T_ALT}"
[[ "$TOPIC" =~ ^[A-Za-z0-9_-]{12,64}$ ]] || { echo "Kanal: nur Buchstaben, Ziffern, - und _, 12–64 Zeichen."; exit 1; }

# 2) Web-App-Adresse
U_ALT="$(alt einsatzUrl)"
read -r -p "Web-App-Adresse (einsatzUrl aus ▶ einsatzEinrichtenNachbereitung)${U_ALT:+ [$U_ALT]}: " URL
URL="${URL:-$U_ALT}"
[[ "$URL" =~ ^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$ ]] || { echo "Adresse muss so aussehen: https://script.google.com/macros/s/…/exec"; exit 1; }

# 3) Schlüssel (wird nicht angezeigt)
K_ALT="$(alt einsatzKey)"
read -r -s -p "Schlüssel (einsatzKey)${K_ALT:+ [bisheriger bleibt]}: " KEY; echo
KEY="${KEY:-$K_ALT}"
[[ "$KEY" =~ ^[A-Za-z0-9_-]{20,128}$ ]] || { echo "Schlüssel fehlt oder ist zu kurz (mind. 20 Zeichen)."; exit 1; }

# 4) optional: Links beim Antippen
P_ALT="$(alt kommandoPushLink)"
read -r -p "Link beim Antippen des Lagebild-Pushes (z. B. Handy-Ansicht, leer = keiner)${P_ALT:+ [$P_ALT]}: " PLINK
PLINK="${PLINK:-$P_ALT}"
[ -z "$PLINK" ] || [[ "$PLINK" =~ ^https://[A-Za-z0-9./?=#_:-]+$ ]] || { echo "Link muss mit https:// beginnen."; exit 1; }
A_ALT="$(alt einsatzAppLink)"
read -r -p "Link im Push „Einsatz beendet“ (App-Link mit ?seite=einsaetze, leer = keiner)${A_ALT:+ [$A_ALT]}: " ALINK
ALINK="${ALINK:-$A_ALT}"
[ -z "$ALINK" ] || [[ "$ALINK" =~ ^https://[A-Za-z0-9./?=#_:-]+$ ]] || { echo "Link muss mit https:// beginnen."; exit 1; }

# config.secret.js schreiben (nur für den Benutzer lesbar, nicht im Repo)
umask 077
{
  echo "// Geheim – nur am Pi, wird nur vom Hintergrund-Dienst gelesen. Erstellt mit einrichten-lage.sh am $(date '+%d.%m.%Y %H:%M')."
  echo "globalThis.LEASKIN_CONFIG.kommandoPushTopic = '$TOPIC';"
  echo "globalThis.LEASKIN_CONFIG.einsatzUrl = '$URL';"
  echo "globalThis.LEASKIN_CONFIG.einsatzKey = '$KEY';"
  [ -n "$PLINK" ] && echo "globalThis.LEASKIN_CONFIG.kommandoPushLink = '$PLINK';"
  [ -n "$ALINK" ] && echo "globalThis.LEASKIN_CONFIG.einsatzAppLink = '$ALINK';"
} > "$S"
chmod 600 "$S"
echo "✓ config.secret.js geschrieben"

# lageAktiv in config.local.js
[ -f "$L" ] || { echo "config.local.js fehlt – zuerst install.sh ausführen."; exit 1; }
if grep -q "lageAktiv" "$L"; then
  sed -i "s/^\s*\/\/\s*\(globalThis.LEASKIN_CONFIG.lageAktiv\)/\1/; s/lageAktiv = false/lageAktiv = true/" "$L"
else
  printf '\n// Alarm-Push ans Kommando + Einsatz-Nachbereitung (Kanal und Schlüssel in config.secret.js)\nglobalThis.LEASKIN_CONFIG.lageAktiv = true;\n' >> "$L"
fi
echo "✓ lageAktiv in config.local.js gesetzt"

# Test-Push
echo
echo "Jetzt in der ntfy-App den Kanal abonnieren:  $TOPIC"
read -r -p "Abonniert? Enter schickt einen Test-Push … "
if curl -fsS -m 15 -H "Title: Test Kommando-Kanal" -H "Tags: white_check_mark" -d "Alarm-Push FF Deutsch Haslau ist eingerichtet." "https://ntfy.sh/$TOPIC" >/dev/null 2>&1; then
  echo "✓ Test-Push gesendet – sollte jetzt am Handy sein"
else
  echo "✗ Test-Push ging nicht raus (Internet?). Einrichtung ist trotzdem gespeichert."
fi

# Verbindung zur Web-App prüfen (absichtlich unvollständige Daten → Web-App muss den Schlüssel akzeptieren)
R="$(curl -fsSL -m 30 -H 'Content-Type: text/plain;charset=utf-8' -d "{\"aktion\":\"einsatzEnde\",\"key\":\"$KEY\",\"einsatz\":{}}" "$URL" 2>/dev/null)"
case "$R" in
  *"Unvollständige Einsatzdaten"*) echo "✓ Web-App erreicht, Schlüssel passt" ;;
  *"Schlüssel falsch"*) echo "✗ Web-App sagt: Schlüssel falsch oder EINSATZ_KEY nicht eingerichtet – bitte prüfen" ;;
  "") echo "✗ Web-App nicht erreichbar – Adresse prüfen bzw. neue Version bereitgestellt?" ;;
  *) echo "? Unerwartete Antwort der Web-App (neue Version mit Nachbereitung.gs bereitgestellt?)" ;;
esac

echo
read -r -p "Infoscreen jetzt neu starten (update.sh)? [J/n] " J
case "${J:-j}" in [jJyY]*) exec "$D/update.sh" ;; *) echo "Später: ~/lea-skin/update.sh" ;; esac

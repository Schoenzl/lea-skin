// Vorlage für config.local.js – am Pi als config.local.js speichern.
// Diese Datei enthält Namen und wird NICHT ins Repo hochgeladen.
// Einsatzleiter-Reihung laut FDISK – [Vorname, Nachname]
globalThis.LEASKIN_CONFIG.elListe = [
  ['Vorname', 'Nachname'],
  ['Vorname', 'Nachname']
];

// Fahrtenbuch: Link „Im Web veröffentlichen“ (Tab Formularantworten, Format CSV)
// globalThis.LEASKIN_CONFIG.fahrtenbuchCsvUrl = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv';

// Ausfallmeldung: Ping-Adresse von healthchecks.io (Check anlegen, Adresse kopieren)
// globalThis.LEASKIN_CONFIG.heartbeatUrl = 'https://hc-ping.com/...';

// Fahrzeugstatus: Tab „Fahrzeuge“ im Web veröffentlichen (CSV)
// globalThis.LEASKIN_CONFIG.fahrzeugeCsvUrl = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=2001&single=true&output=csv';

// QR-Code „Fahrt eintragen“ am Ruhebildschirm: Link zum Google-Formular
// globalThis.LEASKIN_CONFIG.fahrtenbuchFormUrl = 'https://docs.google.com/forms/d/e/.../viewform';

// Handy-Ansicht (mobil/): nur auf EINEM Pi setzen. Gibt den Stand an den Server am Pi weiter (127.0.0.1:8787),
// erreichbar nur über Tailscale. Einrichten: ~/lea-skin/mobil/install-mobil.sh
// globalThis.LEASKIN_CONFIG.mobilPush = true;

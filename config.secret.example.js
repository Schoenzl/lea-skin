// Vorlage für config.secret.js – am Pi als config.secret.js speichern (wird NICHT ins Repo hochgeladen).
// Wird nur vom Hintergrund-Dienst gelesen, nicht von der LEA-Seite. Zusätzlich in config.local.js: lageAktiv = true.

// Alarm-Push mit Lagebild ans Kommando (App „ntfy“, eigener geheimer Kanal, z. B. 'ffdh-kommando-' + Zufall).
// 3 min nach dem Alarm das Lagebild, dann bei Änderung, bis 20 min; nach 5 min noch „nicht besetzbar“ → Warnung mit hoher Priorität.
// globalThis.LEASKIN_CONFIG.kommandoPushTopic = 'ffdh-kommando-…';
// optional: Antippen des Pushes öffnet die Handy-Ansicht (Tailscale-Adresse)
// globalThis.LEASKIN_CONFIG.kommandoPushLink = 'https://…ts.net/';

// Einsatz-Nachbereitung: Web-App-Adresse und Schlüssel – beides zeigt ▶ einsatzEinrichtenNachbereitung im Apps-Script-Editor an.
// globalThis.LEASKIN_CONFIG.einsatzUrl = 'https://script.google.com/macros/s/…/exec';
// globalThis.LEASKIN_CONFIG.einsatzKey = '…';
// optional: Link im Push „Einsatz beendet“
// globalThis.LEASKIN_CONFIG.einsatzAppLink = 'https://schoenzl.github.io/feuerwehr-dh/ff.html?seite=einsaetze#…';

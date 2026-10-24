// Einstellungen für den eigenen LEA-Infoscreen der FF Deutsch Haslau.
// Nach Änderungen: Datei speichern, Kiosk neu starten (oder Seite neu laden).
// globalThis: wird auch vom Hintergrund-Dienst (background.js) gelesen
globalThis.LEASKIN_CONFIG = {
  feuerwehr: 'FF Deutsch Haslau',

  // true = eigener Ruhebildschirm, false = LEA-Original, wenn kein Einsatz läuft
  ruheAnsicht: true,

  // Einsatzleiter-Reihung: steht in config.local.js (nur am Pi, nicht im Repo)
  elListe: [],

  // Funktionskürzel aus der LEA und ihre Farben (Reihenfolge = Reihenfolge der Anzeige)
  funktionen: {
    'EL': { bg: '#DC2626', fg: '#FFFFFF' },
    'MA': { bg: '#FACC15', fg: '#0B0E13' },
    'ATS': { bg: '#2563EB', fg: '#FFFFFF' },
    'C': { bg: '#166534', fg: '#FFFFFF' },
    '5,5t': { bg: '#86EFAC', fg: '#0B0E13' }
  },

  // Ampel: Mindestbesetzung KLF-W. Jede Person zählt nur für eine Rolle.
  // pflicht: fehlt diese Rolle -> "nicht besetzbar", sonst höchstens "knapp"
  fahrzeug: {
    name: 'KLF-W',
    besatzung: 'Staffel 1:5',
    mindestGesamt: 6,
    rollen: [
      { kuerzel: 'EL', label: 'Einsatzleiter', anzahl: 1, pflicht: true },
      { kuerzel: 'C', label: 'Lenker', anzahl: 1, pflicht: true },
      { kuerzel: 'ATS', label: 'Atemschutz', anzahl: 3, pflicht: false }
    ]
  },

  // Farbe des Alarmbands nach erstem Buchstaben der Alarmstufe
  farben: { B: '#B3122E', T: '#1D4ED8', S: '#C2410C', default: '#4B5563' },

  einsatzWechselSek: 15,   // mehrere Einsätze gleichzeitig: Wechselintervall
  datenTimeoutSek: 45,     // keine neuen Daten so lange -> Original-Infoscreen zeigen
  karteZoom: 17,
  karteUrl: 'https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png',

  // ---------- Ruhebildschirm ----------
  // Wetter & Wind (Open-Meteo, frei, ohne Anmeldung)
  ort: { name: 'Deutsch Haslau', lat: 48.07, lon: 16.87 },
  // Bezirkslage direkt aus WASTL (feuerwehr-krems.at), Bezirk Bruck/Leitha = 03
  wastlBezirk: '03',
  wastlTitel: 'Ausgerückte Feuerwehren · Bruck/Leitha & Neusiedl/See',
  // Burgenland: Landessicherheitszentrale (einsatz.lsz-b.at), Bezirk Neusiedl am See = ND
  lszBezirk: 'ND',
  lszUrl: 'https://einsatz.lsz-b.at/',
  eigeneFF: 'Deutsch Haslau',   // wird in der Liste der eingesetzten Feuerwehren hervorgehoben
  // Pegel aus dem Hydrographischen Dienst NÖ (noe.gv.at/wasserstand)
  pegel: { name: 'Leitha', station: '209007', ort: 'Deutsch Haslau' },
  // Termine: öffentlicher Google-Kalender „FF Deutsch Haslau“ (iCal) ...
  kalenderIcsUrl: 'https://calendar.google.com/calendar/ical/99e2e6ed3a981ad4f7ac6eea1af12056aa7e9a6a91587923b10359adc3443447%40group.calendar.google.com/public/basic.ics',
  kalenderTage: 60,        // so weit im Voraus Termine suchen
  // ... plus optional fix eingetragene Termine: { start: '2026-11-04T18:00', titel: '...' }
  termine: [],
  // Fahrtenbuch (Google-Formular -> Google-Tabelle, Antwort-Tab „Im Web veröffentlichen“ als CSV)
  // Der CSV-Link steht nur am Pi in config.local.js (fahrtenbuchCsvUrl), nicht im Repo
  fahrzeuge: ['KLF-W', 'MTF', 'VFA'],
  fahrtenbuchCsvUrl: '',
  fahrtenbuchVorschauTage: 7,   // nächste Nutzung so weit im Voraus anzeigen
  aktualisierenMin: 5      // Wetter/WASTL/Kalender alle 5 Minuten neu holen
};

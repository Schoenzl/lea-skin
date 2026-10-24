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
  // Bezirkslage aus dem eigenen WASTL-Proxy (Bezirk Bruck/Leitha)
  wastlUrl: 'https://wastl-proxy.onrender.com',
  wastlTitel: 'Bezirk Bruck/Leitha · WASTL',
  // Pegel aus dem Hydrographischen Dienst NÖ (noe.gv.at/wasserstand)
  pegel: { name: 'Leitha', station: '209007', ort: 'Deutsch Haslau' },
  // Termine: fix eingetragen (Ausbildungsplan 2026, Beginn jeweils 18:00) ...
  termine: [
    { start: '2026-11-04T18:00', titel: 'Planspiel Einsatzleiter' }
  ],
  // ... und/oder ein Kalender im iCal-Format (z. B. öffentlicher Google-Kalender, „Adresse im iCal-Format“)
  kalenderIcsUrl: '',
  aktualisierenMin: 5      // Wetter/WASTL/Kalender alle 5 Minuten neu holen
};

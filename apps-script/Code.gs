/**
 * Fahrzeugbuchung FF Deutsch Haslau – Buchungsseite mit Prüfung auf Doppelbuchung.
 * Gehört zur Tabelle „Fahrzeugnutzung FF Deutsch Haslau“ (Erweiterungen → Apps Script).
 * Schreibt in denselben Tab wie das bisherige Google-Formular, der Infoscreen liest unverändert mit.
 */
const BLATT = 'Formularantworten 1';            // Spalten: Zeitstempel · Fahrzeug · Name · Von · Bis · Zweck
const FAHRZEUGE = ['KLF-W', 'MTF', 'VFA'];
const ABGESAGT = /abgesagt|storniert|storno|entf(ä|ae)llt|f(ä|ae)llt aus/i;
const MAX_TAGE = 7;                              // längste Buchung

function doGet() {
  return HtmlService.createTemplateFromFile('Buchung').evaluate()
    .setTitle('Fahrzeug buchen – FF Deutsch Haslau')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------- Daten lesen ----------
function blatt_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(BLATT);
  if (!sh) throw new Error('Tab „' + BLATT + '“ fehlt');
  return sh;
}
function spalten_(kopf) {
  const k = kopf.map((x) => String(x).toLowerCase());
  const f = (...w) => k.findIndex((h) => w.some((x) => h.indexOf(x) !== -1));
  return { zeit: f('zeitstempel'), fz: f('fahrzeug'), name: f('name'), von: f('von', 'beginn'), bis: f('bis', 'ende'), zweck: f('zweck', 'grund') };
}
function buchungen_() {
  const werte = blatt_().getDataRange().getValues();
  if (werte.length < 2) return [];
  const s = spalten_(werte[0]);
  return werte.slice(1).map((r, i) => ({
    zeile: i + 2,
    fahrzeug: String(r[s.fz] || '').trim(),
    name: String(r[s.name] || '').trim(),
    von: zeit_(r[s.von]),
    bis: zeit_(r[s.bis]),
    zweck: s.zweck >= 0 ? String(r[s.zweck] || '').trim() : ''
  })).filter((b) => b.fahrzeug && b.von && b.bis && b.bis > b.von && !ABGESAGT.test(b.zweck));
}
function zeit_(v) {
  if (v instanceof Date) return v.getTime();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(String(v || '').trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}
const gleich_ = (a, b) => String(a).replace(/\s+/g, '').toLowerCase() === String(b).replace(/\s+/g, '').toLowerCase();
const WT_ = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const fmt_ = (t) => { const d = new Date(t); return WT_[+Utilities.formatDate(d, 'Europe/Vienna', 'u')] + ' ' + Utilities.formatDate(d, 'Europe/Vienna', 'dd.MM. HH:mm'); };

// Für die Seite: Fahrzeuge, bekannte Namen, kommende Buchungen (nächste 30 Tage)
function startdaten() {
  const jetzt = Date.now(), alle = buchungen_();
  const namen = Array.from(new Set(alle.map((b) => b.name).filter(Boolean))).sort();
  const kommend = alle.filter((b) => b.bis >= jetzt && b.von <= jetzt + 30 * 864e5)
    .sort((a, b) => a.von - b.von)
    .map((b) => ({ zeile: b.zeile, fahrzeug: b.fahrzeug, name: b.name, zweck: b.zweck, von: b.von, bis: b.bis, text: fmt_(b.von) + ' – ' + fmt_(b.bis) }));
  return { fahrzeuge: FAHRZEUGE, namen, kommend };
}

// ---------- Buchen ----------
// von/bis kommen als „2026-10-29T18:00“ (Zeit in Wien)
function lokal_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) throw new Error('Bitte Datum und Uhrzeit angeben.');
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
function pruefe_(neu, alle) {
  if (FAHRZEUGE.indexOf(neu.fahrzeug) === -1) return 'Bitte ein Fahrzeug auswählen.';
  if (!neu.name || neu.name.length < 3) return 'Bitte den vollen Namen eintragen.';
  if (!(neu.bis > neu.von)) return '„Bis“ muss nach „Von“ liegen.';
  if (neu.bis - neu.von > MAX_TAGE * 864e5) return 'Eine Buchung darf höchstens ' + MAX_TAGE + ' Tage dauern.';
  if (neu.bis < Date.now()) return 'Der Zeitraum liegt in der Vergangenheit.';
  const konflikt = alle.filter((b) => gleich_(b.fahrzeug, neu.fahrzeug) && b.von < neu.bis && neu.von < b.bis);
  if (konflikt.length) {
    return neu.fahrzeug + ' ist in diesem Zeitraum bereits gebucht:\n' +
      konflikt.map((b) => '• ' + fmt_(b.von) + ' – ' + fmt_(b.bis) + ' · ' + b.name + (b.zweck ? ' · ' + b.zweck : '')).join('\n');
  }
  return '';
}
function buchen(daten) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);                        // zwei gleichzeitige Buchungen nacheinander prüfen
  try {
    const neu = {
      fahrzeug: String(daten.fahrzeug || '').trim(),
      name: String(daten.name || '').trim().slice(0, 80),
      zweck: String(daten.zweck || '').trim().slice(0, 120),
      von: lokal_(daten.von).getTime(),
      bis: lokal_(daten.bis).getTime()
    };
    const fehler = pruefe_(neu, buchungen_());
    if (fehler) return { ok: false, fehler };
    const sh = blatt_();
    const s = spalten_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    const zeile = new Array(sh.getLastColumn()).fill('');
    zeile[s.zeit] = new Date(); zeile[s.fz] = neu.fahrzeug; zeile[s.name] = neu.name;
    zeile[s.von] = new Date(neu.von); zeile[s.bis] = new Date(neu.bis);
    if (s.zweck >= 0) zeile[s.zweck] = neu.zweck;
    sh.appendRow(zeile);
    const r = sh.getLastRow();
    [s.zeit, s.von, s.bis].forEach((c) => sh.getRange(r, c + 1).setNumberFormat('dd.MM.yyyy HH:mm:ss'));
    SpreadsheetApp.flush();
    return { ok: true, text: neu.fahrzeug + ' gebucht: ' + fmt_(neu.von) + ' – ' + fmt_(neu.bis) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Absagen: „abgesagt“ vor den Zweck schreiben (der Infoscreen blendet die Fahrt dann aus) ----------
function absagen(zeile, name) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = blatt_();
    const s = spalten_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    const r = sh.getRange(zeile, 1, 1, sh.getLastColumn()).getValues()[0];
    if (!String(r[s.fz] || '').trim()) return { ok: false, fehler: 'Buchung nicht gefunden.' };
    const wer = String(name || '').trim();
    if (wer.length < 3) return { ok: false, fehler: 'Bitte deinen Namen angeben.' };
    const zweck = String(r[s.zweck] || '').trim();
    sh.getRange(zeile, s.zweck + 1).setValue('ABGESAGT (' + wer + ')' + (zweck ? ' – ' + zweck : ''));
    return { ok: true, text: 'Buchung abgesagt.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Fahrzeugbuchung FF Deutsch Haslau – Buchungsseite mit Prüfung auf Doppelbuchung.
 * Gehört zur Tabelle „Fahrzeugnutzung FF Deutsch Haslau“ (Erweiterungen → Apps Script).
 * Schreibt in denselben Tab wie das bisherige Google-Formular, der Infoscreen liest unverändert mit.
 */
const BLATT = 'Formularantworten 1';            // Spalten: Zeitstempel · Fahrzeug · Name · Von · Bis · Zweck
const FAHRZEUGE = ['KLF-W', 'MTF', 'VFA'];
const ABGESAGT = /abgesagt|storniert|storno|entf(ä|ae)llt|f(ä|ae)llt aus/i;
const MAX_TAGE = 7;                              // längste Buchung

function doGet(e) {
  const status = e && e.parameter && e.parameter.seite === 'status';
  return HtmlService.createTemplateFromFile(status ? 'Status' : 'Buchung').evaluate()
    .setTitle(status ? 'Fahrzeugstatus – FF Deutsch Haslau' : 'Fahrzeug buchen – FF Deutsch Haslau')
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

// ---------- Statusseite fürs Kommando (…/exec?seite=status), mit PIN geschützt ----------
// PIN einrichten: Projekteinstellungen → Skripteigenschaften → STATUS_PIN (mind. 6 Ziffern).
// Ohne richtige PIN liefert der Server keine Daten. Nach 10 Fehlversuchen ist 15 Minuten gesperrt.
const FEHL_MAX = 10, SPERRE_S = 900;

function pinOk_(pin) {
  const soll = PropertiesService.getScriptProperties().getProperty('STATUS_PIN');
  if (!soll || String(soll).length < 6) throw new Error('Die Statusseite ist noch nicht eingerichtet (STATUS_PIN fehlt).');
  const cache = CacheService.getScriptCache();
  const fehl = +(cache.get('status-fehl') || 0);
  if (fehl >= FEHL_MAX) throw new Error('Zu viele falsche Versuche. Bitte in 15 Minuten wieder probieren.');
  if (String(pin || '').trim() === String(soll).trim()) return true;
  cache.put('status-fehl', String(fehl + 1), SPERRE_S);
  Utilities.sleep(800);                          // bremst Durchprobieren
  return false;
}

function zustand_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Fahrzeuge');
  const erg = {};
  if (!sh) return erg;
  const w = sh.getDataRange().getDisplayValues();
  const k = w[0].map((x) => String(x).toLowerCase());
  const f = (t) => k.findIndex((h) => h.indexOf(t) !== -1);
  const c = { fz: f('fahrzeug'), bereit: f('einsatzbereit'), mangel: f('mangel'), pickerl: f('pickerl') };
  w.slice(1).forEach((r) => {
    const fz = String(r[c.fz] || '').trim(); if (!fz) return;
    erg[fz] = {
      bereit: String(r[c.bereit] || '').trim().toLowerCase(),
      mangel: c.mangel >= 0 ? String(r[c.mangel] || '').trim() : '',
      pickerl: c.pickerl >= 0 ? String(r[c.pickerl] || '').trim() : ''
    };
  });
  return erg;
}

function statusdaten(pin) {
  if (!pinOk_(pin)) return { ok: false, fehler: 'PIN falsch.' };
  const jetzt = Date.now(), alle = buchungen_(), zst = zustand_();
  const fahrzeuge = FAHRZEUGE.map((fz) => {
    const eigene = alle.filter((b) => gleich_(b.fahrzeug, fz)).sort((a, b) => a.von - b.von);
    const zeige = (b) => b && { zeile: b.zeile, name: b.name, zweck: b.zweck, von: b.von, bis: b.bis, text: fmt_(b.von) + ' – ' + fmt_(b.bis) };
    const z = Object.keys(zst).find((x) => gleich_(x, fz));
    return {
      fahrzeug: fz,
      unterwegs: zeige(eigene.find((b) => b.von <= jetzt && jetzt < b.bis)),
      naechste: zeige(eigene.find((b) => b.von > jetzt)),
      zuletzt: zeige(eigene.filter((b) => b.bis <= jetzt).pop()),
      zustand: z ? zst[z] : null,
      // für die Zeitleiste: alles, was die nächsten 7 Tage oder die letzten 24 h berührt
      fahrten: eigene.filter((b) => b.bis > jetzt - 864e5 && b.von < jetzt + 7 * 864e5).map(zeige)
    };
  });
  return { ok: true, jetzt, fahrzeuge };
}

// Kommando löscht eine Fahrt: Zeile wird nur entfernt, wenn Fahrzeug, Von und Bis noch übereinstimmen
// (falls sich die Tabelle inzwischen verschoben hat, wird nichts Falsches gelöscht).
function statusLoeschen(pin, zeile, fahrzeug, von, bis) {
  if (!pinOk_(pin)) return { ok: false, fehler: 'PIN falsch.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = buchungen_().find((x) => x.zeile === +zeile);
    if (!b || !gleich_(b.fahrzeug, fahrzeug) || b.von !== +von || b.bis !== +bis) {
      return { ok: false, fehler: 'Die Fahrt wurde inzwischen geändert oder gelöscht. Ansicht wird neu geladen.' };
    }
    blatt_().deleteRow(b.zeile);
    SpreadsheetApp.flush();
    return { ok: true, text: b.fahrzeug + ' · ' + b.name + ' · ' + fmt_(b.von) + ' gelöscht.' };
  } finally {
    lock.releaseLock();
  }
}

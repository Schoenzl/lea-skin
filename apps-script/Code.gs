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
  const a = (e && e.parameter && e.parameter.aktion) || '';
  if (a === 'fdisk' || a === 'fdiskErledigt' || a === 'fdiskEinsaetze' || a === 'einsatzErledigt' || a === 'fristenAnfrage' || a === 'fristenStatus') return fdiskAbfrage_(e.parameter);   // automatischer FDISK-Übertrag (Taetigkeit.gs)
  const t = HtmlService.createTemplateFromFile('Buchung');
  const seite = (e && e.parameter && e.parameter.seite) || '';
  // Alte Links bleiben gültig: ?seite=da (Anwesenheit), ?seite=intern/status (Verwaltung), ?seite=einsatz; neu ?fz=KLF-W (Fahrzeug-QR)
  // Fahrzeug-QR: ?seite=klfw / mtf / vfa (die Hülle ff.html gibt nur „seite“ weiter, nur Buchstaben) oder ?fz=KLF-W
  const nurBuchstaben = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
  const fzWunsch = nurBuchstaben((e && e.parameter && e.parameter.fz) || seite);
  t.start = seite === 'status' || seite === 'intern' || seite === 'kommando' ? 'verwaltung' : seite === 'da' || seite === 'anwesenheit' ? 'da' : seite === 'einsatz' ? 'einsatz' : seite === 'buchen' ? 'fahrzeuge' : seite === 'maengel' ? 'maengel' : seite === 'mangel' ? 'mangel' : seite === 'einsaetze' ? 'einsaetze' : seite === 'fristen' ? 'fristen' : '';
  t.fz = FAHRZEUGE.find((f) => nurBuchstaben(f) === fzWunsch) || '';
  return t.evaluate()
    .setTitle('FF Deutsch Haslau')
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
  return { zeit: f('zeitstempel'), fz: f('fahrzeug'), name: f('name'), von: f('von', 'beginn'), bis: f('bis', 'ende'), zweck: f('zweck', 'grund'), mail: f('mail') };
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
    zweck: s.zweck >= 0 ? String(r[s.zweck] || '').trim() : '',
    mail: s.mail >= 0 ? String(r[s.mail] || '').trim() : ''
  })).filter((b) => b.fahrzeug && b.von && b.bis && b.bis > b.von && !ABGESAGT.test(b.zweck));
}
function zeit_(v) {
  if (v instanceof Date) return v.getTime();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(String(v || '').trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}
const MAIL_ = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Spalte „E-Mail“ beim ersten Bedarf hinten anfügen (Infoscreen erkennt Spalten am Namen, stört also nicht)
function mailSpalte_(sh) {
  const kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (spalten_(kopf).mail < 0) sh.getRange(1, kopf.length + 1).setValue('E-Mail');
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
  const bewegung = alle.filter((b) => BF_LAEUFT.test(b.zweck)).map((b) => ({ zeile: b.zeile, fahrzeug: b.fahrzeug, name: b.name, von: b.von, bis: b.bis, seit: fmt_(b.von) }));
  return { fahrzeuge: FAHRZEUGE, namen, kommend, bewegung };
}

// ---------- Bewegungsfahrt: Start sofort, Ende mit „Einrücken“ ----------
// Läuft als normale Buchung mit Zweck „Bewegungsfahrt (läuft)“ und vorläufigem Ende; der Zeitauslöser verlängert sie,
// bis eingerückt wird (höchstens BF_MAX_H Stunden und nie in die nächste Buchung hinein).
const BF_ZWECK = 'Bewegungsfahrt', BF_LAEUFT = /^Bewegungsfahrt \(läuft\)/, BF_START_H = 2, BF_MAX_H = 8, BF_MIN_FREI = 15 * 60e3;

function bewegungStart(daten) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const fz = FAHRZEUGE.find((f) => gleich_(f, daten && daten.fahrzeug));
    const name = String(daten && daten.name || '').trim().slice(0, 80), mail = String(daten && daten.mail || '').trim().toLowerCase().slice(0, 120);
    if (!fz) return { ok: false, fehler: 'Bitte ein Fahrzeug auswählen.' };
    if (name.length < 3) return { ok: false, fehler: 'Bitte deinen vollen Namen eintragen.' };
    const jetzt = Date.now(), alle = buchungen_();
    // außer Dienst (Status im Tab „Fahrzeuge“ oder geplante Sperre)?
    try {
      const t = fzTab_(), z = t.w.find((y, j) => j > 0 && gleich_(y[t.s.fz], fz));
      if (z && fzBereit_(z[t.s.bereit]) === 'Nein') return { ok: false, fehler: fz + ' ist außer Dienst' + (String(z[t.s.mangel] || '').trim() ? ': ' + String(z[t.s.mangel]).trim() : '') + '.' };
    } catch (e) { /* Tab fehlt – dann ohne Statusprüfung */ }
    const gesperrt = sperrKonflikt_({ fahrzeug: fz, von: jetzt, bis: jetzt + BF_MIN_FREI });
    if (gesperrt.length) return { ok: false, fehler: fz + ' ist außer Dienst: ' + gesperrt[0].grund + '.' };
    const eigene = alle.filter((b) => gleich_(b.fahrzeug, fz));
    const jetztB = eigene.find((b) => b.von <= jetzt && jetzt < b.bis);
    if (jetztB) return { ok: false, fehler: fz + ' ist gerade unterwegs: ' + jetztB.name + (jetztB.zweck ? ' · ' + jetztB.zweck : '') + ' bis ' + fmt_(jetztB.bis) + '.' };
    const naechste = eigene.filter((b) => b.von > jetzt).sort((a, b) => a.von - b.von)[0];
    if (naechste && naechste.von - jetzt < BF_MIN_FREI) return { ok: false, fehler: fz + ' ist ab ' + fmt_(naechste.von) + ' gebucht (' + naechste.name + '). Für eine Bewegungsfahrt ist das zu knapp.' };
    const bis = Math.min(jetzt + BF_START_H * 3600e3, naechste ? naechste.von : Infinity, bfSperreAb_(fz, jetzt));
    const sh = blatt_();
    mailSpalte_(sh);
    const s = spalten_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    if (s.zweck < 0) return { ok: false, fehler: 'Spalte „Zweck“ fehlt in der Tabelle.' };
    const zeile = new Array(sh.getLastColumn()).fill('');
    zeile[s.zeit] = new Date(); zeile[s.fz] = fz; zeile[s.name] = name;
    zeile[s.von] = new Date(jetzt); zeile[s.bis] = new Date(bis); zeile[s.zweck] = BF_ZWECK + ' (läuft)';
    if (s.mail >= 0 && MAIL_.test(mail)) zeile[s.mail] = mail;
    sh.appendRow(zeile);
    const r = sh.getLastRow();
    [s.zeit, s.von, s.bis].forEach((c) => sh.getRange(r, c + 1).setNumberFormat('dd.MM.yyyy HH:mm:ss'));
    SpreadsheetApp.flush();
    let hinweis = naechste && naechste.von === bis ? ' Achtung: ' + fz + ' ist ab ' + fmt_(naechste.von) + ' gebucht, bis dahin bitte einrücken.' : '';
    try { ausloeserPruefen_(); } catch (e) { hinweis += ' (Automatische Verlängerung nicht aktiv: im Editor ▶ sperrenEinrichten ausführen.)'; }
    return { ok: true, text: 'Bewegungsfahrt ' + fz + ' läuft seit ' + fmt_(jetzt) + '. Nach der Fahrt „Einrücken“ drücken.' + hinweis };
  } finally { lock.releaseLock(); }
}

function bewegungEnde(zeile, name) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const wer = String(name || '').trim().slice(0, 80);
    if (wer.length < 3) return { ok: false, fehler: 'Bitte deinen Namen eintragen.' };
    const b = buchungen_().find((x) => x.zeile === +zeile && BF_LAEUFT.test(x.zweck));
    if (!b) return { ok: false, fehler: 'Diese Bewegungsfahrt ist schon beendet. Ansicht wird neu geladen.' };
    const sh = blatt_(), s = spalten_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    const alle = buchungen_(), naechste = alle.filter((x) => x.zeile !== b.zeile && gleich_(x.fahrzeug, b.fahrzeug) && x.von >= b.von).sort((x, y) => x.von - y.von)[0];
    const jetzt = Date.now(), ende = Math.max(b.von + 60e3, Math.min(jetzt, naechste ? naechste.von : Infinity));
    sh.getRange(b.zeile, s.bis + 1).setValue(new Date(ende)).setNumberFormat('dd.MM.yyyy HH:mm:ss');
    sh.getRange(b.zeile, s.zweck + 1).setValue(BF_ZWECK + (gleich_(wer, b.name) ? '' : ' (eingerückt: ' + wer + ')'));
    SpreadsheetApp.flush();
    try { taetBewegung_(b, ende); } catch (e) { console.error('Bewegungsfahrt als Tätigkeit: ' + e.message); }
    const min = Math.round((ende - b.von) / 60e3);
    return { ok: true, text: b.fahrzeug + ' eingerückt um ' + fmt_(ende).slice(-5) + ' · Bewegungsfahrt ' + (min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min') + '.' };
  } finally { lock.releaseLock(); }
}

// Beginn der nächsten geplanten Außerdienststellung ab „ab“ (sonst Infinity)
function bfSperreAb_(fz, ab) {
  let t = Infinity;
  try { sperren_().forEach((x) => { if (x.aktiv && x.ablauf !== 'beendet' && x.status === 'Nein' && gleich_(x.fahrzeug, fz) && x.von > ab) t = Math.min(t, x.von); }); } catch (e) { /* ohne Sperren */ }
  return t;
}
// Vom Zeitauslöser: laufende Bewegungsfahrten vor ihrem vorläufigen Ende um 30 min verlängern
function bewegungVerlaengern_() {
  const jetzt = Date.now(), alle = buchungen_();
  const laufend = alle.filter((b) => BF_LAEUFT.test(b.zweck) && b.bis - jetzt < 10 * 60e3);
  if (!laufend.length) return;
  const sh = blatt_(), s = spalten_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  laufend.forEach((b) => {
    const naechste = alle.filter((x) => x.zeile !== b.zeile && gleich_(x.fahrzeug, b.fahrzeug) && x.von >= b.bis).sort((x, y) => x.von - y.von)[0];
    const grenze = Math.min(b.von + BF_MAX_H * 3600e3, naechste ? naechste.von : Infinity, bfSperreAb_(b.fahrzeug, b.von));
    const neu = Math.min(Math.max(b.bis, jetzt) + 30 * 60e3, grenze);
    if (neu > b.bis) sh.getRange(b.zeile, s.bis + 1).setValue(new Date(neu)).setNumberFormat('dd.MM.yyyy HH:mm:ss');
    else if (jetzt >= b.bis) sh.getRange(b.zeile, s.zweck + 1).setValue(BF_ZWECK + ' (nicht eingerückt)');
  });
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
  if (neu.mail && !MAIL_.test(neu.mail)) return 'Die E-Mail-Adresse stimmt nicht.';
  if (!(neu.bis > neu.von)) return '„Bis“ muss nach „Von“ liegen.';
  if (neu.bis - neu.von > MAX_TAGE * 864e5) return 'Eine Buchung darf höchstens ' + MAX_TAGE + ' Tage dauern.';
  if (neu.bis < Date.now()) return 'Der Zeitraum liegt in der Vergangenheit.';
  const gesperrt = sperrKonflikt_(neu);
  if (gesperrt.length) {
    return neu.fahrzeug + ' ist in diesem Zeitraum außer Dienst:\n' +
      gesperrt.map((x) => '• ' + fmt_(x.von) + ' – ' + (x.bis ? fmt_(x.bis) : 'bis auf Weiteres') + ' · ' + x.grund).join('\n');
  }
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
      mail: String(daten.mail || '').trim().toLowerCase().slice(0, 120) || mitgliedMail_(daten.name),
      von: lokal_(daten.von).getTime(),
      bis: lokal_(daten.bis).getTime()
    };
    const fehler = pruefe_(neu, buchungen_());
    if (fehler) return { ok: false, fehler };
    const sh = blatt_();
    mailSpalte_(sh);
    const s = spalten_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    const zeile = new Array(sh.getLastColumn()).fill('');
    if (MAIL_.test(neu.mail)) zeile[s.mail] = neu.mail;
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
// PIN einrichten: Projekteinstellungen → Skripteigenschaften → STATUS_PIN (mind. 4 Ziffern).
// Ohne richtige PIN liefert der Server keine Daten. Nach 10 Fehlversuchen ist 15 Minuten gesperrt.
const FEHL_MAX = 10, SPERRE_S = 900;

function pinNorm_(p) { return String(p == null ? '' : p).replace(/[\s"'„“]/g, ''); }
// Anmeldung kommt als „Name|PIN“. Fahrzeuge, Fahrten löschen und Anwesenheit nur für Rolle „Alles“ (Kdt, Stv) – siehe rolle_ in Pruefung.gs.
function pinOk_(pin) {
  const r = rolle_(pin);
  return !!r && r.rolle === 'kommando';
}

// Im Editor ausführen (▶ pinPruefen), wenn die PIN nicht geht: zeigt im Ausführungslog, ob STATUS_PIN gefunden wird, und hebt eine Sperre auf.
function pinPruefen() {
  const p = PropertiesService.getScriptProperties().getProperties();
  const k = Object.keys(p);
  CacheService.getScriptCache().remove('status-fehl');
  console.log('Skripteigenschaften: ' + (k.length ? k.join(', ') : '(keine)'));
  console.log(p.STATUS_PIN ? 'STATUS_PIN gefunden, ' + pinNorm_(p.STATUS_PIN).length + ' Zeichen. Sperre aufgehoben.' : 'STATUS_PIN NICHT gefunden – Name genau so schreiben: STATUS_PIN');
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
function statusLoeschen(pin, zeile, fahrzeug, von, bis, grund) {
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
    const begr = String(grund || '').trim().slice(0, 500);
    let info = ' Keine E-Mail hinterlegt, bitte persönlich Bescheid geben.';
    if (MAIL_.test(b.mail)) {
      try {
        MailApp.sendEmail({
          to: b.mail,
          subject: 'Fahrzeugbuchung ' + b.fahrzeug + ' ' + fmt_(b.von) + ' wurde gelöscht',
          body: 'Hallo ' + b.name + ',\n\n' +
            'deine Buchung wurde vom Kommando der FF Deutsch Haslau gelöscht:\n\n' +
            '  Fahrzeug: ' + b.fahrzeug + '\n' +
            '  Zeit:     ' + fmt_(b.von) + ' – ' + fmt_(b.bis) + '\n' +
            (b.zweck ? '  Zweck:    ' + b.zweck + '\n' : '') +
            '\nBegründung: ' + (begr || '(keine angegeben)') + '\n\n' +
            'Bei Fragen melde dich bitte beim Kommando.\n\nFF Deutsch Haslau',
          name: 'FF Deutsch Haslau – Fahrzeuge'
        });
        info = ' Benachrichtigung an ' + b.mail + ' gesendet.';
      } catch (e) {
        info = ' E-Mail konnte nicht gesendet werden (' + e.message + '), bitte persönlich Bescheid geben.';
      }
    }
    return { ok: true, text: b.fahrzeug + ' · ' + b.name + ' · ' + fmt_(b.von) + ' gelöscht.' + info };
  } finally {
    lock.releaseLock();
  }
}

// Einmal im Editor ausführen (▶ mailTest): erteilt die Berechtigung zum Mailversand und schickt dir eine Testmail.
function mailTest() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Test Fahrzeugbuchung', 'Mailversand funktioniert. Verbleibendes Tageskontingent: ' + MailApp.getRemainingDailyQuota());
}


// ---------- Fahrzeugstatus (Tab „Fahrzeuge“) – Kommando und Fahrmeister ----------
const FZ_BEREIT = ['Ja', 'Eingeschränkt', 'Nein'];
const fzDarf_ = (r) => !!r && (r.rolle === 'kommando' || r.rolle === 'fahrmeister');
const fzName_ = (r) => String(r.name).replace(/\s*\(.*\)$/, '');
const fzBereit_ = (b) => FZ_BEREIT.find((x) => x.toLowerCase() === String(b || '').trim().toLowerCase()) || (/^einge/i.test(String(b || '').trim()) ? 'Eingeschränkt' : '');

// Tab „Fahrzeuge“ lesen: Blatt, Werte, Spaltennummern
function fzTab_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Fahrzeuge');
  if (!sh) throw new Error('Tab „Fahrzeuge“ fehlt in der Tabelle.');
  const w = sh.getDataRange().getValues(), k = w[0].map((x) => String(x).toLowerCase());
  const c = (t) => k.findIndex((h) => h.indexOf(t) !== -1);
  const s = { fz: c('fahrzeug'), bereit: c('einsatzbereit'), mangel: c('mangel'), von: c('gemeldet von'), am: c('gemeldet am'), pickerl: c('pickerl') };
  if (s.fz < 0 || s.bereit < 0 || s.mangel < 0) throw new Error('Spalten „Fahrzeug“, „Einsatzbereit“ oder „Mangel“ fehlen.');
  return { sh, w, s };
}

function fzStatus(pin) {
  const r = rolle_(pin); if (!fzDarf_(r)) return { ok: false, fehler: 'Keine Berechtigung.' };
  try {
    const t = fzTab_(), s = t.s, anz = t.sh.getDataRange().getDisplayValues(), jetzt = Date.now(), sp = sperren_().filter((x) => x.aktiv && x.ablauf !== 'beendet' && (!x.bis || x.bis > jetzt));
    const fz = t.w.slice(1).map((z, j) => [z, anz[j + 1]]).filter(([z]) => String(z[s.fz] || '').trim()).map(([z, d]) => {
      const name = String(z[s.fz]).trim(), b = String(z[s.bereit] || '').trim();
      return {
        fahrzeug: name,
        bereit: fzBereit_(b) || (b ? b : 'Ja'),
        mangel: String(z[s.mangel] || '').trim(),
        von: s.von >= 0 ? String(z[s.von] || '').trim() : '',
        am: s.am >= 0 ? String(d[s.am] || '').trim() : '',
        pickerl: s.pickerl >= 0 ? String(d[s.pickerl] || '').trim() : '',
        sperren: sp.filter((x) => gleich_(x.fahrzeug, name)).sort((a, b) => a.von - b.von)
          .map((x) => ({ id: x.id, status: x.status, grund: x.grund, von: x.von, bis: x.bis, wer: x.wer, laeuft: x.von <= jetzt,
            text: fmt_(x.von) + ' – ' + (x.bis ? fmt_(x.bis) : 'bis auf Weiteres') }))
      };
    });
    return { ok: true, fahrzeuge: fz };
  } catch (e) { return { ok: false, fehler: e.message }; }
}

// Status direkt setzen. Bei „Ja“ wird der Mangel geleert (behoben). Wer und wann landet in „Gemeldet von/am“.
function fzStatusSetzen(pin, fahrzeug, bereit, mangel) {
  const r = rolle_(pin); if (!fzDarf_(r)) return { ok: false, fehler: 'Keine Berechtigung.' };
  bereit = fzBereit_(bereit);
  if (!bereit) return { ok: false, fehler: 'Unbekannter Status.' };
  mangel = String(mangel || '').trim().slice(0, 300);
  if (bereit !== 'Ja' && !mangel) return { ok: false, fehler: 'Bitte kurz den Grund eintragen (z. B. „Werkstatt bis Fr“).' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const fz = fzSetzen_(fahrzeug, bereit, mangel, fzName_(r));
    // Von Hand freigegeben: laufende Sperre dieses Fahrzeugs gilt als beendet
    if (bereit === 'Ja') sperren_().filter((x) => x.aktiv && x.ablauf === 'läuft' && gleich_(x.fahrzeug, fz)).forEach((x) => spAblauf_(x, 'beendet'));
    // von Hand einsatzbereit → bestätigte Mängelmeldungen dieses Fahrzeugs gelten als behoben
    if (bereit === 'Ja') try { const sh = SpreadsheetApp.getActive().getSheetByName(MG_TAB); if (sh) mgLesen_().filter((x) => x.status === 'bestätigt' && gleich_(x.was, fz)).forEach((x) => sh.getRange(x.zeile, mgSp_('Status'), 1, 3).setValues([['behoben', fzName_(r), new Date()]])); } catch (e) { console.error(e.message); }
    const was = bereit === 'Ja' ? 'wieder einsatzbereit' : bereit === 'Nein' ? 'außer Dienst' : 'eingeschränkt einsatzbereit';
    return { ok: true, text: fz + ' ist jetzt ' + was + '. Der Infoscreen zeigt es in wenigen Minuten.' };
  } catch (e) { return { ok: false, fehler: e.message }; } finally { lock.releaseLock(); }
}

// Schreibt den Status (ohne Rechteprüfung, Aufrufer hält den Lock). Gibt den Fahrzeugnamen aus der Tabelle zurück.
function fzSetzen_(fahrzeug, bereit, mangel, name) {
  const t = fzTab_(), s = t.s, sh = t.sh;
  const i = t.w.findIndex((z, j) => j > 0 && gleich_(z[s.fz], fahrzeug));
  if (i < 0) throw new Error('Fahrzeug „' + fahrzeug + '“ nicht gefunden.');
  if (bereit === 'Ja') mangel = '';
  mangel = String(mangel || '').replace(/^[\s=+\-@]+/, '');    // keine Formeln in der Tabelle
  sh.getRange(i + 1, s.bereit + 1).setValue(bereit);
  sh.getRange(i + 1, s.mangel + 1).setValue(mangel);
  if (s.von >= 0) sh.getRange(i + 1, s.von + 1).setValue(bereit === 'Ja' ? '' : name);
  if (s.am >= 0) sh.getRange(i + 1, s.am + 1).setValue(bereit === 'Ja' ? '' : Utilities.formatDate(new Date(), 'Europe/Vienna', 'dd.MM.yyyy HH:mm'));
  const fz = String(t.w[i][s.fz]).trim();
  fzLog_(fz, bereit, mangel, name);
  SpreadsheetApp.flush();
  return fz;
}

// Verlauf im Tab „Fahrzeugstatus-Log“ (legt sich selbst an)
function fzLog_(fahrzeug, bereit, mangel, name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Fahrzeugstatus-Log');
  if (!sh) { sh = ss.insertSheet('Fahrzeugstatus-Log'); sh.appendRow(['Zeitstempel', 'Fahrzeug', 'Einsatzbereit', 'Mangel', 'Von']); sh.getRange(1, 1, 1, 5).setFontWeight('bold'); sh.setFrozenRows(1); }
  sh.appendRow([new Date(), fahrzeug, bereit, mangel, name]);
}

// ---------- Geplante Sperren (Tab „Fahrzeugsperren“) ----------
// Ein Zeitauslöser (alle 5 Min., ▶ sperrenEinrichten einmal im Editor) setzt den Status bei Beginn und stellt ihn am Ende zurück.
// Während einer Sperre „Nein“ (außer Dienst) sind keine Buchungen möglich; „Eingeschränkt“ blockiert nicht.
const SP_TAB = 'Fahrzeugsperren';
const SP_KOPF = ['ID', 'Fahrzeug', 'Von', 'Bis', 'Status', 'Grund', 'Angelegt von', 'Angelegt am', 'Aktiv', 'Ablauf'];

function spBlatt_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SP_TAB);
  if (!sh) {
    sh = ss.insertSheet(SP_TAB); sh.appendRow(SP_KOPF);
    sh.getRange(1, 1, 1, SP_KOPF.length).setFontWeight('bold'); sh.setFrozenRows(1);
    sh.getRange('C:D').setNumberFormat('dd.MM.yyyy HH:mm'); sh.getRange('H:H').setNumberFormat('dd.MM.yyyy HH:mm');
  }
  return sh;
}
// Sperren lesen; „Ablauf“: leer = noch nicht begonnen, „läuft“ = Status gesetzt, „beendet“
function sperren_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SP_TAB); if (!sh) return [];
  const w = sh.getDataRange().getValues(), k = w[0].map((x) => String(x).trim());
  const c = (n) => k.indexOf(n);
  return w.slice(1).map((z, i) => ({
    zeile: i + 2, id: String(z[c('ID')] || ''), fahrzeug: String(z[c('Fahrzeug')] || '').trim(),
    von: zeit_(z[c('Von')]), bis: zeit_(z[c('Bis')]), status: fzBereit_(z[c('Status')]) || 'Nein',
    grund: String(z[c('Grund')] || '').trim(), wer: String(z[c('Angelegt von')] || '').trim(),
    aktiv: !/^nein$/i.test(String(z[c('Aktiv')] || '').trim()), ablauf: String(z[c('Ablauf')] || '').trim()
  })).filter((x) => x.id && x.fahrzeug && x.von);
}
const spMangel_ = (x) => x.grund + ' (geplant' + (x.bis ? ' bis ' + fmt_(x.bis) : '') + ')';
function spSpalte_(sh, name) {
  const k = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((x) => String(x).trim());
  let i = k.indexOf(name); if (i < 0) { i = k.length; sh.getRange(1, i + 1).setValue(name); }
  return i + 1;
}
function spAblauf_(x, wert) { const sh = spBlatt_(); sh.getRange(x.zeile, spSpalte_(sh, 'Ablauf')).setValue(wert); }

function fzSperreAnlegen(pin, fahrzeug, von, bis, status, grund) {
  const r = rolle_(pin); if (!fzDarf_(r)) return { ok: false, fehler: 'Keine Berechtigung.' };
  try {
    status = fzBereit_(status);
    if (status !== 'Nein' && status !== 'Eingeschränkt') return { ok: false, fehler: 'Bitte „Außer Dienst“ oder „Eingeschränkt“ wählen.' };
    if (FAHRZEUGE.every((f) => !gleich_(f, fahrzeug))) return { ok: false, fehler: 'Unbekanntes Fahrzeug.' };
    grund = String(grund || '').trim().slice(0, 200);
    if (!grund) return { ok: false, fehler: 'Bitte einen Grund eintragen (z. B. „Service Werkstatt“).' };
    const v = lokal_(von).getTime(), b = bis ? lokal_(bis).getTime() : 0;
    if (b && b <= v) return { ok: false, fehler: '„Bis“ muss nach „Von“ liegen.' };
    if (b && b <= Date.now()) return { ok: false, fehler: 'Der Zeitraum liegt in der Vergangenheit.' };
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const jetzt = Date.now(), ueber = sperren_().find((x) => x.aktiv && x.ablauf !== 'beendet' && gleich_(x.fahrzeug, fahrzeug) && (!x.bis || x.bis > jetzt) && (!b || x.von < b) && (!x.bis || v < x.bis));
      if (ueber) return { ok: false, fehler: fahrzeug + ' hat in diesem Zeitraum schon eine Sperre: ' + fmt_(ueber.von) + ' – ' + (ueber.bis ? fmt_(ueber.bis) : 'bis auf Weiteres') + ' · ' + ueber.grund + '. Bitte diese zuerst löschen oder anpassen.' };
      const sh = spBlatt_(), id = Utilities.getUuid().slice(0, 8);
      sh.appendRow([id, fahrzeug, new Date(v), b ? new Date(b) : '', status, grund, fzName_(r), new Date(), 'Ja', '']);
      SpreadsheetApp.flush();
    } finally { lock.releaseLock(); }
    sperrenAnwenden();
    let hinweis = '';
    try { ausloeserPruefen_(); } catch (e) { hinweis = ' ⚠ Automatik noch nicht eingerichtet: im Editor einmal ▶ sperrenEinrichten ausführen.'; }
    const konflikt = status === 'Nein' ? buchungen_().filter((x) => gleich_(x.fahrzeug, fahrzeug) && x.bis > Math.max(v, Date.now()) && (!b || x.von < b)) : [];
    return { ok: true, text: fahrzeug + ' ' + (status === 'Nein' ? 'außer Dienst' : 'eingeschränkt') + ' geplant: ' + fmt_(v) + ' – ' + (b ? fmt_(b) : 'bis auf Weiteres') + '.' + hinweis,
      konflikt: konflikt.map((x) => fmt_(x.von) + ' – ' + fmt_(x.bis) + ' · ' + x.name + (x.zweck ? ' · ' + x.zweck : '')) };
  } catch (e) { return { ok: false, fehler: e.message }; }
}

// Sperre löschen. Läuft sie gerade, wird das Fahrzeug wieder freigegeben (wenn der Status noch von der Sperre stammt).
function fzSperreLoeschen(pin, id) {
  const r = rolle_(pin); if (!fzDarf_(r)) return { ok: false, fehler: 'Keine Berechtigung.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const x = sperren_().find((y) => y.id === String(id));
    if (!x || !x.aktiv) return { ok: false, fehler: 'Sperre nicht gefunden.' };
    const sh = spBlatt_(); sh.getRange(x.zeile, spSpalte_(sh, 'Aktiv')).setValue('Nein');
    let frei = '';
    if (x.ablauf === 'läuft') { if (spFreigeben_(x, fzName_(r))) frei = ' ' + x.fahrzeug + ' ist wieder einsatzbereit.'; spAblauf_(x, 'beendet'); }
    SpreadsheetApp.flush();
    return { ok: true, text: 'Geplante Sperre gelöscht.' + frei };
  } catch (e) { return { ok: false, fehler: e.message }; } finally { lock.releaseLock(); }
}

// Fahrzeug nur freigeben, wenn der aktuelle Status noch von dieser Sperre stammt (nicht inzwischen von Hand geändert)
function spFreigeben_(x, name) {
  const t = fzTab_(), z = t.w.find((y, j) => j > 0 && gleich_(y[t.s.fz], x.fahrzeug));
  if (!z || String(z[t.s.mangel] || '').trim() !== spMangel_(x)) return false;
  fzSetzen_(x.fahrzeug, 'Ja', '', name);
  return true;
}

// Vom Zeitauslöser aufgerufen (und nach dem Anlegen): Sperren beginnen bzw. beenden
function sperrenAnwenden() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return;
  try {
    try { bewegungVerlaengern_(); } catch (e) { console.error('Bewegungsfahrt: ' + e.message); }
    const jetzt = Date.now();
    sperren_().filter((x) => x.aktiv && x.ablauf !== 'beendet').sort((a, b) => a.von - b.von).forEach((x) => {
      try {
        const vorbei = x.bis && x.bis <= jetzt;
        if (x.ablauf === 'läuft' && vorbei) { spFreigeben_(x, 'Automatik'); spAblauf_(x, 'beendet'); }
        else if (!x.ablauf && vorbei) spAblauf_(x, 'beendet');
        else if (!x.ablauf && x.von <= jetzt) { fzSetzen_(x.fahrzeug, x.status, spMangel_(x), x.wer || 'Automatik'); spAblauf_(x, 'läuft'); }
      } catch (e) { console.error('Sperre ' + x.id + ' (' + x.fahrzeug + '): ' + e.message); }
    });
  } finally { lock.releaseLock(); }
}

// Einmal im Editor ausführen (▶ sperrenEinrichten): legt den Tab und den Zeitauslöser alle 5 Minuten an.
function sperrenEinrichten() {
  spBlatt_();
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'sperrenAnwenden')) ScriptApp.newTrigger('sperrenAnwenden').timeBased().everyMinutes(5).create();
  console.log('Fahrzeugsperren eingerichtet, Auslöser läuft alle 5 Minuten.');
}
function ausloeserPruefen_() {
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'sperrenAnwenden')) throw new Error('kein Auslöser');
}

// Für die Buchung: Sperren „außer Dienst“, die mit dem Zeitraum kollidieren
function sperrKonflikt_(neu) {
  return sperren_().filter((x) => x.aktiv && x.ablauf !== 'beendet' && x.status === 'Nein' && gleich_(x.fahrzeug, neu.fahrzeug) && x.von < neu.bis && (!x.bis || neu.von < x.bis));
}

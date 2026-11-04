/**
 * Einsatz-Nachbereitung – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt.
 *
 * Ablauf: Der Pi (lea-skin, config.local.js einsatzUrl + einsatzKey) meldet nach Einsatzende Stufe, Einsatzart, Ort,
 * Meldebild, Alarm- und Endzeit und alle, die in der LEA zugesagt haben. Daraus entsteht im Tab „Einsätze“ ein Entwurf.
 * Das Kommando hakt in der App (Verwaltung › Einsätze) Teilnehmer und Fahrzeuge ab, korrigiert die Zeiten, schreibt kurz,
 * was war, und schließt ab. Dann gibt es einen fertigen Facebook-Text zum Kopieren.
 * Den Einsatzbericht im FDISK trägt Claude auf Zuruf ein (Abfrage fdiskEinsaetze / einsatzErledigt mit FDISK_KEY).
 *
 * Einrichten: Skripteigenschaft EINSATZ_KEY (langer Zufallswert, mind. 20 Zeichen) anlegen; derselbe Wert steht am Pi als einsatzKey.
 */
const EIN_TAB = 'Einsätze';
const EIN_KOPF = ['ID', 'Alarm', 'Ende', 'Stufe', 'Einsatzart', 'Straße', 'Ort', 'Meldebild', 'Zusagen LEA', 'Teilnehmer', 'Fahrzeuge',
  'Bericht', 'Status', 'Bearbeitet von', 'Bearbeitet am', 'FDISK-Bericht'];
const eSp_ = (k) => EIN_KOPF.indexOf(k) + 1;
// Text für die Tabelle: keine Formeln, keine Steuerzeichen, Länge begrenzt
const nbText_ = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').replace(/^[\s=+\-@]+/, '').trim().slice(0, n || 200);

// Einmal im Editor ausführen: legt EINSATZ_KEY an (falls nicht vorhanden) und den Tab „Einsätze“.
// Den angezeigten Schlüssel am Pi in config.local.js als einsatzKey eintragen – sonst nirgends speichern.
function einsatzEinrichtenNachbereitung() {
  const props = PropertiesService.getScriptProperties();
  let k = (props.getProperty('EINSATZ_KEY') || '').trim();
  if (k.length < 20) { k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('EINSATZ_KEY', k); }
  einTab_(anwSS_());
  console.log('einsatzUrl = ' + ScriptApp.getService().getUrl());
  console.log('einsatzKey = ' + k);
}
function einTab_(ss) {
  let sh = ss.getSheetByName(EIN_TAB);
  if (!sh) {
    sh = ss.insertSheet(EIN_TAB);
    sh.getRange(1, 1, 1, EIN_KOPF.length).setValues([EIN_KOPF]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('B:C').setNumberFormat('dd.MM.yyyy HH:mm');
    sh.getRange('O:O').setNumberFormat('dd.MM.yyyy HH:mm');
  }
  return sh;
}
function einsaetze_(ss) {
  const sh = einTab_(ss), w = sh.getDataRange().getValues();
  return w.slice(1).map((r, i) => {
    const o = { _zeile: i + 2 }; EIN_KOPF.forEach((k, j) => { o[k] = r[j]; }); return o;
  }).filter((o) => String(o.ID).trim() !== '');
}
const nbListe_ = (s) => String(s || '').split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
const nbZeit_ = (v) => (v instanceof Date ? v.getTime() : v ? +new Date(v) : 0) || 0;

// LEA-Namen (Vorname, Nachname) einem Mitglied zuordnen – Reihenfolge und Groß/Klein egal
function nbZuordnen_(alle, vn, nn) {
  const teile = (s) => anwNorm_(s).split(/[\s-]+/).filter(Boolean);
  const lea = teile(vn + ' ' + nn);
  if (!lea.length) return null;
  const gleich = alle.find((m) => { const t = teile(m.name); return t.length === lea.length && t.slice().sort().join(' ') === lea.slice().sort().join(' '); });
  if (gleich) return gleich;
  const v = teile(vn), n = teile(nn);
  const passend = alle.filter((m) => { const t = teile(m.name); return n.every((x) => t.indexOf(x) !== -1) && v.length && t.indexOf(v[0]) !== -1; });
  return passend.length === 1 ? passend[0] : null;
}

// ---------- Vom Pi: Einsatz beendet ----------
function einsatzEnde_(d) {
  const soll = (PropertiesService.getScriptProperties().getProperty('EINSATZ_KEY') || '').trim();
  if (!soll || soll.length < 20 || String(d.key || '') !== soll) { Utilities.sleep(1000); return { ok: false, fehler: 'Schlüssel falsch oder EINSATZ_KEY nicht eingerichtet.' }; }
  const x = d.einsatz || {};
  const id = 'lea:' + nbText_(x.id, 80).replace(/[^\w:.-]/g, '');
  const alarm = +x.alarm, ende = +x.ende;
  if (id === 'lea:' || !isFinite(alarm) || !isFinite(ende) || alarm <= 0) return { ok: false, fehler: 'Unvollständige Einsatzdaten.' };
  if (alarm < Date.now() - 14 * 864e5 || alarm > Date.now() + 3600e3) return { ok: false, fehler: 'Alarmzeit unplausibel.' };
  const bis = Math.max(alarm + 15 * 60000, Math.min(ende, alarm + 24 * 3600e3));
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = anwSS_(), sh = einTab_(ss);
    if (einsaetze_(ss).some((e) => String(e.ID) === id)) return { ok: true, neu: false };
    const alle = mitglieder_(ss);
    const leute = (Array.isArray(x.personen) ? x.personen : []).slice(0, 80).map((p) => ({
      vn: nbText_(p.vn, 40), nn: nbText_(p.nn, 40), fn: (Array.isArray(p.fn) ? p.fn : []).slice(0, 8).map((f) => nbText_(f, 10)).filter(Boolean)
    })).filter((p) => p.vn || p.nn);
    const zusagen = leute.map((p) => (p.vn + ' ' + p.nn).trim() + (p.fn.length ? ' (' + p.fn.join(', ') + ')' : '')).join('; ');
    const teiln = [];
    leute.forEach((p) => { const m = nbZuordnen_(alle, p.vn, p.nn); if (m && teiln.indexOf(m.name) === -1) teiln.push(m.name); });
    const o = x.ort || {};
    const zeile = {
      ID: id, Alarm: new Date(alarm), Ende: new Date(bis), Stufe: nbText_(x.stufe, 10), Einsatzart: nbText_(x.text, 80),
      'Straße': nbText_([o.strasse, o.nr].filter(Boolean).join(' ') || o.objekt, 80), Ort: nbText_([o.plz, o.ort].filter(Boolean).join(' '), 60),
      Meldebild: nbText_(x.meldebild, 300), 'Zusagen LEA': nbText_(zusagen, 2000), Teilnehmer: teiln.join('; '), Fahrzeuge: '', Bericht: '',
      Status: 'entwurf', 'Bearbeitet von': '', 'Bearbeitet am': '', 'FDISK-Bericht': ''
    };
    sh.appendRow(EIN_KOPF.map((k) => zeile[k]));
    return { ok: true, neu: true };
  } finally { lock.releaseLock(); }
}

// ---------- App: Verwaltung › Einsätze (nur Kommando) ----------
const nbKdo_ = (pin) => { const r = rolle_(pin); return r && r.rolle === 'kommando' ? r : null; };
function nbAusgabe_(e) {
  const a = nbZeit_(e.Alarm), b = nbZeit_(e.Ende);
  const o = { id: String(e.ID), alarm: a, ende: b, stufe: String(e.Stufe || ''), art: String(e.Einsatzart || ''), strasse: String(e['Straße'] || ''), ort: String(e.Ort || ''),
    meldebild: String(e.Meldebild || ''), zusagen: nbListe_(e['Zusagen LEA']), teilnehmer: nbListe_(e.Teilnehmer), fahrzeuge: nbListe_(e.Fahrzeuge),
    bericht: String(e.Bericht || ''), status: String(e.Status || 'entwurf'), von: String(e['Bearbeitet von'] || ''), fdisk: String(e['FDISK-Bericht'] || '') };
  if (o.status !== 'entwurf' && o.status !== 'verworfen') o.fb = fbText_(o);
  return o;
}
function einsatzListe(pin) {
  if (!nbKdo_(pin)) return { ok: false, fehler: 'Nur fürs Kommando.' };
  const ss = anwSS_();
  const liste = einsaetze_(ss).map(nbAusgabe_).sort((a, b) => b.alarm - a.alarm).slice(0, 40);
  return { ok: true, liste, namen: mitglieder_(ss).map((m) => m.name).sort((a, b) => a.localeCompare(b, 'de')), fahrzeuge: FAHRZEUGE };
}
function einsatzAnzahl_() {
  try { return einsaetze_(anwSS_()).filter((e) => String(e.Status) === 'entwurf').length; } catch (e) { return null; }
}

// Speichern: d = { teilnehmer: [Namen], fahrzeuge: [IDs], alarm: 'JJJJ-MM-TTTHH:MM', ende: 'JJJJ-MM-TTTHH:MM', bericht, aktion: 'speichern'|'abschliessen'|'oeffnen'|'verwerfen' }
function einsatzSpeichern(pin, id, d) {
  const r = nbKdo_(pin); if (!r) return { ok: false, fehler: 'Nur fürs Kommando.' };
  d = d || {};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = anwSS_(), sh = einTab_(ss);
    const e = einsaetze_(ss).find((x) => String(x.ID) === String(id));
    if (!e) return { ok: false, fehler: 'Einsatz nicht gefunden.' };
    if (String(e.Status) === 'eingetragen') return { ok: false, fehler: 'Schon im FDISK eingetragen – Änderungen bitte direkt im FDISK.' };
    const set = (k, v) => sh.getRange(e._zeile, eSp_(k)).setValue(v);
    const wer = nameKurz_(r);
    if (d.aktion === 'oeffnen' || d.aktion === 'verwerfen') {
      set('Status', d.aktion === 'oeffnen' ? 'entwurf' : 'verworfen'); set('Bearbeitet von', wer); set('Bearbeitet am', new Date());
      return { ok: true, text: d.aktion === 'oeffnen' ? 'Wieder offen zum Bearbeiten.' : 'Verworfen (kommt nicht ins FDISK).' };
    }
    if (String(e.Status) !== 'entwurf') return { ok: false, fehler: 'Schon abgeschlossen. Zum Ändern zuerst „Wieder öffnen“.' };
    const alle = mitglieder_(ss);
    const teiln = [];
    (Array.isArray(d.teilnehmer) ? d.teilnehmer : []).forEach((n) => { const m = alle.find((x) => anwNorm_(x.name) === anwNorm_(n)); if (m && teiln.indexOf(m.name) === -1) teiln.push(m.name); });
    const fz = FAHRZEUGE.filter((f) => (Array.isArray(d.fahrzeuge) ? d.fahrzeuge : []).indexOf(f) !== -1);
    const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    if (!re.test(String(d.alarm || '')) || !re.test(String(d.ende || ''))) return { ok: false, fehler: 'Bitte Alarm- und Endzeit angeben.' };
    const a = lokal_(d.alarm), b = lokal_(d.ende);
    if (b <= a) return { ok: false, fehler: 'Das Ende muss nach dem Alarm liegen.' };
    if (b - a > 48 * 3600e3) return { ok: false, fehler: 'Ein Einsatz darf hier höchstens 48 Stunden dauern.' };
    if (a.getTime() > Date.now() + 3600e3) return { ok: false, fehler: 'Der Alarm liegt in der Zukunft.' };
    const bericht = nbText_(d.bericht, 1500);
    const ab = d.aktion === 'abschliessen';
    if (ab && !teiln.length) return { ok: false, fehler: 'Bitte mindestens eine Person abhaken.' };
    if (ab && !bericht) return { ok: false, fehler: 'Bitte kurz beschreiben, was war (ein, zwei Sätze reichen).' };
    sh.getRange(e._zeile, eSp_('Alarm'), 1, 2).setValues([[a, b]]);
    set('Teilnehmer', teiln.join('; ')); set('Fahrzeuge', fz.join('; ')); set('Bericht', bericht);
    set('Bearbeitet von', wer); set('Bearbeitet am', new Date());
    if (ab) set('Status', 'abgeschlossen');
    SpreadsheetApp.flush();
    const neu = einsaetze_(ss).find((x) => String(x.ID) === String(id));
    return { ok: true, text: ab ? 'Abgeschlossen. Der Facebook-Text ist fertig.' : 'Gespeichert.', einsatz: nbAusgabe_(neu) };
  } finally { lock.releaseLock(); }
}

// ---------- Facebook-Text (Stil laut FF-Social-Media-Regeln: keine Hausnummern, keine Namen von Betroffenen, sparsam Emojis) ----------
function fbText_(o) {
  const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const tag = Utilities.formatDate(new Date(o.alarm), 'Europe/Vienna', 'u') % 7;   // 1 = Montag … 7 = Sonntag
  const datum = Utilities.formatDate(new Date(o.alarm), 'Europe/Vienna', 'd.M.');
  const strasse = String(o.strasse || '').replace(/\s+\d+\s*[a-zA-Z]?([\/-]\d+)*\s*$/, '').trim();   // ohne Hausnummer
  const ort = String(o.ort || '').replace(/^\d{4}\s*/, '').trim();
  const wo = strasse && ort ? ' in die ' + strasse + ' nach ' + ort : ort ? ' nach ' + ort : '';
  const art = o.art || 'Einsatz';
  const min = Math.max(0, Math.round((o.ende - o.alarm) / 60000));
  const dauer = min < 60 ? min + ' Minuten' : min < 90 ? 'rund eine Stunde' : 'rund ' + Math.round(min / 60) + ' Stunden';
  const n = o.teilnehmer.length;
  const fz = o.fahrzeuge.length ? ' mit ' + (o.fahrzeuge.length === 1 ? 'dem ' + o.fahrzeuge[0] : 'dem ' + o.fahrzeuge.slice(0, -1).join(', dem ') + ' und dem ' + o.fahrzeuge.slice(-1)[0]) : '';
  const brand = /^B/i.test(o.stufe) ? '🔥' : '🚒';
  return [
    brand + ' Einsatz: ' + art,
    '',
    'Am ' + WT[tag] + ', ' + datum + ', wurden wir um ' + Utilities.formatDate(new Date(o.alarm), 'Europe/Vienna', 'HH:mm') + ' Uhr zu einem Einsatz „' + art + '“' + (o.stufe ? ' (' + o.stufe + ')' : '') + wo + ' alarmiert.',
    '',
    o.bericht,
    '',
    'Wir waren mit ' + n + (n === 1 ? ' Mitglied' : ' Mitgliedern') + fz + ' ' + dauer + ' im Einsatz.',
    'Danke an alle Kameradinnen und Kameraden für ihren Einsatz! 💪',
    '',
    '#feuerwehr #ffdeutschhaslau #feuerwehrnoe #bezirkbruck'
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------- Abfrage für den FDISK-Einsatzbericht (über doGet mit FDISK_KEY, aus fdiskAbfrage_) ----------
function einsatzFdisk_(p) {
  const ss = anwSS_();
  if (p.aktion === 'fdiskEinsaetze') {
    const sbn = {}; mitglieder_(ss).forEach((m) => { sbn[m.name] = m.sbn; });
    const liste = einsaetze_(ss).filter((e) => String(e.Status) === 'abgeschlossen').map((e) => {
      const o = nbAusgabe_(e);
      return { id: o.id, stufe: o.stufe, art: o.art, strasse: o.strasse, ort: o.ort, meldebild: o.meldebild, bericht: o.bericht, fahrzeuge: o.fahrzeuge,
        datumAlarm: tzDatum_(o.alarm), uhrzeitAlarm: tzUhr_(o.alarm), datumEnde: tzDatum_(o.ende), uhrzeitEnde: tzUhr_(o.ende),
        personen: o.teilnehmer.map((n) => ({ name: n, sbn: String(sbn[n] || '') })) };
    });
    return { ok: true, liste };
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const e = einsaetze_(ss).find((x) => String(x.ID) === String(p.id || ''));
    if (!e) return { ok: false, fehler: 'Einsatz nicht gefunden.' };
    if (String(e.Status) === 'eingetragen') return { ok: true, text: 'Schon als eingetragen vermerkt: ' + e['FDISK-Bericht'] };
    if (String(e.Status) !== 'abgeschlossen') return { ok: false, fehler: 'Dieser Einsatz ist nicht abgeschlossen.' };
    const nr = String(p.bericht || '').replace(/[^0-9A-Za-z\/-]/g, '').slice(0, 30);
    if (!nr) return { ok: false, fehler: 'Berichtsnummer fehlt.' };
    const sh = einTab_(ss);
    sh.getRange(e._zeile, eSp_('Status')).setValue('eingetragen');
    sh.getRange(e._zeile, eSp_('FDISK-Bericht')).setValue('Bericht ' + nr + ' · ' + tzDatum_(Date.now()));
    return { ok: true, text: (e.Einsatzart || 'Einsatz') + ' als eingetragen vermerkt (Bericht ' + nr + ').' };
  } finally { lock.releaseLock(); }
}

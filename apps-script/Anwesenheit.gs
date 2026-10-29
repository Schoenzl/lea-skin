/**
 * Anwesenheit per QR-Code – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt wie Code.gs (Funktionen sind gemeinsam sichtbar).
 *
 * Ablauf: Ein QR-Code im Haus → Seite „Anwesenheit“ (…/exec?seite=da). Wer scannt, wählt seinen Namen und tippt „Ich bin da“.
 * Welche Tätigkeit läuft, kommt aus dem Google-Kalender „FF Deutsch Haslau“ (Stichwort im Titel → FDISK-Art laut Tab „Zuordnung“).
 * Ohne Kalendertermin wählt die erste Person „Was machst du?“, alle weiteren werden automatisch dazugenommen.
 * Das Kommando prüft im Reiter „Kommando“, trägt nach, ändert die Art und schließt ab. Abgeschlossene Termine werden ins FDISK übertragen.
 *
 * Einrichten: einmal ▶ anwesenheitEinrichten ausführen (legt die Tabelle „Anwesenheit FF Deutsch Haslau“ an und prüft den Kalender).
 */
const KALENDER_ID = '99e2e6ed3a981ad4f7ac6eea1af12056aa7e9a6a91587923b10359adc3443447@group.calendar.google.com';
const ANW_VORLAUF_MIN = 90;      // so lange vor Beginn kann man sich schon eintragen
const ANW_NACHLAUF_MIN = 60;     // so lange nach dem Ende noch
const ANW_ZUSAMMEN_H = 4;        // ohne Kalender: gleiche Tätigkeit innerhalb von 4 h = derselbe Termin

// Auswahl „Was machst du?“ (ohne Kalendertermin) → FDISK-Tätigkeitsart
const ANW_ARTEN = [
  ['Übung', 'Ausbildung'], ['Atemschutz', 'Atemschutz'], ['Schulung / Vortrag', 'Vorträge/Schulungen'],
  ['Arbeiten im Feuerwehrhaus', 'Tätigkeit im Feuerwehrhaus'], ['Wartung / Fahrzeugpflege', 'Wartungsarbeiten'],
  ['Kommandobesprechung', 'Kommandobesprechung'], ['Chargensitzung', 'Chargensitzung'], ['Dienstbesprechung', 'Dienstbesprechung'],
  ['Mitgliederversammlung', 'Mitgliederversammlung'], ['Fest / Ball / Punschstand', 'Feuerwehrfest'],
  ['Feuerwehrjugend', 'FJ feuerwehrfachliche Ausbildung'], ['Verwaltung', 'Verwaltungstätigkeiten']
];
// FDISK-Tätigkeitsarten (für die Auswahl im Kommando-Reiter)
const FDISK_ARTEN = ['Ausbildung', 'Atemschutz', 'Vorträge/Schulungen', 'Tätigkeit im Feuerwehrhaus', 'Wartungsarbeiten',
  'Kommandobesprechung', 'Chargensitzung', 'Dienstbesprechung', 'Mitgliederversammlung', 'Feuerwehrfest',
  'FJ feuerwehrfachliche Ausbildung', 'Verwaltungstätigkeiten', 'Fahrmeister', 'Zeugmeister'];
const FDISK_UNTERARTEN = { 'Ausbildung': ['', 'Brandübung', 'Technische Übung', 'Schadstoffübung', 'Übung Löschangriff (Bewerbe)', 'Grundkurs'] };
// Startwerte für den Tab „Zuordnung“ (Stichwort im Kalendertitel; die erste passende Zeile von oben gilt)
const ANW_ZUORDNUNG = [
  ['brandübung', 'Ausbildung', 'Brandübung'], ['technische übung', 'Ausbildung', 'Technische Übung'], ['schadstoff', 'Ausbildung', 'Schadstoffübung'],
  ['grundkurs', 'Ausbildung', 'Grundkurs'], ['atemschutz', 'Atemschutz', ''], ['jugend', 'FJ feuerwehrfachliche Ausbildung', ''],
  ['kommando', 'Kommandobesprechung', ''], ['charge', 'Chargensitzung', ''], ['dienstbesprechung', 'Dienstbesprechung', ''],
  ['mitgliederversammlung', 'Mitgliederversammlung', ''], ['schulung', 'Vorträge/Schulungen', ''], ['vortrag', 'Vorträge/Schulungen', ''],
  ['übung', 'Ausbildung', ''], ['aple', 'Ausbildung', ''], ['pflege', 'Wartungsarbeiten', ''], ['wartung', 'Wartungsarbeiten', ''],
  ['arbeitsdienst', 'Tätigkeit im Feuerwehrhaus', ''], ['fest', 'Feuerwehrfest', ''], ['ball', 'Feuerwehrfest', ''], ['punsch', 'Feuerwehrfest', '']
];
const ANW_TABS = {
  Mitglieder: ['Name', 'Standesbuchnummer', 'Aktiv'],
  Zuordnung: ['Stichwort im Kalendertitel', 'FDISK-Art', 'Unterart'],
  Termine: ['ID', 'Titel', 'FDISK-Art', 'Unterart', 'Beginn', 'Ende', 'Status', 'Abgeschlossen von', 'FDISK-Bericht', 'Bemerkung'],
  Anwesenheit: ['Zeitstempel', 'Termin-ID', 'Name', 'Standesbuchnummer', 'Quelle']
};

// ---------- Einrichten (einmal im Editor ausführen) ----------
function anwesenheitEinrichten() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('ANW_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Anwesenheit FF Deutsch Haslau');
    ss.setSpreadsheetTimeZone('Europe/Vienna');
    props.setProperty('ANW_ID', ss.getId());
  }
  Object.keys(ANW_TABS).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, ANW_TABS[name].length).setValues([ANW_TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  const leer = ss.getSheetByName('Tabellenblatt1') || ss.getSheetByName('Sheet1');
  if (leer && ss.getSheets().length > 1) ss.deleteSheet(leer);
  const zu = ss.getSheetByName('Zuordnung');
  if (zu.getLastRow() < 2) zu.getRange(2, 1, ANW_ZUORDNUNG.length, 3).setValues(ANW_ZUORDNUNG);
  const mi = ss.getSheetByName('Mitglieder');
  mi.getRange('C2:C500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Ja', 'Nein'], true).build());
  mi.getRange('B2:B500').setNumberFormat('@');
  ss.getSheetByName('Termine').getRange('E2:F1000').setNumberFormat('dd.MM.yyyy HH:mm');
  ss.getSheetByName('Anwesenheit').getRange('A2:A5000').setNumberFormat('dd.MM.yyyy HH:mm:ss');
  ss.getSheetByName('Anwesenheit').getRange('D2:D5000').setNumberFormat('@');
  console.log('Tabelle: ' + ss.getUrl());
  const kal = CalendarApp.getCalendarById(KALENDER_ID);
  console.log(kal ? 'Kalender gefunden: ' + kal.getName() + ' – Termine heute: ' + kal.getEventsForDay(new Date()).length
    : 'Kalender NICHT gefunden – die Seite funktioniert trotzdem, dann immer mit „Was machst du?“.');
  console.log('Als Nächstes: Tab „Mitglieder“ befüllen (Name, Standesbuchnummer, Aktiv = Ja).');
}

// ---------- Tabellen-Helfer ----------
function anwSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('ANW_ID');
  if (!id) throw new Error('Anwesenheit ist noch nicht eingerichtet (im Editor ▶ anwesenheitEinrichten ausführen).');
  return SpreadsheetApp.openById(id);
}
function anwLesen_(ss, name) {
  const sh = ss.getSheetByName(name);
  const w = sh.getDataRange().getValues();
  const kopf = ANW_TABS[name];
  return { sh, zeilen: w.slice(1).map((r, i) => { const o = { _zeile: i + 2 }; kopf.forEach((k, j) => { o[k] = r[j]; }); return o; }).filter((o) => String(o[kopf[0]]).trim() !== '') };
}
const anwNorm_ = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const anwZeit_ = (v) => (v instanceof Date ? v.getTime() : 0);
const anwFmt_ = (t) => (t ? fmt_(t) : '–');

function mitglieder_(ss) {
  return anwLesen_(ss, 'Mitglieder').zeilen
    .filter((m) => anwNorm_(m.Aktiv) !== 'nein')
    .map((m) => ({ name: String(m.Name).trim(), sbn: String(m.Standesbuchnummer || '').trim() }));
}
function zuordnen_(ss, titel) {
  const t = anwNorm_(titel);
  const z = anwLesen_(ss, 'Zuordnung').zeilen.find((r) => t.indexOf(anwNorm_(r['Stichwort im Kalendertitel'])) !== -1);
  return z ? { art: String(z['FDISK-Art']).trim(), unterart: String(z.Unterart || '').trim() } : { art: '', unterart: '' };
}

// Kalendertermine, bei denen man sich gerade eintragen kann
function kalenderJetzt_(ss) {
  let kal = null;
  try { kal = CalendarApp.getCalendarById(KALENDER_ID); } catch (e) { kal = null; }
  if (!kal) return [];
  const jetzt = Date.now();
  return kal.getEvents(new Date(jetzt - 18 * 3600e3), new Date(jetzt + 6 * 3600e3)).map((ev) => {
    let von = ev.getStartTime().getTime(), bis = ev.getEndTime().getTime();
    if (ev.isAllDayEvent()) { bis = Math.min(bis, von + 24 * 3600e3); }
    return { ev, von, bis };
  }).filter((x) => x.von - ANW_VORLAUF_MIN * 60e3 <= jetzt && jetzt <= x.bis + ANW_NACHLAUF_MIN * 60e3).map((x) => {
    const titel = x.ev.getTitle();
    const z = zuordnen_(ss, titel);
    const tag = Utilities.formatDate(new Date(x.von), 'Europe/Vienna', 'yyyyMMdd');
    return { id: 'k:' + x.ev.getId().split('@')[0] + ':' + tag, titel, von: x.von, bis: x.bis, art: z.art, unterart: z.unterart };
  });
}

// ---------- Seite „Anwesenheit“ ----------
function daStart() {
  const ss = anwSS_();
  const jetzt = Date.now();
  const termine = anwLesen_(ss, 'Termine').zeilen;
  const offen = termine.filter((t) => t.Status === 'offen' && jetzt - anwZeit_(t.Beginn) < 16 * 3600e3);
  const kal = kalenderJetzt_(ss).filter((k) => !termine.some((t) => t.ID === k.id && t.Status !== 'offen'));
  const liste = kal.map((k) => ({ id: k.id, titel: k.titel, text: anwFmt_(k.von) + ' – ' + Utilities.formatDate(new Date(k.bis), 'Europe/Vienna', 'HH:mm') }));
  offen.forEach((t) => { if (!liste.some((l) => l.id === t.ID)) liste.push({ id: t.ID, titel: t.Titel, text: 'seit ' + anwFmt_(anwZeit_(t.Beginn)) }); });
  const anw = anwLesen_(ss, 'Anwesenheit').zeilen;
  liste.forEach((l) => { l.anzahl = anw.filter((a) => a['Termin-ID'] === l.id).length; });
  return { namen: mitglieder_(ss).map((m) => m.name).sort((a, b) => a.localeCompare(b, 'de')), termine: liste, arten: ANW_ARTEN.map((a) => a[0]) };
}

function daEinchecken(d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = anwSS_();
    const name = String((d && d.name) || '').trim();
    const m = mitglieder_(ss).find((x) => anwNorm_(x.name) === anwNorm_(name));
    if (!m) return { ok: false, fehler: '„' + name + '“ steht nicht in der Mitgliederliste. Bitte Namen aus der Liste wählen oder beim Kommando melden.' };
    const jetzt = new Date();
    const T = anwLesen_(ss, 'Termine');
    let termin = null;
    const id = String((d && d.termin) || '');
    if (id) {
      termin = T.zeilen.find((t) => t.ID === id);
      if (!termin && id.indexOf('k:') === 0) {
        const k = kalenderJetzt_(ss).find((x) => x.id === id);
        if (!k) return { ok: false, fehler: 'Der Termin ist nicht mehr offen. Bitte Seite neu laden.' };
        T.sh.appendRow([k.id, k.titel, k.art, k.unterart, new Date(k.von), new Date(k.bis), 'offen', '', '', '']);
        termin = { ID: k.id, Titel: k.titel, Status: 'offen' };
      }
      if (!termin) return { ok: false, fehler: 'Termin nicht gefunden. Bitte Seite neu laden.' };
    } else {
      const wahl = ANW_ARTEN.find((a) => a[0] === (d && d.art));
      if (!wahl) return { ok: false, fehler: 'Bitte auswählen, was du machst.' };
      // gleiche Tätigkeit in den letzten Stunden schon begonnen? → dazunehmen
      termin = T.zeilen.find((t) => t.Status === 'offen' && t.ID.indexOf('m:') === 0 && t['FDISK-Art'] === wahl[1] &&
        jetzt.getTime() - anwZeit_(t.Beginn) < ANW_ZUSAMMEN_H * 3600e3);
      if (!termin) {
        const neu = 'm:' + Utilities.formatDate(jetzt, 'Europe/Vienna', 'yyyyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 6);
        const titel = String((d && d.titel) || '').trim().slice(0, 80) || wahl[0];
        T.sh.appendRow([neu, titel, wahl[1], '', jetzt, '', 'offen', '', '', '']);
        termin = { ID: neu, Titel: titel, Status: 'offen' };
      }
    }
    if (termin.Status !== 'offen') return { ok: false, fehler: '„' + termin.Titel + '“ ist schon abgeschlossen. Bitte beim Kommando melden.' };
    const A = anwLesen_(ss, 'Anwesenheit');
    if (A.zeilen.some((a) => a['Termin-ID'] === termin.ID && anwNorm_(a.Name) === anwNorm_(m.name))) {
      return { ok: true, text: m.name + ', du bist bei „' + termin.Titel + '“ schon eingetragen.' };
    }
    A.sh.appendRow([jetzt, termin.ID, m.name, m.sbn, 'QR']);
    const anzahl = A.zeilen.filter((a) => a['Termin-ID'] === termin.ID).length + 1;
    hausPush_(m.name, termin.Titel, anzahl);
    return { ok: true, text: 'Danke ' + m.name.split(' ')[0] + '! Du bist bei „' + termin.Titel + '“ eingetragen.' };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Kommando: Übersicht und Bearbeiten (PIN wie beim Fahrzeugstatus) ----------
function anwUebersicht(pin) {
  if (!pinOk_(pin)) return { ok: false, fehler: 'PIN falsch.' };
  let ss;
  try { ss = anwSS_(); } catch (e) { return { ok: true, fehlt: e.message, termine: [] }; }
  const A = anwLesen_(ss, 'Anwesenheit').zeilen;
  const termine = anwLesen_(ss, 'Termine').zeilen
    .filter((t) => t.Status !== 'eingetragen' && Date.now() - anwZeit_(t.Beginn) < 60 * 864e5)
    .sort((a, b) => anwZeit_(b.Beginn) - anwZeit_(a.Beginn))
    .map((t) => ({
      id: t.ID, titel: t.Titel, art: t['FDISK-Art'], unterart: t.Unterart, status: t.Status,
      beginn: anwZeit_(t.Beginn), ende: anwZeit_(t.Ende), text: anwFmt_(anwZeit_(t.Beginn)) + ' – ' + (anwZeit_(t.Ende) ? Utilities.formatDate(t.Ende, 'Europe/Vienna', 'HH:mm') : 'offen'),
      bemerkung: t.Bemerkung || '',
      personen: A.filter((a) => a['Termin-ID'] === t.ID).map((a) => ({ name: a.Name, quelle: a.Quelle, fehlt: !String(a.Standesbuchnummer || '').trim() }))
    }));
  return { ok: true, termine, arten: FDISK_ARTEN, unterarten: FDISK_UNTERARTEN, namen: mitglieder_(ss).map((m) => m.name).sort((a, b) => a.localeCompare(b, 'de')) };
}

function anwAktion(pin, a) {
  if (!pinOk_(pin)) return { ok: false, fehler: 'PIN falsch.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = anwSS_();
    const T = anwLesen_(ss, 'Termine');
    const t = T.zeilen.find((x) => x.ID === a.id);
    if (!t) return { ok: false, fehler: 'Termin nicht gefunden.' };
    if (t.Status === 'eingetragen') return { ok: false, fehler: 'Schon ins FDISK eingetragen, Änderungen bitte direkt im FDISK.' };
    const sp = (k) => ANW_TABS.Termine.indexOf(k) + 1;
    const A = anwLesen_(ss, 'Anwesenheit');
    if (a.aktion === 'nachtragen') {
      const m = mitglieder_(ss).find((x) => anwNorm_(x.name) === anwNorm_(a.name));
      if (!m) return { ok: false, fehler: '„' + a.name + '“ steht nicht in der Mitgliederliste.' };
      if (A.zeilen.some((x) => x['Termin-ID'] === t.ID && anwNorm_(x.Name) === anwNorm_(m.name))) return { ok: false, fehler: m.name + ' ist schon eingetragen.' };
      A.sh.appendRow([new Date(), t.ID, m.name, m.sbn, 'nachgetragen']);
      return { ok: true, text: m.name + ' nachgetragen.' };
    }
    if (a.aktion === 'entfernen') {
      const z = A.zeilen.filter((x) => x['Termin-ID'] === t.ID && anwNorm_(x.Name) === anwNorm_(a.name));
      z.reverse().forEach((x) => A.sh.deleteRow(x._zeile));
      return { ok: true, text: a.name + ' entfernt.' };
    }
    if (a.aktion === 'speichern') {
      if (FDISK_ARTEN.indexOf(a.art) === -1) return { ok: false, fehler: 'Bitte eine FDISK-Art wählen.' };
      T.sh.getRange(t._zeile, sp('Titel')).setValue(String(a.titel || t.Titel).slice(0, 80));
      T.sh.getRange(t._zeile, sp('FDISK-Art')).setValue(a.art);
      T.sh.getRange(t._zeile, sp('Unterart')).setValue(a.unterart || '');
      if (a.beginn) T.sh.getRange(t._zeile, sp('Beginn')).setValue(lokal_(a.beginn));
      if (a.ende) T.sh.getRange(t._zeile, sp('Ende')).setValue(lokal_(a.ende));
      T.sh.getRange(t._zeile, sp('Bemerkung')).setValue(String(a.bemerkung || '').slice(0, 300));
      return { ok: true, text: 'Gespeichert.' };
    }
    if (a.aktion === 'abschliessen') {
      if (!t['FDISK-Art']) return { ok: false, fehler: 'Bitte zuerst die FDISK-Art festlegen und speichern.' };
      if (!A.zeilen.some((x) => x['Termin-ID'] === t.ID)) return { ok: false, fehler: 'Niemand eingetragen – Termin lieber löschen.' };
      if (!anwZeit_(t.Ende)) T.sh.getRange(t._zeile, sp('Ende')).setValue(new Date());   // ohne Ende (kein Kalendertermin): jetzt
      T.sh.getRange(t._zeile, sp('Status')).setValue('abgeschlossen');
      T.sh.getRange(t._zeile, sp('Abgeschlossen von')).setValue(String(a.wer || 'Kommando').slice(0, 60));
      return { ok: true, text: '„' + t.Titel + '“ abgeschlossen – bereit fürs FDISK.' };
    }
    if (a.aktion === 'oeffnen') {
      T.sh.getRange(t._zeile, sp('Status')).setValue('offen');
      return { ok: true, text: 'Wieder geöffnet.' };
    }
    if (a.aktion === 'loeschen') {
      A.zeilen.filter((x) => x['Termin-ID'] === t.ID).reverse().forEach((x) => A.sh.deleteRow(x._zeile));
      T.sh.deleteRow(t._zeile);
      return { ok: true, text: 'Termin gelöscht.' };
    }
    return { ok: false, fehler: 'Unbekannte Aktion.' };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Push „Jemand ist im Feuerwehrhaus“ über ntfy (App „ntfy“, kostenlos, ohne Konto) ----------
// Skripteigenschaft NTFY_TOPIC = geheimer Kanalname (wer ihn kennt, bekommt die Nachrichten). Nicht ins Repo schreiben.
// Skripteigenschaft NTFY_TOKEN = Zugangstoken (tk_…) eines kostenlosen Kontos auf ntfy.sh – ohne Token lehnt ntfy.sh
// Anfragen von Google oft ab (Tageskontingent der gemeinsamen Google-Server erschöpft, Antwort 429).
// Einmal ▶ pushTest ausführen: erlaubt den Versand nach außen und schickt eine Testnachricht.
function hausPush_(name, titel, anzahl) {
  const topic = (PropertiesService.getScriptProperties().getProperty('NTFY_TOPIC') || '').trim();
  if (!topic) return;
  try {
    const text = titel + ' · ' + Utilities.formatDate(new Date(), 'Europe/Vienna', 'HH:mm') + ' Uhr · ' + anzahl + (anzahl === 1 ? ' Person' : ' Personen') + ' da';
    const id = (/\/s\/([^/]+)\//.exec(ScriptApp.getService().getUrl() || '') || [])[1];
    const klick = id ? 'https://schoenzl.github.io/feuerwehr-dh/ff.html?seite=da#' + id : '';
    const q = 'title=' + encodeURIComponent(name + ' ist im Feuerwehrhaus') + '&tags=fire_engine' + (klick ? '&click=' + encodeURIComponent(klick) : '');
    // Mit Zugangstoken (kostenloses ntfy-Konto) zählt das Kontingent für unser Konto statt für Googles gemeinsame Server-Adressen
    const token = (PropertiesService.getScriptProperties().getProperty('NTFY_TOKEN') || '').trim();
    const r = UrlFetchApp.fetch('https://ntfy.sh/' + encodeURIComponent(topic) + '?' + q, {
      method: 'post', contentType: 'text/plain; charset=utf-8', payload: text, muteHttpExceptions: true,
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const code = r.getResponseCode();
    if (code !== 200) console.log('ntfy antwortet ' + code + ': ' + r.getContentText().slice(0, 300));
    return code;
  } catch (e) { console.log('Push fehlgeschlagen: ' + e.message); return -1; }   // Einchecken klappt trotzdem
}
function pushTest() {
  const topic = PropertiesService.getScriptProperties().getProperty('NTFY_TOPIC');
  if (!topic) { console.log('NTFY_TOPIC fehlt: Projekteinstellungen → Skripteigenschaften → NTFY_TOPIC anlegen.'); return; }
  const code = hausPush_('Test', 'Testnachricht vom Anwesenheits-Skript', 1);
  console.log(code === 200 ? 'ntfy hat die Testnachricht angenommen (Kanal „' + topic + '“). Kommt sie nicht an, liegt es an der App.'
    : 'ntfy hat NICHT angenommen (Antwort ' + code + '), Details in der Zeile darüber.');
}

// ---------- „Ich bin da“ aus der Handy-Ansicht am Pi (mobil/server.py ruft das per POST auf) ----------
// Skripteigenschaft DA_KEY = geheimer Schlüssel, derselbe steht am Pi in ~/lea-skin/mobil/da.json. Ohne DA_KEY ist das aus.
function doPost(e) {
  const antwort = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const soll = (PropertiesService.getScriptProperties().getProperty('DA_KEY') || '').trim();
    if (!soll || String(d.key || '') !== soll) return antwort({ ok: false, fehler: 'Schlüssel falsch oder DA_KEY nicht eingerichtet.' });
    if (d.aktion === 'start') { const s = daStart(); return antwort({ ok: true, termine: s.termine, arten: s.arten }); }
    if (d.aktion === 'einchecken') return antwort(daEinchecken({ name: d.name, termin: d.termin, art: d.art, titel: d.titel }));
    return antwort({ ok: false, fehler: 'Unbekannte Aktion.' });
  } catch (err) {
    return antwort({ ok: false, fehler: err.message });
  }
}

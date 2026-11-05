/**
 * Tätigkeiten eintragen und monatlich fürs FDISK freigeben – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt. Nutzt die Tabelle „Anwesenheit FF Deutsch Haslau“ (Tabs „Termine“ und „Anwesenheit“),
 * damit Tätigkeiten aus der App, Anwesenheit per QR und Bewegungsfahrten gemeinsam ins FDISK gehen.
 *
 * Termin-IDs: k:… Kalender · m:… „etwas anderes“ per QR · h:… von Hand eingetragen · b:… Bewegungsfahrt
 * Ablauf: eintragen (Kommando, Fahrmeister) → Status „abgeschlossen“ → Kommando gibt den Monat frei („FDISK-Bericht“ = „freigegeben MM/JJJJ“)
 *   → geplante Aufgabe am Monatsersten holt die Liste über ?aktion=fdisk&key=… und meldet jeden Bericht mit ?aktion=fdiskErledigt zurück
 *   → Status „eingetragen“, „FDISK-Bericht“ = Berichtsnummer.
 * Einrichten: Skripteigenschaft FDISK_KEY (langer Zufallswert) anlegen. Ohne FDISK_KEY ist die Abfrage aus.
 */
const FREIGABE_TAB = 'FDISK-Freigaben';
const FREIGABE_KOPF = ['Monat', 'Freigegeben am', 'Freigegeben von', 'Anzahl', 'Übertragen am'];

const taetRolle_ = (pin) => { const r = rolle_(pin); return r && (r.rolle === 'kommando' || r.rolle === 'fahrmeister') ? r : null; };
const monatVon_ = (t) => Utilities.formatDate(new Date(t), 'Europe/Vienna', 'yyyy-MM');
const tzDatum_ = (t) => Utilities.formatDate(new Date(t), 'Europe/Vienna', 'dd.MM.yyyy');
const tzUhr_ = (t) => Utilities.formatDate(new Date(t), 'Europe/Vienna', 'HH:mm');
const nameKurz_ = (r) => String(r.name).replace(/\s*\(.*\)$/, '');
function freigabeTab_(ss) {
  let sh = ss.getSheetByName(FREIGABE_TAB);
  if (!sh) { sh = ss.insertSheet(FREIGABE_TAB); sh.appendRow(FREIGABE_KOPF); sh.getRange(1, 1, 1, FREIGABE_KOPF.length).setFontWeight('bold'); sh.setFrozenRows(1); sh.getRange('A:A').setNumberFormat('@'); }
  return sh;
}
function freigaben_(ss) {
  const sh = ss.getSheetByName(FREIGABE_TAB); if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).map((z, i) => ({ zeile: i + 2, monat: String(z[0]).trim(), am: z[1], von: String(z[2] || ''), anzahl: z[3], uebertragen: z[4] })).filter((x) => x.monat);
}
const tSp_ = (k) => ANW_TABS.Termine.indexOf(k) + 1;

// Auswahllisten für das Formular
function taetStamm(pin) {
  const r = taetRolle_(pin); if (!r) return { ok: false, fehler: 'Keine Berechtigung.' };
  const ss = anwSS_();
  return { ok: true, arten: FDISK_ARTEN, unterarten: FDISK_UNTERARTEN, namen: mitglieder_(ss).map((m) => m.name).sort((a, b) => a.localeCompare(b, 'de')) };
}

// Tätigkeit von Hand eintragen: { art, unterart, titel, datum: 'JJJJ-MM-TT', von: 'HH:MM', bis: 'HH:MM', personen: [Namen], bemerkung }
function taetAnlegen(pin, d) {
  const r = taetRolle_(pin); if (!r) return { ok: false, fehler: 'Keine Berechtigung.' };
  d = d || {};
  const art = String(d.art || '').trim();
  if (FDISK_ARTEN.indexOf(art) === -1) return { ok: false, fehler: 'Bitte eine Tätigkeitsart wählen.' };
  const ua = String(d.unterart || '').trim();
  if (ua && (FDISK_UNTERARTEN[art] || []).indexOf(ua) === -1) return { ok: false, fehler: 'Unbekannte Unterart.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.datum || '')) || !/^\d{2}:\d{2}$/.test(String(d.von || '')) || !/^\d{2}:\d{2}$/.test(String(d.bis || ''))) return { ok: false, fehler: 'Bitte Datum und Uhrzeit angeben.' };
  const von = lokal_(d.datum + 'T' + d.von);
  let bis = lokal_(d.datum + 'T' + d.bis);
  if (bis.getTime() === von.getTime()) return { ok: false, fehler: '„Bis“ muss nach „Von“ liegen.' };
  if (bis < von) bis = new Date(bis.getTime() + 864e5);           // über Mitternacht
  if (bis - von > 24 * 3600e3) return { ok: false, fehler: 'Eine Tätigkeit darf höchstens 24 Stunden dauern.' };
  if (von.getTime() > Date.now() + 864e5) return { ok: false, fehler: 'Tätigkeiten bitte erst nachher eintragen, nicht im Voraus.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = anwSS_(), alle = mitglieder_(ss);
    const leute = [];
    (Array.isArray(d.personen) ? d.personen : []).forEach((n) => { const m = alle.find((x) => anwNorm_(x.name) === anwNorm_(n)); if (m && !leute.some((x) => x.name === m.name)) leute.push(m); });
    if (!leute.length) return { ok: false, fehler: 'Bitte mindestens eine Person auswählen.' };
    const fg = freigaben_(ss).find((x) => x.monat === monatVon_(von));
    if (fg && fg.uebertragen) return { ok: false, fehler: 'Dieser Monat ist schon ins FDISK übertragen. Bitte direkt im FDISK nachtragen.' };
    const titel = String(d.titel || '').trim().slice(0, 80) || (ua || art);
    const id = 'h:' + Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyyyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 6);
    const T = anwLesen_(ss, 'Termine').sh, A = anwLesen_(ss, 'Anwesenheit').sh;
    // Personen zuerst, dann der Termin: bricht etwas ab, bleibt kein Termin ohne Personen zurück
    const jetzt = new Date();
    A.getRange(A.getLastRow() + 1, 1, leute.length, 5).setValues(leute.map((m) => [jetzt, id, m.name, m.sbn, 'eingetragen']));
    T.appendRow([id, titel, art, ua, von, bis, 'abgeschlossen', nameKurz_(r), '', String(d.bemerkung || '').trim().slice(0, 300)]);
    return { ok: true, text: '„' + titel + '“ am ' + tzDatum_(von) + ' mit ' + leute.length + (leute.length === 1 ? ' Person' : ' Personen') + ' eingetragen.' };
  } finally { lock.releaseLock(); }
}

// Bewegungsfahrt nach dem Einrücken als Tätigkeit „Fahrmeister“ (aus bewegungEnde aufgerufen; Fehler dort abgefangen)
function taetBewegung_(b, ende) {
  const ss = anwSS_(), m = mitglieder_(ss).find((x) => anwNorm_(x.name) === anwNorm_(b.name));
  if (!m) return;                                                   // kein Mitglied laut Liste → nur Fahrtenbuch
  const id = 'b:' + b.fahrzeug + ':' + b.von;
  const T = anwLesen_(ss, 'Termine');
  if (T.zeilen.some((t) => t.ID === id)) return;
  const fg = freigaben_(ss).find((x) => x.monat === monatVon_(b.von));
  if (fg && fg.uebertragen) return;
  anwLesen_(ss, 'Anwesenheit').sh.appendRow([new Date(), id, m.name, m.sbn, 'Bewegungsfahrt']);
  T.sh.appendRow([id, 'Bewegungsfahrt ' + b.fahrzeug, 'Fahrmeister', '', new Date(b.von), new Date(ende), 'abgeschlossen', 'Bewegungsfahrt', '', '']);
}

// Monatsübersicht: alle Tätigkeiten eines Monats (JJJJ-MM) mit Stand der Freigabe
function taetMonat(pin, monat) {
  const r = taetRolle_(pin); if (!r) return { ok: false, fehler: 'Keine Berechtigung.' };
  monat = /^\d{4}-\d{2}$/.test(String(monat || '')) ? monat : monatVon_(Date.now());
  const ss = anwSS_(), A = anwLesen_(ss, 'Anwesenheit').zeilen;
  const liste = anwLesen_(ss, 'Termine').zeilen.filter((t) => anwZeit_(t.Beginn) && monatVon_(anwZeit_(t.Beginn)) === monat).map((t) => {
    const p = A.filter((a) => a['Termin-ID'] === t.ID);
    const fb = String(t['FDISK-Bericht'] || '');
    return { id: t.ID, titel: t.Titel, art: t['FDISK-Art'], unterart: t.Unterart, beginn: anwZeit_(t.Beginn), ende: anwZeit_(t.Ende),
      status: t.Status === 'eingetragen' ? 'fdisk' : t.Status === 'offen' ? 'offen' : /^freigegeben/.test(fb) ? 'freigegeben' : 'fertig',
      bericht: t.Status === 'eingetragen' ? fb : '', von: String(t['Abgeschlossen von'] || ''), quelle: String(t.ID).slice(0, 1),
      personen: p.length, ohneSbn: p.filter((a) => !String(a.Standesbuchnummer || '').trim()).map((a) => String(a.Name)) };
  }).sort((a, b) => a.beginn - b.beginn);
  const fg = freigaben_(ss).find((x) => x.monat === monat);
  return { ok: true, monat, rolle: r.rolle, liste,
    freigabe: fg ? { am: fg.am instanceof Date ? tzDatum_(fg.am) : String(fg.am), von: fg.von, uebertragen: fg.uebertragen instanceof Date ? tzDatum_(fg.uebertragen) : String(fg.uebertragen || '') } : null };
}

// Kommando gibt einen Monat frei: alle abgeschlossenen Tätigkeiten des Monats bekommen „freigegeben MM/JJJJ“
function taetFreigeben(pin, monat) {
  if (!pinOk_(pin)) return { ok: false, fehler: 'Nur das Kommando kann freigeben.' };
  const r = rolle_(pin);
  if (!/^\d{4}-\d{2}$/.test(String(monat || ''))) return { ok: false, fehler: 'Monat fehlt.' };
  if (monat >= monatVon_(Date.now())) return { ok: false, fehler: 'Ein Monat kann erst freigegeben werden, wenn er vorbei ist.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = anwSS_(), T = anwLesen_(ss, 'Termine');
    const imMonat = T.zeilen.filter((t) => anwZeit_(t.Beginn) && monatVon_(anwZeit_(t.Beginn)) === monat);
    const offen = imMonat.filter((t) => t.Status === 'offen');
    if (offen.length) return { ok: false, fehler: 'Zuerst unter „Anwesenheit prüfen“ abschließen oder löschen:\n' + offen.map((t) => '• ' + t.Titel + ' (' + tzDatum_(anwZeit_(t.Beginn)) + ')').join('\n') };
    const A = anwLesen_(ss, 'Anwesenheit').zeilen;
    const neu = imMonat.filter((t) => t.Status === 'abgeschlossen' && A.some((a) => a['Termin-ID'] === t.ID));
    neu.forEach((t) => T.sh.getRange(t._zeile, tSp_('FDISK-Bericht')).setValue('freigegeben ' + monat));
    const sh = freigabeTab_(ss), fg = freigaben_(ss).find((x) => x.monat === monat);
    if (fg) sh.getRange(fg.zeile, 2, 1, 4).setValues([[new Date(), nameKurz_(r), neu.length, '']]);
    else sh.appendRow([monat, new Date(), nameKurz_(r), neu.length, '']);
    SpreadsheetApp.flush();
    return { ok: true, text: neu.length + (neu.length === 1 ? ' Tätigkeit' : ' Tätigkeiten') + ' freigegeben. Der Übertrag ins FDISK läuft am Monatsersten automatisch.' };
  } finally { lock.releaseLock(); }
}

// ---------- Abfrage für den automatischen FDISK-Übertrag (über doGet, mit FDISK_KEY) ----------
function fdiskAbfrage_(p) {
  const aus = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  const soll = (PropertiesService.getScriptProperties().getProperty('FDISK_KEY') || '').trim();
  if (!soll || soll.length < 20 || String(p.key || '') !== soll) { Utilities.sleep(1000); return aus({ ok: false, fehler: 'Schlüssel falsch oder FDISK_KEY nicht eingerichtet.' }); }
  if (p.aktion === 'fdiskEinsaetze' || p.aktion === 'einsatzErledigt') return aus(einsatzFdisk_(p));
  if (p.aktion === 'fristenAnfrage' || p.aktion === 'fristenStatus') return aus(fristenAnfrage_(p));   // FDISK-Fristenabgleich (Fristen.gs)   // Einsatzberichte (Nachbereitung.gs)
  const ss = anwSS_(), T = anwLesen_(ss, 'Termine'), A = anwLesen_(ss, 'Anwesenheit').zeilen;
  if (p.aktion === 'fdisk') {
    const liste = T.zeilen.filter((t) => t.Status === 'abgeschlossen' && /^freigegeben/.test(String(t['FDISK-Bericht'] || ''))).map((t) => {
      const b = anwZeit_(t.Beginn), e = anwZeit_(t.Ende) || b;
      const p2 = A.filter((a) => a['Termin-ID'] === t.ID);
      return { id: t.ID, titel: t.Titel, art: t['FDISK-Art'], unterart: t.Unterart || '', datumBeginn: tzDatum_(b), uhrzeitBeginn: tzUhr_(b), datumEnde: tzDatum_(e), uhrzeitEnde: tzUhr_(e),
        bemerkung: [t.Titel !== t['FDISK-Art'] && t.Titel !== t.Unterart ? t.Titel : '', t.Bemerkung || ''].filter(Boolean).join(' · ').slice(0, 300),
        personen: p2.map((a) => ({ name: String(a.Name), sbn: String(a.Standesbuchnummer || '').trim() })), monat: String(t['FDISK-Bericht']).replace('freigegeben ', '') };
    }).filter((x) => x.personen.length).sort((a, b) => a.id < b.id ? -1 : 1);
    return aus({ ok: true, liste });
  }
  if (p.aktion === 'fdiskErledigt') {
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const t = anwLesen_(ss, 'Termine').zeilen.find((x) => x.ID === String(p.id || ''));   // frisch lesen, Zeilen können sich verschoben haben
      if (!t) return aus({ ok: false, fehler: 'Termin nicht gefunden.' });
      if (t.Status === 'eingetragen') return aus({ ok: true, text: 'Schon als eingetragen vermerkt: ' + t['FDISK-Bericht'] });
      if (t.Status !== 'abgeschlossen' || !/^freigegeben /.test(String(t['FDISK-Bericht'] || ''))) return aus({ ok: false, fehler: 'Dieser Termin ist nicht freigegeben.' });
      const nr = String(p.bericht || '').replace(/[^0-9A-Za-z-]/g, '').slice(0, 30);
      if (!nr) return aus({ ok: false, fehler: 'Berichtsnummer fehlt.' });
      const monat = String(t['FDISK-Bericht'] || '').replace('freigegeben ', '');
      T.sh.getRange(t._zeile, tSp_('Status')).setValue('eingetragen');
      T.sh.getRange(t._zeile, tSp_('FDISK-Bericht')).setValue('Bericht ' + nr + ' · ' + tzDatum_(Date.now()));
      SpreadsheetApp.flush();
      // Alles aus diesem Monat übertragen? → in „FDISK-Freigaben“ vermerken
      const rest = anwLesen_(ss, 'Termine').zeilen.filter((x) => String(x['FDISK-Bericht'] || '') === 'freigegeben ' + monat && x.Status !== 'eingetragen');
      if (!rest.length) { const fg = freigaben_(ss).find((x) => x.monat === monat); if (fg) freigabeTab_(ss).getRange(fg.zeile, 5).setValue(new Date()); }
      return aus({ ok: true, text: t.Titel + ' als eingetragen vermerkt (Bericht ' + nr + ').', offenImMonat: rest.length });
    } finally { lock.releaseLock(); }
  }
  return aus({ ok: false, fehler: 'Unbekannte Aktion.' });
}

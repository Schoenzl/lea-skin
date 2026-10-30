/**
 * Geräteprüfungen – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt wie Code.gs und Anwesenheit.gs.
 *
 * Rollen über den PIN im Reiter „Kommando“:
 *  - Kommando-PIN (STATUS_PIN) → alles
 *  - Prüfer-PIN (Tab „Prüfer“ in der Tabelle „Geräte & Prüfungen“) → nur die Geräteprüfungen; alle anderen
 *    Funktionen prüfen weiterhin nur den Kommando-PIN und liefern einem Prüfer nichts.
 * Geprüft wird ohne Aufkleber: Ort wählen (z. B. „KLF-W › Geräteraum 4“), Geräte abhaken, bei Mangel kurz notieren.
 *
 * Einrichten: GeraeteImport.gs (Daten aus FDISK, nicht im Repo) einfügen und einmal ▶ geraeteEinrichten ausführen.
 */
const GER_TABS = {
  'Geräte': ['ID', 'Ort', 'Gruppe', 'Gerätestandard', 'Bezeichnung', 'Inventarnr.', 'Seriennr.', 'Anzahl', 'Prüfarten', 'Prüfen', 'Bemerkung'],
  'Prüfarten': ['Prüfart', 'Intervall (Monate)', 'Aktiv', 'Hinweis'],
  'Prüfungen': ['Zeitstempel', 'Geräte-ID', 'Bezeichnung', 'Ort', 'Prüfart', 'Ergebnis', 'Bemerkung', 'Prüfer'],
  'Prüfer': ['Name', 'Funktion', 'PIN', 'Aktiv']
};
const BALD_TAGE = 30;

// ---------- Einrichten (einmal im Editor; braucht GeraeteImport.gs mit GERAETE_IMPORT) ----------
function geraeteEinrichten() {
  if (typeof GERAETE_IMPORT === 'undefined') throw new Error('GeraeteImport.gs fehlt – zuerst einfügen.');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('GER_ID')) { console.log('Schon eingerichtet: ' + SpreadsheetApp.openById(props.getProperty('GER_ID')).getUrl()); return; }
  const ss = SpreadsheetApp.create('Geräte & Prüfungen FF Deutsch Haslau');
  ss.setSpreadsheetTimeZone('Europe/Vienna');
  Object.keys(GER_TABS).forEach((name, i) => {
    const sh = i === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
    sh.getRange(1, 1, 1, GER_TABS[name].length).setValues([GER_TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const g = ss.getSheetByName('Geräte');
  g.getRange('F2:G1000').setNumberFormat('@');               // Inventar- und Seriennummern als Text (führende Nullen)
  const rows = GERAETE_IMPORT.geraete.map((x, i) => ['G' + String(i + 1).padStart(3, '0'), x.ort, x.gruppe, x.standard, x.bez, x.inv, x.serie, x.anzahl, x.pruefarten, 'Ja', '']);
  g.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  g.getRange('J2:J1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Ja', 'Nein'], true).build());
  const p = ss.getSheetByName('Prüfarten');
  p.getRange(2, 1, GERAETE_IMPORT.pruefarten.length, 4).setValues(GERAETE_IMPORT.pruefarten);
  p.getRange('C2:C200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Ja', 'Nein'], true).build());
  ss.getSheetByName('Prüfungen').getRange('A2:A10000').setNumberFormat('dd.MM.yyyy HH:mm');
  const pr = ss.getSheetByName('Prüfer');
  pr.getRange('C2:C100').setNumberFormat('@');
  pr.getRange('D2:D100').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Ja', 'Nein'], true).build());
  [g, p, ss.getSheetByName('Prüfungen'), pr].forEach((sh) => sh.autoResizeColumns(1, sh.getLastColumn()));
  props.setProperty('GER_ID', ss.getId());
  console.log(rows.length + ' Geräte übernommen. Tabelle: ' + ss.getUrl());
  console.log('Als Nächstes: Tab „Prüfer“ befüllen (Name, Funktion, PIN mind. 4 Ziffern, Aktiv = Ja) und GeraeteImport.gs wieder löschen.');
}

// ---------- Lesen ----------
function gerSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('GER_ID');
  if (!id) throw new Error('Geräteprüfungen sind noch nicht eingerichtet (▶ geraeteEinrichten).');
  return SpreadsheetApp.openById(id);
}
function gerLesen_(ss, name) {
  const sh = ss.getSheetByName(name);
  const kopf = GER_TABS[name];
  const w = sh.getDataRange().getValues();
  return { sh, zeilen: w.slice(1).map((r, i) => { const o = { _zeile: i + 2 }; kopf.forEach((k, j) => { o[k] = r[j]; }); return o; })
    .filter((o) => String(o[kopf[0]]).trim() !== '') };
}
const jaNein_ = (v) => String(v || '').trim().toLowerCase() !== 'nein';
const monatePlus_ = (t, m) => { const d = new Date(t); d.setMonth(d.getMonth() + m); return d.getTime(); };
const datum_ = (t) => (t ? Utilities.formatDate(new Date(t), 'Europe/Vienna', 'dd.MM.yyyy') : '');

// Rolle aus dem PIN: Kommando (STATUS_PIN) oder Prüfer (Tab „Prüfer“). Sperre nach Fehlversuchen wie beim Kommando-PIN.
function rolle_(pin) {
  const cache = CacheService.getScriptCache();
  if (+(cache.get('status-fehl') || 0) >= FEHL_MAX) throw new Error('Zu viele falsche Versuche. Bitte in 15 Minuten wieder probieren.');
  const p = pinNorm_(pin);
  const soll = pinNorm_(PropertiesService.getScriptProperties().getProperty('STATUS_PIN'));
  if (soll && p === soll) { cache.remove('status-fehl'); return { rolle: 'kommando', name: 'Kommando' }; }
  try {
    const t = gerLesen_(gerSS_(), 'Prüfer').zeilen.find((x) => jaNein_(x.Aktiv) && pinNorm_(x.PIN).length >= 4 && pinNorm_(x.PIN) === p);
    if (t) { cache.remove('status-fehl'); return { rolle: 'pruefer', name: String(t.Name).trim() + (t.Funktion ? ' (' + String(t.Funktion).trim() + ')' : '') }; }
  } catch (e) { /* noch nicht eingerichtet */ }
  cache.put('status-fehl', String(+(cache.get('status-fehl') || 0) + 1), SPERRE_S);
  Utilities.sleep(800);
  return null;
}
function anmelden(pin) {
  const r = rolle_(pin);
  return r ? Object.assign({ ok: true }, r) : { ok: false, fehler: 'PIN falsch.' };
}

// Stand aller Geräte: je aktiver Prüfart letzte Prüfung, Fälligkeit, Ampel
function gerStand_(ss) {
  const arten = {};
  gerLesen_(ss, 'Prüfarten').zeilen.forEach((a) => { arten[String(a['Prüfart']).trim()] = { monate: +a['Intervall (Monate)'] || 12, aktiv: jaNein_(a.Aktiv) }; });
  const prot = {};
  gerLesen_(ss, 'Prüfungen').zeilen.forEach((p) => {
    const k = p['Geräte-ID'] + '|' + String(p['Prüfart']).trim();
    const t = p.Zeitstempel instanceof Date ? p.Zeitstempel.getTime() : 0;
    if (!prot[k] || t >= prot[k].t) prot[k] = { t, ergebnis: String(p.Ergebnis), bem: String(p.Bemerkung || ''), pruefer: String(p['Prüfer'] || '') };
  });
  const jetzt = Date.now();
  return gerLesen_(ss, 'Geräte').zeilen.filter((g) => jaNein_(g['Prüfen'])).map((g) => {
    const pa = String(g['Prüfarten'] || '').split(';').map((s) => s.trim()).filter((s) => s && (!arten[s] || arten[s].aktiv));
    const pruefungen = pa.map((a) => {
      const l = prot[g.ID + '|' + a]; const mon = (arten[a] || { monate: 12 }).monate;
      let status = 'grau', faellig = 0;
      if (l) {
        faellig = monatePlus_(l.t, mon);
        status = /mangel/i.test(l.ergebnis) || jetzt > faellig ? 'rot' : faellig - jetzt < BALD_TAGE * 864e5 ? 'gelb' : 'gruen';
      }
      return { art: a, monate: mon, status, letzte: l ? datum_(l.t) : '', ergebnis: l ? l.ergebnis : '', bem: l ? l.bem : '', pruefer: l ? l.pruefer : '', faellig: faellig ? datum_(faellig) : '' };
    });
    const rang = { rot: 3, gelb: 2, grau: 1, gruen: 0 };
    const status = pruefungen.reduce((s, p) => (rang[p.status] > rang[s] ? p.status : s), pruefungen.length ? 'gruen' : 'gruen');
    return { id: g.ID, ort: String(g.Ort || '').trim() || 'Ohne Ort', gruppe: g.Gruppe, standard: g['Gerätestandard'], bez: g.Bezeichnung,
      inv: String(g['Inventarnr.'] || ''), serie: String(g['Seriennr.'] || ''), anzahl: g.Anzahl, pruefungen, status, bem: String(g.Bemerkung || '') };
  }).filter((g) => g.pruefungen.length);
}

// Übersicht: Orte mit Ampel-Zählern
function pruefUebersicht(pin) {
  const r = rolle_(pin); if (!r) return { ok: false, fehler: 'PIN falsch.' };
  let ss; try { ss = gerSS_(); } catch (e) { return { ok: true, rolle: r.rolle, name: r.name, fehlt: e.message, orte: [] }; }
  const g = gerStand_(ss), orte = {};
  g.forEach((x) => { const o = orte[x.ort] || (orte[x.ort] = { ort: x.ort, n: 0, rot: 0, gelb: 0, grau: 0 }); o.n++; if (x.status !== 'gruen') o[x.status]++; });
  const reihe = (o) => (/^KLF-W/.test(o) ? 0 : /^MTF/.test(o) ? 1 : /^VFA/.test(o) ? 2 : /^Ohne|nicht zugewiesen/i.test(o) ? 9 : 5);
  return { ok: true, rolle: r.rolle, name: r.name,
    orte: Object.values(orte).sort((a, b) => reihe(a.ort) - reihe(b.ort) || a.ort.localeCompare(b.ort, 'de', { numeric: true })),
    gesamt: { n: g.length, rot: g.filter((x) => x.status === 'rot').length, gelb: g.filter((x) => x.status === 'gelb').length, grau: g.filter((x) => x.status === 'grau').length } };
}

// Geräte eines Orts – oder Suche (Bezeichnung, Inventar-/Seriennummer) – oder alle fälligen
function pruefListe(pin, filter) {
  const r = rolle_(pin); if (!r) return { ok: false, fehler: 'PIN falsch.' };
  const g = gerStand_(gerSS_());
  let liste;
  if (filter && filter.ort) liste = g.filter((x) => x.ort === filter.ort);
  else if (filter && filter.faellig) liste = g.filter((x) => x.status === 'rot' || x.status === 'gelb');
  else if (filter && filter.suche) { const q = String(filter.suche).toLowerCase(); liste = g.filter((x) => (x.bez + ' ' + x.inv + ' ' + x.serie + ' ' + x.standard).toLowerCase().indexOf(q) !== -1).slice(0, 60); }
  else liste = [];
  return { ok: true, geraete: liste };
}

// Prüfungen speichern: [{ id, art, ergebnis: 'OK'|'Mangel', bem }]
function pruefSpeichern(pin, eintraege) {
  const r = rolle_(pin); if (!r) return { ok: false, fehler: 'PIN falsch.' };
  if (!Array.isArray(eintraege) || !eintraege.length) return { ok: false, fehler: 'Nichts ausgewählt.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = gerSS_();
    const geraete = {}; gerLesen_(ss, 'Geräte').zeilen.forEach((g) => { geraete[g.ID] = g; });
    const jetzt = new Date(), zeilen = [], maengel = [];
    eintraege.forEach((e) => {
      const g = geraete[e.id]; if (!g) return;
      const erg = /mangel/i.test(e.ergebnis) ? 'Mangel' : 'OK';
      const bem = String(e.bem || '').trim().slice(0, 300);
      if (erg === 'Mangel' && !bem) throw new Error('Bei „' + g.Bezeichnung + '“ bitte kurz beschreiben, was der Mangel ist.');
      zeilen.push([jetzt, g.ID, g.Bezeichnung, g.Ort, String(e.art || '').trim(), erg, bem, r.name]);
      if (erg === 'Mangel') maengel.push({ ort: String(g.Ort || ''), text: g.Bezeichnung + ': ' + bem });
    });
    if (!zeilen.length) return { ok: false, fehler: 'Geräte nicht gefunden.' };
    const sh = ss.getSheetByName('Prüfungen');
    sh.getRange(sh.getLastRow() + 1, 1, zeilen.length, zeilen[0].length).setValues(zeilen);
    const info = fahrzeugMaengel_(maengel);
    return { ok: true, text: zeilen.length + ' Prüfung' + (zeilen.length === 1 ? '' : 'en') + ' gespeichert' + (maengel.length ? ', ' + maengel.length + ' Mangel' + (maengel.length === 1 ? '' : '/Mängel') + info : '') + '.' };
  } finally { lock.releaseLock(); }
}

// Mängel an Fahrzeuggeräten zusätzlich in den Tab „Fahrzeuge“ (Spalte Mangel) der Fahrzeugtabelle → Infoscreen
function fahrzeugMaengel_(maengel) {
  const proFz = {};
  maengel.forEach((m) => { const fz = FAHRZEUGE.find((f) => m.ort.indexOf(f) === 0); if (fz) (proFz[fz] = proFz[fz] || []).push(m.text); });
  if (!Object.keys(proFz).length) return '';
  const sh = SpreadsheetApp.getActive().getSheetByName('Fahrzeuge'); if (!sh) return '';
  const w = sh.getDataRange().getValues(), k = w[0].map((x) => String(x).toLowerCase());
  const cFz = k.findIndex((h) => h.indexOf('fahrzeug') !== -1), cM = k.findIndex((h) => h.indexOf('mangel') !== -1);
  if (cFz < 0 || cM < 0) return '';
  const fertig = [];
  Object.keys(proFz).forEach((fz) => {
    const i = w.findIndex((r, j) => j > 0 && gleich_(r[cFz], fz)); if (i < 0) return;
    const alt = String(w[i][cM] || '').trim();
    sh.getRange(i + 1, cM + 1).setValue((alt ? alt + ' · ' : '') + proFz[fz].join(' · '));
    fertig.push(fz);
  });
  return fertig.length ? ' (bei ' + fertig.join(', ') + ' als Mangel eingetragen)' : '';
}

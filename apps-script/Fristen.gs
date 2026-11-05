/**
 * Fristen je Mitglied – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt.
 *
 * Quellen:
 *  - Atemschutz: Google-Tabelle „Atemschutzgeräteträger – Tauglichkeit“ (Drive, Ordner Atemschutz).
 *    Gelesen werden Name, „Untersuchung gültig bis“ und „Finnentest gültig bis“. Die Tabelle bleibt, wie sie ist.
 *    Das Konto, unter dem die Web-App läuft, braucht Lesezugriff (Tabelle mit diesem Konto teilen: Betrachter).
 *  - FDISK: Tab „Fristen (FDISK)“ in der Anwesenheitstabelle. Den füllt der monatliche FDISK-Abgleich
 *    (Claude im Browser, POST aktion=fristen mit FDISK_KEY) – jedes Mal komplett neu.
 *
 * Anzeige: Verwaltung › Fristen mit Ampel – Kommando (Rolle „Alles“) sieht alles, wer im Tab „Prüfer“ eine Funktion mit
 * „Atemschutz“ hat (SB Atemschutz), sieht nur die Atemschutz-Fristen.
 * Ampel – rot abgelaufen, gelb in den nächsten 60 Tagen.
 * Erinnerung: täglich um 7 Uhr; läuft eine Frist in 30 Tagen ab, bekommt das Mitglied (Spalte „E-Mail“ im Tab „Mitglieder“)
 * eine Mail, das Kommando eine Sammelmail. Jede Frist wird nur einmal erinnert.
 *
 * Einrichten: einmal ▶ fristenEinrichten ausführen (legt den Tab und den täglichen Auslöser an, prüft den Zugriff auf die ATS-Tabelle).
 */
const ATS_ID_STD = '15A_-3In6H6ceB9RZVt0fxLmNG7Nn__4gY6WoqDb9HGw';   // Skripteigenschaft ATS_ID überschreibt das
const FR_TAB = 'Fristen (FDISK)';
const FR_KOPF = ['Name', 'Standesbuchnummer', 'Art', 'Gültig bis', 'Stand'];
const FR_GELB_TAGE = 60, FR_ERINNERN_TAGE = 30;

function fristenEinrichten() {
  frTab_(anwSS_());
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'fristenErinnern')) ScriptApp.newTrigger('fristenErinnern').timeBased().everyDays(1).atHour(7).create();
  try { const a = fristenAts_(); console.log('ATS-Tabelle gelesen: ' + a.length + ' Fristen.'); }
  catch (e) { console.log('ATS-Tabelle NICHT lesbar: ' + e.message + ' → Tabelle mit ' + Session.getEffectiveUser().getEmail() + ' teilen (Betrachter).'); }
  console.log('Fristen eingerichtet, Erinnerung läuft täglich um 7 Uhr.');
}
function frTab_(ss) {
  let sh = ss.getSheetByName(FR_TAB);
  if (!sh) {
    sh = ss.insertSheet(FR_TAB);
    sh.getRange(1, 1, 1, FR_KOPF.length).setValues([FR_KOPF]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange('D:D').setNumberFormat('dd.MM.yyyy');
    sh.getRange('E:E').setNumberFormat('dd.MM.yyyy HH:mm');
  }
  return sh;
}

// Datum aus Zelle: Date oder „28.03.2030“ / „2030-03-28“ → Zeitpunkt (Tagesende, damit „gültig bis heute“ heute noch grün ist)
function frDatum_(v) {
  let d = null;
  if (v instanceof Date) d = new Date(v.getFullYear(), v.getMonth(), v.getDate());
  else {
    const s = String(v || '').trim();
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (m) d = new Date(+m[3], +m[2] - 1, +m[1]);
    else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) d = new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return d && isFinite(d) ? d.getTime() + 864e5 - 1 : 0;
}

// Atemschutz-Tabelle lesen: Kopfzeile ist die Zeile, deren erste Zelle „Name“ ist
function fristenAts_() {
  const id = (PropertiesService.getScriptProperties().getProperty('ATS_ID') || ATS_ID_STD).trim();
  const w = SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getValues();
  const k = w.findIndex((r, i) => i < 15 && anwNorm_(r[0]) === 'name');
  if (k < 0) throw new Error('Kopfzeile „Name“ in der ATS-Tabelle nicht gefunden.');
  const kopf = w[k].map((x) => anwNorm_(x));
  const sp = (t) => kopf.findIndex((x) => x.indexOf(t) !== -1);
  const cU = sp('untersuchung gultig bis'), cF = sp('finnentest gultig bis'), cT = sp('tauglichkeit');
  if (cU < 0 && cF < 0) throw new Error('Spalten „Untersuchung gültig bis“ / „Finnentest gültig bis“ fehlen.');
  const out = [];
  w.slice(k + 1).forEach((r) => {
    const name = String(r[0] || '').trim(); if (!name) return;
    if (cT >= 0 && /^untauglich/i.test(String(r[cT] || '').trim()) && !frDatum_(r[cU]) && !frDatum_(r[cF])) return;   // kein Geräteträger
    if (cU >= 0) out.push({ name, art: 'ATS-Untersuchung', bis: frDatum_(r[cU]), quelle: 'ATS-Tabelle' });
    if (cF >= 0) out.push({ name, art: 'ATS-Finnentest', bis: frDatum_(r[cF]), quelle: 'ATS-Tabelle' });
  });
  return out;
}
function fristenFdisk_(ss) {
  const sh = ss.getSheetByName(FR_TAB); if (!sh) return { liste: [], stand: 0 };
  const w = sh.getDataRange().getValues().slice(1).filter((r) => String(r[0]).trim() || String(r[1]).trim());
  let stand = 0;
  const liste = w.map((r) => { stand = Math.max(stand, r[4] instanceof Date ? r[4].getTime() : 0); return { name: String(r[0]).trim(), sbn: String(r[1] || '').trim(), art: String(r[2] || '').trim(), bis: frDatum_(r[3]), quelle: 'FDISK' }; })
    .filter((x) => x.art);
  return { liste, stand };
}

// Name aus einer Quelle („BAYER Daniel“) dem Mitglied zuordnen
function frMitglied_(alle, name, sbn) {
  if (sbn) { const m = alle.find((x) => x.sbn && String(x.sbn) === String(sbn)); if (m) return m; }
  const t = (s) => anwNorm_(s).split(/[\s,-]+/).filter(Boolean).sort().join(' ');
  const n = t(name);
  return alle.find((m) => t(m.name) === n) || null;
}
const frAmpel_ = (bis, jetzt) => (!bis ? 'grau' : bis < jetzt ? 'rot' : bis - jetzt <= FR_GELB_TAGE * 864e5 ? 'gelb' : 'gruen');

// Wer darf was sehen: 'alle' (Kommando), 'ats' (SB Atemschutz: Funktion enthält „Atemschutz“) oder null
const FR_ATS_FUNKTION = /atemschutz/i;
function frRecht_(pin) {
  const r = rolle_(pin); if (!r) return null;
  if (r.rolle === 'kommando') return 'alle';
  const wer = String(pin || '').split('|')[0].trim();
  let leute = [];
  try { leute = personen_(); } catch (e) { return null; }
  const p = leute.find((x) => x.name === wer);
  return p && FR_ATS_FUNKTION.test(p.funktion) ? 'ats' : null;
}

// Alle Fristen je Person (für Anzeige und Erinnerung); nurAts = nur Fristen aus der ATS-Tabelle
function fristenAlle_(nurAts) {
  const ss = anwSS_(), alle = mitglieder_(ss), jetzt = Date.now(), fehler = [];
  let ats = [];
  try { ats = fristenAts_(); } catch (e) { fehler.push('Atemschutz-Tabelle nicht lesbar: ' + e.message); }
  const fd = fristenFdisk_(ss);
  const pers = {};
  ats.concat(nurAts ? [] : fd.liste).forEach((x) => {
    const m = frMitglied_(alle, x.name, x.sbn);
    const name = m ? m.name : x.name;
    const p = pers[name] || (pers[name] = { name, mitglied: !!m, fristen: [] });
    p.fristen.push({ art: x.art, bis: x.bis, quelle: x.quelle, ampel: frAmpel_(x.bis, jetzt) });
  });
  const rang = { rot: 0, gelb: 1, grau: 2, gruen: 3 };
  const personen = Object.values(pers).map((p) => {
    p.fristen.sort((a, b) => rang[a.ampel] - rang[b.ampel] || (a.bis || 9e15) - (b.bis || 9e15));
    p.ampel = p.fristen.length ? p.fristen[0].ampel : 'gruen';
    return p;
  }).sort((a, b) => rang[a.ampel] - rang[b.ampel] || a.name.localeCompare(b.name, 'de'));
  return { personen, fehler, fdiskStand: fd.stand };
}

function fristenUebersicht(pin) {
  const recht = frRecht_(pin); if (!recht) return { ok: false, fehler: 'Nur fürs Kommando und den SB Atemschutz.' };
  const nurAts = recht === 'ats', f = fristenAlle_(nurAts);
  const n = (a) => f.personen.reduce((s, p) => s + p.fristen.filter((x) => x.ampel === a).length, 0);
  const z = { rot: n('rot'), gelb: n('gelb') };
  try { CacheService.getScriptCache().put(nurAts ? 'fristen-zahl-ats' : 'fristen-zahl', JSON.stringify(z), 3600); } catch (e) { /* egal */ }
  return { ok: true, nurAts, personen: f.personen, fehler: f.fehler, fdiskStand: nurAts ? 0 : f.fdiskStand, rot: z.rot, gelb: z.gelb };
}
// Zahl für die Kachel (zwischengespeichert, damit die Startseite schnell bleibt)
function fristenZahl_(nurAts) {
  const c = CacheService.getScriptCache(), k = nurAts ? 'fristen-zahl-ats' : 'fristen-zahl', alt = c.get(k);
  if (alt) return JSON.parse(alt);
  const f = fristenAlle_(nurAts);
  const n = (a) => f.personen.reduce((s, p) => s + p.fristen.filter((x) => x.ampel === a).length, 0);
  const z = { rot: n('rot'), gelb: n('gelb') };
  try { c.put(k, JSON.stringify(z), 3600); } catch (e) { /* egal */ }
  return z;
}
const frCacheWeg_ = () => { const c = CacheService.getScriptCache(); c.remove('fristen-zahl'); c.remove('fristen-zahl-ats'); };

// ---------- Vom FDISK-Abgleich (doPost, FDISK_KEY): { liste: [{ name, sbn, art, bis: 'TT.MM.JJJJ' }] } ersetzt den Tab ----------
function fristenAusFdisk_(d) {
  const soll = (PropertiesService.getScriptProperties().getProperty('FDISK_KEY') || '').trim();
  if (!soll || soll.length < 20 || String(d.key || '') !== soll) { Utilities.sleep(1000); return { ok: false, fehler: 'Schlüssel falsch oder FDISK_KEY nicht eingerichtet.' }; }
  const liste = (Array.isArray(d.liste) ? d.liste : []).slice(0, 2000).map((x) => [
    nbText_(x.name, 80), nbText_(x.sbn, 20).replace(/[^0-9A-Za-z]/g, ''), nbText_(x.art, 80), frDatum_(x.bis) ? new Date(frDatum_(x.bis) - 864e5 + 1) : '', new Date()
  ]).filter((r) => (r[0] || r[1]) && r[2] && r[3]);
  if (!liste.length && !d.leerErlaubt) return { ok: false, fehler: 'Leere Liste – nichts geändert (leerErlaubt: true zum Leeren).' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = frTab_(anwSS_());
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, FR_KOPF.length).clearContent();
    if (liste.length) sh.getRange(2, 1, liste.length, FR_KOPF.length).setValues(liste);
    frCacheWeg_();
    return { ok: true, text: liste.length + ' Fristen aus dem FDISK gespeichert.' };
  } finally { lock.releaseLock(); }
}

// ---------- Täglich 7 Uhr: Erinnerung 30 Tage vorher ----------
function fristenErinnern() {
  const props = PropertiesService.getScriptProperties();
  let erinnert = {};
  try { erinnert = JSON.parse(props.getProperty('FRIST_ERINNERT') || '{}'); } catch (e) { erinnert = {}; }
  const jetzt0 = Date.now();
  Object.keys(erinnert).forEach((k) => { if (jetzt0 - erinnert[k] > (FR_ERINNERN_TAGE + 5) * 864e5) delete erinnert[k]; });
  const jetzt = jetzt0, f = fristenAlle_(), faellig = [];
  f.personen.forEach((p) => p.fristen.forEach((x) => {
    if (!x.bis || x.bis < jetzt || x.bis - jetzt > FR_ERINNERN_TAGE * 864e5) return;
    const k = anwNorm_(p.name) + '|' + x.art + '|' + tzDatum_(x.bis);
    if (erinnert[k]) return;
    faellig.push({ p, x, k });
  }));
  const datum = (t) => tzDatum_(t);
  faellig.forEach(({ p, x, k }) => {
    const mail = p.mitglied ? mitgliedMail_(p.name) : '';
    if (mail) try {
      MailApp.sendEmail({ to: mail, name: 'FF Deutsch Haslau', subject: 'Erinnerung: ' + x.art + ' läuft am ' + datum(x.bis) + ' ab',
        body: 'Hallo ' + p.name.split(' ')[0] + ',\n\ndeine Frist „' + x.art + '“ läuft am ' + datum(x.bis) + ' ab. Bitte rechtzeitig einen Termin ausmachen bzw. beim Kommando melden.\n\nFF Deutsch Haslau' });
    } catch (e) { console.error('Fristen-Mail an ' + p.name + ': ' + e.message); }
    erinnert[k] = jetzt;
    props.setProperty('FRIST_ERINNERT', JSON.stringify(erinnert));   // gleich sichern: bricht etwas ab, geht keine Mail doppelt
  });
  if (faellig.length) {
    let leute = [];
    try { leute = personen_(); } catch (e) { /* Geräte-Tabelle fehlt */ }
    const an = Array.from(new Set(leute.filter((p) => p.alles).map((p) => mitgliedMail_(p.name)).filter(Boolean)));
    if (!an.length) an.push(Session.getEffectiveUser().getEmail());
    // SB Atemschutz: eigene Sammelmail nur mit den Atemschutz-Fristen
    const atsF = faellig.filter(({ x }) => x.quelle === 'ATS-Tabelle');
    const atsAn = Array.from(new Set(leute.filter((p) => !p.alles && FR_ATS_FUNKTION.test(p.funktion)).map((p) => mitgliedMail_(p.name)).filter((m) => m && an.indexOf(m) === -1)));
    if (atsF.length && atsAn.length) try {
      MailApp.sendEmail({ to: atsAn.join(','), name: 'FF Deutsch Haslau – Fristen', subject: 'Atemschutz: ' + (atsF.length === 1 ? '1 Frist läuft' : atsF.length + ' Fristen laufen') + ' in den nächsten ' + FR_ERINNERN_TAGE + ' Tagen ab',
        body: atsF.map(({ p, x }) => '• ' + p.name + ': ' + x.art + ' bis ' + datum(x.bis)).join('\n') + '\n\nÜbersicht in der App unter Verwaltung › Fristen.' });
    } catch (e) { console.error('Fristen-Mail SB Atemschutz: ' + e.message); }
    try {
      MailApp.sendEmail({ to: an.join(','), name: 'FF Deutsch Haslau – Fristen', subject: 'Fristen: ' + (faellig.length === 1 ? '1 Frist läuft' : faellig.length + ' Fristen laufen') + ' in den nächsten ' + FR_ERINNERN_TAGE + ' Tagen ab',
        body: faellig.map(({ p, x }) => '• ' + p.name + ': ' + x.art + ' bis ' + datum(x.bis) + (p.mitglied && mitgliedMail_(p.name) ? ' (Mail an das Mitglied ist raus)' : ' (keine E-Mail hinterlegt)')).join('\n') +
          '\n\nÜbersicht in der App unter Verwaltung › Fristen.' });
    } catch (e) { console.error('Fristen-Sammelmail: ' + e.message); }
  }
  // alte Einträge aufräumen: erinnert wird nur 30 Tage vor Ablauf, danach ist der Eintrag nicht mehr nötig (Platz in der Eigenschaft ist knapp)
  Object.keys(erinnert).forEach((k) => { if (jetzt - erinnert[k] > (FR_ERINNERN_TAGE + 5) * 864e5) delete erinnert[k]; });
  props.setProperty('FRIST_ERINNERT', JSON.stringify(erinnert));
  frCacheWeg_();
}

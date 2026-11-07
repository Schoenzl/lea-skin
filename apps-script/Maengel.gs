/**
 * Mängel und Beschädigungen melden (mit Fotos) – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt.
 *
 * Melden: alle Mitglieder ohne PIN (mangelMelden). Gespeichert im Tab „Mängelmeldungen“ der Fahrzeugtabelle,
 * Fotos im privaten Drive-Ordner „Mängelmeldungen FF Deutsch Haslau“ (wird beim ersten Mal angelegt, nicht öffentlich).
 * Benachrichtigung: E-Mail mit Fotos an die Zuständigen (Spalte „E-Mail“ im Tab „Mitglieder“ der Anwesenheitstabelle)
 *   – Fahrzeug: Rolle „Alles“ und „Fahrmeister“ · Gerät/Haus: Rolle „Alles“ und Prüfer mit Funktion Gerätewart/Zeugmeister –
 *   ohne hinterlegte Adresse an das Konto der Web-App; dazu Push über den ntfy-Kanal (NTFY_TOPIC), falls eingerichtet.
 * Der Fahrzeugstatus ändert sich erst, wenn Fahrmeister oder Kommando in der Verwaltung „Eingeschränkt“ oder „Außer Dienst“ tippt.
 */
const MG_TAB = 'Mängelmeldungen';
const MG_KOPF = ['ID', 'Zeitstempel', 'Was', 'Beschreibung', 'Fahrbereit', 'Gemeldet von', 'Fotos', 'Vorschau', 'Status', 'Bearbeitet von', 'Bearbeitet am', 'Notiz'];
const MG_HAUS = 'Gerät / Feuerwehrhaus';
const MG_FAHRBEREIT = ['Ja', 'Nein', 'Weiß nicht'];
const MG_MAX_FOTO = 4 * 1024 * 1024;   // Base64-Zeichen je Foto (≈ 3 MB Bild)

function mgBlatt_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(MG_TAB);
  if (!sh) { sh = ss.insertSheet(MG_TAB); sh.appendRow(MG_KOPF); sh.getRange(1, 1, 1, MG_KOPF.length).setFontWeight('bold'); sh.setFrozenRows(1); sh.getRange('B:B').setNumberFormat('dd.MM.yyyy HH:mm'); sh.getRange('K:K').setNumberFormat('dd.MM.yyyy HH:mm'); }
  sh.getRange('D:D').setNumberFormat('@'); sh.getRange('L:L').setNumberFormat('@');
  return sh;
}
function mgOrdner_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('MG_ORDNER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* gelöscht → neu */ } }
  const o = DriveApp.createFolder('Mängelmeldungen FF Deutsch Haslau');
  try { o.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* Standard ist privat */ }
  p.setProperty('MG_ORDNER', o.getId());
  return o;
}
function mgLesen_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(MG_TAB); if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).map((z, i) => ({
    zeile: i + 2, id: String(z[0]), zeit: z[1] instanceof Date ? z[1].getTime() : 0, was: String(z[2]), text: String(z[3]), fahrbereit: String(z[4] || ''),
    von: String(z[5]), fotos: String(z[6] || '').split(';').filter(Boolean), vorschau: String(z[7] || '').split(';').filter(Boolean),
    status: String(z[8] || 'offen'), bearbeiter: String(z[9] || ''), bearbeitet: z[10] instanceof Date ? z[10].getTime() : 0, notiz: String(z[11] || '')
  })).filter((m) => m.id);
}
const mgSp_ = (k) => MG_KOPF.indexOf(k) + 1;

// Melden (ohne PIN): { name, was, text, fahrbereit, fotos: [{ voll: base64, klein: base64 }] }
function mangelMelden(d) {
  d = d || {};
  let m = null;
  try { m = mitglieder_(anwSS_()).find((x) => anwNorm_(x.name) === anwNorm_(d.name)); } catch (e) { /* Mitgliederliste fehlt */ }
  if (!m) return { ok: false, fehler: 'Bitte zuerst deinen Namen aus der Mitgliederliste wählen.' };
  const was = FAHRZEUGE.find((f) => gleich_(f, d.was)) || (d.was === MG_HAUS ? MG_HAUS : '');
  if (!was) return { ok: false, fehler: 'Bitte auswählen, was betroffen ist.' };
  const text = String(d.text || '').replace(/^[\s=+\-@]+/, '').trim().slice(0, 500);   // keine Formeln in der Tabelle
  if (text.length < 3) return { ok: false, fehler: 'Bitte kurz beschreiben, was kaputt ist.' };
  const fb = was === MG_HAUS ? '' : (MG_FAHRBEREIT.indexOf(d.fahrbereit) !== -1 ? d.fahrbereit : 'Weiß nicht');
  const fotos = (Array.isArray(d.fotos) ? d.fotos : []).slice(0, 3);
  // Fotos zuerst vollständig prüfen (echtes JPEG, Größe), erst dann irgendetwas speichern
  const jpeg = (s, max) => { if (typeof s !== 'string' || s.length < 400 || s.length > max) return null; try { const b = Utilities.base64Decode(s); return b.length > 300 && (b[0] & 255) === 0xFF && (b[1] & 255) === 0xD8 ? b : null; } catch (e) { return null; } };
  const bytes = fotos.map((f) => f && [jpeg(f.voll, MG_MAX_FOTO), jpeg(f.klein, 200000)]);
  if (bytes.some((x) => !x || !x[0] || !x[1])) return { ok: false, fehler: 'Ein Foto ist zu groß oder beschädigt. Bitte ohne dieses Foto noch einmal.' };
  // Begrenzung gegen Spam: je Name 10 und insgesamt 30 Meldungen pro Stunde
  const cache = CacheService.getScriptCache(), ck = 'mg-' + anwNorm_(m.name).replace(/\W/g, '');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (+(cache.get(ck) || 0) >= 10 || +(cache.get('mg-alle') || 0) >= 30) return { ok: false, fehler: 'Zu viele Meldungen in kurzer Zeit. Bitte später noch einmal oder direkt beim Kommando melden.' };
    cache.put(ck, String(+(cache.get(ck) || 0) + 1), 3600); cache.put('mg-alle', String(+(cache.get('mg-alle') || 0) + 1), 3600);
  } finally { lock.releaseLock(); }
  const id = 'M' + Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 5);
  const voll = [], klein = [], blobs = [];
  if (bytes.length) {
    const o = mgOrdner_();
    bytes.forEach(([vb, kb], i) => {
      const b = Utilities.newBlob(vb, 'image/jpeg', id + '-' + (i + 1) + '.jpg');
      voll.push(o.createFile(b).getId()); klein.push(o.createFile(Utilities.newBlob(kb, 'image/jpeg', id + '-' + (i + 1) + '-klein.jpg')).getId()); blobs.push(b);
    });
  }
  lock.waitLock(20000);
  try { mgBlatt_().appendRow([id, new Date(), was, text, fb, m.name, voll.join(';'), klein.join(';'), 'offen', '', '', '']); SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
  let info = '';
  try { info = mgMelden_({ id, was, text, fahrbereit: fb, von: m.name }, blobs); } catch (e) { console.error('Mangel-Benachrichtigung: ' + e.message); }
  return { ok: true, text: 'Danke, ' + m.name.split(' ')[0] + '! Die Meldung ist eingegangen' + info + '.' };
}

// Empfänger und Versand
function mgEmpfaenger_(was) {
  let leute = [];
  try { leute = personen_(); } catch (e) { /* Geräte-Tabelle fehlt */ }
  const zust = leute.filter((p) => p.alles || (was === MG_HAUS ? /ger(ä|ae)tewart|zeugmeister/i.test(p.funktion) : p.fahrmeister));
  const mails = Array.from(new Set(zust.map((p) => mitgliedMail_(p.name)).filter(Boolean)));
  return { namen: zust.map((p) => p.name), mails };
}
function mgMelden_(mg, blobs) {
  const e = mgEmpfaenger_(mg.was);
  const an = e.mails.length ? e.mails : [Session.getEffectiveUser().getEmail()].filter(Boolean);
  const titel = 'Mangel gemeldet: ' + mg.was;
  const zeilen = [mg.text, mg.fahrbereit ? 'Fahrbereit: ' + mg.fahrbereit : '', 'Gemeldet von ' + mg.von + ' am ' + Utilities.formatDate(new Date(), 'Europe/Vienna', 'dd.MM.yyyy HH:mm')].filter(Boolean);
  mgPush_(titel, mg.text + (mg.fahrbereit === 'Nein' ? ' · NICHT fahrbereit' : '') + ' · ' + mg.von);
  let gesendet = false;
  if (an.length) try {
    const inline = {};
    blobs.forEach((b, i) => { inline['foto' + i] = b; });
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    MailApp.sendEmail({
      to: an.join(','), subject: titel, name: 'FF Deutsch Haslau – Mängel',
      body: zeilen.join('\n') + '\n\nIn der App unter Verwaltung › Mängel bestätigen oder als behoben markieren.',
      htmlBody: '<p style="font:16px/1.4 sans-serif"><b>' + esc(mg.was) + '</b><br>' + zeilen.map(esc).join('<br>') + '</p>' +
        blobs.map((b, i) => '<p><img src="cid:foto' + i + '" style="max-width:100%;border-radius:8px"></p>').join('') +
        '<p style="font:14px sans-serif;color:#555">In der App unter Verwaltung › Mängel bestätigen oder als behoben markieren.</p>',
      inlineImages: inline
    });
    gesendet = true;
  } catch (x) { console.error('Mangel-Mail: ' + x.message); }
  const mitMail = e.namen.filter((n) => mitgliedMail_(n));
  return gesendet ? (mitMail.length ? ' und ist an ' + mitMail.map((n) => n.split(' ')[0]).join(', ') + ' gegangen' : ' und ist ans Kommando gegangen') : '';
}
// Push über den ntfy-Kanal (Skripteigenschaft NTFY_TOPIC) – auch für Feedback genutzt.
// opt.tags = ntfy-Symbol (Standard warning), opt.seite = App-Seite beim Antippen (Standard maengel, '' = kein Link)
function mgPush_(titel, text, opt) {
  opt = opt || {};
  try {   // ein fehlgeschlagener Push darf Meldung/Feedback nie kaputt machen
    const props = PropertiesService.getScriptProperties();
    const topic = (props.getProperty('NTFY_TOPIC') || '').trim(); if (!topic) return;
    const token = (props.getProperty('NTFY_TOKEN') || '').trim();
    const seite = opt.seite === undefined ? 'maengel' : opt.seite;
    const id = (/\/s\/([^/]+)\//.exec(ScriptApp.getService().getUrl() || '') || [])[1];
    const klick = id && seite ? 'https://schoenzl.github.io/feuerwehr-dh/ff.html?seite=' + seite + '#' + id : '';
    UrlFetchApp.fetch('https://ntfy.sh/' + encodeURIComponent(topic) + '?title=' + encodeURIComponent(titel) + '&tags=' + (opt.tags || 'warning') + (klick ? '&click=' + encodeURIComponent(klick) : ''), {
      method: 'post', contentType: 'text/plain; charset=utf-8', payload: text, muteHttpExceptions: true, headers: token ? { Authorization: 'Bearer ' + token } : {} });
  } catch (e) { console.log('ntfy: ' + e.message); }
}

// ---------- Verwaltung ----------
const mgSicht_ = (m, mitBild) => {
  const o = { id: m.id, zeit: m.zeit, was: m.was, text: m.text, fahrbereit: m.fahrbereit, von: m.von, status: m.status, bearbeiter: m.bearbeiter, bearbeitet: m.bearbeitet, notiz: m.notiz, fotos: m.fotos, bilder: [] };
  if (mitBild) m.vorschau.forEach((fid) => { try { o.bilder.push(Utilities.base64Encode(DriveApp.getFileById(fid).getBlob().getBytes())); } catch (e) { o.bilder.push(''); } });
  return o;
};
function mangelListe(pin) {
  const r = rolle_(pin); if (!r) return { ok: false, fehler: 'PIN falsch.' };
  const alle = mgLesen_().sort((a, b) => b.zeit - a.zeit);
  return { ok: true, rolle: r.rolle,
    offen: alle.filter((m) => m.status !== 'behoben').slice(0, 40).map((m, i) => mgSicht_(m, i < 25)),
    behoben: alle.filter((m) => m.status === 'behoben').slice(0, 8).map((m) => mgSicht_(m, false)) };
}
function mangelAnzahl_() { try { return mgLesen_().filter((m) => m.status === 'offen').length; } catch (e) { return 0; } }

// Ein Foto groß (nur Fotos, die zu einer Meldung gehören)
function mangelFoto(pin, fid) {
  if (!rolle_(pin)) return { ok: false, fehler: 'PIN falsch.' };
  if (!mgLesen_().some((m) => m.fotos.indexOf(String(fid)) !== -1)) return { ok: false, fehler: 'Foto nicht gefunden.' };
  return { ok: true, bild: Utilities.base64Encode(DriveApp.getFileById(String(fid)).getBlob().getBytes()) };
}

// aktion: 'eingeschraenkt' | 'ausser' (nur Fahrzeug, Kommando/Fahrmeister) · 'behoben' (alle Verwaltungsrollen)
function mangelAktion(pin, id, aktion, notiz) {
  const r = rolle_(pin); if (!r) return { ok: false, fehler: 'PIN falsch.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const m = mgLesen_().find((x) => x.id === String(id));
    if (!m) return { ok: false, fehler: 'Meldung nicht gefunden.' };
    const sh = mgBlatt_(), wer = String(r.name).replace(/\s*\(.*\)$/, ''), fz = FAHRZEUGE.find((f) => gleich_(f, m.was));
    const n = String(notiz || '').trim().slice(0, 300);
    const markiere = (status) => { sh.getRange(m.zeile, mgSp_('Status'), 1, 4).setValues([[status, wer, new Date(), n || m.notiz]]); };
    if (m.status === 'behoben') return { ok: false, fehler: 'Diese Meldung ist schon behoben.' };
    if (fz && !fzDarf_(r)) return { ok: false, fehler: 'Fahrzeugmängel bearbeiten nur Fahrmeister und Kommando.' };
    const jetzt_ = () => { const t = fzTab_(), z = t.w.find((y, j) => j > 0 && gleich_(y[t.s.fz], fz)); return { bereit: z ? fzBereit_(z[t.s.bereit]) || 'Ja' : 'Ja', mangel: z ? String(z[t.s.mangel] || '').trim() : '' }; };
    if (aktion === 'eingeschraenkt' || aktion === 'ausser') {
      if (!fz) return { ok: false, fehler: 'Nur bei Fahrzeugen möglich.' };
      const ist = jetzt_();
      const neu = aktion === 'ausser' || ist.bereit === 'Nein' ? 'Nein' : 'Eingeschränkt';   // nie herabstufen
      const grund = ist.bereit !== 'Ja' && ist.mangel && ist.mangel.indexOf(m.text) === -1 ? ist.mangel + ' · ' + m.text : (ist.bereit !== 'Ja' && ist.mangel ? ist.mangel : m.text);
      fzSetzen_(fz, neu, grund.slice(0, 300), wer);
      markiere('bestätigt');
      return { ok: true, text: fz + ' ist jetzt ' + (neu === 'Nein' ? 'außer Dienst' : 'eingeschränkt einsatzbereit') + '. Der Infoscreen zeigt es gleich.' };
    }
    if (aktion === 'behoben') {
      const warBestaetigt = m.status === 'bestätigt';
      markiere('behoben');
      let frei = '';
      if (fz && warBestaetigt) {
        const ist = jetzt_();
        if (ist.bereit !== 'Ja' && ist.mangel.indexOf(m.text) !== -1) {
          const rest = ist.mangel.split(' · ').filter((x) => x && x !== m.text);
          let sperre = false;
          try { sperre = sperren_().some((x) => x.aktiv && x.ablauf === 'läuft' && gleich_(x.fahrzeug, fz)); } catch (e) { /* keine Sperren */ }
          if (rest.length || sperre) fzSetzen_(fz, ist.bereit, (rest.join(' · ') || ist.mangel).slice(0, 300), wer);
          else { fzSetzen_(fz, 'Ja', '', wer); frei = ' ' + fz + ' ist wieder einsatzbereit.'; }
        }
      }
      return { ok: true, text: 'Als behoben markiert.' + frei };
    }
    return { ok: false, fehler: 'Unbekannte Aktion.' };
  } finally { lock.releaseLock(); }
}

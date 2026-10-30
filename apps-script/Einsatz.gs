/**
 * Einsatzunterstützung – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt. Reiter „Einsatz“ in der Web-App, für alle ohne PIN.
 *
 * Die Dokumente liegen in einem Google-Drive-Ordner „Einsatzunterstützung FF Deutsch Haslau“.
 * Jeder Unterordner ist eine Rubrik in der App, Dateien direkt im Hauptordner erscheinen unter „Allgemein“.
 * Nummern vorne im Ordnernamen („01 Gefahrstoffe“) bestimmen nur die Reihenfolge und werden nicht angezeigt.
 * Ordner und Dateien werden auf „Jeder mit dem Link – Betrachter“ gestellt, damit alle sie ohne Google-Konto öffnen können.
 *
 * Einrichten: einmal ▶ einsatzEinrichten ausführen, dann Dokumente in die Unterordner ziehen.
 */
const EIN_RUBRIKEN = ['01 Gefahrstoffe & Gefahrgut', '02 Objekte & Einsatzpläne', '03 Wasserversorgung',
  '04 Checklisten & Merkblätter', '05 Alarmpläne & Kontakte', '06 Fahrzeuge & Rettungskarten'];
const EIN_CACHE_S = 600;

function einsatzEinrichten() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('EIN_ID')) { console.log('Schon eingerichtet: ' + DriveApp.getFolderById(props.getProperty('EIN_ID')).getUrl()); return; }
  const o = DriveApp.createFolder('Einsatzunterstützung FF Deutsch Haslau');
  o.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  EIN_RUBRIKEN.forEach((n) => o.createFolder(n).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW));
  props.setProperty('EIN_ID', o.getId());
  console.log('Ordner angelegt: ' + o.getUrl());
  console.log('Dokumente in die Unterordner legen. Neue Unterordner sind erlaubt und erscheinen als eigene Rubrik.');
}

// Liste aller Dokumente (für alle, ohne PIN). neu = true umgeht den Zwischenspeicher.
function einsatzDokumente(neu) {
  const id = PropertiesService.getScriptProperties().getProperty('EIN_ID');
  if (!id) return { ok: false, fehler: 'Die Einsatzunterstützung ist noch nicht eingerichtet.' };
  const cache = CacheService.getScriptCache();
  if (!neu) { const c = cache.get('ein-liste'); if (c) return JSON.parse(c); }
  const haupt = DriveApp.getFolderById(id);
  const rubriken = [];
  const dateien = (ordner) => {
    const out = [], it = ordner.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed()) continue;
      try { if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* fremde Datei */ }
      out.push({ name: f.getName().replace(/\.[a-z0-9]{2,5}$/i, ''), typ: einTyp_(f.getMimeType(), f.getName()), url: f.getUrl(),
        groesse: f.getSize(), datum: Utilities.formatDate(f.getLastUpdated(), 'Europe/Vienna', 'dd.MM.yyyy') });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  };
  const lose = dateien(haupt);
  const it = haupt.getFolders(), ordner = [];
  while (it.hasNext()) ordner.push(it.next());
  ordner.sort((a, b) => a.getName().localeCompare(b.getName(), 'de', { numeric: true })).forEach((o) => {
    if (o.isTrashed()) return;
    rubriken.push({ name: o.getName().replace(/^\s*\d+[\s._-]*/, ''), dateien: dateien(o) });
  });
  if (lose.length) rubriken.unshift({ name: 'Allgemein', dateien: lose });
  const r = { ok: true, rubriken, stand: Utilities.formatDate(new Date(), 'Europe/Vienna', 'dd.MM. HH:mm') };
  try { cache.put('ein-liste', JSON.stringify(r), EIN_CACHE_S); } catch (e) { /* zu groß für den Zwischenspeicher */ }
  return r;
}

function einTyp_(mime, name) {
  if (/pdf/.test(mime)) return 'PDF';
  if (/^image\//.test(mime)) return 'Bild';
  if (/document|word/.test(mime)) return 'Text';
  if (/spreadsheet|excel/.test(mime)) return 'Tabelle';
  if (/presentation|powerpoint/.test(mime)) return 'Folien';
  if (/^video\//.test(mime)) return 'Video';
  const e = String(name).match(/\.([a-z0-9]{2,5})$/i);
  return e ? e[1].toUpperCase() : 'Datei';
}

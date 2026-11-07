/**
 * Push-Warteschlange – FF Deutsch Haslau. Eigene Datei im selben Apps-Script-Projekt.
 *
 * Warum: ntfy.sh lehnt Nachrichten direkt aus Apps Script ab (Googles Server teilen sich ihre Adressen,
 * das Tageskontingent ist laufend erschöpft → Antwort 429, auch mit Token eines Gratis-Kontos).
 * Darum stellt die Web-App Meldungen (Einchecken, Mängel, Feedback) nur in den Tab „Push“ der Anwesenheitstabelle.
 * Der Pi mit einsatzUrl + einsatzKey + kommandoPushTopic holt sie jede Minute ab (doPost aktion „pushAbholen“,
 * Schlüssel = EINSATZ_KEY wie bei der Nachbereitung) und schickt sie über eure eigene Leitung in den Kommando-Kanal.
 * Der Kanalname steht damit nur mehr am Pi (config.secret.js), NTFY_TOPIC / NTFY_TOKEN werden nicht mehr gebraucht.
 */
const PUSH_TAB = 'Push';
const PUSH_KOPF = ['Zeitstempel', 'Titel', 'Text', 'Tags', 'Link', 'Abgeholt'];
const PUSH_VERFALL_MIN = 120;   // was der Pi so lange nicht abgeholt hat (Pi aus), wird nicht mehr geschickt
const PUSH_AUFHEBEN_TAGE = 7;

function pushTab_(ss) {
  let sh = ss.getSheetByName(PUSH_TAB);
  if (!sh) {
    sh = ss.insertSheet(PUSH_TAB);
    sh.getRange(1, 1, 1, PUSH_KOPF.length).setValues([PUSH_KOPF]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd.MM.yyyy HH:mm:ss');
    sh.getRange('B:F').setNumberFormat('@');   // Text bleibt Text (kein „=…“ als Formel)
  }
  return sh;
}

// In die Warteschlange stellen. Darf nie das Einchecken, eine Meldung oder Feedback kaputt machen.
function pushStellen_(titel, text, tags, link) {
  try {
    pushTab_(anwSS_()).appendRow([new Date(), String(titel || '').slice(0, 200), String(text || '').slice(0, 1000), String(tags || ''), String(link || ''), '']);
    return true;
  } catch (e) { console.log('Push-Warteschlange: ' + e.message); return false; }
}

// Pi holt ab: { aktion: 'pushAbholen', key }
function pushAbholen_(d) {
  const soll = (PropertiesService.getScriptProperties().getProperty('EINSATZ_KEY') || '').trim();
  if (!soll || soll.length < 20 || String((d || {}).key || '') !== soll) { Utilities.sleep(1000); return { ok: false, fehler: 'Schlüssel falsch oder EINSATZ_KEY nicht eingerichtet.' }; }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = pushTab_(anwSS_()), jetzt = Date.now();
    // Alte Zeilen oben wegräumen (Zeilen stehen in zeitlicher Reihenfolge)
    let n = sh.getLastRow() - 1;
    if (n > 0) {
      const zeiten = sh.getRange(2, 1, n, 1).getValues();
      let weg = 0;
      while (weg < n && zeiten[weg][0] instanceof Date && jetzt - zeiten[weg][0].getTime() > PUSH_AUFHEBEN_TAGE * 864e5) weg++;
      if (weg) sh.deleteRows(2, weg);
    }
    n = sh.getLastRow() - 1;
    if (n < 1) return { ok: true, push: [] };
    const zeilen = sh.getRange(2, 1, n, PUSH_KOPF.length).getValues();
    const push = [], marken = [];
    const stempel = Utilities.formatDate(new Date(), 'Europe/Vienna', 'dd.MM.yyyy HH:mm:ss');
    zeilen.forEach((z, i) => {
      if (z[5]) { marken.push([z[5]]); return; }
      const t = z[0] instanceof Date ? z[0].getTime() : 0;
      if (!t || jetzt - t > PUSH_VERFALL_MIN * 60000) { marken.push(['verfallen']); return; }
      push.push({ id: t + '-' + (i + 2) + '-' + String(z[1]).length, titel: z[1], text: z[2], tags: z[3], link: z[4] });
      marken.push([stempel]);
    });
    sh.getRange(2, 6, n, 1).setValues(marken);
    return { ok: true, push };
  } finally { lock.releaseLock(); }
}

// Klick-Link in die App (Seite, z. B. 'da' oder 'maengel'); '' = kein Link
function pushLink_(seite) {
  if (!seite) return '';
  try {
    const id = (/\/s\/([^/]+)\//.exec(ScriptApp.getService().getUrl() || '') || [])[1];
    return id ? 'https://schoenzl.github.io/feuerwehr-dh/ff.html?seite=' + seite + '#' + id : '';
  } catch (e) { return ''; }
}

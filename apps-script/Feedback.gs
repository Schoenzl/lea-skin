/**
 * Feedback zur App – FF Deutsch Haslau.
 * Eigene Datei im selben Apps-Script-Projekt. Für alle ohne PIN: Startseite › „Feedback zur App“.
 * Art (Idee, Problem, Lob), Text, auf Wunsch ohne Namen. Landet im Tab „Feedback“ der Anwesenheitstabelle
 * und kommt per Mail an alle mit Rolle „Alles“ (Spalte E-Mail im Tab „Mitglieder“), sonst ans Konto der Web-App,
 * dazu Push über den ntfy-Kanal (NTFY_TOPIC, siehe Maengel.gs), falls eingerichtet.
 */
const FB_TAB = 'Feedback';
const FB_KOPF = ['Zeitstempel', 'Art', 'Text', 'Von', 'Seite', 'Erledigt'];
const FB_ARTEN = ['Idee', 'Problem', 'Lob'];

function fbTab_(ss) {
  let sh = ss.getSheetByName(FB_TAB);
  if (!sh) {
    sh = ss.insertSheet(FB_TAB);
    sh.getRange(1, 1, 1, FB_KOPF.length).setValues([FB_KOPF]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd.MM.yyyy HH:mm');
    sh.getRange('B:E').setNumberFormat('@');
    sh.getRange('C:C').setWrap(true);
  }
  return sh;
}

// d = { name, art, text, anonym, seite }
function feedbackSenden(d) {
  d = d || {};
  const art = FB_ARTEN.indexOf(String(d.art)) !== -1 ? String(d.art) : 'Idee';
  const text = nbText_(d.text, 1500);
  if (text.length < 3) return { ok: false, fehler: 'Bitte kurz schreiben, worum es geht.' };
  const ss = anwSS_();
  const m = mitglieder_(ss).find((x) => anwNorm_(x.name) === anwNorm_(d.name));
  if (!m) return { ok: false, fehler: 'Bitte zuerst deinen Namen wählen.' };
  const von = d.anonym ? 'ohne Namen' : m.name;
  // gegen Spam: je Person 5, insgesamt 20 pro Stunde (gezählt wird immer über den Namen, auch ohne Namen)
  const cache = CacheService.getScriptCache(), ck = 'fb-' + anwNorm_(m.name).replace(/\W/g, '');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (+(cache.get(ck) || 0) >= 5 || +(cache.get('fb-alle') || 0) >= 20) return { ok: false, fehler: 'Gerade sehr viel Feedback – bitte später noch einmal.' };
    cache.put(ck, String(+(cache.get(ck) || 0) + 1), 3600); cache.put('fb-alle', String(+(cache.get('fb-alle') || 0) + 1), 3600);
    fbTab_(ss).appendRow([new Date(), art, text, von, nbText_(d.seite, 30), '']);
  } finally { lock.releaseLock(); }
  try {
    let leute = [];
    try { leute = personen_(); } catch (e) { /* Geräte-Tabelle fehlt */ }
    const an = Array.from(new Set(leute.filter((p) => p.alles).map((p) => mitgliedMail_(p.name)).filter(Boolean)));
    if (!an.length) an.push(Session.getEffectiveUser().getEmail());
    MailApp.sendEmail({ to: an.join(','), name: 'FF Deutsch Haslau – App-Feedback', subject: 'App-Feedback (' + art + ')' + (d.anonym ? ' – ohne Namen' : ' von ' + von),
      body: text + '\n\n— ' + von + ', ' + Utilities.formatDate(new Date(), 'Europe/Vienna', 'dd.MM.yyyy HH:mm') + '\n\nAlles gesammelt im Tab „Feedback“ der Anwesenheitstabelle.' });
  } catch (e) { console.error('Feedback-Mail: ' + e.message); }   // gespeichert ist es trotzdem
  mgPush_('Feedback (' + art + ') · ' + von, text.length > 300 ? text.slice(0, 300) + ' …' : text,
    { tags: art === 'Problem' ? 'exclamation' : art === 'Lob' ? 'thumbsup' : 'bulb', seite: '' });
  return { ok: true, text: d.anonym ? 'Danke! Dein Feedback ist ohne Namen angekommen.' : 'Danke, ' + m.name.split(' ')[0] + '! Dein Feedback ist angekommen.' };
}

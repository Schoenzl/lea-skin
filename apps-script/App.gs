/**
 * Neue Handy-App FF Deutsch Haslau (Startseite mit Kacheln) – gebündelte Daten für die Oberfläche.
 * Eigene Datei im selben Apps-Script-Projekt. Nutzt die Funktionen aus Code.gs, Anwesenheit.gs und Pruefung.gs.
 *
 * Für alle ohne PIN: appDaten(name) – Fahrzeuge mit Status, Fahrten, Sperren; Mitgliederliste; Termine von heute.
 * Verwaltung: verwaltungAnmelden(name, pin) – prüft den PIN zum gewählten Namen (Tab „Prüfer“) und liefert Rolle und Anmeldung.
 */
const FZ_ART = { 'KLF-W': 'Kleinlöschfahrzeug-Wasser', MTF: 'Mannschaftstransportfahrzeug', VFA: '' };

function appDaten(name) {
  const jetzt = Date.now(), alle = buchungen_();
  let zst = {};
  try { zst = zustand_(); } catch (e) { /* Tab „Fahrzeuge“ fehlt */ }
  let sp = [];
  try { sp = sperren_().filter((x) => x.aktiv && x.ablauf !== 'beendet' && (!x.bis || x.bis > jetzt)); } catch (e) { /* keine Sperren */ }
  const kurz = (b) => b && { zeile: b.zeile, name: b.name, zweck: b.zweck, von: b.von, bis: b.bis, bewegung: /^Bewegungsfahrt/.test(b.zweck), laeuft: BF_LAEUFT.test(b.zweck) };
  const fahrzeuge = FAHRZEUGE.map((fz) => {
    const eigene = alle.filter((b) => gleich_(b.fahrzeug, fz)).sort((a, b) => a.von - b.von);
    const k = Object.keys(zst).find((x) => gleich_(x, fz)), z = k ? zst[k] : {};
    return {
      id: fz, art: FZ_ART[fz] || '',
      bereit: fzBereit_(z.bereit) || (!z.bereit || /^ja/i.test(z.bereit) ? 'Ja' : /^nein/i.test(z.bereit) ? 'Nein' : 'Eingeschränkt'), mangel: z.mangel || '', pickerl: z.pickerl || '',
      unterwegs: kurz(eigene.find((b) => b.von <= jetzt && jetzt < b.bis)) || null,
      // Bewegungsfahrt, die nach der Höchstdauer als „nicht eingerückt“ markiert wurde – der Fahrer kann noch einrücken
      offen: kurz(eigene.filter((b) => BF_OFFEN.test(b.zweck) && jetzt - b.von < 36 * 3600e3).pop()) || null,
      fahrten: eigene.filter((b) => b.bis > jetzt && b.von < jetzt + 30 * 864e5).map(kurz),
      sperren: sp.filter((x) => gleich_(x.fahrzeug, fz)).map((x) => ({ von: x.von, bis: x.bis, status: x.status, grund: x.grund, laeuft: x.von <= jetzt }))
    };
  });
  let mitglieder = [], da = null;
  try {
    const ss = anwSS_();
    mitglieder = mitglieder_(ss).map((m) => m.name).sort((a, b) => a.localeCompare(b, 'de'));
    if (name) da = daHeute_(ss, name);
  } catch (e) { da = { fehler: e.message, termine: [], arten: ANW_ARTEN.map((a) => a[0]) }; }
  return { ok: true, jetzt, fahrzeuge, mitglieder, da };
}

// Kalendertermine von heute (ganzer Tag) plus alles, was gerade läuft oder gleich beginnt
function kalenderHeute_(ss) {
  let kal = null;
  try { kal = CalendarApp.getCalendarById(KALENDER_ID); } catch (e) { kal = null; }
  if (!kal) return [];
  const jetzt = Date.now(), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const a = t0.getTime(), b = a + 864e5;
  return kal.getEvents(new Date(Math.min(a, jetzt - 18 * 3600e3)), new Date(Math.max(b, jetzt + 6 * 3600e3))).map((ev) => {
    const von = ev.getStartTime().getTime();
    let bis = ev.getEndTime().getTime();
    if (ev.isAllDayEvent()) bis = Math.min(bis, von + 864e5);
    return { ev, von, bis, ganz: ev.isAllDayEvent() };
  }).filter((x) => (x.von < b && x.bis > a) || (x.von - ANW_VORLAUF_MIN * 60e3 <= jetzt && jetzt <= x.bis + ANW_NACHLAUF_MIN * 60e3)).map((x) => {
    const titel = x.ev.getTitle(), z = zuordnen_(ss, titel);
    const tag = Utilities.formatDate(new Date(x.von), 'Europe/Vienna', 'yyyyMMdd');
    return { id: 'k:' + x.ev.getId().split('@')[0] + ':' + tag, titel, von: x.von, bis: x.bis, ganz: x.ganz, art: z.art, unterart: z.unterart };
  });
}

// „Ich bin da“: alle Termine von heute, ob ich irgendwo eingetragen bin, wer noch da ist
function daHeute_(ss, name) {
  const jetzt = Date.now(), n = anwNorm_(name);
  const T = anwLesen_(ss, 'Termine').zeilen, A = anwLesen_(ss, 'Anwesenheit').zeilen;
  const liste = kalenderHeute_(ss).filter((k) => !T.some((t) => t.ID === k.id && t.Status !== 'offen'))
    .map((k) => ({ id: k.id, titel: k.titel, von: k.von, bis: k.bis, ganz: k.ganz, kalender: true }));
  T.filter((t) => t.Status === 'offen' && jetzt - anwZeit_(t.Beginn) < 16 * 3600e3 && !anwVorbei_(t, jetzt)).forEach((t) => {
    if (!liste.some((l) => l.id === t.ID)) liste.push({ id: t.ID, titel: t.Titel, von: anwZeit_(t.Beginn), bis: anwZeit_(t.Ende), kalender: false });
  });
  liste.forEach((l) => {
    const p = A.filter((a) => a['Termin-ID'] === l.id && !anwZeit_(a.Gegangen));
    l.anzahl = p.length;
    const ich = p.find((a) => anwNorm_(a.Name) === n);
    l.ich = !!ich; l.seit = ich ? anwZeit_(ich.Zeitstempel) : 0;
    l.auch = p.filter((a) => anwNorm_(a.Name) !== n).map((a) => String(a.Name));
    l.laeuft = l.von <= jetzt && (!l.bis || jetzt <= l.bis);
  });
  liste.sort((a, b) => a.von - b.von);
  const mein = liste.filter((l) => l.ich).sort((a, b) => b.seit - a.seit)[0] || null;
  return { termine: liste, mein, arten: ANW_ARTEN.map((a) => a[0]) };
}

// Namen vergleichen, egal in welcher Reihenfolge und Schreibweise („Huber Anna“ = „anna huber“, Akzente egal)
const nameGleich_ = (a, b) => { const t = (s) => anwNorm_(s).split(/[\s,]+/).filter(Boolean).sort().join(' '); return !!t(a) && t(a) === t(b); };

// E-Mail eines Mitglieds aus dem Tab „Mitglieder“ (optionale Spalte „E-Mail“) – für Nachrichten zur Buchung
function mitgliedMail_(name) {
  try {
    const sh = anwSS_().getSheetByName('Mitglieder'); if (!sh) return '';
    const w = sh.getDataRange().getValues(), k = w[0].map((x) => String(x).trim().toLowerCase());
    const cN = k.indexOf('name'), cM = k.findIndex((x) => x.replace(/[\s-]/g, '') === 'email');
    if (cN < 0 || cM < 0) return '';
    const z = w.slice(1).find((r) => nameGleich_(r[cN], name));
    const m = z ? String(z[cM] || '').trim().toLowerCase() : '';
    return MAIL_.test(m) ? m : '';
  } catch (e) { return ''; }
}

// Verwaltung: PIN zum gewählten Mitglied prüfen. Liefert die Anmeldung („Name|PIN“), die das Handy 30 Tage speichert.
function verwaltungAnmelden(name, pin) {
  let leute = [];
  try { leute = personen_(); } catch (e) { /* Geräte-Tabelle noch nicht eingerichtet */ }
  const p = leute.find((x) => nameGleich_(x.name, name));
  // Genau ein Versuch (jeder Fehlversuch zählt für die Sperre): eigener PIN, sonst – solange es ihn noch gibt – der gemeinsame Kommando-PIN
  const versuch = p && p.pin.length >= 4 ? p.name + '|' + String(pin || '') : kommandoGemeinsam_(leute) ? 'Kommando|' + String(pin || '') : '';
  if (!versuch) return { ok: false, fehler: 'Für ' + name + ' ist keine Verwaltung eingerichtet. Bitte beim Kommando melden.' };
  const r = rolle_(versuch);
  return r ? { ok: true, pin: versuch, rolle: r.rolle, name: r.name, funktion: p ? p.funktion : '' } : { ok: false, fehler: 'PIN falsch.' };
}

// Gespeicherte Anmeldung beim Öffnen prüfen (PIN geändert oder Person deaktiviert → abgemeldet).
// Fehlversuche zählen wie beim Anmelden (gemeinsame Sperre), damit niemand PINs durchprobieren kann.
// Kann die Tabelle gerade nicht gelesen werden, wird ein Fehler geworfen – dann bleibt man angemeldet.
function verwaltungPruefen(pin) {
  const s = String(pin == null ? '' : pin), i = s.indexOf('|');
  const wer = i >= 0 ? s.slice(0, i).trim() : '', p = pinNorm_(i >= 0 ? s.slice(i + 1) : '');
  fehlPruefen_(wer);
  const leute = personen_();
  let r = null;
  if (wer === 'Kommando') {
    const soll = pinNorm_(PropertiesService.getScriptProperties().getProperty('STATUS_PIN'));
    if (soll && soll.length >= 4 && p === soll && kommandoGemeinsam_(leute)) r = { ok: true, rolle: 'kommando', name: 'Kommando', funktion: '' };
  } else if (wer) {
    const t = leute.find((x) => x.name === wer && x.pin.length >= 4 && x.pin === p);
    if (t) r = { ok: true, rolle: t.alles ? 'kommando' : t.fahrmeister ? 'fahrmeister' : 'pruefer', name: t.name, funktion: t.funktion };
  }
  if (r) return r;
  fehlZaehlen_(wer);
  return { ok: false };
}

// Zahlen für die Verwaltungskacheln
function verwaltungZahlen(pin) {
  const r = verwaltungPruefen(pin); if (!r.ok) return { ok: false, fehler: 'Bitte neu anmelden.' };
  const out = { ok: true, rolle: r.rolle, funktion: r.funktion || '', maengel: mangelAnzahl_() };
  try { const g = pruefUebersicht(pin); if (g.ok && g.gesamt) out.geraete = g.gesamt; } catch (e) { /* Geräte nicht eingerichtet */ }
  if (r.rolle === 'kommando') {
    try { const a = anwUebersicht(pin); if (a.ok) out.anwOffen = (a.termine || []).filter((t) => t.status === 'offen').length; } catch (e) { /* Anwesenheit nicht eingerichtet */ }
    out.einsaetze = einsatzAnzahl_();
  }
  if (r.rolle === 'kommando' || FR_ATS_FUNKTION.test(r.funktion || '')) {
    try { out.fristen = fristenZahl_(r.rolle !== 'kommando'); } catch (e) { /* ATS-Tabelle nicht lesbar */ }
  }
  return out;
}

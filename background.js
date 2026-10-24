// Hintergrund-Dienst: holt Wetter, WASTL-Bezirkslage und Termine für den Ruhebildschirm.
// Läuft getrennt von der LEA-Seite und hat keinen Zugriff auf LEA-Daten oder den Token.
importScripts('config.js');
const C = globalThis.LEASKIN_CONFIG || {};

const getJson = async (url, ms) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 60000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
};

const wetter = async () => {
  if (!C.ort) return null;
  const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + C.ort.lat + '&longitude=' + C.ort.lon +
    '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&wind_speed_unit=kmh&timezone=Europe%2FVienna';
  const d = await getJson(u, 20000);
  const c = d.current || {};
  return { temp: c.temperature_2m, code: c.weather_code, wind: c.wind_speed_10m, dir: c.wind_direction_10m, boeen: c.wind_gusts_10m, at: Date.now() };
};

// WASTL: öffentliche Listen auf feuerwehr-krems.at (Zeichensatz windows-1252, einfache Tabellen)
const WASTL = 'https://www.feuerwehr-krems.at/codepages/wastl/wastlmain/';
const getHtml = async (url) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new TextDecoder('windows-1252').decode(await r.arrayBuffer());
  } finally { clearTimeout(t); }
};
const ENT = { auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', nbsp: ' ', lt: '<', gt: '>', quot: '"' };
const cellText = (c) => c.replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENT ? ENT[n] : m))
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tableRows = (html) => (html.match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) || [])
  .map((tr) => (tr.match(/<t[dh]\b(?:(?!<t[dh]\b)[\s\S])*?<\/t[dh]>/gi) || []).map(cellText).filter(Boolean))
  .filter((r) => r.length);
const splitMeldung = (m) => { const x = /^([A-Z]\d)\s+(.*)$/.exec(m || ''); return x ? { stufe: x[1], text: x[2] } : { stufe: '', text: m || '' }; };

const wastl = async () => {
  const bz = C.wastlBezirk;
  if (!bz) return null;
  const [akt, ff, hist] = await Promise.all([
    getHtml(WASTL + 'Land_EinsatzAktuell.asp?bezirk=' + bz),
    getHtml(WASTL + 'Land_FFimEinsatz.asp?bezirk=' + bz),
    getHtml(WASTL + 'Land_EinsatzHistorie.asp?bezirk=' + bz)
  ]);
  const laufend = tableRows(akt).filter((r) => r.length >= 4).map((r) => {
    const [baz, ort, meldung, zeit] = r.slice(-4);
    return Object.assign({ baz, ort, zeit }, splitMeldung(meldung));
  });
  const feuerwehren = tableRows(ff).filter((r) => r.length >= 3 && /^\d{6}\s/.test(r[0])).map((r) => {
    const [name, meldung, zeit] = r.slice(-3);
    return Object.assign({ code: name.slice(0, 6), name: name.slice(7), zeit }, splitMeldung(meldung));
  });
  const rueckblick = tableRows(hist).filter((r) => r.length >= 4 && /\d{2}\.\d{2}\.\d{4}/.test(r[r.length - 1])).slice(0, 5).map((r) => {
    const [baz, ort, meldung, zeit] = r.slice(-4);
    return Object.assign({ baz, ort, zeit }, splitMeldung(meldung));
  });
  return { laufend, feuerwehren, rueckblick, at: Date.now() };
};

// Pegel: Hydrographischer Dienst NÖ, Messstellen-Liste mit Wasserstand + Prognose + Warnklasse
const pegel = async () => {
  if (!C.pegel || !C.pegel.station) return null;
  const d = await getJson('https://www.noe.gv.at/wasserstand/kidata/maplist/MapList.json', 30000);
  const rows = (Array.isArray(d) ? d : []).filter((x) => String(x.Stationnumber) === String(C.pegel.station));
  const get = (p) => rows.find((x) => x.Parameter === p) || null;
  const ws = get('Wasserstand'), pr = get('WasserstandPrognose'), q = get('Durchfluss');
  if (!ws) throw new Error('Messstelle nicht gefunden');
  return {
    wert: Number(ws.Value), einheit: ws.Unit, klasse: Number(ws.ClassID), farbe: ws.Class, zeit: ws.Timestamp,
    prognose: pr ? Number(pr.Value) : null, prognoseZeit: pr ? pr.Timestamp : null, prognoseKlasse: pr ? Number(pr.ClassID) : null,
    durchfluss: q ? Number(q.Value) : null, at: Date.now()
  };
};

// sehr einfacher iCal-Leser: nur DTSTART + SUMMARY künftiger Termine
const kalender = async () => {
  if (!C.kalenderIcsUrl) return [];
  const r = await fetch(C.kalenderIcsUrl, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = (await r.text()).replace(/\r?\n[ \t]/g, '');
  const out = [];
  txt.split('BEGIN:VEVENT').slice(1).forEach((blk) => {
    const ds = (blk.match(/\nDTSTART[^:\n]*:(\d{8})(T(\d{6})(Z)?)?/) || []);
    const sum = (blk.match(/\nSUMMARY[^:\n]*:([^\n]*)/) || [])[1];
    if (!ds[1] || !sum) return;
    const y = ds[1].slice(0, 4), mo = ds[1].slice(4, 6), da = ds[1].slice(6, 8);
    const hh = ds[3] ? ds[3].slice(0, 2) : '00', mi = ds[3] ? ds[3].slice(2, 4) : '00';
    const iso = y + '-' + mo + '-' + da + 'T' + hh + ':' + mi + ':00' + (ds[4] ? 'Z' : '');
    out.push({ start: iso, titel: sum.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ').trim(), ganztags: !ds[3] });
  });
  return out;
};

const refresh = async () => {
  const prev = (await chrome.storage.local.get('extra')).extra || {};
  const next = { ...prev, at: Date.now() };
  await Promise.all([
    wetter().then((v) => { next.wetter = v; }).catch(() => {}),
    wastl().then((v) => { next.wastl = v; }).catch(() => {}),
    pegel().then((v) => { next.pegel = v; }).catch(() => {}),
    kalender().then((v) => { next.kalender = v; next.kalenderAt = Date.now(); }).catch(() => {})
  ]);
  await chrome.storage.local.set({ extra: next });
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('leaskin-refresh', { periodInMinutes: C.aktualisierenMin || 5 });
  refresh();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('leaskin-refresh', { periodInMinutes: C.aktualisierenMin || 5 });
  refresh();
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'leaskin-refresh') refresh(); });
chrome.runtime.onMessage.addListener((m) => { if (m === 'leaskin-refresh') refresh(); });

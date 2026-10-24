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

const wastl = async () => {
  if (!C.wastlUrl) return null;
  const d = await getJson(C.wastlUrl, 70000); // Render-Gratisdienst braucht beim Aufwachen bis ~50 s
  return { liste: d.einsaetze_bl || [], stand: d.stand_bl || '', fehler: d.fehler_bl || null, at: Date.now() };
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

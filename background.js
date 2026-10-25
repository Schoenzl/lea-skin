// Hintergrund-Dienst: holt Wetter, WASTL-Bezirkslage und Termine für den Ruhebildschirm.
// Läuft getrennt von der LEA-Seite und hat keinen Zugriff auf LEA-Daten oder den Token.
// Fenster-Alias, damit auch config.local.js (window.LEASKIN_CONFIG...) hier lesbar ist
globalThis.window = globalThis;
importScripts('config.js');
try { importScripts('config.local.js'); } catch (e) { /* optional */ }
importScripts('lib/ical.min.js'); // Mozilla ical.js 1.5.0 (MPL-2.0) – Serientermine, Ausnahmen, Zeitzonen
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

// LSZ Burgenland: laufende Einsätze je Feuerwehr (nur Reiter „Laufend“, nur gewählter Bezirk)
const lsz = async () => {
  if (!C.lszUrl || !C.lszBezirk) return null;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 30000);
  const r = await fetch(C.lszUrl, { cache: 'no-store', signal: ctl.signal }).finally(() => clearTimeout(tm));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const html = await r.text();
  const a = html.indexOf('id="current-pane"');
  if (a < 0) throw new Error('Seitenaufbau unbekannt');
  const b = html.indexOf('id="twelve-hours-pane"', a);
  const laufend = html.slice(a, b > a ? b : undefined);
  const out = [];
  laufend.split('data-filter-district="').slice(1).forEach((blk) => {
    const bezirk = blk.slice(0, blk.indexOf('"'));
    if (bezirk !== C.lszBezirk) return;
    blk.split('class="row gx-3 mb-3 operation"').slice(1).forEach((op) => {
      const txt = (re) => { const m = re.exec(op); return m ? cellText(m[1]) : ''; };
      const code = txt(/class="avatar[^"]*"[^>]*>([^<]*)</);
      const name = txt(/<div class="col">\s*<div>([^<]*)<\/div>/).replace(/^FW\s+/, '');
      const ort = txt(/fa-location-dot[^>]*><\/i>([^<]*)</);
      const alarm = txt(/fa-alarm-clock[^>]*><\/i>([^<]*)</);
      const dauer = txt(/fa-clock-rotate-left[^>]*><\/i>([^<]*)</);
      if (!name) return;
      const st = /^([A-Z]\d)/.exec(code);
      out.push({ name, code, stufe: st ? st[1] : code.slice(0, 3), text: code + (ort && ort !== name ? ' · ' + ort : ''), alarm, dauer, bezirk: 'ND' });
    });
  });
  return { feuerwehren: out, at: Date.now() };
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

// Kalender (iCal): Serien, Ausnahmen und Zeitzonen über ical.js auflösen, künftige Termine der nächsten Wochen
const kalender = async () => {
  if (!C.kalenderIcsUrl) return [];
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 30000);
  const r = await fetch(C.kalenderIcsUrl, { cache: 'no-store', signal: ctl.signal }).finally(() => clearTimeout(tm));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const comp = new ICAL.Component(ICAL.parse(await r.text()));
  comp.getAllSubcomponents('vtimezone').forEach((tz) => { try { ICAL.TimezoneService.register(tz); } catch (e) {} });
  const now = Date.now(), von = now - 2 * 3600000, bis = now + (C.kalenderTage || 60) * 86400000;
  const all = comp.getAllSubcomponents('vevent');
  const ausnahmen = {};
  all.filter((v) => v.hasProperty('recurrence-id')).forEach((v) => { const uid = v.getFirstPropertyValue('uid'); (ausnahmen[uid] = ausnahmen[uid] || []).push(v); });
  const out = [];
  const push = (start, titel, ganztags, status) => {
    if (status === 'CANCELLED') return;
    const t = start.toJSDate().getTime();
    if (t < von || t > bis) return;
    out.push({ start: new Date(t).toISOString(), titel: String(titel || '').trim(), ganztags: !!ganztags });
  };
  all.filter((v) => !v.hasProperty('recurrence-id')).forEach((v) => {
    try {
      const ev = new ICAL.Event(v, { exceptions: ausnahmen[v.getFirstPropertyValue('uid')] || [] });
      if (ev.isRecurring()) {
        const it = ev.iterator();
        let next, n = 0;
        while ((next = it.next()) && n++ < 2000) {
          if (next.toJSDate().getTime() > bis) break;
          const d = ev.getOccurrenceDetails(next);
          push(d.startDate, d.item.summary, d.startDate.isDate, d.item.component.getFirstPropertyValue('status'));
        }
      } else {
        push(ev.startDate, ev.summary, ev.startDate.isDate, v.getFirstPropertyValue('status'));
      }
    } catch (e) { /* einzelnen kaputten Termin überspringen */ }
  });
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out.slice(0, 20);
};

// Fahrtenbuch: veröffentlichte Google-Tabelle (CSV) mit Fahrzeug, Name, Von, Bis, Zweck
const csvParse = (txt) => {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
};
// Datum aus Google-Tabelle: "24.10.2026 18:00:00", "2026-10-24 18:00", "10/24/2026 18:00:00"
const parseZeit = (s) => {
  s = String(s || '').trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0)).getTime();
  return NaN;
};
// abgesagte Fahrten: im Zweck „abgesagt“, „storniert“, „storno“, „entfällt“ oder „fällt aus“ (Groß/Klein egal)
const ABGESAGT = /abgesagt|storniert|storno|entf(ä|ae)llt|f(ä|ae)llt aus/i;
const fahrtenbuch = async () => {
  if (!C.fahrtenbuchCsvUrl) return null;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 30000);
  const r = await fetch(C.fahrtenbuchCsvUrl, { cache: 'no-store', signal: ctl.signal }).finally(() => clearTimeout(tm));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = csvParse(await r.text());
  if (!rows.length) return [];
  const head = rows[0].map((x) => x.toLowerCase());
  const col = (...keys) => head.findIndex((h) => keys.some((k) => h.indexOf(k) !== -1));
  const iF = col('fahrzeug'), iN = col('name'), iV = col('von', 'beginn', 'start'), iB = col('bis', 'ende', 'rückgabe'), iZ = col('zweck', 'grund');
  if (iF < 0 || iV < 0 || iB < 0) throw new Error('Spalten Fahrzeug/Von/Bis fehlen');
  const now = Date.now(), bis = now + (C.fahrtenbuchVorschauTage || 7) * 86400000;
  return rows.slice(1).map((r) => ({
    fahrzeug: (r[iF] || '').trim(), name: iN >= 0 ? (r[iN] || '').trim() : '', zweck: iZ >= 0 ? (r[iZ] || '').trim() : '',
    von: parseZeit(r[iV]), bis: parseZeit(r[iB])
  })).filter((e) => e.fahrzeug && isFinite(e.von) && isFinite(e.bis) && e.bis > e.von && !ABGESAGT.test(e.zweck) && e.bis >= now - 3600000 && e.von <= bis)
    .sort((a, b) => a.von - b.von).slice(0, 30);
};

// Schlagzeilen (RSS 2.0 oder RDF/RSS 1.0, z. B. ORF): nur Titel, Quelle und Zeit
const xmlText = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(block); return m ? xmlText(m[1]) : ''; };
const feed = async (f) => {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 30000);
  const r = await fetch(f.url, { cache: 'no-store', signal: ctl.signal }).finally(() => clearTimeout(tm));
  if (!r.ok) throw new Error(f.name + ' HTTP ' + r.status);
  const xml = await r.text();
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return items.map((it, i) => {
    const d = Date.parse(tag(it, 'dc:date') || tag(it, 'pubDate') || '');
    return { titel: tag(it, 'title'), quelle: f.name, at: isFinite(d) ? d : null, pos: i };
  }).filter((x) => x.titel);
};
const schlagzeilen = async () => {
  const feeds = C.schlagzeilenFeeds || [];
  if (!feeds.length) return null;
  const res = await Promise.allSettled(feeds.map(feed));
  const ok = res.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  if (!ok.length) throw new Error(String(res[0].reason && res[0].reason.message || 'keine Daten').slice(0, 60));
  const n = C.schlagzeilenAnzahl || 8, seen = new Set(), out = [];
  // abwechselnd aus jeder Quelle die neuesten (Reihenfolge des Feeds = Aktualität)
  for (let i = 0; out.length < n && ok.some((l) => l[i]); i++) ok.forEach((l) => {
    const x = l[i]; if (x && out.length < n && !seen.has(x.titel)) { seen.add(x.titel); out.push(x); }
  });
  return out;
};

// Unwetterwarnungen der UWZ (uwz.at): Warngebiete je Tag und Art als GeoJSON -> liegt Deutsch Haslau drin?
// Stufen: 0 Vorwarnung, 1 Gelb (markant), 2 Orange (Unwetter), 3 Rot (schweres Unwetter), 4 Violett (extrem)
const UWZ_ARTEN = { storm: 'Wind', rain: 'Regen', thunderstorm: 'Gewitter/Hagel', snowfall: 'Schneefall', freezingRain: 'Gefrierender Regen' };
const imRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c; } return c; };
const imPoly = (p, poly) => imRing(p, poly[0]) && !poly.slice(1).some((h) => imRing(p, h));
const trifft = (p, g) => !!g && (g.type === 'Polygon' ? imPoly(p, g.coordinates) : g.type === 'MultiPolygon' ? g.coordinates.some((pl) => imPoly(p, pl)) : false);
const uwz = async () => {
  if (!C.uwz || !C.ort) return null;
  const p = [C.ort.lon, C.ort.lat];
  const t = Math.floor(Date.now() / 300000);
  const stufe = async (name) => {
    const j = await getJson('https://www.uwz.at/data/warnings/AT/AT_' + name + '.geojson?cache=' + t, 30000);
    let lv = -1;
    (j.features || []).forEach((f) => { if (trifft(p, f.geometry)) lv = Math.max(lv, Number(f.properties && f.properties.level) || 0); });
    return lv;
  };
  const min = C.uwzMinStufe || 0, out = [];
  for (const tag of ['today', 'tomorrow']) {
    const alle = await stufe(tag + '_all');
    if (alle < min) continue;
    const vorher = out.length;
    for (const art of Object.keys(UWZ_ARTEN)) {
      const lv = await stufe(tag + '_' + art).catch(() => -1);
      if (lv >= min) out.push({ tag: tag === 'today' ? 'heute' : 'morgen', art: UWZ_ARTEN[art], stufe: lv });
    }
    if (out.length === vorher) out.push({ tag: tag === 'today' ? 'heute' : 'morgen', art: 'Unwetter', stufe: alle });
  }
  return out.sort((a, b) => (a.tag === b.tag ? b.stufe - a.stufe : a.tag === 'heute' ? -1 : 1));
};

const refresh = async () => {
  const prev = (await chrome.storage.local.get('extra')).extra || {};
  const next = { ...prev, at: Date.now(), version: chrome.runtime.getManifest().version, status: {} };
  const run = (name, fn, set) => fn().then((v) => { set(v); next.status[name] = { ok: true, at: Date.now(), n: Array.isArray(v) ? v.length : undefined }; })
    .catch((e) => { next.status[name] = { ok: false, at: Date.now(), fehler: String((e && e.message) || e).slice(0, 80) }; });
  await Promise.all([
    run('Wetter', wetter, (v) => { next.wetter = v; }),
    run('WASTL', wastl, (v) => { next.wastl = v; }),
    run('LSZ', lsz, (v) => { next.lsz = v; }),
    C.pegel ? run('Pegel', pegel, (v) => { next.pegel = v; }) : (delete next.pegel, null),
    run('Kalender', kalender, (v) => { next.kalender = v; next.kalenderAt = Date.now(); }),
    run('Fahrtenbuch', fahrtenbuch, (v) => { next.fahrtenbuch = v; }),
    run('Schlagzeilen', schlagzeilen, (v) => { next.schlagzeilen = v; }),
    run('UWZ', uwz, (v) => { next.uwz = v; })
  ]);
  await chrome.storage.local.set({ extra: next });
};

// ---------- Wächter: Selbstheilung + Ausfallmeldung ----------
// leaAlive setzt bridge.js, solange LEA-Daten ankommen. Bleiben sie aus, wird die LEA-Seite neu geladen.
// Nach 3 erfolglosen Versuchen nur mehr alle 30 Minuten (damit z. B. eine Token-Eingabe nicht gestört wird).
const LEA_URL = 'https://lea-screen.notrufnoe.at/';
const watch = async () => {
  const now = Date.now();
  const w = await chrome.storage.local.get(['leaAlive', 'bootAt', 'watch']);
  const st = w.watch || { versuche: 0, letzterNeustart: 0, letzterPing: 0 };
  const seit = Math.max(w.leaAlive || 0, w.bootAt || 0);
  const stale = now - seit;
  const grenze = (C.neuladenNachMin || 3) * 60000;
  if (stale < grenze) st.versuche = 0;
  else {
    const pause = st.versuche < 3 ? 5 * 60000 : 30 * 60000;
    if (now - st.letzterNeustart > pause) {
      const tabs = await chrome.tabs.query({}).catch(() => []);
      for (const t of tabs) await chrome.tabs.update(t.id, { url: LEA_URL }).catch(() => {});
      st.versuche++; st.letzterNeustart = now; st.neustarts = (st.neustarts || 0) + 1;
    }
  }
  // Ausfallmeldung: healthchecks.io meldet sich, wenn der Ping ausbleibt (Pi/Strom/Internet weg)
  // oder wenn wir länger als 10 Minuten keine LEA-Daten haben (/fail).
  if (C.heartbeatUrl && now - st.letzterPing > 4 * 60000) {
    const fail = stale > 10 * 60000;
    if (stale < grenze || fail) {
      const msg = fail ? 'Seit ' + Math.round(stale / 60000) + ' min keine LEA-Daten' : 'ok';
      await fetch(C.heartbeatUrl.replace(/\/+$/, '') + (fail ? '/fail' : ''), { method: 'POST', body: msg }).catch(() => {});
      st.letzterPing = now;
    }
  }
  await chrome.storage.local.set({ watch: st });
};

const start = () => {
  chrome.alarms.create('leaskin-refresh', { periodInMinutes: C.aktualisierenMin || 5 });
  chrome.alarms.create('leaskin-watch', { periodInMinutes: 1 });
  chrome.storage.local.set({ bootAt: Date.now() });
  refresh();
};
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'leaskin-refresh') refresh();
  if (a.name === 'leaskin-watch') watch();
});
chrome.runtime.onMessage.addListener((m) => { if (m === 'leaskin-refresh') refresh(); });

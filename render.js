// Eigene Darstellung des LEA-Infoscreens (Einsatzansicht + Ruhebildschirm).
// Daten kommen aus inject.js. Fehlen sie oder passen sie nicht, bleibt das LEA-Original sichtbar.
(() => {
  const C = window.LEASKIN_CONFIG || {};
  const DEMO = /[?&]demo=1\b/.test(location.search);

  const state = { events: null, history: [], lastData: 0, idx: 0, lastSwitch: 0, key: '', view: null };
  const refs = {};

  // ---------- Hilfsfunktionen ----------
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const ddmm = (ms) => { const d = new Date(ms); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.'; };
  const dateLong = (d) => d.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const elapsed = (ms) => {
    let s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return '+ ' + (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
  };
  const h = (tag, cls, kids, style) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) Object.assign(e.style, style);
    (kids || []).forEach((k) => {
      if (k == null || k === '') return;
      e.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    });
    return e;
  };
  const listOf = (d) => (Array.isArray(d) ? d : (d && (d.events || d.data || d.items)) || []);
  const bandColor = (t) => { const f = C.farben || {}; return f[String(t || '').charAt(0).toUpperCase()] || f.default || '#4B5563'; };

  // helle Hintergründe (z. B. gelb) bekommen dunkle Schrift
  const istHellFarbe = (hex) => {
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return false;
    const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
  };
  const chipStil = (t) => { const c = bandColor(t); return istHellFarbe(c) ? { background: c, color: '#111827' } : { background: c }; };

  // Pickerl (§57a): gelochter Monat = fällig bis Monatsende.
  // LKW (pickerlLkw, z. B. KLF-W, VFA): Begutachtung ab 3 Monate vorher, keine Toleranz danach.
  // sonst: ab 1 Monat vorher, danach 4 Monate Toleranz.
  const pickerlInfo = (pk, fz) => {
    if (!pk) return null;
    const lkw = (C.pickerlLkw || []).some((x) => norm(x) === norm(fz));
    const now = Date.now();
    const ende = new Date(pk.y, pk.m, 0, 23, 59).getTime();                // Ende des gelochten Monats
    const ab = new Date(pk.y, pk.m - 1 - (lkw ? 3 : 1), 1).getTime();       // Beginn des Prüfzeitraums
    const txt = 'Pickerl ' + pad(pk.m) + '/' + String(pk.y).slice(2);
    if (now > ende) {
      if (lkw || now > new Date(pk.y, pk.m + 4, 0, 23, 59).getTime()) return { txt: txt + ' abgelaufen', cls: 'ls-pk-rot' };
      return { txt: txt + ' – Toleranz', cls: 'ls-pk-rot' };
    }
    if (now >= ab) return { txt: txt + ' fällig', cls: 'ls-pk-bald' };
    return { txt, cls: 'ls-pk-ok' };
  };
  const fzStatusVon = (ex, fz) => (ex.fahrzeugStatus || []).find((x) => norm(x.fahrzeug) === norm(fz));

  // UWZ-Warnstufen
  const UWZ_FARBE = ['#94A3B8', '#FACC15', '#F97316', '#DC2626', '#9333EA'];
  const UWZ_NAME = ['Vorwarnung', 'Gelb – markantes Wetter', 'Orange – Unwetter', 'Rot – schweres Unwetter', 'Violett – extremes Unwetter'];
  const uwzStil = (lv) => { const c = UWZ_FARBE[Math.max(0, Math.min(4, lv))]; return istHellFarbe(c) ? { background: c, color: '#111827' } : { background: c, color: '#FFFFFF' }; };

  const fnKeys = Object.keys(C.funktionen || {});
  const fnStyle = (short) => { const k = fnKeys.find((x) => norm(x) === norm(short)); return k ? C.funktionen[k] : null; };
  const fnOrder = (short) => { const i = fnKeys.findIndex((x) => norm(x) === norm(short)); return i < 0 ? 99 : i; };
  const hasFn = (p, k) => (p.functions || []).some((f) => norm(f.shortname) === norm(k));
  const elRank = (p) => {
    const i = (C.elListe || []).findIndex(([vn, nn]) => norm(vn) === norm(p.firstname) && norm(nn) === norm(p.lastname));
    return i >= 0 ? i + 1 : null;
  };

  // Meldebild aus dem Fließtext: "A17504ALLE (16:41) B2 Innenraum. Musterstraße 24, ...: Rauch aus Fenster (48.3, 16.0)"
  const meldebild = (ev) => {
    let t = String(ev.additionalinformation || '').trim();
    t = t.replace(/^\S+\s+\(\d{1,2}:\d{2}\)\s*/, '');
    t = t.replace(/\s*\(\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\)\s*$/, '');
    const i = t.indexOf(': ');
    const m = i >= 0 ? t.slice(i + 2).trim() : '';
    return m || t;
  };

  // ---------- Ampel: jede Person nur für eine Rolle ----------
  const ampel = (yes) => {
    const F = C.fahrzeug;
    if (!F) return null;
    const slots = [];
    F.rollen.forEach((r) => { for (let i = 0; i < r.anzahl; i++) slots.push(r.kuerzel); });
    const n = slots.length;
    const full = Math.pow(2, n + 1) - 2;
    let best = [], bestScore = -1;
    const used = new Set(), cur = [];
    const score = (arr) => arr.reduce((s, v, i) => s + (v != null ? Math.pow(2, n - i) : 0), 0);
    const dfs = (i, minJ) => {
      if (bestScore === full) return;
      if (i === n) { const sc = score(cur); if (sc > bestScore) { bestScore = sc; best = cur.slice(); } return; }
      const sameAsPrev = i > 0 && slots[i] === slots[i - 1];
      for (let j = sameAsPrev ? minJ : 0; j < yes.length; j++) {
        if (used.has(j) || !hasFn(yes[j], slots[i])) continue;
        used.add(j); cur.push(j); dfs(i + 1, j + 1); cur.pop(); used.delete(j);
        if (bestScore === full) return;
      }
      cur.push(null); dfs(i + 1, sameAsPrev ? minJ : 0); cur.pop();
    };
    dfs(0, 0);
    const rows = F.rollen.map((r) => {
      const filled = best.filter((v, i) => v != null && slots[i] === r.kuerzel).length;
      return { label: r.label + ' (' + r.kuerzel + ')', ist: filled, soll: r.anzahl, ok: filled >= r.anzahl, pflicht: r.pflicht };
    });
    const total = { label: 'Gesamt', ist: yes.length, soll: F.mindestGesamt || 0, ok: yes.length >= (F.mindestGesamt || 0), pflicht: false };
    let status = 'besetzbar';
    if (rows.some((r) => r.pflicht && !r.ok)) status = 'nicht besetzbar';
    else if (rows.some((r) => !r.ok) || !total.ok) status = 'knapp';
    return { rows: rows.concat([total]), status };
  };

  // ---------- Karte (Kacheln wie im LEA-Original) ----------
  const drawMap = (box, ev) => {
    const loc = ev.location || {};
    let a = Number(loc.x), b = Number(loc.y);
    if (!isFinite(a) || !isFinite(b) || (!a && !b)) { box.appendChild(h('div', 'ls-map-empty', ['Keine Koordinaten'])); return; }
    const lat = Math.max(a, b), lon = Math.min(a, b); // Österreich: Breite > Länge
    const z = C.karteZoom || 17, size = 256, scale = size * Math.pow(2, z);
    const px = ((lon + 180) / 360) * scale;
    const r = (lat * Math.PI) / 180;
    const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scale;
    requestAnimationFrame(() => {
      const w = box.clientWidth || 800, ht = box.clientHeight || 400;
      const x0 = Math.floor((px - w / 2) / size), x1 = Math.floor((px + w / 2) / size);
      const y0 = Math.floor((py - ht / 2) / size), y1 = Math.floor((py + ht / 2) / size);
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          const img = document.createElement('img');
          img.className = 'ls-tile';
          img.alt = '';
          img.onerror = () => { img.style.visibility = 'hidden'; };
          img.src = (C.karteUrl || '').replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
          img.style.left = Math.round(tx * size - px + w / 2) + 'px';
          img.style.top = Math.round(ty * size - py + ht / 2) + 'px';
          box.appendChild(img);
        }
      }
      box.appendChild(h('div', 'ls-marker'));
    });
  };

  // ---------- Ansichten ----------
  // Bühne in 1920x1080, wird auf die echte Bildschirmgröße skaliert
  const stage = h('div', 'ls-stage');
  const root = h('div', 'ls-root ls-hidden', [stage]);
  const fit = () => {
    const sc = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
    stage.style.transform = 'translate(-50%, -50%) scale(' + sc + ')';
  };
  window.addEventListener('resize', fit);
  const mount = () => { if (!root.isConnected && document.body) { document.body.appendChild(root); fit(); } };

  const renderEinsatz = (ev, nr, anzahl) => {
    stage.textContent = '';
    const color = bandColor(ev.eventtype);
    const persons = (ev.alarmedpersons || []).filter((p) => p.response && p.response.basicresponse === 'Ja');
    const ranked = persons.map((p) => ({ p, rank: elRank(p), t: (p.response && p.response.timestamp) || 0 }));
    ranked.sort((x, y) => {
      if (x.rank != null && y.rank != null) return x.rank - y.rank;
      if (x.rank != null) return -1;
      if (y.rank != null) return 1;
      return x.t - y.t;
    });
    const loc = ev.location || {};
    const strasse = [loc.street, loc.housenumber].filter(Boolean).join(' ') || loc.objectname || loc.city || 'Einsatzort siehe Meldebild';
    const ort = [loc.zipcode, loc.city].filter(Boolean).join(' ');
    const extra = [loc.street ? loc.objectname : '', loc.additionalinfo].filter(Boolean).join(' · ');

    refs.timer = h('div', 'ls-timer', [elapsed(ev.alarmtime)]);
    refs.clock = h('div', 'ls-clock', [hhmm(Date.now())]);
    const band = h('header', 'ls-band', [
      h('div', 'ls-stufe', [ev.eventtype || '–']),
      h('div', 'ls-art', [
        h('div', 'ls-label-inv', ['Alarmstufe ' + (ev.eventtype || '')]),
        h('div', 'ls-art-text', [ev.eventtypetext || 'Einsatz'])
      ]),
      anzahl > 1 ? h('div', 'ls-multi', [nr + ' / ' + anzahl]) : null,
      h('div', 'ls-zeit', [h('div', 'ls-label-inv', ['Alarmiert ' + (ev.alarmtime ? hhmm(ev.alarmtime) : '')]), refs.timer]),
      h('div', 'ls-sep'),
      refs.clock
    ], { background: color });
    if (istHellFarbe(color)) band.classList.add('ls-band-hell');

    // links: wohin, was, wer ist mitalarmiert, Karte
    const map = h('div', 'ls-map ls-map-big');
    const uwzHeute = ((state.extra || {}).uwz || []).filter((w) => w.tag === 'heute');
    const fzMaengel = ((state.extra || {}).fahrzeugStatus || []).filter((x) => x.bereit !== 'ja');
    const groups = (ev.alarmedalarmgroups || []).map((g) => h('span', 'ls-chip', [String(g.name || g.id).replace(/\s*-\s*Sammelruf$/i, '')]));
    const links = h('section', 'ls-left', [
      h('div', 'ls-ort', [h('div', 'ls-label', ['Einsatzort']), h('div', 'ls-strasse', [strasse]), ort ? h('div', 'ls-stadt', [ort]) : null]),
      h('div', 'ls-card ls-melde', [h('div', 'ls-label', ['Meldebild']), h('div', 'ls-melde-text', [meldebild(ev)]), extra ? h('div', 'ls-melde-extra', [extra]) : null]),
      groups.length ? h('div', 'ls-groups-row', [h('div', 'ls-label', ['Mitalarmiert'])].concat([h('div', 'ls-chips', groups)])) : null,
      uwzHeute.length ? h('div', 'ls-groups-row', [h('div', 'ls-label', ['Unwetter']), h('div', 'ls-chips',
        uwzHeute.map((w) => h('span', 'ls-chip ls-uwz-chip', ['⚠ ' + w.art + ' · ' + UWZ_NAME[Math.max(0, Math.min(4, w.stufe))].split(' – ')[0]], uwzStil(w.stufe))))]) : null,
      fzMaengel.length ? h('div', 'ls-groups-row', [h('div', 'ls-label', ['Fahrzeuge']), h('div', 'ls-chips',
        fzMaengel.map((x) => h('span', 'ls-chip ls-uwz-chip', ['⚠ ' + x.fahrzeug + ' ' + (x.bereit === 'nein' ? 'nicht einsatzbereit' : 'eingeschränkt') + (x.mangel ? ': ' + x.mangel : '')],
          x.bereit === 'nein' ? { background: '#DC2626', color: '#FFFFFF' } : { background: '#F97316', color: '#FFFFFF' })))]) : null,
      map
    ]);

    // rechts: wer kommt, mit welcher Qualifikation
    const summe = fnKeys.map((k) => ({ k, n: persons.filter((p) => hasFn(p, k)).length })).filter((x) => x.n > 0)
      .map((x) => h('span', 'ls-qsum', [h('span', 'ls-tag', [x.k], { background: C.funktionen[x.k].bg, color: C.funktionen[x.k].fg }), h('span', 'ls-qsum-n', [String(x.n)])]));
    const MAXZEILEN = 10;
    const zeigen = ranked.length > MAXZEILEN ? MAXZEILEN - 1 : ranked.length;
    const rows = ranked.slice(0, zeigen).map((x, i) => {
      const fns = (x.p.functions || []).slice().sort((a, b) => fnOrder(a.shortname) - fnOrder(b.shortname)).map((f) => {
        const st = fnStyle(f.shortname) || { bg: '#2A3340', fg: '#F2F4F7' };
        return h('span', 'ls-tag', [f.shortname], { background: st.bg, color: st.fg });
      });
      return h('div', 'ls-person' + (i === 0 && x.rank != null ? ' ls-lead' : ''), [
        h('div', 'ls-rank', [x.rank != null ? 'EL ' + x.rank : '']),
        h('div', 'ls-pmain', [
          h('div', 'ls-name', [[x.p.firstname, x.p.lastname].filter(Boolean).join(' ')]),
          (x.p.response && x.p.response.freetext) ? h('div', 'ls-free', [x.p.response.freetext]) : null
        ]),
        h('div', 'ls-tags', fns)
      ]);
    });
    if (ranked.length > zeigen) rows.push(h('div', 'ls-w-more', ['+ ' + (ranked.length - zeigen) + ' weitere: ' + ranked.slice(zeigen).map((x) => x.p.firstname + ' ' + x.p.lastname).join(', ')]));

    const rechts = h('section', 'ls-right', [
      h('div', 'ls-count', [
        h('div', 'ls-count-n', [persons.length]),
        h('div', null, [h('div', 'ls-label', ['Wer kommt']), h('div', 'ls-count-t', [persons.length === 1 ? 'Zusage' : 'Zusagen'])]),
        h('div', 'ls-count-hint', ['gereiht nach EL-Liste'])
      ]),
      summe.length ? h('div', 'ls-qsums', summe) : null,
      h('div', 'ls-list', rows.length ? rows : [h('div', 'ls-empty', ['Noch keine Zusagen'])])
    ]);

    stage.appendChild(h('div', 'ls-einsatz', [band, h('main', 'ls-body', [links, rechts])]));
    drawMap(map, ev);
  };

  // ---------- Ruhebildschirm ----------
  const WETTER = { 0: 'klar', 1: 'überwiegend klar', 2: 'teils bewölkt', 3: 'bewölkt', 45: 'Nebel', 48: 'Raureifnebel',
    51: 'leichter Niesel', 53: 'Niesel', 55: 'starker Niesel', 56: 'gefrierender Niesel', 57: 'gefrierender Niesel',
    61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen', 66: 'gefrierender Regen', 67: 'gefrierender Regen',
    71: 'leichter Schneefall', 73: 'Schneefall', 75: 'starker Schneefall', 77: 'Schneegriesel',
    80: 'Regenschauer', 81: 'Regenschauer', 82: 'heftige Schauer', 85: 'Schneeschauer', 86: 'Schneeschauer',
    95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel' };
  const RICHTUNG = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const wdir = (deg) => (deg == null ? '' : RICHTUNG[Math.round(((deg % 360) + 360) % 360 / 45) % 8]);
  const WTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const terminZeit = (d, ganztags) => WTAG[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.' + (ganztags ? '' : ' · ' + hhmm(d.getTime()));
  // Emojis aus Kalendertiteln entfernen (am Pi fehlt meist eine Emoji-Schrift)
  const ohneEmoji = (t) => String(t || '').replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200d\ufe0f]/gu, '').replace(/\s{2,}/g, ' ').replace(/^[\s/·|–-]+/, '').trim();
  const kachel = (label, wert, unter) => h('div', 'ls-wx', [h('div', 'ls-label', [label]), h('div', 'ls-wx-val', [wert]), h('div', 'ls-wx-sub', [unter])]);

  const renderRuhe = () => {
    stage.textContent = '';
    refs.timer = null;
    refs.clock = h('div', 'ls-big-clock', [hhmm(Date.now())]);
    const now = Date.now();
    const ex = state.extra || {};

    // Wetter (höchstens 60 min alt)
    const w = ex.wetter && now - ex.wetter.at < 60 * 60000 ? ex.wetter : null;
    // Pegel (höchstens 60 min alt). Warnklassen Wasserstand laut NÖ: 1 < MW, 2 > MW, 3 > HW1, 4 > HW5, 5 > HW30, 6 > HW100
    const pg = ex.pegel && now - ex.pegel.at < 60 * 60000 ? ex.pegel : null;
    const PSTUFE = { 1: 'unter Mittelwasser', 2: 'über Mittelwasser', 3: 'über HW1', 4: 'über HW5', 5: 'über HW30', 6: 'über HW100' };
    const PFARBE = istHell() ? { 3: '#A16207', 4: '#C2410C', 5: '#B91C1C', 6: '#A21CAF' } : { 3: '#FACC15', 4: '#FB923C', 5: '#F87171', 6: '#E879F9' };
    let pegelBox = null;
    if (C.pegel) {
      const titel = (C.pegel.name || 'Pegel') + ' · ' + (C.pegel.ort || '');
      if (pg) {
        const trend = pg.prognose == null ? '' : pg.prognose > pg.wert ? '↗' : pg.prognose < pg.wert ? '↘' : '→';
        const col = PFARBE[pg.klasse] ? { color: PFARBE[pg.klasse] } : null;
        pegelBox = h('div', 'ls-card ls-pegel', [
          h('div', 'ls-pegel-main', [
            h('div', 'ls-label', [titel]),
            h('div', 'ls-pegel-row', [h('div', 'ls-pegel-val', [Math.round(pg.wert) + ' cm'], col), h('div', 'ls-pegel-stufe', [PSTUFE[pg.klasse] || ''], col)])
          ]),
          pg.prognose != null ? h('div', 'ls-pegel-prog', [h('div', 'ls-label', ['Prognose']), h('div', 'ls-pegel-pval', [trend + ' ' + Math.round(pg.prognose) + ' cm'])]) : null
        ]);
      } else {
        pegelBox = h('div', 'ls-card ls-pegel', [h('div', 'ls-pegel-main', [h('div', 'ls-label', [titel]), h('div', 'ls-empty', ['keine aktuellen Daten'])])]);
      }
    }
    const wetterBox = h('div', 'ls-card ls-wx-grid', w ? [
      kachel('Wetter', Math.round(w.temp) + '°', WETTER[w.code] || ''),
      kachel('Wind', (wdir(w.dir) + ' ' + Math.round(w.wind)).trim(), 'km/h'),
      kachel('Böen', String(Math.round(w.boeen)), 'km/h')
    ] : [kachel('Wetter', '–', 'keine Daten')]);

    // letzte Einsätze
    const hist = listOf(state.history).slice(0, 1).map((ev) => {
      const loc = ev.location || {};
      const where = [[loc.street, loc.housenumber].filter(Boolean).join(' '), loc.city].filter(Boolean).join(', ') || loc.objectname || '';
      return h('div', 'ls-hist', [
        h('div', 'ls-hist-date', [ev.alarmtime ? ddmm(ev.alarmtime) + ' ' + hhmm(ev.alarmtime) : '']),
        h('div', 'ls-hist-code', [ev.eventtype || '–'], chipStil(ev.eventtype)),
        h('div', 'ls-hist-main', [h('div', 'ls-hist-title', [ev.eventtypetext || '']), h('div', 'ls-hist-where', [where])])
      ]);
    });

    // Termine: fix eingetragen + Kalender, nur künftige, nächste 3
    const alle = (C.termine || []).concat(ex.kalender || []).map((t) => ({ d: new Date(t.start), titel: t.titel, ganztags: t.ganztags }))
      .filter((t) => !isNaN(t.d) && t.d.getTime() > now - 2 * 3600000)
      .sort((a, b) => a.d - b.d);
    const seen = new Set();
    const termine = alle.filter((t) => { const k = t.d.getTime() + t.titel; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, C.termineAnzahl || 6)
      .map((t) => h('div', 'ls-termin', [h('div', 'ls-termin-wann', [terminZeit(t.d, t.ganztags)]), h('div', 'ls-termin-was', [ohneEmoji(t.titel)])]));
    // Termine: bis zu 4, einzeilig

    // WASTL (höchstens 30 min alt)
    const wa = ex.wastl && now - ex.wastl.at < 30 * 60000 && Array.isArray(ex.wastl.laufend) ? ex.wastl : null;
    const kurzZeit = (z) => {
      const d = /(\d{2})\.(\d{2})\.\d{4}\s+(\d{2}):(\d{2})/.exec(z || '');
      if (d) return d[1] + '.' + d[2] + '. ' + d[3] + ':' + d[4];
      const u = /([<~>]\s*\d+)\s*std/i.exec(z || '');
      return u ? u[1].replace(/\s+/g, ' ') + ' Std.' : '';
    };
    const wRow = (e) => h('div', 'ls-w-row', [
      h('div', 'ls-w-chip', [e.stufe || '–'], chipStil(e.stufe)),
      h('div', 'ls-w-main', [h('div', 'ls-w-ort', [e.ort || e.name || '']), h('div', 'ls-w-text', [e.text || ''])]),
      h('div', 'ls-w-zeit', [kurzZeit(e.zeit)])
    ]);
    const eigen = (n) => C.eigeneFF && norm(n).indexOf(norm(C.eigeneFF)) !== -1;
    let wastlKids;
    const ls = ex.lsz && now - ex.lsz.at < 30 * 60000 ? ex.lsz : null;
    if (!wa && !ls) {
      wastlKids = [h('div', 'ls-empty', ['keine aktuellen Daten'])];
    } else {
      // nur aktuell ausgerückte Feuerwehren: NÖ (WASTL, Bezirk Bruck/Leitha) + Burgenland (LSZ, Bezirk Neusiedl/See), eigene FF zuerst
      const ffs = ((wa && wa.feuerwehren) || []).map((f) => Object.assign({ bezirk: 'BL' }, f))
        .concat((ls && ls.feuerwehren) || [])
        .sort((a, b) => (eigen(b.name) ? 1 : 0) - (eigen(a.name) ? 1 : 0));
      const zeitText = (f) => (f.dauer ? f.dauer.replace(/\s*h$/, ' Std.') : kurzZeit(f.zeit));
      if (ffs.length) {
        // mit Nachrichten-Band: 3 Zeilen (+ „weitere“), ohne Band: 4 Zeilen bzw. 3 + „weitere“
        const zeigen = (ex.schlagzeilen || []).length ? 3 : (ffs.length > 4 ? 3 : 4);
        wastlKids = [
          h('div', 'ls-w-head', [
            h('div', 'ls-wastl-n', [String(ffs.length)]),
            h('div', 'ls-wastl-t', [ffs.length === 1 ? 'Feuerwehr im Einsatz' : 'Feuerwehren im Einsatz'])
          ])
        ].concat(ffs.slice(0, zeigen).map((f) => h('div', 'ls-w-ffrow' + (eigen(f.name) ? ' ls-w-own' : ''), [
          h('div', 'ls-w-chip', [f.stufe || '–'], chipStil(f.stufe)),
          h('div', 'ls-w-ffname', [f.name]),
          h('div', 'ls-w-text', [f.text || '']),
          h('div', 'ls-w-bez', [f.bezirk || '']),
          h('div', 'ls-w-zeit', [zeitText(f)])
        ])));
        if (ffs.length > zeigen) wastlKids.push(h('div', 'ls-w-more', ['+ ' + (ffs.length - zeigen) + ' weitere: ' + ffs.slice(zeigen).map((f) => f.name).join(', ')]));
      } else if (wa && wa.laufend.length) {
        wastlKids = [h('div', 'ls-w-head', [h('div', 'ls-wastl-n', [String(wa.laufend.length)]), h('div', 'ls-wastl-t', [wa.laufend.length === 1 ? 'laufender Einsatz im Bezirk' : 'laufende Einsätze im Bezirk'])])]
          .concat(wa.laufend.slice(0, 4).map(wRow));
      } else {
        wastlKids = [h('div', 'ls-w-ruhig', [h('span', 'ls-dot'), 'Keine Feuerwehr im Einsatz'])];
      }
    }
    const wastlBox = h('div', 'ls-card ls-wastl', [h('div', 'ls-label', [C.wastlTitel || 'Bezirk'])].concat(wastlKids));

    // Fahrzeuge aus dem Fahrtenbuch: unterwegs / nächste Nutzung / frei
    let fzBox = null;
    if ((C.fahrzeuge || []).length) {
      const fb = Array.isArray(ex.fahrtenbuch) ? ex.fahrtenbuch : null;
      const kurz = (t) => { const d = new Date(t); const heute = new Date(); const morgen = new Date(Date.now() + 864e5);
        if (d.toDateString() === heute.toDateString()) return hhmm(t);
        if (d.toDateString() === morgen.toDateString()) return 'morgen ' + hhmm(t);
        return WTAG[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '. ' + hhmm(t); };
      const rows = C.fahrzeuge.map((fz) => {
        const mine = fb ? fb.filter((e) => norm(e.fahrzeug) === norm(fz)) : [];
        const jetzt = mine.find((e) => e.von <= now && e.bis >= now);
        const naechst = mine.find((e) => e.von > now);
        let cls = 'ls-fz-frei', status = fb ? 'frei' : '–', detail = '';
        if (jetzt) { cls = 'ls-fz-weg'; status = 'unterwegs bis ' + kurz(jetzt.bis); detail = [jetzt.name, jetzt.zweck].filter(Boolean).join(' · '); }
        else if (naechst) { detail = 'ab ' + kurz(naechst.von) + ' · ' + [naechst.name, naechst.zweck].filter(Boolean).join(' · '); }
        // Mängel aus dem Tab „Fahrzeuge“ gehen vor
        const st = fzStatusVon(ex, fz);
        if (st && st.bereit !== 'ja') {
          cls = st.bereit === 'nein' ? 'ls-fz-nein' : 'ls-fz-einge';
          status = jetzt ? (st.bereit === 'nein' ? 'nicht einsatzbereit' : 'eingeschränkt') + ' · unterwegs bis ' + kurz(jetzt.bis)
            : (st.bereit === 'nein' ? 'nicht einsatzbereit' : 'eingeschränkt einsatzbereit');
          detail = st.mangel || detail;
        } else if (st && st.mangel) {
          detail = '⚠ ' + st.mangel + (detail ? ' · ' + detail : '');
        }
        // Doppelbuchung (z. B. direkt in der Tabelle eingetragen)
        const doppelt = [];
        mine.forEach((a, i) => mine.slice(i + 1).forEach((b) => { if (a.von < b.bis && b.von < a.bis && a.bis >= now) doppelt.push([a, b]); }));
        if (doppelt.length) {
          const [a, b] = doppelt[0];
          detail = '⚠ Doppelbuchung ' + kurz(Math.max(a.von, b.von)) + ': ' + [a.name, b.name].filter(Boolean).join(' / ') + (detail ? ' · ' + detail : '');
        }
        const pk = pickerlInfo(st && st.pickerl, fz);
        return h('div', 'ls-fz-row ' + cls, [
          h('div', 'ls-fz-name', [fz]),
          h('div', 'ls-fz-info', [
            h('div', 'ls-fz-status', [h('span', 'ls-fz-dot'), status]),
            detail ? h('div', 'ls-fz-detail', [detail]) : null
          ]),
          pk ? h('div', 'ls-fz-pk ' + pk.cls, [pk.txt]) : null
        ]);
      });
      // QR-Code zum Formular „Fahrzeugnutzung“, zum Scannen direkt vom Bildschirm
      let qrBox = null;
      if (C.fahrtenbuchFormUrl && window.LEASKIN_QR) {
        try {
          const qr = window.LEASKIN_QR(0, 'L'); qr.addData(C.fahrtenbuchFormUrl); qr.make();
          const n = qr.getModuleCount(), rand = 2, gr = n + 2 * rand;
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 ' + gr + ' ' + gr); svg.setAttribute('class', 'ls-qr-svg'); svg.setAttribute('shape-rendering', 'crispEdges');
          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bg.setAttribute('width', gr); bg.setAttribute('height', gr); bg.setAttribute('fill', '#FFFFFF'); svg.appendChild(bg);
          let d = '';
          for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + rand) + ' ' + (r + rand) + 'h1v1h-1z';
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', d); path.setAttribute('fill', '#000000'); svg.appendChild(path);
          qrBox = h('div', 'ls-qr', [svg, h('div', 'ls-qr-t', ['Fahrt eintragen'])]);
        } catch (e) { qrBox = null; }
      }
      fzBox = h('div', 'ls-card ls-fz' + (qrBox ? ' ls-fz-mitqr' : ''), [
        h('div', 'ls-fz-main', [h('div', 'ls-label', ['Fahrzeuge'])].concat(rows)),
        qrBox
      ]);
    }

    const flamme = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    flamme.setAttribute('viewBox', '0 0 24 24'); flamme.setAttribute('width', '30'); flamme.setAttribute('height', '30');
    flamme.setAttribute('aria-hidden', 'true');
    const pth = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pth.setAttribute('d', 'M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z');
    ['fill:none', 'stroke:#FFFFFF', 'stroke-width:2', 'stroke-linecap:round', 'stroke-linejoin:round'].forEach((x) => { const [k, v] = x.split(':'); pth.setAttribute(k, v); });
    flamme.appendChild(pth);

    // Statuszeile für die Wartung: Version + Zustand der Datenquellen
    const st = ex.status || {};
    const statusZeile = h('div', 'ls-statusline', ['lea-skin ' + (ex.version || '?') + (ex.at ? ' · ' + hhmm(ex.at) : ' · keine Hintergrunddaten')].concat(
      Object.keys(st).map((k) => h('span', st[k].ok ? 'ls-st-ok' : 'ls-st-err', [' · ' + k + (st[k].ok ? (st[k].n != null ? ' ' + st[k].n : ' ✓') : ' ✗ ' + (st[k].fehler || '')) ]))));

    // Schlagzeilen-Band (wechselt alle paar Sekunden, siehe tick)
    // Bei aktiver UWZ-Warnung ersetzt das Warnband die Nachrichten
    const warn = ex.uwz || [];
    const news = warn.length
      ? warn.map((w) => ({ titel: (w.tag === 'heute' ? 'Heute' : 'Morgen') + ' · ' + w.art + ' · ' + UWZ_NAME[Math.max(0, Math.min(4, w.stufe))], quelle: 'UWZ', stufe: w.stufe }))
      : (ex.schlagzeilen || []);
    refs.news = news; refs.newsText = null; refs.newsQuelle = null; refs.newsLabel = null;
    let newsBand = null;
    if (news.length) {
      refs.newsText = h('div', 'ls-nw-text', [news[0].titel]);
      refs.newsQuelle = h('div', 'ls-nw-quelle', [news[0].quelle]);
      refs.newsLabel = h('div', 'ls-nw-label', [warn.length ? 'Unwetterwarnung' : 'Nachrichten'], warn.length ? uwzStil(news[0].stufe) : null);
      newsBand = h('div', 'ls-nw' + (warn.length ? ' ls-nw-warn' : ''), [refs.newsLabel, refs.newsText, refs.newsQuelle]);
    }

    stage.appendChild(h('div', 'ls-ruhe' + (newsBand ? ' ls-mit-nw' : ''), [
      h('header', 'ls-ruhe-head', [
        h('div', 'ls-brand', [h('div', 'ls-logo', [flamme]), h('div', 'ls-ff', [C.feuerwehr || ''])]),
        h('div', 'ls-status', [h('span', 'ls-dot'), 'Kein aktiver Einsatz'])
      ]),
      newsBand,
      h('main', 'ls-ruhe-body', [
        h('section', 'ls-ruhe-left', [
          h('div', 'ls-clockbox', [refs.clock, h('div', 'ls-date', [dateLong(new Date())])]),
          wetterBox,
          pegelBox,
          h('div', 'ls-card ls-termine', [h('div', 'ls-label', ['Nächste Termine'])].concat(termine.length ? termine : [h('div', 'ls-empty', ['keine Termine eingetragen'])]))
        ]),
        h('section', 'ls-ruhe-right', [
          h('div', 'ls-histbox', [h('div', 'ls-label', ['Letzter Einsatz'])].concat(hist.length ? hist : [h('div', 'ls-empty', ['Noch keine Daten'])])),
          fzBox,
          wastlBox
        ])
      ]),
      statusZeile
    ]));
  };

  // ---------- Hell/Dunkel: config design 'dunkel' | 'hell' | 'auto' (hell zwischen hellAb und dunkelAb) ----------
  const istHell = () => {
    const q = location.search.match(/[?&]hell=([01])\b/);
    if (q) return q[1] === '1';
    const d = C.design || 'dunkel';
    if (d === 'auto') { const hNow = new Date().getHours(); return hNow >= (C.hellAb || 7) && hNow < (C.dunkelAb || 19); }
    return d === 'hell';
  };

  // ---------- Alarm-Rahmen: neuer Einsatz -> Rand pulsiert ----------
  state.seen = {};
  const alarmRahmen = (evs, now) => {
    const dauer = (C.alarmRahmenSek || 30) * 1000;
    let farbe = null;
    evs.forEach((ev) => {
      const id = ev.id || (ev.alarmtime + ':' + ev.eventtype);
      if (!state.seen[id]) state.seen[id] = now;
      // nur bei frischen Alarmen (nicht nach einem Neuladen mitten im längeren Einsatz)
      const frisch = !ev.alarmtime || now - ev.alarmtime < 10 * 60000;
      if (frisch && now - state.seen[id] < dauer && !farbe) farbe = bandColor(ev.eventtype);
    });
    if (farbe) root.style.setProperty('--ls-alarm', farbe);
    root.classList.toggle('ls-alarm', !!farbe);
  };

  // ---------- Steuerung ----------
  const tick = () => {
    mount();
    const now = Date.now();
    const fresh = DEMO || (state.events && now - state.lastData < (C.datenTimeoutSek || 45) * 1000);
    if (!fresh) { root.classList.add('ls-hidden'); root.classList.remove('ls-alarm'); state.key = ''; return; }
    const evs = listOf(state.events);
    let key;
    if (evs.length) {
      if (!state.lastSwitch) state.lastSwitch = now;
      else if (now - state.lastSwitch > (C.einsatzWechselSek || 15) * 1000) { state.idx = (state.idx + 1) % evs.length; state.lastSwitch = now; }
      if (state.idx >= evs.length) state.idx = 0;
      key = 'e:' + state.idx + ':' + state.dataVersion;
      if (key !== state.key) renderEinsatz(evs[state.idx], state.idx + 1, evs.length);
    } else if (C.ruheAnsicht) {
      root.classList.remove('ls-alarm');
      key = 'r:' + state.dataVersion + ':' + state.extraVersion + ':' + new Date().getDate();
      if (key !== state.key) renderRuhe();
    } else {
      root.classList.add('ls-hidden'); state.key = ''; return;
    }
    state.key = key;
    root.classList.remove('ls-hidden');
    const hell = istHell();
    if (hell !== root.classList.contains('ls-hell')) { root.classList.toggle('ls-hell', hell); state.key = ''; }
    alarmRahmen(evs, now);
    if (refs.clock) refs.clock.textContent = hhmm(now);
    if (!evs.length && refs.newsText && refs.news.length > 1) {
      const i = Math.floor(now / ((C.schlagzeilenWechselSek || 8) * 1000)) % refs.news.length;
      const n = refs.news[i];
      if (refs.newsText.textContent !== n.titel) {
        refs.newsText.textContent = n.titel; refs.newsQuelle.textContent = n.quelle;
        if (n.stufe != null && refs.newsLabel) Object.assign(refs.newsLabel.style, uwzStil(n.stufe));
      }
    }
    if (refs.timer && evs[state.idx]) refs.timer.textContent = elapsed(evs[state.idx].alarmtime);
  };

  state.dataVersion = 0;
  state.extraVersion = 0;
  // Wetter/WASTL/Termine aus dem Hintergrund-Dienst (über bridge.js)
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'leaskin:extra') return;
    try {
      if (e.data.json !== state.lastExtraJson) { state.lastExtraJson = e.data.json; state.extra = JSON.parse(e.data.json); state.extraVersion++; }
    } catch (err) { /* ignorieren */ }
  });
  window.addEventListener('leaskin:events', (e) => {
    const s = JSON.stringify(e.detail);
    if (s !== state.lastEventsJson) { state.lastEventsJson = s; state.dataVersion++; }
    state.events = e.detail; state.lastData = Date.now();
    if (!DEMO && state.lastData - (state.lastAlive || 0) > 20000) {
      state.lastAlive = state.lastData;
      window.postMessage({ type: 'leaskin:alive' }, location.origin);
    }
  });
  window.addEventListener('leaskin:history', (e) => {
    const s = JSON.stringify(e.detail);
    if (s !== state.lastHistJson) { state.lastHistJson = s; state.dataVersion++; }
    state.history = e.detail;
  });

  // ---------- Demo-Modus: ?demo=1 (fiktive Daten, Ort "Demodorf") ----------
  if (DEMO) {
    C.fahrtenbuchFormUrl = C.fahrtenbuchFormUrl || 'https://docs.google.com/forms/d/e/1FAIpQLSdemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo/viewform';
    C.elListe = [['Anna', 'Berger'], ['Max', 'Huber'], ['Paul', 'Fuchs'], ['Lena', 'Steiner']];
    const t0 = Date.now() - 6 * 60 * 1000 - 41000;
    const P = (fn, ln, fns, ans, free, dt) => ({
      id: fn + ln, firstname: fn, lastname: ln, qualifications: [],
      functions: fns.map((s) => ({ id: s, shortname: s, name: s })),
      response: ans ? { timestamp: t0 + dt * 1000, basicresponse: ans, freetext: free || '' } : null
    });
    state.events = [{
      id: 'demo1', eventtype: 'B2', eventtypetext: 'Brand Wohnhaus',
      location: { city: 'Demodorf', zipcode: '3000', street: 'Musterstraße', housenumber: '12', x: 48.1219, y: 16.9472, objectname: '', additionalinfo: 'Zufahrt über Hofeinfahrt' },
      additionalinformation: 'A00000ALLE (14:32) B2 Brand Wohnhaus. Musterstraße 12, 3000 Demodorf: Rauch aus dem Dachbereich, Bewohner im Freien (48.1219, 16.9472)',
      alarmtime: t0,
      alarmedalarmgroups: [{ id: 'A1', name: 'FF Demodorf - Sammelruf' }, { id: 'A2', name: 'FF Nachbarort - Sammelruf' }],
      alarmedpersons: [
        P('Anna', 'Berger', ['EL', 'MA'], 'Nein', '', 20),
        P('Max', 'Huber', ['EL', 'ATS', 'C'], 'Ja', '2 min', 30),
        P('Sabine', 'Gruber', ['MA', 'C'], 'Ja', '', 35),
        P('Tom', 'Wagner', ['ATS', '5,5t'], 'Ja', '3 min', 40),
        P('Paul', 'Fuchs', ['EL'], null, '', 0),
        P('Lisa', 'Bauer', ['ATS'], 'Ja', 'bin im Ort', 50),
        P('Lena', 'Steiner', ['EL', 'MA', 'C'], 'Ja', '', 60),
        P('Karl', 'Mayer', ['5,5t'], 'Ja', '', 70),
        P('Jonas', 'Hofer', ['ATS'], 'Ja', '10 min', 80)
      ]
    }];
    state.history = [
      { eventtype: 'T1', eventtypetext: 'Baum über Straße', alarmtime: Date.now() - 3 * 864e5, location: { street: 'Feldweg', city: 'Demodorf' } },
      { eventtype: 'B1', eventtypetext: 'Brandmeldealarm', alarmtime: Date.now() - 10 * 864e5, location: { city: 'Demodorf' } },
      { eventtype: 'T2', eventtypetext: 'Verkehrsunfall', alarmtime: Date.now() - 18 * 864e5, location: { street: 'Landesstraße', city: 'Nachbarort' } },
      { eventtype: 'B2', eventtypetext: 'Flurbrand', alarmtime: Date.now() - 25 * 864e5, location: { city: 'Demodorf' } }
    ];
    state.dataVersion = 1;
    state.extra = {
      wetter: { temp: 12.4, code: 3, wind: 25, dir: 315, boeen: 45, at: Date.now() },
      fahrtenbuch: [
        { fahrzeug: 'MTF', name: 'Max Huber', zweck: 'Besorgung', von: Date.now() - 3600000, bis: Date.now() + 2 * 3600000 },
        { fahrzeug: 'KLF-W', name: 'Lena Steiner', zweck: 'Übung', von: Date.now() + 2 * 864e5, bis: Date.now() + 2 * 864e5 + 3 * 3600000 }
      ],
      pegel: { wert: 124, einheit: 'cm', klasse: 1, prognose: 128, at: Date.now() },
      wastl: {
        laufend: [{ stufe: 'T1', text: 'Tierrettung', ort: 'Nachbarort A', zeit: '24.10.2026 ~ 1 std.' }, { stufe: 'S1', text: 'Ölspur', ort: 'Nachbarort B', zeit: '24.10.2026 < 1 std.' }],
        feuerwehren: [
          { name: 'Nachbarort A', stufe: 'T1', text: 'Tierrettung', zeit: '24.10.2026 ~ 1 std.' },
          { name: 'Deutsch Haslau', stufe: 'T1', text: 'Tierrettung', zeit: '24.10.2026 ~ 1 std.' },
          { name: 'Nachbarort B', stufe: 'S1', text: 'Ölspur', zeit: '24.10.2026 < 1 std.' }
        ],
        rueckblick: [],
        at: Date.now()
      },
      lsz: { feuerwehren: [{ name: 'Neusiedl am See', code: 'T1-BOOT', stufe: 'T1', text: 'T1-BOOT', alarm: '20:16', dauer: '1:33 h', bezirk: 'ND' }], at: Date.now() },
      fahrzeugStatus: [
        { fahrzeug: 'KLF-W', bereit: 'ja', mangel: '', pickerl: { m: 3, y: 2027 } },
        { fahrzeug: 'MTF', bereit: 'eingeschränkt', mangel: 'Blaulicht hinten links defekt', pickerl: { m: new Date().getMonth() + 1, y: new Date().getFullYear() } },
        { fahrzeug: 'VFA', bereit: 'nein', mangel: 'Reifen vorne rechts platt', pickerl: { m: 6, y: 2026 } }
      ],
      uwz: /[?&]uwz=1\b/.test(location.search) ? [{ tag: 'heute', art: 'Wind', stufe: 2 }, { tag: 'morgen', art: 'Regen', stufe: 1 }] : [],
      schlagzeilen: [
        { titel: 'Beispiel-Schlagzeile: Sturmwarnung für das östliche Niederösterreich', quelle: 'ORF NÖ' },
        { titel: 'Beispiel-Schlagzeile: Neue Regelung für Rettungsgasse tritt in Kraft', quelle: 'ORF' }
      ],
      kalender: [1, 3, 6, 8, 13, 20].map((t, i) => ({ start: new Date(Date.now() + t * 864e5).toISOString().slice(0, 10) + 'T19:00', titel: ['Übung APLE – Durchgang 3', 'Fahrzeugpflege', 'Atemschutzübung', 'Kommandositzung', 'Funkübung', 'Monatsübung'][i] }))
    };
    if (/[?&]ruhe=1\b/.test(location.search)) state.events = [];
  }

  setInterval(tick, 1000);
  document.addEventListener('DOMContentLoaded', tick);
})();

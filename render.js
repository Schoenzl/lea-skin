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
    const amp = ampel(persons);
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

    const map = h('div', 'ls-map');
    const groups = (ev.alarmedalarmgroups || []).map((g) => h('div', 'ls-chip', [g.name || g.id]));
    const links = h('section', 'ls-left', [
      h('div', 'ls-ort', [h('div', 'ls-label', ['Einsatzort']), h('div', 'ls-strasse', [strasse]), ort ? h('div', 'ls-stadt', [ort]) : null]),
      h('div', 'ls-card ls-melde', [h('div', 'ls-label', ['Meldebild']), h('div', 'ls-melde-text', [meldebild(ev)]), extra ? h('div', 'ls-melde-extra', [extra]) : null]),
      h('div', 'ls-bottom', [map, groups.length ? h('div', 'ls-groups', [h('div', 'ls-label', ['Alarmiert'])].concat(groups)) : null])
    ]);

    const ampBox = amp ? h('div', 'ls-ampel ls-st-' + amp.status.replace(/\s+/g, '-'), [
      h('div', 'ls-ampel-head', [
        h('div', 'ls-ampel-fz', [(C.fahrzeug.name || '') + ' · ' + (C.fahrzeug.besatzung || '')]),
        h('div', 'ls-ampel-status', [amp.status])
      ]),
      h('div', 'ls-ampel-grid', amp.rows.map((r) => h('div', 'ls-ampel-row', [
        h('span', null, [r.label]),
        h('span', 'ls-val ' + (r.ok ? 'ls-ok' : r.pflicht ? 'ls-bad' : 'ls-warn'), [r.ist + ' / ' + r.soll])
      ])))
    ]) : null;

    const rows = ranked.map((x, i) => {
      const fns = (x.p.functions || []).slice().sort((a, b) => fnOrder(a.shortname) - fnOrder(b.shortname)).map((f) => {
        const st = fnStyle(f.shortname) || { bg: '#2A3340', fg: '#F2F4F7' };
        return h('span', 'ls-tag', [f.shortname], { background: st.bg, color: st.fg });
      });
      return h('div', 'ls-person' + (i === 0 && x.rank != null ? ' ls-lead' : ''), [
        h('div', 'ls-rank', [x.rank != null ? 'EL ' + x.rank : '']),
        h('div', 'ls-name', [[x.p.firstname, x.p.lastname].filter(Boolean).join(' ')]),
        h('div', 'ls-tags', fns),
        h('div', 'ls-free', [(x.p.response && x.p.response.freetext) || ''])
      ]);
    });

    const rechts = h('section', 'ls-right', [
      h('div', 'ls-count', [h('div', 'ls-count-n', [persons.length]), h('div', null, [h('div', 'ls-label', ['Rückmeldungen']), h('div', 'ls-count-t', ['Zusagen'])]), h('div', 'ls-count-hint', ['gereiht nach EL-Liste'])]),
      ampBox,
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
    const PFARBE = { 3: '#FACC15', 4: '#FB923C', 5: '#F87171', 6: '#E879F9' };
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
        h('div', 'ls-hist-code', [ev.eventtype || '–'], { background: bandColor(ev.eventtype) }),
        h('div', 'ls-hist-main', [h('div', 'ls-hist-title', [ev.eventtypetext || '']), h('div', 'ls-hist-where', [where])])
      ]);
    });

    // Termine: fix eingetragen + Kalender, nur künftige, nächste 3
    const alle = (C.termine || []).concat(ex.kalender || []).map((t) => ({ d: new Date(t.start), titel: t.titel, ganztags: t.ganztags }))
      .filter((t) => !isNaN(t.d) && t.d.getTime() > now - 2 * 3600000)
      .sort((a, b) => a.d - b.d);
    const seen = new Set();
    const termine = alle.filter((t) => { const k = t.d.getTime() + t.titel; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3)
      .map((t) => h('div', 'ls-termin', [h('div', 'ls-termin-wann', [terminZeit(t.d, t.ganztags)]), h('div', 'ls-termin-was', [ohneEmoji(t.titel)])]));

    // WASTL (höchstens 30 min alt)
    const wa = ex.wastl && now - ex.wastl.at < 30 * 60000 && Array.isArray(ex.wastl.laufend) ? ex.wastl : null;
    const kurzZeit = (z) => {
      const d = /(\d{2})\.(\d{2})\.\d{4}\s+(\d{2}):(\d{2})/.exec(z || '');
      if (d) return d[1] + '.' + d[2] + '. ' + d[3] + ':' + d[4];
      const u = /([<~>]\s*\d+)\s*std/i.exec(z || '');
      return u ? u[1].replace(/\s+/g, ' ') + ' Std.' : '';
    };
    const wRow = (e) => h('div', 'ls-w-row', [
      h('div', 'ls-w-chip', [e.stufe || '–'], { background: bandColor(e.stufe) }),
      h('div', 'ls-w-main', [h('div', 'ls-w-ort', [e.ort || e.name || '']), h('div', 'ls-w-text', [e.text || ''])]),
      h('div', 'ls-w-zeit', [kurzZeit(e.zeit)])
    ]);
    const eigen = (n) => C.eigeneFF && norm(n).indexOf(norm(C.eigeneFF)) !== -1;
    let wastlKids;
    if (!wa) {
      wastlKids = [h('div', 'ls-empty', ['keine aktuellen Daten'])];
    } else {
      // Kern: welche Feuerwehr im Bezirk ist draußen – eigene FF zuerst
      const ffs = (wa.feuerwehren || []).slice().sort((a, b) => (eigen(b.name) ? 1 : 0) - (eigen(a.name) ? 1 : 0));
      if (ffs.length) {
        wastlKids = [
          h('div', 'ls-w-head', [
            h('div', 'ls-wastl-n', [String(ffs.length)]),
            h('div', 'ls-wastl-t', [ffs.length === 1 ? 'Feuerwehr im Einsatz' : 'Feuerwehren im Einsatz']),
            wa.laufend.length ? h('div', 'ls-w-count', [wa.laufend.length + (wa.laufend.length === 1 ? ' Einsatz' : ' Einsätze') + ' im Bezirk']) : null
          ])
        ].concat(ffs.slice(0, 7).map((f) => h('div', 'ls-w-ffrow' + (eigen(f.name) ? ' ls-w-own' : ''), [
          h('div', 'ls-w-chip', [f.stufe || '–'], { background: bandColor(f.stufe) }),
          h('div', 'ls-w-ffname', [f.name]),
          h('div', 'ls-w-text', [f.text || '']),
          h('div', 'ls-w-zeit', [kurzZeit(f.zeit)])
        ])));
        if (ffs.length > 7) wastlKids.push(h('div', 'ls-w-more', ['+ ' + (ffs.length - 7) + ' weitere']));
      } else if (wa.laufend.length) {
        wastlKids = [h('div', 'ls-w-head', [h('div', 'ls-wastl-n', [String(wa.laufend.length)]), h('div', 'ls-wastl-t', [wa.laufend.length === 1 ? 'laufender Einsatz im Bezirk' : 'laufende Einsätze im Bezirk'])])]
          .concat(wa.laufend.slice(0, 5).map(wRow));
      } else {
        wastlKids = [h('div', 'ls-w-ruhig', [h('span', 'ls-dot'), 'Keine Feuerwehr im Bezirk im Einsatz'])]
          .concat((wa.rueckblick || []).length ? [h('div', 'ls-label ls-w-sub', ['Zuletzt im Bezirk'])] : [])
          .concat((wa.rueckblick || []).slice(0, 4).map(wRow));
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
        return h('div', 'ls-fz-row ' + cls, [
          h('div', 'ls-fz-name', [fz]),
          h('div', 'ls-fz-status', [h('span', 'ls-fz-dot'), status]),
          h('div', 'ls-fz-detail', [detail])
        ]);
      });
      fzBox = h('div', 'ls-card ls-fz', [h('div', 'ls-label', ['Fahrzeuge'])].concat(rows));
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

    stage.appendChild(h('div', 'ls-ruhe', [
      h('header', 'ls-ruhe-head', [
        h('div', 'ls-brand', [h('div', 'ls-logo', [flamme]), h('div', 'ls-ff', [C.feuerwehr || ''])]),
        h('div', 'ls-status', [h('span', 'ls-dot'), 'Kein aktiver Einsatz'])
      ]),
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

  // ---------- Steuerung ----------
  const tick = () => {
    mount();
    const now = Date.now();
    const fresh = DEMO || (state.events && now - state.lastData < (C.datenTimeoutSek || 45) * 1000);
    if (!fresh) { root.classList.add('ls-hidden'); state.key = ''; return; }
    const evs = listOf(state.events);
    let key;
    if (evs.length) {
      if (!state.lastSwitch) state.lastSwitch = now;
      else if (now - state.lastSwitch > (C.einsatzWechselSek || 15) * 1000) { state.idx = (state.idx + 1) % evs.length; state.lastSwitch = now; }
      if (state.idx >= evs.length) state.idx = 0;
      key = 'e:' + state.idx + ':' + state.dataVersion;
      if (key !== state.key) renderEinsatz(evs[state.idx], state.idx + 1, evs.length);
    } else if (C.ruheAnsicht) {
      key = 'r:' + state.dataVersion + ':' + state.extraVersion + ':' + new Date().getDate();
      if (key !== state.key) renderRuhe();
    } else {
      root.classList.add('ls-hidden'); state.key = ''; return;
    }
    state.key = key;
    root.classList.remove('ls-hidden');
    if (refs.clock) refs.clock.textContent = hhmm(now);
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
  });
  window.addEventListener('leaskin:history', (e) => {
    const s = JSON.stringify(e.detail);
    if (s !== state.lastHistJson) { state.lastHistJson = s; state.dataVersion++; }
    state.history = e.detail;
  });

  // ---------- Demo-Modus: ?demo=1 (fiktive Daten, Ort "Demodorf") ----------
  if (DEMO) {
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
        rueckblick: [{ stufe: 'T1', text: 'Bergung - PKW', ort: 'Nachbarort C', zeit: '24.10.2026 13:22:21' }],
        at: Date.now()
      },
      kalender: [{ start: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) + 'T19:00', titel: 'Übung APLE – Durchgang 3' }]
    };
    if (/[?&]ruhe=1\b/.test(location.search)) state.events = [];
  }

  setInterval(tick, 1000);
  document.addEventListener('DOMContentLoaded', tick);
})();

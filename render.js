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

  const renderRuhe = () => {
    stage.textContent = '';
    refs.timer = null;
    refs.clock = h('div', 'ls-big-clock', [hhmm(Date.now())]);
    refs.date = h('div', 'ls-date', [dateLong(new Date())]);
    const hist = listOf(state.history).slice(0, 4).map((ev) => {
      const loc = ev.location || {};
      const where = [[loc.street, loc.housenumber].filter(Boolean).join(' '), loc.city].filter(Boolean).join(', ') || loc.objectname || '';
      return h('div', 'ls-hist', [
        h('div', 'ls-hist-date', [ev.alarmtime ? ddmm(ev.alarmtime) + ' ' + hhmm(ev.alarmtime) : '']),
        h('div', 'ls-hist-code', [ev.eventtype || '–'], { background: bandColor(ev.eventtype) }),
        h('div', 'ls-hist-main', [h('div', 'ls-hist-title', [ev.eventtypetext || '']), h('div', 'ls-hist-where', [where])])
      ]);
    });
    stage.appendChild(h('div', 'ls-ruhe', [
      h('header', 'ls-ruhe-head', [
        h('div', 'ls-ff', [C.feuerwehr || '']),
        h('div', 'ls-status', [h('span', 'ls-dot'), 'Kein aktiver Einsatz'])
      ]),
      h('main', 'ls-ruhe-body', [
        h('section', 'ls-ruhe-left', [refs.clock, refs.date]),
        h('section', 'ls-ruhe-right', [h('div', 'ls-label', ['Letzte Einsätze'])].concat(hist.length ? hist : [h('div', 'ls-empty', ['Noch keine Daten'])]))
      ])
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
      key = 'r:' + state.dataVersion + ':' + new Date().getDate();
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
    if (/[?&]ruhe=1\b/.test(location.search)) state.events = [];
  }

  setInterval(tick, 1000);
  document.addEventListener('DOMContentLoaded', tick);
})();

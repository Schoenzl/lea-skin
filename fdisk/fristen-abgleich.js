// FDISK-Fristenabgleich – läuft im eingebauten Browser auf app.fdisk.at (angemeldet), über javascript_tool im Top-Fenster.
// Liest je Mitglied (Feuerwehrmitglieder: Aktiv + Reserve) die Gültig-bis-Daten aus
//   Gesetzliche Fahrgenehmigungen (Führerscheinklassen), Feuerwehrführerscheine, Qualifikationen.
// Schritt 1: fdiskMitglieder() → window.__mg (Liste), Schritt 2: fdiskFristen(von, bis) in Teilen (je ~50 Mitglieder, ~25 s),
// Schritt 3: fdiskSenden(url, key) → POST aktion=fristen an die Web-App (ersetzt den Tab „Fristen (FDISK)“).
// Keine Sozialversicherungsnummern o. Ä. werden übernommen – nur Name, Standesbuchnummer, Art, Gültig bis.
window.fdiskMitglieder = async () => {
  const f = window.frames[3];
  f.location.href = '/fdisk/module/mgvw/mitgliedschaften/MitgliedschaftenList.aspx?search=1&searchid_feuerwehren=311&searchid_instanzen=3000&id_instanzen=3000&searchid_instanzen_besitzer=3000&searchid_fahrzeugstatus=1';
  await new Promise((r) => setTimeout(r, 4000));
  if (/login/i.test(window.frames[3].location.href)) throw new Error('FDISK nicht angemeldet');
  window.frames[3].FdcLayListMitgliedschaften_changeAnzahlDropdown('ALLE');
  await new Promise((r) => setTimeout(r, 6000));
  const d = window.frames[3].document, seen = {}, m = [];
  d.querySelectorAll('a[href*="PersonenForm.aspx"]').forEach((a) => {
    const u = new URL(a.href), id = u.searchParams.get('id_personen');
    if (seen[id]) return; seen[id] = 1;
    const tds = Array.from(a.closest('tr').children).map((c) => c.textContent.trim());
    m.push({ status: tds[1], sbn: tds[2], vn: tds[4], nn: tds[5], idp: id, idm: u.searchParams.get('id_mitgliedschaften') });
  });
  window.__mg = m; window.__fr = [];
  return m.length;
};
window.fdiskFristen = async (von, bis) => {
  const P = {
    ges: '/fdisk/module/mgvw/ges_fahrgenehmigungen/Ges_fahrgenehmigungenListEdit.aspx?search=1&searchid_mitgliedschaften=IDM&id_personen=IDP&id_mitgliedschaften=IDM&searchid_personen=IDP&searchid_maskmode=&searchid_instanzen=3000',
    ffs: '/fdisk/module/mgvw/feuerwehrfuehrerscheine/FeuerwehrfuehrerscheineList.aspx?search=1&searchid_mitgliedschaften=IDM&id_personen=IDP&id_mitgliedschaften=IDM&searchid_personen=IDP&searchid_maskmode=&searchid_instanzen=3000',
    qua: '/fdisk/module/mgvw/zu_personen_qualifikationen/Zu_personen_qualifikationenList.aspx?search=1&searchid_mitgliedschaften=IDM&id_personen=IDP&id_mitgliedschaften=IDM&searchid_personen=IDP&searchid_maskmode='
  };
  const dat = (s) => (String(s || '').match(/\d{2}\.\d{2}\.\d{4}/) || [''])[0];
  for (const m of window.__mg.slice(von, bis)) {
    try {
      const holen = async (p) => { const r = await fetch(p.replace(/IDM/g, m.idm).replace(/IDP/g, m.idp), { credentials: 'include' }); if (/login/i.test(r.url)) throw new Error('FDISK nicht angemeldet'); return new DOMParser().parseFromString(await r.text(), 'text/html'); };
      const out = [];
      const tabelle = (doc, artSpalte, artFest) => {
        const zeilen = Array.from(doc.querySelectorAll('tr')).filter((tr) => !tr.querySelector('tr'));
        const k = zeilen.findIndex((tr) => /Gültig bis/.test(tr.textContent)); if (k < 0) return;
        const kopf = Array.from(zeilen[k].children).map((c) => c.textContent.trim());
        const ib = kopf.findIndex((x) => /Gültig bis/.test(x)), ia = artSpalte ? kopf.indexOf(artSpalte) : -1;
        zeilen.slice(k + 1).forEach((tr) => { const z = Array.from(tr.children).map((c) => c.textContent.replace(/\s+/g, ' ').trim()); if (z.length !== kopf.length) return; const b = dat(z[ib]); if (b) out.push({ art: artFest || z[ia], bis: b }); });
      };
      const g = await holen(P.ges);
      for (let i = 0; i < 30; i++) {
        const b = g.querySelector('[name$="gueltig_bis_' + i + '"]'), s = g.querySelector('[name$="id_fahrgenehmigungsklassen_' + i + '"]');
        if (!b && !s) break;
        const kl = s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].text.trim() : '';
        if (dat(b && b.value) && kl) out.push({ art: /^KFZ-Führerschein/.test(kl) ? 'Führerschein ' + kl.replace(/^KFZ-Führerschein\s*\/\s*/, '') : kl.replace(/^.*\/\s*/, ''), bis: dat(b.value) });
      }
      tabelle(await holen(P.ffs), null, 'Feuerwehrführerschein');
      tabelle(await holen(P.qua), 'Qualifikation');
      out.forEach((x) => window.__fr.push({ name: m.vn + ' ' + m.nn, sbn: m.sbn, art: x.art, bis: x.bis }));
    } catch (e) { if (/angemeldet/.test(e.message)) throw e; window.__fr.push({ sbn: m.sbn, fehler: e.message }); }
  }
  return { bisher: window.__fr.length, mitglieder: window.__mg.length };
};
window.fdiskSenden = async (url, key) => {
  const liste = window.__fr.filter((x) => !x.fehler);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ aktion: 'fristen', key, liste }) });
  return { antwort: await r.text(), gesendet: liste.length, fehler: window.__fr.filter((x) => x.fehler).map((x) => x.sbn + ': ' + x.fehler) };
};
'FDISK-Fristenabgleich geladen';

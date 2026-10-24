// Liest die Antworten mit, die der LEA-Infoscreen ohnehin alle 10 bzw. 30 Sekunden abholt.
// Es werden KEINE eigenen Anfragen gestellt und KEINE Anfrage-Header (Token) gelesen –
// nur der Inhalt der Antworten auf /events und /eventhistory.
(() => {
  const API = 'lea-screen.api.notrufnoe.at';
  const emit = (type, data) => window.dispatchEvent(new CustomEvent('leaskin:' + type, { detail: data }));

  const handle = (url, body) => {
    try {
      if (!url || url.indexOf(API) === -1) return;
      const path = new URL(url, location.href).pathname.replace(/\/+$/, '');
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      if (path.endsWith('/eventhistory')) emit('history', data);
      else if (path.endsWith('/events')) emit('events', data);
    } catch (e) { /* unbekanntes Format -> ignorieren, Original bleibt sichtbar */ }
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__leaskinUrl = String(url);
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      if (this.status !== 200) return;
      const t = this.responseType;
      handle(this.__leaskinUrl, t === '' || t === 'text' ? this.responseText : this.response);
    });
    return send.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      const p = origFetch.apply(this, arguments);
      p.then((r) => { if (r.ok && r.url.indexOf(API) !== -1) r.clone().text().then((t) => handle(r.url, t)).catch(() => {}); }).catch(() => {});
      return p;
    };
  }
})();

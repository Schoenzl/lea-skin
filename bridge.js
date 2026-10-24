// Brücke: reicht Wetter/WASTL/Termine aus dem Hintergrund-Dienst an die Anzeige (render.js) weiter.
(() => {
  const send = (extra) => {
    if (!extra) return;
    window.postMessage({ type: 'leaskin:extra', json: JSON.stringify(extra) }, location.origin);
  };
  const pull = () => chrome.storage.local.get('extra').then((r) => send(r.extra)).catch(() => {});
  chrome.storage.onChanged.addListener((ch) => { if (ch.extra) send(ch.extra.newValue); });
  try { chrome.runtime.sendMessage('leaskin-refresh'); } catch (e) {}
  pull();
  setTimeout(pull, 2000);
  setInterval(pull, 60000);
})();

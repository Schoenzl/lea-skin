#!/usr/bin/env python3
"""Handy-Ansicht des Einsatzmonitors – kleiner Server am Pi.

- Die Erweiterung schickt alle 5 s den aktuellen Stand per POST /push (nur von 127.0.0.1).
- Das Handy holt sich die Seite (/) und die Daten (/data) über Tailscale
  („tailscale serve“ leitet https://<pi>.<tailnet>.ts.net auf 127.0.0.1:8787 weiter).
- Der Server lauscht nur auf 127.0.0.1, ist also weder im WLAN noch im Internet erreichbar.
- Nichts wird auf die Festplatte geschrieben; der Stand liegt nur im Arbeitsspeicher.
Nur Python-Standardbibliothek.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST, PORT = '127.0.0.1', int(os.environ.get('LEA_MOBIL_PORT', '8787'))
DIR = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 2 * 1024 * 1024
DATEIEN = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/manifest.webmanifest': ('manifest.webmanifest', 'application/manifest+json'),
    '/icon-180.png': ('icon-180.png', 'image/png'),
    '/icon-512.png': ('icon-512.png', 'image/png'),
}

stand = {'empfangen': 0, 'json': None}
sperre = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = 'lea-mobil'
    sys_version = ''

    def log_message(self, *args):  # keine Zugriffsprotokolle (enthalten nichts Nützliches, schonen die SD-Karte)
        pass

    def _antwort(self, code, body, typ='text/plain; charset=utf-8', extra=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', typ)
        self.send_header('Content-Length', str(len(body)))
        kopf = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}
        kopf.update(extra or {})
        for k, v in kopf.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        pfad = self.path.split('?', 1)[0]
        if pfad == '/data':
            with sperre:
                j, t = stand['json'], stand['empfangen']
            body = '{"jetzt":%d,"empfangen":%d,"d":%s}' % (time.time() * 1000, t, j or 'null')
            return self._antwort(200, body, 'application/json; charset=utf-8')
        if pfad == '/gesund':
            return self._antwort(200, 'ok')
        if pfad.startswith('/fonts/') and pfad.endswith('.woff2'):
            name = os.path.basename(pfad)
            ordner = os.path.join(DIR, '..', 'fonts')
            if name in os.listdir(ordner):
                with open(os.path.join(ordner, name), 'rb') as f:
                    return self._antwort(200, f.read(), 'font/woff2', {'Cache-Control': 'max-age=604800'})
        if pfad in DATEIEN:
            name, typ = DATEIEN[pfad]
            try:
                with open(os.path.join(DIR, name), 'rb') as f:
                    return self._antwort(200, f.read(), typ)
            except OSError:
                return self._antwort(404, 'fehlt')
        return self._antwort(404, 'nicht gefunden')

    def do_POST(self):
        if self.path.split('?', 1)[0] != '/push':
            return self._antwort(404, 'nicht gefunden')
        # Nur die Erweiterung am Pi selbst darf schreiben – nicht über Tailscale (dort kommt X-Forwarded-For mit)
        if self.client_address[0] != '127.0.0.1' or self.headers.get('X-Forwarded-For') or self.headers.get('Tailscale-User-Login'):
            return self._antwort(403, 'verboten')
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            return self._antwort(413, 'zu groß')
        roh = self.rfile.read(n)
        try:
            json.loads(roh)
        except ValueError:
            return self._antwort(400, 'kein JSON')
        with sperre:
            stand['json'] = roh.decode('utf-8')
            stand['empfangen'] = int(time.time() * 1000)
        return self._antwort(204, b'')

    def do_OPTIONS(self):
        return self._antwort(405, 'nein')


if __name__ == '__main__':
    print('lea-mobil lauscht auf http://%s:%d' % (HOST, PORT), flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

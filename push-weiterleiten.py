#!/usr/bin/env python3
"""Push-Weiterleitung FF Deutsch Haslau – läuft per cron jede Minute (update.sh richtet das ein).

Die Web-App (Apps Script) kann ntfy.sh nicht direkt erreichen (Googles gemeinsame Adressen → 429).
Sie stellt Meldungen (Einchecken, Mängel, Feedback) in den Tab „Push“. Dieses Skript holt sie ab
(aktion „pushAbholen“, Schlüssel einsatzKey) und schickt sie über die eigene Leitung an kommandoPushTopic.
Wirkt nur auf dem Pi mit config.secret.js (einsatzUrl, einsatzKey, kommandoPushTopic), sonst tut es nichts.
Protokoll: /tmp/lea-push.log
"""
import fcntl, json, os, re, time, urllib.error, urllib.parse, urllib.request

D = os.path.dirname(os.path.abspath(__file__))
SECRET = os.path.join(D, 'config.secret.js')
OFFEN = os.path.expanduser('~/.lea-push-offen.json')
LOG = '/tmp/lea-push.log'
VERFALL = 2 * 3600   # was so lange nicht an ntfy ging, wird verworfen


def log(text):
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > 200_000:
            os.replace(LOG, LOG + '.alt')
        with open(LOG, 'a') as f:
            f.write(time.strftime('%d.%m. %H:%M:%S ') + text + '\n')
    except OSError:
        pass


def wert(name, s):
    m = re.search(name + r"\s*=\s*'([^']*)'", s)
    return m.group(1) if m else ''


def speichern(liste):
    tmp = OFFEN + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(liste, f)
    os.replace(tmp, OFFEN)


def main():
    try:
        s = open(SECRET).read()
    except OSError:
        return
    url, key, topic = wert('einsatzUrl', s), wert('einsatzKey', s), wert('kommandoPushTopic', s)
    if not (url and key and topic):
        return
    sperre = open('/tmp/lea-push.lock', 'w')
    try:
        fcntl.flock(sperre, fcntl.LOCK_EX | fcntl.LOCK_NB)   # nicht doppelt laufen
    except OSError:
        return
    try:
        offen = json.load(open(OFFEN))
    except (OSError, ValueError):
        offen = []

    # 1) abholen
    try:
        req = urllib.request.Request(url, data=json.dumps({'aktion': 'pushAbholen', 'key': key}).encode(),
                                     headers={'Content-Type': 'text/plain;charset=utf-8'})
        a = json.load(urllib.request.urlopen(req, timeout=40))
        if a.get('ok'):
            ids = {p.get('id') for p in offen}
            for p in a.get('push') or []:
                if p.get('id') not in ids:
                    p['seit'] = time.time()
                    offen.append(p)
                    log('abgeholt: ' + str(p.get('titel', '')))
        else:
            log('Web-App lehnt ab: ' + str(a.get('fehler')))
    except Exception as e:   # Web-App nicht erreichbar → nächste Minute wieder
        log('Web-App nicht erreichbar: %s' % e)
    speichern(offen)   # abgeholt ist abgeholt: erst merken, dann schicken

    # 2) an ntfy schicken
    rest = []
    for i, p in enumerate(offen):
        titel = str(p.get('titel') or 'FF Deutsch Haslau')
        if time.time() - p.get('seit', 0) > VERFALL:
            log('verworfen (zu alt): ' + titel)
        else:
            q = {'title': titel}
            if p.get('tags'):
                q['tags'] = p['tags']
            if p.get('link'):
                q['click'] = p['link']
            try:
                r = urllib.request.Request('https://ntfy.sh/' + urllib.parse.quote(topic) + '?' + urllib.parse.urlencode(q, quote_via=urllib.parse.quote),
                                           data=str(p.get('text') or '').encode(), method='POST')
                urllib.request.urlopen(r, timeout=15)
                log('gesendet: ' + titel)
            except urllib.error.HTTPError as e:
                log('ntfy antwortet %s: %s' % (e.code, titel))
                if e.code != 400:   # 400 = Meldung selbst kaputt, nicht ewig wiederholen
                    rest.append(p)
            except Exception as e:
                log('ntfy nicht erreichbar: %s' % e)
                rest.append(p)
        speichern(rest + offen[i + 1:])   # Gesendetes sofort austragen


if __name__ == '__main__':
    main()

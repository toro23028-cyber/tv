"""Importação editorial contínua. Credencial de serviço permanece nesta máquina."""
import argparse
import hashlib
import html
import ipaddress
import json
import os
import re
import socket
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

LIMITS = {'news': 78, 'tweet': 160, 'topic': 54}

def key(item):
    url = item.get('url', '')
    if url:
        u = urllib.parse.urlsplit(url)
        host = u.netloc.lower().removeprefix('www.').replace('twitter.com', 'x.com')
        query = urllib.parse.urlencode([(k, v) for k, v in urllib.parse.parse_qsl(u.query) if not k.lower().startswith('utm_') and k not in ('s', 'si', 'ref')])
        text = urllib.parse.urlunsplit((u.scheme, host, u.path.rstrip('/'), query, ''))
    else:
        text = re.sub(r'\s+', ' ', item.get('title', '')).strip().lower() + ':' + item.get('source', '').strip().lower()
    return item.get('kind', 'news') + (':url:' if url else ':text:') + text

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirecionamento recusado: use o endereço final do feed.')

def read_feed(source):
    u = urllib.parse.urlsplit(source['url'])
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.port:
        raise ValueError('Use feed HTTPS público.')
    addresses = socket.getaddrinfo(u.hostname, 443, socket.AF_INET)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Endereço não público.')
    req = urllib.request.Request(source['url'], headers={'User-Agent': 'TrendTV-Editorial/2.0'})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
        raw = response.read(500001)
    if len(raw) > 500000:
        raise ValueError('Feed acima de 500 KB.')
    return parse_feed(raw, source)

def parse_feed(raw, source):
    kind = source.get('kind', 'news')
    if kind not in LIMITS:
        raise ValueError('Tipo de conteúdo inválido.')
    raw = raw.decode('utf-8-sig') if isinstance(raw, bytes) else raw
    if raw.lstrip().startswith('<'):
        if '<!DOCTYPE' in raw.upper() or '<!ENTITY' in raw.upper():
            raise ValueError('Declarações XML não permitidas.')
        root = ET.fromstring(raw)
        def name(n): return n.tag.rsplit('}', 1)[-1]
        def text(n, tag): return next((''.join(c.itertext()).strip() for c in n if name(c) == tag), '')
        channel = next((n for n in root if name(n) == 'channel'), root)
        items = []
        for n in root.iter():
            if name(n) not in ('item', 'entry'): continue
            link = next((c for c in n if name(c) == 'link'), None)
            items.append({'title': text(n, 'title'), 'source': text(channel, 'title'),
                          'url': (link.attrib.get('href') or link.text or '') if link is not None else '',
                          'published': text(n, 'pubDate') or text(n, 'published')})
    else:
        data = json.loads(raw); items = data if isinstance(data, list) else data.get('items', [])
    result = []
    for p in items[:100]:
        if not isinstance(p, dict): continue
        title = html.unescape(re.sub('<[^>]+>', '', str(p.get('title') or p.get('text') or ''))).strip()
        if kind == 'news': title = ' '.join(title.split()[:12])
        title = title[:LIMITS[kind]]
        author = str(p.get('source') or p.get('author') or source.get('name') or 'TREND TV')[:48]
        url = str(p.get('url') or p.get('link') or '')
        if urllib.parse.urlsplit(url).scheme not in ('http', 'https'): url = ''
        if not title: continue
        result.append({'title': title, 'source': author, 'url': url, 'kind': kind,
                       'subtitle': str(p.get('subtitle') or '')[:130], 'category': 'Atualização automática',
                       'urgent': False, 'approved': False, 'durationMinutes': 30,
                       'imageUrl': '', 'published': p.get('published', '')})
    return result

def decode(v):
    if 'mapValue' in v: return {k: decode(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [decode(x) for x in v['arrayValue'].get('values', [])]
    if 'integerValue' in v: return int(v['integerValue'])
    return next(iter(v.values()), None)

def encode(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [encode(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: encode(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}

def fresh_items(incoming, seen, now):
    output = []
    for p in incoming:
        k = key(p)
        if k in seen: continue
        seen.add(k)
        dated = p.pop('published', '')
        if dated:
            try:
                from datetime import datetime
                date = datetime.fromisoformat(dated.replace('Z', '+00:00')) if 'T' in dated else parsedate_to_datetime(dated)
                if now - date.timestamp() * 1000 > 86400000: continue
            except (ValueError, TypeError): pass
        output.append({**p, 'id': 'auto-' + hashlib.sha256(k.encode()).hexdigest()[:24],
                       'expiresAt': now + 1800000, 'autoImported': True})
    return output

def sync_channel(session, base, document):
    name = document['name']; channel = name.rsplit('/', 1)[-1]
    config = {k: decode(v) for k, v in document.get('fields', {}).items()}
    if not config.get('enabled'): return
    now = int(time.time() * 1000)
    interval = max(5, min(60, int(config.get('intervalMinutes', 5))))
    if now - config.get('lastRunAt', 0) < interval * 60000: return
    incoming = []; failed = 0
    for source in config.get('sources', [])[:5]:
        try: incoming.extend(read_feed(source))
        except Exception: failed += 1
    seen_list = config.get('seenKeys', []); seen = set(seen_list)
    blocked = set(config.get('suppressedKeys', []))
    fresh = fresh_items([p for p in incoming if key(p) not in blocked], seen, now)
    new_seen = seen_list + [key(p) for p in fresh if key(p) not in set(seen_list)]
    # Keep an idempotence history even after published content expires.
    new_seen = list(dict.fromkeys(new_seen + sorted(seen - set(new_seen))))[-2000:]
    writes = []
    target = 'newsPublished' if config.get('autoPublish') else 'newsDrafts'
    response = session.get(base + '/' + target + '/' + channel, timeout=20)
    if response.status_code not in (200, 404): response.raise_for_status()
    old_doc = response.json() if response.status_code == 200 else {}
    old = {k: decode(v) for k, v in old_doc.get('fields', {}).items()}
    existing = old.get('items', [])
    existing_keys = {key(p) for p in existing}
    fresh = [p for p in fresh if key(p) not in existing_keys]
    if config.get('autoPublish') and config.get('config', {}).get('enabled'):
        existing = [p for p in existing if p.get('approved') and p.get('expiresAt', 0) > now]
        fresh = [{**p, 'approved': True} for p in fresh]
        limit = 50
    elif not config.get('autoPublish'):
        limit = 100
    else:
        fresh = []; limit = 50
    # Never rewrite drafts when no new entry exists; preserve unrelated manual fields.
    if fresh:
        room = max(0, limit - len(existing))
        retained = fresh[:room]
        # Entries above the limit remain eligible on the next run.
        excluded = {key(p) for p in fresh[room:]}
        new_seen = [k for k in new_seen if k not in excluded]
        if retained:
            data = {**old, 'items': existing + retained, 'updatedAt': now}
            if target == 'newsPublished': data['config'] = config.get('config', {})
            writes.append({'update': {'name': name.replace('/editorialAutomation/', '/' + target + '/'),
                                     'fields': {k: encode(v) for k, v in data.items()}},
                           'currentDocument': {'updateTime': old_doc['updateTime']} if old_doc else {'exists': False}})
    writes.append({'update': {'name': name, 'fields': {k: encode(v) for k, v in {
        'lastRunAt': now, 'lastError': f'{failed} fontes indisponíveis' if failed else '', 'seenKeys': new_seen}.items()}},
        'updateMask': {'fieldPaths': ['lastRunAt', 'lastError', 'seenKeys']},
        'currentDocument': {'updateTime': document['updateTime']}})
    result = session.post(base + ':commit', json={'writes': writes}, timeout=20)
    if result.status_code in (409, 412): return # Concurrent manual edit wins; retry next pass.
    result.raise_for_status()
    print(f'{channel}: {len(fresh)} itens novos, {failed} fontes indisponíveis', flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--once', action='store_true'); args = parser.parse_args()
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    credentials = service_account.Credentials.from_service_account_file(os.environ['GOOGLE_APPLICATION_CREDENTIALS'], scopes=['https://www.googleapis.com/auth/datastore'])
    session = AuthorizedSession(credentials)
    project = os.environ.get('FIREBASE_PROJECT_ID') or credentials.project_id
    base = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents'
    while True:
        try:
            token = ''
            while True:
                response = session.get(base + '/editorialAutomation', params={'pageSize': 100, **({'pageToken': token} if token else {})}, timeout=20)
                response.raise_for_status(); data = response.json()
                for document in data.get('documents', []):
                    try: sync_channel(session, base, document)
                    except Exception as error: print(f'Canal não atualizado: {type(error).__name__}', flush=True)
                token = data.get('nextPageToken', '')
                if not token: break
            from playlist_sync import sync_playlists
            sync_playlists(session,base)
            from live_sync import sync_lives
            sync_lives(session,base)
        except Exception as error:
            if args.once: raise
            print(f'Importação pausada: {type(error).__name__}. Nova tentativa em 60 segundos.', flush=True)
        if args.once: break
        time.sleep(60)

if __name__ == '__main__':
    main()

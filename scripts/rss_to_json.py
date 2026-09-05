"""Converte manchetes de RSS/Atom para revisão no painel; não publica no Firebase."""
import argparse
import json
import sys
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path


def convert(raw):
    root = ET.fromstring(raw)
    def name(node):
        return node.tag.rsplit('}', 1)[-1]
    def child(node, tag):
        return next((p for p in node if name(p) == tag), None)
    def content(node, tag):
        p = child(node, tag)
        return ''.join(p.itertext()).strip() if p is not None else ''
    channel = next((p for p in root if name(p) == 'channel'), root)
    source = content(channel, 'title')[:80]
    output = []
    seen = set()
    for item in root.iter():
        if name(item) not in ('item', 'entry'):
            continue
        title = content(item, 'title')[:240]
        link = child(item, 'link')
        url = (link.attrib.get('href') or link.text or '').strip() if link is not None else ''
        if urllib.parse.urlsplit(url).scheme not in ('http', 'https'):
            url = ''
        key = url or title
        if not title or key in seen:
            continue
        seen.add(key)
        output.append({'title': title, 'source': source, 'url': url,
                       'kind': 'news', 'approved': False, 'urgent': False,
                       'expiresAt': int(time.time() * 1000) + 86400000})
        if len(output) >= 100:
            break
    return {'items': output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if urllib.parse.urlsplit(args.url).scheme not in ('http', 'https'):
        parser.error('Use uma URL http ou https de RSS público.')
    request = urllib.request.Request(args.url, headers={'User-Agent': 'TrendTV-RSS-Importer/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read(1000001)
    if len(raw) > 1000000:
        raise ValueError('Feed maior que 1 MB. Use um feed menor.')
    result = convert(raw)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(result["items"])} manchetes salvas para revisão em {args.output}')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Erro: {error}', file=sys.stderr)
        sys.exit(1)

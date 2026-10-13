import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'scripts/editorial_worker.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
class Response:
    status_code = 200
    def __init__(self, data): self.data = data
    def json(self): return self.data
    def raise_for_status(self): pass
class Session:
    def __init__(self, document): self.document = document; self.commits = []
    def get(self, *a, **k): return Response(self.document)
    def post(self, *a, **k): self.commits.append(k['json']); return Response({})
class WorkerTests(unittest.TestCase):
    def test_rss(self):
        result = w.parse_feed('<rss><channel><title>Fonte</title><item><title><![CDATA[Notícia & teste]]></title><link>https://example.com/1</link></item></channel></rss>', {'kind':'news'})
        self.assertEqual(result[0]['title'], 'Notícia & teste'); self.assertFalse(result[0]['approved'])
    def test_json_tweet_limit(self):
        result = w.parse_feed('[{"text":"' + 'a'*200 + '","author":"@perfil"}]', {'kind':'tweet'})
        self.assertEqual(len(result[0]['title']),160); self.assertEqual(result[0]['source'],'@perfil')
    def test_entity_block(self):
        with self.assertRaises(ValueError): w.parse_feed('<!DOCTYPE rss [<!ENTITY x "test">]><rss/>',{'kind':'news'})
    def test_codec(self):
        v = {'items':[{'approved':True, 'expiresAt':123}], 'enabled':False}
        self.assertEqual(w.decode(w.encode(v)),v)
    def test_no_expiry_renewal(self):
        p = {'title':'Teste','source':'Fonte','kind':'news','url':'https://example.com/1'}
        seen = set(); first = w.fresh_items([dict(p)], seen, 1000)
        self.assertEqual(first[0]['expiresAt'],1801000); self.assertEqual(w.fresh_items([dict(p)],seen,2000),[])
    def test_canonical_social(self):
        p = {'kind':'tweet','url':'https://twitter.com/a/status/1?s=20'}
        self.assertEqual(w.key(p), w.key({**p,'url':'https://x.com/a/status/1'}))
    def test_manual_edits_preserved_and_commit_preconditions(self):
        now=1000
        old={'items':[{'id':'manual','title':'Manual','source':'Fonte','kind':'news','approved':True,'expiresAt':99999999}], 'config':{'enabled':True}}
        sess=Session({'updateTime':'published-version','fields':{k:w.encode(v) for k,v in old.items()}})
        automation={'enabled':True,'autoPublish':True,'sources':[{'url':'https://example.com/rss'}], 'config':{'enabled':True}}
        doc={'name':'projects/p/databases/(default)/documents/editorialAutomation/c','updateTime':'automation-version','fields':{k:w.encode(v) for k,v in automation.items()}}
        with patch.object(w,'read_feed',return_value=[{'title':'Nova','source':'Fonte','kind':'news'}]),patch.object(w.time,'time',return_value=1000):
            w.sync_channel(sess,'https://example.com/documents',doc)
        writes=sess.commits[0]['writes']; self.assertEqual(len(writes),2)
        data={k:w.decode(v) for k,v in writes[0]['update']['fields'].items()}
        self.assertEqual(data['items'][0]['id'],'manual'); self.assertTrue(data['items'][1]['approved'])
        self.assertEqual(writes[0]['currentDocument'],{'updateTime':'published-version'})
        self.assertEqual(writes[1]['currentDocument'],{'updateTime':'automation-version'})
    def test_suppressed_item_is_not_reimported(self):
        item={'title':'Removido','source':'Fonte','kind':'tweet','url':'https://x.com/a/status/1'}
        config={'enabled':True,'autoPublish':True,'sources':[{'url':'https://example.com/rss'}],'config':{'enabled':True},'suppressedKeys':[w.key(item)]}
        doc={'name':'test/editorialAutomation/c','updateTime':'v','fields':{k:w.encode(v) for k,v in config.items()}}
        sess=Session({'updateTime':'pub-v','fields':{'items':w.encode([])}})
        with patch.object(w,'read_feed',return_value=[item]),patch.object(w.time,'time',return_value=1000):w.sync_channel(sess,'https://example.com',doc)
        self.assertEqual(len(sess.commits[0]['writes']),1)
    def test_disabled_automation_no_requests(self):
        sess=Session({}); w.sync_channel(sess,'url',{'name':'test/c','fields':{}}); self.assertEqual(sess.commits,[])
if __name__ == '__main__': unittest.main()

import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import live_sync as l
from editorial_worker import encode,decode
from unittest.mock import patch
import unittest
import io
class Response:
 status_code=200
 def __init__(self,data):self.data=data
 def json(self):return self.data
 def raise_for_status(self):pass
class Session:
 def __init__(self,c):self.c=c;self.commits=[]
 def get(self,*a,**k):return Response({'documents':[{'name':'projects/p/databases/(default)/documents/channels/c','updateTime':'v','fields':{k:encode(v) for k,v in self.c.items()}}]})
 def post(self,*a,**k):self.commits.append(k['json']);return Response({})
class Tests(unittest.TestCase):
 def test_new_live_shared_metadata_without_search(self):
  sess=Session({'autoMode':'live','autoLiveChannel':'UC1234567890123456789012'})
  def api(resource,params):
   if resource=='channels':return {'items':[{'contentDetails':{'relatedPlaylists':{'uploads':'UP123'}}}]}
   if resource=='playlistItems':return {'items':[{'snippet':{'resourceId':{'videoId':'abcdefghijk'}}}]}
   if resource=='videos':return {'items':[{'id':'abcdefghijk','snippet':{'liveBroadcastContent':'live','title':'Nova live'}}]}
   self.fail('search não é necessário para live recente')
  with patch.dict('os.environ',{'YOUTUBE_API_KEY':'test'}),patch.object(l,'api',side_effect=api):l.sync_lives(sess,'base',1000000)
  fields=sess.commits[0]['writes'][0]['update']['fields'];self.assertEqual(decode(fields['autoLiveVideoId']),'abcdefghijk');self.assertEqual(decode(fields['autoLiveStatus']),'live')
 def test_fresh_check_no_quota(self):
  sess=Session({'autoMode':'live','autoLiveChannel':'@canal','autoLiveCheckedAt':999000})
  with patch.object(l,'api',side_effect=AssertionError('não consultar')):l.sync_lives(sess,'base',1000000)
  self.assertEqual(sess.commits,[])
 def test_hls_failure_marks_reserve_without_youtube_key(self):
  sess=Session({'autoMode':'live','autoHlsUrl':'https://example.com/live.m3u8'})
  with patch.object(l.urllib.request,'urlopen',side_effect=OSError('offline')):l.sync_lives(sess,'base',1000000)
  self.assertEqual(decode(sess.commits[0]['writes'][0]['update']['fields']['autoHlsStatus']),'waiting')
if __name__=='__main__':unittest.main()

import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import playlist_sync as p
import unittest
from unittest.mock import patch
class SyncTests(unittest.TestCase):
 def test_playlist_domain(self):
  self.assertEqual(p.playlist_id('https://youtube.com/playlist?list=PL1234567890'),'PL1234567890')
  self.assertIsNone(p.playlist_id('https://evil.example/playlist?list=PL1234567890'))
 def test_duration(self): self.assertEqual(p.duration('PT1H2M3S'),3723);self.assertEqual(p.duration('P1DT1H'),90000)
 def test_recorded_only_and_order(self):
  def api(resource,params):
   if resource=='playlistItems':return {'items':[{'snippet':{'resourceId':{'videoId':v}}} for v in ['abcdefghijk','12345678901','98765432109']]}
   return {'items':[{'id':'abcdefghijk','snippet':{'title':'Gravado','liveBroadcastContent':'none'},'contentDetails':{'duration':'PT5M'},'status':{'embeddable':True}}, {'id':'12345678901','snippet':{'liveBroadcastContent':'live'},'contentDetails':{'duration':'PT3H'}},{'id':'98765432109','snippet':{'liveBroadcastContent':'upcoming'}}]}
  with patch.object(p,'api',side_effect=api):
   videos=p.fetch_playlist('PL1234567890');self.assertEqual(len(videos),1);self.assertEqual(videos[0]['duration'],300)
 def test_large_playlist_never_truncates(self):
  with patch.object(p,'api',return_value={'items':[],'nextPageToken':'more'}):
   with self.assertRaises(ValueError):p.fetch_playlist('PL1234567890')
if __name__=='__main__':unittest.main()

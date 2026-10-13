"""Sincroniza playlists dos programas às 22h de Brasília, preservando a grade."""
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo
from editorial_worker import encode, decode
RETRY_AFTER = {}

def playlist_id(url):
    u = urllib.parse.urlsplit(url or '')
    if u.scheme != 'https' or u.hostname not in ('youtube.com', 'www.youtube.com', 'm.youtube.com'): return None
    value = urllib.parse.parse_qs(u.query).get('list', [''])[0]
    return value if re.fullmatch(r'[\w-]{10,100}', value) else None

def api(resource, params):
    url = 'https://www.googleapis.com/youtube/v3/' + resource + '?' + urllib.parse.urlencode({**params, 'key':os.environ['YOUTUBE_API_KEY']})
    with urllib.request.urlopen(url, timeout=15) as response:
        raw=response.read(2000001)
    if len(raw)>2000000: raise ValueError('Resposta acima do limite.')
    return json.loads(raw)

def duration(value):
    m = re.fullmatch(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?', value or '')
    return sum(int(v or 0)*weight for v,weight in zip(m.groups(),[86400,3600,60,1])) if m else 0

def fetch_playlist(id):
    ids=[]; token=''
    for _ in range(4):
        data=api('playlistItems',{'playlistId':id,'part':'snippet','maxResults':50,**({'pageToken':token} if token else {})})
        ids += [p.get('snippet',{}).get('resourceId',{}).get('videoId') for p in data.get('items',[])]
        token=data.get('nextPageToken','')
        if not token: break
    if token: raise ValueError('Playlist acima de 200 vídeos; importação cancelada para não truncar.')
    ids=list(dict.fromkeys(id for id in ids if id and re.fullmatch(r'[\w-]{11}', id)))
    metadata={}
    for start in range(0,len(ids),50):
        for p in api('videos',{'id':','.join(ids[start:start+50]),'part':'snippet,contentDetails,status','maxResults':50}).get('items',[]): metadata[p['id']]=p
    output=[]
    for id in ids:
        p=metadata.get(id)
        if not p or p.get('snippet',{}).get('liveBroadcastContent') in ('live','upcoming'): continue
        seconds=duration(p.get('contentDetails',{}).get('duration'))
        if not seconds or p.get('status',{}).get('embeddable') is False: continue
        output.append({'youtubeUrl':'https://youtu.be/'+id,'titulo':p.get('snippet',{}).get('title','Vídeo'),'duration':seconds,'blocked':False})
    if not output: raise ValueError('Playlist sem vídeos gravados disponíveis; conteúdo atual preservado.')
    return output

def sync_playlists(session, base, now=None):
    if not os.environ.get('YOUTUBE_API_KEY'): return
    now=now or datetime.now(ZoneInfo('America/Sao_Paulo'))
    if now.hour<22: return
    today=now.date().isoformat(); token=''
    while True:
        result=session.get(base+'/programs',params={'pageSize':100,**({'pageToken':token} if token else {})},timeout=20)
        result.raise_for_status(); data=result.json()
        for document in data.get('documents',[]):
            p={k:decode(v) for k,v in document.get('fields',{}).items()}
            if not p.get('playlistAutoSync') or p.get('isLive') or p.get('playlistSyncedDate')==today: continue
            if time.time()<RETRY_AFTER.get(document['name'],0):continue
            id=playlist_id(p.get('playlistSourceUrl'))
            if not id: continue
            try:
                videos=fetch_playlist(id)
                fields={'videos':videos,'youtubeId':videos[0]['youtubeUrl'],'playlistSyncedDate':today,'playlistSyncedAt':int(time.time()*1000)}
                response=session.post(base+':commit',json={'writes':[{'update':{'name':document['name'],'fields':{k:encode(v) for k,v in fields.items()}},'updateMask':{'fieldPaths':list(fields)},'currentDocument':{'updateTime':document['updateTime']}}]},timeout=20)
                if response.status_code not in (409,412): response.raise_for_status()
            except Exception as error:
                RETRY_AFTER[document['name']]=time.time()+900
                print(f'Playlist não atualizada: {type(error).__name__}. Nova tentativa em 15 minutos.',flush=True)
        token=data.get('nextPageToken','')
        if not token: break

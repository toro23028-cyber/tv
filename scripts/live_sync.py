"""Descobre lives e atualiza os metadados compartilhados do canal a cada 15 min."""
import re
import os
import time
import urllib.request
from playlist_sync import api
from editorial_worker import encode, decode

def resolve_channel(value):
    if re.fullmatch(r'UC[\w-]{22}',value):return value
    if not re.fullmatch(r'@?[\w.-]{3,30}',value):return None
    data=api('channels',{'forHandle':'@'+value.lstrip('@'),'part':'id'})
    return next((p['id'] for p in data.get('items',[]) if re.fullmatch(r'UC[\w-]{22}',p.get('id',''))),None)

def sync_lives(session,base,now=None):
    now=now or int(time.time()*1000);token=''
    while True:
        response=session.get(base+'/channels',params={'pageSize':100,**({'pageToken':token} if token else {})},timeout=20)
        response.raise_for_status();data=response.json()
        for document in data.get('documents',[]):
            c={k:decode(v) for k,v in document.get('fields',{}).items()}
            if c.get('autoMode')!='live' or now-c.get('autoLiveCheckedAt',0)<900000:continue
            if c.get('autoHlsUrl'):
                try:
                    with urllib.request.urlopen(c['autoHlsUrl'],timeout=8) as stream:available=stream.read(8192).lstrip().startswith(b'#EXTM3U')
                except Exception:available=False
                fields={'autoLiveCheckedAt':now,'autoHlsStatus':'available' if available else 'waiting'}
                result=session.post(base+':commit',json={'writes':[{'update':{'name':document['name'],'fields':{k:encode(v) for k,v in fields.items()}},'updateMask':{'fieldPaths':list(fields)},'currentDocument':{'updateTime':document['updateTime']}}]},timeout=20)
                if result.status_code not in (409,412):result.raise_for_status()
                continue
            if not os.environ.get('YOUTUBE_API_KEY'):continue
            source=c.get('autoLiveChannel') or c.get('defaultLiveChannel')
            if not source:continue
            try:
                id=resolve_channel(source)
                if not id:continue
                channel_data=api('channels',{'id':id,'part':'contentDetails'})
                uploads=next((p.get('contentDetails',{}).get('relatedPlaylists',{}).get('uploads') for p in channel_data.get('items',[])),None)
                if not uploads:raise ValueError('Canal sem uploads acessíveis.')
                recent=api('playlistItems',{'playlistId':uploads,'part':'snippet','maxResults':49})
                ids=[p.get('snippet',{}).get('resourceId',{}).get('videoId') for p in recent.get('items',[])]
                if c.get('autoLiveVideoId'):ids.append(c['autoLiveVideoId'])
                ids=list(dict.fromkeys(v for v in ids if v and re.fullmatch(r'[\w-]{11}',v)))[:50]
                videos=api('videos',{'id':','.join(ids),'part':'snippet,liveStreamingDetails'}) if ids else {'items':[]}
                item=next((p for p in videos.get('items',[]) if p.get('snippet',{}).get('liveBroadcastContent')=='live' and not p.get('liveStreamingDetails',{}).get('actualEndTime')),None)
                fields={'autoLiveCheckedAt':now,'autoLiveStatus':'live' if item else 'waiting','autoLiveVideoId':item['id'] if item else '', 'autoLiveTitle':item.get('snippet',{}).get('title','') if item else ''}
                # Long-running broadcasts outside recent uploads: occasional fallback search.
                if not item and now-c.get('autoLiveSearchAt',0)>=21600000:
                    result=api('search',{'channelId':id,'eventType':'live','type':'video','part':'snippet','maxResults':1,'order':'date'})
                    found=next((p for p in result.get('items',[]) if p.get('snippet',{}).get('liveBroadcastContent')=='live' and re.fullmatch(r'[\w-]{11}',p.get('id',{}).get('videoId',''))),None)
                    fields['autoLiveSearchAt']=now
                    if found:fields.update({'autoLiveStatus':'live','autoLiveVideoId':found['id']['videoId'],'autoLiveTitle':found.get('snippet',{}).get('title','')})
            except Exception:
                # Preserve source on transient failures, while avoiding a search storm.
                fields={'autoLiveCheckedAt':now,'autoLiveError':'Busca indisponível; nova tentativa em 15 minutos.'}
            result=session.post(base+':commit',json={'writes':[{'update':{'name':document['name'],'fields':{k:encode(v) for k,v in fields.items()}},'updateMask':{'fieldPaths':list(fields)},'currentDocument':{'updateTime':document['updateTime']}}]},timeout=20)
            if result.status_code not in (409,412):result.raise_for_status()
        token=data.get('nextPageToken','')
        if not token:break

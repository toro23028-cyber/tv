import {normalizeYouTubeChannel} from './youtube-id.js';

export async function fetchActiveChannelLive(channelValue,{signal}={}){
  const channel=normalizeYouTubeChannel(channelValue);
  if(!channel)throw new Error('Canal do YouTube inválido.');
  const response=await fetch(`/api/youtube-live?channel=${encodeURIComponent(channel)}`,{signal});
  let payload={};try{payload=await response.json()}catch{}
  if(!response.ok)throw new Error(payload.error||'Não foi possível localizar a live do canal.');
  return payload.live&&/^[\w-]{11}$/.test(payload.videoId||'')
    ?{live:true,videoId:payload.videoId,title:String(payload.title||'')}
    :{live:false,videoId:null,title:''};
}

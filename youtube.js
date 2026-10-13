import {extractYouTubeId,parseDurationISO} from './youtube-id.js';
import {adminRequest} from './editorial-client';
const memory=new Map();
async function api(resource,params){
  const query=new URLSearchParams({resource});
  for(const key of ['id','playlistId','pageToken'])if(params[key])query.set(key,params[key]);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{return await adminRequest(`/api/youtube-data?${query}`,{signal:controller.signal});}
  finally{clearTimeout(timeout);}
}
export async function enrichVideos(videos){
  const unique=[...new Set(videos.map(v=>extractYouTubeId(v.youtubeUrl)).filter(Boolean))];
  const missing=unique.filter(id=>!memory.has(id)||Date.now()-memory.get(id).at>3600000);
  for(let i=0;i<missing.length;i+=50){
    const ids=missing.slice(i,i+50),data=await api('videos',{id:ids.join(','),part:'snippet,contentDetails,status',maxResults:50});
    const items=new Map((data.items||[]).map(v=>[v.id,v]));
    for(const id of ids){
      const item=items.get(id),blocked=!item||item.status?.embeddable===false||['deleted','rejected','failed'].includes(item.status?.uploadStatus);
      memory.set(id,{at:Date.now(),title:item?.snippet?.title||'Vídeo indisponível',description:item?.snippet?.description||'',duration:parseDurationISO(item?.contentDetails?.duration),blocked,embeddable:!blocked});
    }
  }
  return videos.map(v=>{const m=memory.get(extractYouTubeId(v.youtubeUrl));return m?{...v,titulo:m.title,duration:m.duration,blocked:m.blocked}:v;});
}
export async function fetchYouTubeMetadata(id){
  try{await enrichVideos([{youtubeUrl:id}]);window.__ytLastError=null;return memory.get(id)||null;}
  catch(e){window.__ytLastError=e.message;return null;}
}
export async function fetchYouTubePlaylistItems(id){
  window.__ytLastError=null;
  try{
    const result=[];let pageToken='';
    for(let i=0;i<4;i++){
      const data=await api('playlistItems',{playlistId:id,part:'snippet',maxResults:50,...(pageToken?{pageToken}:{})});
      for(const item of data.items||[]){const videoId=item.snippet?.resourceId?.videoId;if(videoId)result.push({youtubeUrl:`https://youtu.be/${videoId}`,titulo:item.snippet?.title||''});}
      pageToken=data.nextPageToken;if(!pageToken)break;
    }
    if(pageToken)throw new Error('Esta playlist tem mais de 200 itens. Importe em lotes menores para evitar uma importação incompleta.');
    return await enrichVideos(result);
  }catch(e){window.__ytLastError=e.message;return [];}
}

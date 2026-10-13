import {dateSecondsToAbsolute,absoluteToDateSeconds} from './clock.js';
import {extractYouTubeId,normalizeYouTubeChannel} from './youtube-id.js';
export function hlsURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
function seed(value){let n=2166136261;for(const ch of value)n=Math.imul(n^ch.charCodeAt(0),16777619);return n>>>0}
export function shuffled(list,key){const result=[...list];let n=seed(key);for(let i=result.length-1;i>0;i--){n=(Math.imul(n,1664525)+1013904223)>>>0;const j=n%(i+1);[result[i],result[j]]=[result[j],result[i]]}return result}
export const effectiveAutoMode=c=>c?.autoMode||(c?.autoLiveChannel||c?.defaultLiveChannel||c?.autoLiveUrl||c?.defaultLiveUrl||c?.autoHlsUrl?'live':'playlists');
export function autoPlaylistPool(programs,channel){
 const selected=channel?.autoPlaylistIds||[];
 const ids=new Set(selected);
 const available=programs.filter(p=>!p.isLive&&!p.isJingle&&(selected.length?ids.has(p.id):p.canalId===channel?.id&&!p.isTemplate));
 return available.map(p=>{
  const raw=p.videos?.length?p.videos:[{youtubeUrl:p.youtubeId,duration:p.videoDuration||p.duracao,titulo:p.nome}];
  return {...p,videos:raw.map(v=>({...v,duration:Number(v.duration)>0?Number(v.duration):Math.max(1,Number(p.videoDuration||p.duracao)/raw.length||240),durationEstimated:!(Number(v.duration)>0)})).filter(v=>extractYouTubeId(v.youtubeUrl)&&!v.blocked)};
 }).filter(p=>p.videos.length);
}
export function fillAutomaticSchedule(schedule,programs,channel,date){
 const mode=effectiveAutoMode(channel);if(mode==='off')return schedule;
 const pool=autoPlaylistPool(programs,channel),block=Math.max(900,Math.min(10800,(Number(channel.autoBlockMinutes)||60)*60));
 const base=dateSecondsToAbsolute(date),output=[];
 const liveChannel=normalizeYouTubeChannel(channel.autoLiveChannel||channel.defaultLiveChannel||'');
 const url=channel.autoLiveUrl||channel.defaultLiveUrl||'';
 const liveId=channel.autoLiveStatus==='live'?channel.autoLiveVideoId:extractYouTubeId(url);
 const stream=hlsURL(channel.autoHlsUrl);
 const preferLive=mode==='live'&&(stream&&channel.autoHlsStatus!=='waiting'||!stream&&channel.autoLiveStatus!=='waiting'&&liveId);
 for(const p of schedule){
  if(!p.isPlaceholder){output.push(p);continue}
  let start=p.horarioInicio;
  while(start<p.horarioFim){
   const slot=Math.floor(start/block),end=Math.min(p.horarioFim,(slot+1)*block),absolute=base+slot*block;
   const {date:slotDate,seconds}=absoluteToDateSeconds(absolute),order=shuffled(pool,`${channel.id}:${slotDate}`),selected=order[(Math.floor(seconds/block))%Math.max(1,order.length)];
   const common={...p,id:`auto-${channel.id}-${absolute}-${start}`,isPlaceholder:false,isAutomatic:true,horarioInicio:start,horarioFim:end,duracao:end-start,duracaoTotal:block,mediaOffset:start-slot*block,srcProgId:`auto-${channel.id}-${absolute}`,contKey:`auto-${channel.id}-${absolute}`};
   if(preferLive)output.push({...common,srcProgId:`auto-live-${channel.id}`,contKey:`auto-live-${channel.id}`,isLive:true,nome:stream?`${channel.nome} · Live HLS`:channel.autoLiveTitle||`${channel.nome} · Ao vivo`,sinopse:'Transmissão automática do canal',sourceType:stream?'hls':'youtube',hlsUrl:stream||'',liveUrl:liveId?`https://youtu.be/${liveId}`:'',liveChannel:liveChannel||''});
   else if(selected)output.push({...selected,...common,nome:selected.nome,sinopse:selected.sinopse||'Seleção automática para você acompanhar a qualquer hora.',isLive:false,isTemplate:false,videos:channel.autoShuffle===false?selected.videos:shuffled(selected.videos,`${channel.id}:${absolute}:videos`),classificacao:selected.classificacao||'L'});
   else output.push({...p,...common,isPlaceholder:true,nome:'Nenhuma fonte automática disponível',sinopse:'Cadastre playlists de reserva ou uma transmissão disponível.'});
   start=end;
  }
 }
 return output;
}

import {getToday,getNow,dateSecondsToAbsolute,absoluteToDateSeconds,fmtHM} from './clock.js';
import {extractYouTubeId} from './youtube-id.js';
export const DAY = 86400;
const mod = (n,m) => ((n%m)+m)%m;
const safeDuration = p => Number.isFinite(Number(p.duracao)) && Number(p.duracao)>0 && Number(p.duracao)<=30*86400;
export const placeholder = {nome:'Voltamos já!',sinopse:'Programação em breve',classificacao:'L',tags:[],isPlaceholder:true};

// O ciclo base contém somente programas que começam nos N dias da âncora.
// Datas posteriores são exceções explícitas; o ciclo nunca começa antes da âncora.
export function projectInstances(programs, channelId, channel, date = getToday()) {
  const day = dateSecondsToAbsolute(date);
  const all = programs.filter(p=>p.canalId===channelId && safeDuration(p))
    .map(p=>({...p,duracao:Number(p.duracao),horarioInicio:Number(p.horarioInicio)||0}));
  const dated = all.filter(p=>p.data).map(p=>({...p,absStart:dateSecondsToAbsolute(p.data,p.horarioInicio)}))
    .filter(p=>Number.isFinite(p.absStart)).sort((a,b)=>a.absStart-b.absStart || String(a.id).localeCompare(String(b.id)));
  if (!dated.length) {
    // Compatibilidade exclusiva com grades antigas sem data. Vinhetas não viram programas.
    const legacy = all.filter(p=>!p.isJingle && !p.data).sort((a,b)=>a.horarioInicio-b.horarioInicio);
    if (!legacy.length) return [];
    const result=[]; let start=day,i=0;
    while(start<day+DAY && i<10000){
      const p=legacy[i%legacy.length]; result.push({...p,absStart:start}); start+=p.duracao; i++;
    }
    return result;
  }
  const intersects=p=>p.absStart<day+DAY && p.absStart+p.duracao>day;
  if (!channel?.eternity) return dated.filter(intersects);
  const cycle=Math.max(1,Math.min(30,Math.floor(Number(channel.eternityDays)||1)))*DAY;
  const anchorDate=channel.eternityAnchor || (dated.find(p=>!p.isJingle)||dated[0]).data;
  const anchor=dateSecondsToAbsolute(anchorDate);
  const base=dated.filter(p=>p.absStart>=anchor && p.absStart<anchor+cycle);
  const exceptions=dated.filter(p=>p.absStart<anchor || p.absStart>=anchor+cycle).filter(intersects);
  const result=[...exceptions.map(p=>({...p,_priority:2}))];
  for (const p of base) {
    // Inclui também programas de vários dias, sem limitar a apenas 3 ciclos vizinhos.
    const first=Math.max(0,Math.floor((day-p.absStart-p.duracao)/cycle)+1);
    const last=Math.floor((day+DAY-1-p.absStart)/cycle);
    for(let n=first;n<=last;n++) result.push({...p,absStart:p.absStart+n*cycle,_cycle:n});
  }
  return result;
}
function asBlock(inst,start,end,day,blockIndex,totalBlocks) {
  const sourceStart=inst.absStart, s=start-day,e=end-day;
  const maratona=!inst.isJingle && (inst.maratona===true || inst.duracao>21600);
  const endReal=sourceStart+inst.duracao-day;
  return {...inst,id:`${inst.id}@${sourceStart}:${s}`,srcProgId:inst.id,
    contKey:`${inst.id}@${sourceStart}`,horarioInicio:s,horarioFim:e,duracao:e-s,
    duracaoTotal:inst.duracao,mediaOffset:start-sourceStart,isMaratona:maratona,
    horarioTexto:fmtHM(s),horarioFimTexto:fmtHM(e),fimReal:endReal,
    fimRealTexto:endReal>DAY?`${fmtHM(endReal%DAY)} (+${Math.floor(endReal/DAY)}d)`:fmtHM(endReal),
    nome:maratona?`Maratona ${inst.nome}${totalBlocks>1?` (${blockIndex+1}/${totalBlocks})`:''}`:inst.nome,
    blocoInfo:maratona&&totalBlocks>1?{i:blockIndex+1,total:totalBlocks}:null};
}
export function buildSchedule(programs,channelId,channel,date=getToday()) {
  const day=dateSecondsToAbsolute(date), instances=projectInstances(programs,channelId,channel,date);
  if(!instances.length) return [{...placeholder,id:`_gap_${date}`,horarioInicio:0,horarioFim:DAY,duracao:DAY,horarioTexto:'00:00',horarioFimTexto:'24:00',canalId:channelId}];
  // Vinhetas interrompem o programa; ao retornar, a mídia continua no horário absoluto.
  // Nos conflitos legados a regra é estável: vinheta, exceção, início mais recente, ID.
  const points=new Set([day,day+DAY]);
  for(const p of instances){points.add(Math.max(day,p.absStart));points.add(Math.min(day+DAY,p.absStart+p.duracao));}
  const sorted=[...points].sort((a,b)=>a-b), segments=[];
  for(let i=0;i<sorted.length-1;i++){
    const start=sorted[i],end=sorted[i+1];
    const candidates=instances.filter(p=>p.absStart<=start && p.absStart+p.duracao>=end)
      .sort((a,b)=>Number(!!b.isJingle)-Number(!!a.isJingle)||(b._priority||0)-(a._priority||0)||b.absStart-a.absStart||String(a.id).localeCompare(String(b.id)));
    const inst=candidates[0],prev=segments.at(-1);
    if(prev && prev.inst===inst) prev.end=end; else segments.push({inst,start,end});
  }
  const output=[];
  for(const {inst,start,end} of segments){
    if(!inst){output.push({...placeholder,id:`_gap_${date}_${start}`,canalId:channelId,horarioInicio:start-day,horarioFim:end-day,duracao:end-start,horarioTexto:fmtHM(start-day),horarioFimTexto:fmtHM(end-day)});continue;}
    const split=!inst.isJingle && (inst.maratona===true || inst.duracao>21600);
    const block=Math.max(1800,Number(inst.blocoDuracao)||10800);
    let total=split?Math.ceil(inst.duracao/block):1;
    if(total>1 && inst.duracao-(total-1)*block<900) total--;
    let s=start;
    while(s<end){
      const i=split?Math.min(Math.floor((s-inst.absStart)/block),total-1):0;
      const e=Math.min(end,i===total-1?inst.absStart+inst.duracao:inst.absStart+(i+1)*block);
      output.push(asBlock(inst,s,e,day,i,total)); s=e;
    }
  }
  return output;
}
export function getCurProg(schedule,now=getNow()){return schedule?.find(p=>now>=p.horarioInicio && now<p.horarioFim)||null;}
export function getElapsed(prog,now=getNow()){return now-Number(prog.horarioInicio);}
export function getVideoPlaybackInfo(prog,now=getNow()) {
  if(!prog || prog.isPlaceholder) return null;
  const elapsed=Math.max(0,getElapsed(prog,now)+Number(prog.mediaOffset||0));
  const videos=prog.videos?.length?prog.videos:[{youtubeUrl:prog.youtubeId,titulo:prog.nome,duration:prog.videoDuration||prog.duracaoTotal||prog.duracao}];
  const fallback=Math.max(1,Number(prog.duracaoTotal||prog.duracao)/videos.length||240);
  const durations=videos.map(v=>Number.isFinite(Number(v.duration))&&Number(v.duration)>0?Number(v.duration):fallback);
  const total=durations.reduce((a,b)=>a+b,0), positionInCycle=mod(elapsed,total);
  let start=0;
  for(let i=0;i<videos.length;i++){
    const duration=durations[i];
    if(positionInCycle<start+duration || i===videos.length-1){
      const position=positionInCycle-start;
      return {videoIndex:i,position,duration,remaining:duration-position,videoId:extractYouTubeId(videos[i].youtubeUrl),title:videos[i].titulo||prog.nome||'',isSingle:videos.length===1,cycleIndex:Math.floor(elapsed/total),blocked:!!videos[i].blocked};
    }
    start+=duration;
  }
}
export function getTodayPrograms(programs,channels,date=getToday()) {
  return Object.fromEntries(channels.filter(c=>!c.isInfo).map(c=>[c.id,buildSchedule(programs,c.id,c,date).filter(p=>!p.isPlaceholder)]));
}
export const guideTime = seconds => `${seconds>=DAY?'Amanhã · ':''}${fmtHM(mod(seconds,DAY))}`;
// Keep daily playback semantics, but expose a continuous two-day guide timeline.
export function buildGuideSchedule(programs,channelId,channel,date=getToday()) {
  const tomorrow=absoluteToDateSeconds(dateSecondsToAbsolute(date)+DAY).date;
  return [date,tomorrow].flatMap((day,index)=>buildSchedule(programs,channelId,channel,day).map(p=>({
    ...p,horarioInicio:p.horarioInicio+index*DAY,horarioFim:p.horarioFim+index*DAY,
    horarioTexto:guideTime(p.horarioInicio+index*DAY),horarioFimTexto:guideTime(p.horarioFim+index*DAY),
  })));
}
export function thumbnailForProgram(p) {
  if(!p || p.isPlaceholder) return null;
  if(p.thumbnailType==='custom' && p.thumbnailUrl) return p.thumbnailUrl;
  const id=extractYouTubeId(p.videos?.[0]?.youtubeUrl||p.youtubeId);
  return id?`https://i.ytimg.com/vi/${id}/hqdefault.jpg`:null;
}
export function getThumbnailForChannel(programs,channels,id) {
  const ch=channels.find(c=>c.id===id); return ch?thumbnailForProgram(getCurProg(buildSchedule(programs,id,ch))):null;
}
export function buildScheduleAdmin(programs,id,ch,date){
  const day=dateSecondsToAbsolute(date);
  return projectInstances(programs,id,ch,date).map(p=>{
    const start=Math.max(day,p.absStart)-day,end=Math.min(day+DAY,p.absStart+p.duracao)-day;
    const projected=p.data!==date || start!==Number(p.horarioInicio) || end-start!==p.duracao;
    return {...p,_isProjected:projected,_srcDate:p.data,_srcHorarioInicio:p.horarioInicio,
      _instanceKey:`${p.id}@${p.absStart}`,horarioInicio:start,horarioFim:end,duracao:end-start};
  }).sort((a,b)=>a.horarioInicio-b.horarioInicio);
}
// Validação absoluta, inclusive virada de dia e repetição do ciclo.
export function findConflicts(programs,candidate,channel){
  const start=dateSecondsToAbsolute(candidate.data,candidate.horarioInicio),end=start+Number(candidate.duracao);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start>30*DAY||end<=start) return [];
  const others=programs.filter(p=>p.id!==candidate.id && !!p.isJingle===!!candidate.isJingle);
  const matches=new Map();
  for(let d=Math.floor(start/DAY)*DAY;d<end;d+=DAY){
    const date=new Date(Date.UTC(2026,0,1)+d*1000).toISOString().slice(0,10);
    for(const p of projectInstances(others,candidate.canalId,channel,date)){
      if(p.absStart<end && p.absStart+p.duracao>start) matches.set(p.id,p);
    }
  }
  return [...matches.values()];
}

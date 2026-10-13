import {cleanProgram,assertNoConflicts,assertDocumentSize} from './program-validation.js';
import {buildSchedule} from './schedule.js';
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function filterPrograms(programs,query,type='all'){
 const q=norm(query).trim();return programs.filter(p=>(type==='all'||type==='live'&&p.isLive||type==='playlist'&&!p.isLive&&!p.isJingle||type==='jingle'&&p.isJingle)&&(!q||norm(`${p.nome} ${p.sinopse||''} ${(p.tags||[]).join(' ')}`).includes(q)));
}
export function scheduleWarnings(programs,channels,date){
 return channels.filter(c=>!c.isInfo).flatMap(ch=>{
  const items=buildSchedule(programs,ch.id,ch,date).filter(p=>!p.isPlaceholder);
  if(!items.length)return[{channel:ch.nome,text:'Sem programação neste dia'}];
  const invalid=items.filter(p=>p.isLive&&!p.liveChannel&&!p.liveChannelId);
  return invalid.length?[{channel:ch.nome,text:'Live sem canal de origem'}]:[];
 });
}
export function makeBackup(programs,channels){return{format:'trendtv-backup',version:1,createdAt:new Date().toISOString(),channels,programs:programs.map(p=>({...cleanProgram(p),id:p.id}))};}
export function prepareRestore(text,existing,channels,replace=false){
 if(new TextEncoder().encode(text).length>5*1024*1024)throw new Error('O backup deve ter até 5 MB.');
 const data=JSON.parse(text);
 if(data?.format!=='trendtv-backup'||data.version!==1||!Array.isArray(data.programs))throw new Error('Formato de backup inválido.');
 if(data.programs.length>450)throw new Error('Restaure até 450 programas por lote.');
 const ids=new Set(),existingIds=new Set(existing.map(p=>p.id));
 const changes=data.programs.map(p=>{
  if(!p||typeof p!=='object'||typeof p.id!=='string'||!p.id||p.id.includes('/')||p.id.length>120||ids.has(p.id))throw new Error('Backup contém IDs inválidos ou repetidos.');
  if(p.tags!==undefined&&(!Array.isArray(p.tags)||p.tags.some(t=>typeof t!=='string')))throw new Error('Etiquetas inválidas no backup.');
  if(p.videos!==undefined&&(!Array.isArray(p.videos)||p.videos.some(v=>!v||typeof v!=='object'||typeof v.youtubeUrl!=='string')))throw new Error('Playlist inválida no backup.');
  if(p.sinopse!==undefined&&typeof p.sinopse!=='string')throw new Error('Descrição inválida no backup.');
  if(p.nome!==undefined&&typeof p.nome!=='string')throw new Error('Nome inválido no backup.');
  ids.add(p.id);const clean={...cleanProgram(p),id:p.id};assertDocumentSize(clean);return clean;
 }).filter(p=>replace||!existingIds.has(p.id));
 assertNoConflicts(existing,changes,channels);
 return{changes,skipped:data.programs.length-changes.length,total:data.programs.length};
}

import {useCallback,useEffect,useState} from 'react';
export function readPreference(key,fallback){try{const v=JSON.parse(localStorage.getItem(key));return v??fallback;}catch{return fallback;}}
export function writePreference(key,value){try{localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new CustomEvent('trendtv-preference',{detail:key}));return true;}catch{return false;}}
export function useFavorites(){
  const read=()=>{const v=readPreference('trendtv_favorites',[]);return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];};
  const [ids,setIds]=useState(read);
  useEffect(()=>{const update=()=>setIds(read());window.addEventListener('storage',update);window.addEventListener('trendtv-preference',update);return()=>{window.removeEventListener('storage',update);window.removeEventListener('trendtv-preference',update);};},[]);
  const toggle=useCallback(id=>{const current=read();const next=current.includes(id)?current.filter(x=>x!==id):[...current,id];setIds(next);writePreference('trendtv_favorites',next);},[]);
  return [ids,toggle];
}
export function channelLink(channel){return `${window.location.origin}/canal/${encodeURIComponent(Number(channel?.numero)>0?channel.numero:channel?.id||'')}`;}
export async function shareChannel(channel,program){
  const url=channelLink(channel),title=program?.nome||channel?.nome||'TREND TV';
  if(navigator.share){try{await navigator.share({title,text:channel?.nome||'TREND TV',url});return;}catch(e){if(e.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(url);return 'Link copiado!';}catch{window.prompt('Copie o link do canal:',url);return '';}
}

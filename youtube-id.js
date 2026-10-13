export function extractYouTubeId(value){
  if(typeof value!=='string') return null;
  const text=value.trim(); if(/^[\w-]{11}$/.test(text))return text;
  try{
    const u=new URL(text.startsWith('http')?text:`https://${text}`),host=u.hostname.toLowerCase();
    let id;
    if(host==='youtu.be')id=u.pathname.split('/')[1];
    else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)){
      id=u.searchParams.get('v')||(/\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)||[])[1];
    }
    return /^[\w-]{11}$/.test(id||'')?id:null;
  }catch{return null;}
}
export function normalizeYouTubeChannel(value){
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(/^UC[\w-]{22}$/.test(text))return text;
  if(/^@?[\w.-]{3,30}$/.test(text))return `@${text.replace(/^@/,'')}`;
  try{
    const u=new URL(text.startsWith('http')?text:`https://${text}`),host=u.hostname.toLowerCase();
    if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(host))return null;
    const id=/^\/channel\/(UC[\w-]{22})(?:\/|$)/.exec(u.pathname)?.[1];
    if(id)return id;
    const handle=/^\/@([\w.-]{3,30})(?:\/|$)/.exec(u.pathname)?.[1];
    return handle?`@${handle}`:null;
  }catch{return null;}
}
export function extractPlaylistId(value){
  try{const u=new URL(value.trim());return /(^|\.)youtube\.com$/.test(u.hostname)?u.searchParams.get('list'):null;}catch{return null;}
}
export function parseYouTubeBulk(text){
  const seen=new Set();return String(text||'').split(/[\s,;|]+/).flatMap(part=>{
    const id=extractYouTubeId(part);if(!id||seen.has(id))return [];seen.add(id);return [{youtubeUrl:`https://youtu.be/${id}`,titulo:''}];
  });
}
export function parseDurationISO(s){
  const m=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s||'');
  return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0;
}

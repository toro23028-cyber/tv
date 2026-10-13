export const DEFAULT_NEWS_CONFIG={enabled:false,ticker:true,gc:true,social:true,interval:20,socialSpeed:34,corner:'tr',template:'trend-wall-v2',gcColor:'#1676eb',gcLayout:'single'};
export const NEWS_WORD_LIMIT=12;
export const NEWS_LIMITS={headline:78,subtitle:130,tweet:160,topic:54,source:48,category:28};
export const countWords=value=>String(value||'').trim().split(/\s+/).filter(Boolean).length;
export const newsDuration=item=>[10,15,20,30].includes(Number(item.durationMinutes))?Number(item.durationMinutes):30;
export const prepareNewsPublication=(items,now=Date.now())=>items.map(p=>({...p,expiresAt:now+newsDuration(p)*60000}));
export const NEWS_DURATION_OPTIONS=[
  {label:'10 min',minutes:10},
  {label:'15 min',minutes:15},
  {label:'20 min',minutes:20},
  {label:'30 min',minutes:30},
];
export function safeSourceURL(value){try{const u=new URL(String(value||''));return u.protocol==='https:'||u.protocol==='http:'?u.href:'';}catch{return '';}}
export function normalizeNewsItem(item,now=Date.now()){
  const rawKind=String(item.kind||'');
  const kind=['news','tweet','topic'].includes(rawKind)?rawKind:rawKind==='social'?'tweet':'news';
  const titleLimit=kind==='tweet'?NEWS_LIMITS.tweet:kind==='topic'?NEWS_LIMITS.topic:NEWS_LIMITS.headline;
  const text=String(item.title||item.titulo||item.text||'').trim().slice(0,titleLimit);
  return {id:typeof item.id==='string'?item.id.slice(0,100):crypto.randomUUID(),title:text,
    subtitle:String(item.subtitle||item.subtitulo||'').trim().slice(0,NEWS_LIMITS.subtitle),
    source:String(item.source||item.fonte||item.author||(kind==='topic'?'TRENDING':'' )).trim().slice(0,NEWS_LIMITS.source),
    category:String(item.category||item.topicLabel||'').trim().slice(0,NEWS_LIMITS.category),
    imageUrl:safeSourceURL(item.imageUrl||item.image),url:safeSourceURL(item.url||item.link),
    kind,urgent:item.urgent===true,approved:item.approved===true,durationMinutes:newsDuration(item),
    expiresAt:Number.isFinite(Number(item.expiresAt))&&Number(item.expiresAt)>0?Number(item.expiresAt):now+1800000};
}
export function publishableItems(items,now=Date.now()){
  return dedupeEditorial((Array.isArray(items)?items:[]).filter(p=>p&&typeof p==='object'&&Number.isFinite(Number(p.expiresAt))&&Number(p.expiresAt)>now).map(p=>normalizeNewsItem(p,now))
    .filter(p=>p.approved===true&&p.title.trim()&&(p.kind==='topic'||p.source.trim())&&Number(p.expiresAt)>now)
    ).slice(0,50);
}
export function parseNewsImport(text,defaultKind='news'){
  let input;
  if(text.trim().startsWith('<')){
    const xml=new DOMParser().parseFromString(text,'application/xml');
    if(xml.querySelector('parsererror'))throw new Error('O arquivo RSS/XML está inválido.');
    const source=xml.querySelector('channel > title, feed > title')?.textContent||'';
    input=[...xml.querySelectorAll('item, entry')].map(node=>({title:node.querySelector('title')?.textContent||'',source,
      url:node.querySelector('link')?.getAttribute('href')||node.querySelector('link')?.textContent||''}));
  }else{const json=JSON.parse(text);input=Array.isArray(json)?json:json.items;}
  if(!Array.isArray(input))throw new Error('Use um RSS ou JSON com uma lista de notícias.');
  if(input.length>100)throw new Error('Importe até 100 notícias por vez.');
  const seen=new Set();return input.filter(p=>p&&typeof p==='object').map(p=>normalizeNewsItem({...p,kind:p.kind||defaultKind,id:crypto.randomUUID(),approved:false})).filter(p=>{const key=p.url||p.title;if(!p.title||seen.has(key))return false;seen.add(key);return true;});
}

export function editorialKey(item){
 const kind=item.kind==='social'?'tweet':item.kind||'news';
 const url=safeSourceURL(item.url||item.link);
 if(url){const u=new URL(url);u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key)||['ref','s','si'].includes(key))u.searchParams.delete(key);u.hostname=u.hostname.replace(/^www\./,'').replace(/^twitter\.com$/,'x.com');return `${kind}:url:${u.href.replace(/\/$/,'')}`;}
 const norm=v=>String(v||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
 return `${kind}:text:${norm(item.title||item.text)}:${norm(item.source||item.author)}`;
}
export function dedupeEditorial(items){
 const keys=new Set(),ids=new Set();return (Array.isArray(items)?items:[]).filter(p=>p&&typeof p==='object').filter(p=>{
  const key=editorialKey(p);if((p.id&&ids.has(p.id))||(String(p.title||'').trim()&&keys.has(key)))return false;
  if(p.id)ids.add(p.id);if(String(p.title||'').trim())keys.add(key);return true;
 });
}
export function mergeEditorial(current,incoming){return dedupeEditorial([...current,...incoming]).slice(0,100);}

export const GC_COLORS=[{label:'Azul',value:'#1676eb'},{label:'Vermelho',value:'#c6283e'},{label:'Verde',value:'#087f62'},{label:'Roxo',value:'#7643c7'},{label:'Laranja',value:'#b85b08'}];
export const normalizeGCColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?value:'#1676eb';

export function selectGCHeadlines(news,index,dual=false){
 if(!news.length)return [];
 const first=news[index%news.length];
 return dual&&news.length>1?[first,news[(index+1)%news.length]]:[first];
}

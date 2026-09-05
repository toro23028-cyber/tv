export const DEFAULT_NEWS_CONFIG={enabled:false,ticker:true,gc:false,social:false,interval:20,corner:'tr'};
export function safeSourceURL(value){try{const u=new URL(String(value||''));return u.protocol==='https:'||u.protocol==='http:'?u.href:'';}catch{return '';}}
export function normalizeNewsItem(item,now=Date.now()){
  const text=String(item.title||item.titulo||item.text||'').trim().slice(0,240);
  return {id:typeof item.id==='string'?item.id.slice(0,100):crypto.randomUUID(),title:text,
    source:String(item.source||item.fonte||item.author||'').trim().slice(0,80),url:safeSourceURL(item.url||item.link),
    kind:item.kind==='social'?'social':'news',urgent:item.urgent===true,approved:item.approved===true,
    expiresAt:Number.isFinite(Number(item.expiresAt))&&Number(item.expiresAt)>0?Number(item.expiresAt):now+86400000};
}
export function publishableItems(items,now=Date.now()){return items.filter(p=>p.approved===true&&p.title?.trim()&&p.source?.trim()&&Number(p.expiresAt)>now).map(p=>normalizeNewsItem(p,now)).slice(0,50);}
export function parseNewsImport(text){
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
  const seen=new Set();return input.filter(p=>p&&typeof p==='object').map(p=>normalizeNewsItem({...p,id:crypto.randomUUID(),approved:false})).filter(p=>{const key=p.url||p.title;if(!p.title||seen.has(key))return false;seen.add(key);return true;});
}

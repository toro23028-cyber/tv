import {normalizeNewsItem} from '../news.js';
export async function readBrightSnapshot(id,token,fetcher=fetch){
 if(!/^s_[a-z0-9]{6,100}$/i.test(id||''))throw new Error('ID de snapshot inválido. Use o ID s_… da Bright Data.');
 if(!token)throw new Error('Configure BRIGHTDATA_API_TOKEN no servidor.');
 const options={headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(12000)};
 const progress=await fetcher(`https://api.brightdata.com/datasets/v3/progress/${id}`,options);
 if(!progress.ok)throw new Error(`Bright Data respondeu HTTP ${progress.status}. Confira a chave e o snapshot.`);
 const state=(await progress.json()).status;
 if(state!=='ready')throw new Error(state==='failed'||state==='canceled'?'A coleta da Bright Data falhou ou foi cancelada.':'A coleta da Bright Data ainda está sendo processada. Tente novamente em alguns minutos.');
 const response=await fetcher(`https://api.brightdata.com/datasets/v3/snapshot/${id}?format=ndjson`,options);
 if(!response.ok||!response.body)throw new Error('Não foi possível baixar o snapshot da Bright Data.');
 const reader=response.body.getReader(),decoder=new TextDecoder(),records=[];let bytes=0,buffer='';
 const line=value=>{if(!value.trim())return;const data=JSON.parse(value);for(const item of Array.isArray(data)?data:[data])if(item&&typeof item==='object'&&!item.error&&records.length<100)records.push(item)};
 try{
  while(records.length<100){const {done,value}=await reader.read();if(done){buffer+=decoder.decode();if(buffer.trim())line(buffer);break}bytes+=value.byteLength;if(bytes>3000000)throw new Error('O lote excedeu 3 MB. Gere uma coleta menor na Bright Data.');buffer+=decoder.decode(value,{stream:true});let at;while(records.length<100&&(at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at));buffer=buffer.slice(at+1)}}
 }finally{await reader.cancel().catch(()=>{})}
 return records.map(p=>normalizeNewsItem({...p,id:crypto.randomUUID(),kind:'tweet',title:p.content||p.text||p.title,source:p.user_name||p.username||p.user?.username||p.user?.name||p.author||'X',url:p.url||p.post_url,approved:false,autoImported:true})).filter(p=>p.title);
}

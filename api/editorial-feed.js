import {validateFeedURL} from '../server/feed-url.js';
import {requireAdmin,boundedText} from '../server/admin-auth.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método não permitido.'});
 try{
  await requireAdmin(req);
  if(req.method==='POST'){
   let body=req.body;if(typeof body==='string')body=JSON.parse(body);
   if(!body||typeof body.url!=='string'||body.url.length>2048||!['news','tweet','topic'].includes(body.kind))return res.status(400).json({error:'Informe o link do feed e seu tipo.'});
   const url=await validateFeedURL(body.url);
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/rss+xml, application/atom+xml, application/json, text/xml'}});
   if(!response.ok)throw new Error('A fonte não respondeu. Use o link RSS/JSON, não a página inicial.');
   return res.json({name:String(body.name||url.hostname).slice(0,48),kind:body.kind,text:await boundedText(response)});
  }
  let sources;try{sources=JSON.parse(process.env.EDITORIAL_SOURCES||'[]')}catch{throw new Error('EDITORIAL_SOURCES está inválido no servidor.');}
  if(!Array.isArray(sources))throw new Error('Configure uma lista de fontes no servidor.');
  if(!sources.length)return res.status(503).json({error:'Configure EDITORIAL_SOURCES com fontes RSS/JSON de notícias ou tweets.'});
  if(Object.keys(req.query||{}).some(k=>k!=='source'))return res.status(400).json({error:'Parâmetros inválidos.'});
  if(!req.query?.source)return res.json({sources:sources.map(s=>({id:s.id,name:s.name,kind:s.kind||'news'}))});
  const source=sources.find(s=>s.id===req.query.source);if(!source)return res.status(404).json({error:'Fonte não configurada.'});
  const url=new URL(source.url);
  // The caller cannot supply URLs. Only server-configured trusted sources are fetched; redirects are refused.
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname))throw new Error('Use uma fonte HTTPS pública confiável.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/rss+xml, application/atom+xml, application/json, text/xml', 'User-Agent':'TrendTV-Editorial/1.0'}});
  if(!response.ok)throw new Error('A fonte não respondeu à importação.');
  return res.json({id:source.id,name:source.name,kind:source.kind||'news',text:await boundedText(response)});
 }catch(e){return res.status(e.status||502).json({error:e.message||'Não foi possível importar.'});}
}

import {requireAdmin} from '../server/admin-auth.js';
export function tweetURL(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)||!/^\/[\w]+\/status\/\d+\/?$/.test(u.pathname))return null;return `https://twitter.com${u.pathname.replace(/\/$/,'')}`;}catch{return null;}
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({error:'Método inválido.'});
 try{
  await requireAdmin(req);const url=tweetURL(req.query?.url);
  if(!url||Object.keys(req.query||{}).some(k=>k!=='url'))return res.status(400).json({error:'Cole o link de um post público do X/Twitter.'});
  const endpoint=new URL('https://publish.twitter.com/oembed');endpoint.search=new URLSearchParams({url,omit_script:'true',dnt:'true'});
  const response=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('O X não disponibilizou este post. Ele pode estar restrito ou indisponível.');
  const data=await response.json();if(typeof data.html!=='string'||data.html.length>50000)throw new Error('Post sem texto disponível.');
  return res.json({html:data.html,author:String(data.author_name||'X').slice(0,48),url});
 }catch(e){return res.status(e.status||502).json({error:e.message||'Não foi possível importar o post.'});}
}

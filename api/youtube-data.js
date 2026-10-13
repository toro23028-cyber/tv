import {requireAdmin} from '../server/admin-auth.js';
// Only the two fixed queries used by Admin; the API key never leaves the server.
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método inválido.'});
 try{
  await requireAdmin(req);
  const query=req.query||{},resource=query.resource;
  let params;
  if(resource==='videos'){
   if(Object.keys(query).some(k=>!['resource','id'].includes(k))||typeof query.id!=='string')return res.status(400).json({error:'Consulta de vídeos inválida.'});
   const ids=query.id.split(',');if(!ids.length||ids.length>50||ids.some(id=>!/^[-\w]{11}$/.test(id)))return res.status(400).json({error:'Informe até 50 IDs de vídeo válidos.'});
   params={id:ids.join(','),part:'snippet,contentDetails,status',maxResults:'50'};
  }else if(resource==='playlistItems'){
   if(Object.keys(query).some(k=>!['resource','playlistId','pageToken'].includes(k))||typeof query.playlistId!=='string'||!/^[-\w]{10,100}$/.test(query.playlistId)||query.pageToken!==undefined&&(typeof query.pageToken!=='string'||!/^[-\w=]{1,500}$/.test(query.pageToken)))return res.status(400).json({error:'Consulta de playlist inválida.'});
   params={playlistId:query.playlistId,part:'snippet',maxResults:'50',...(query.pageToken?{pageToken:query.pageToken}:{})};
  }else return res.status(400).json({error:'Consulta não permitida.'});
  const key=process.env.YOUTUBE_API_KEY;
  if(!key)return res.status(503).json({error:'Configure YOUTUBE_API_KEY no servidor para buscar metadados e importar playlists.'});
  const url=new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for(const [k,v] of Object.entries({...params,key}))url.searchParams.set(k,v);
  const upstream=await fetch(url,{signal:AbortSignal.timeout(12000)}),data=await upstream.json();
  if(!upstream.ok)return res.status(upstream.status===429?429:502).json({error:data.error?.errors?.[0]?.reason==='quotaExceeded'?'A cota de consultas do YouTube acabou por hoje.':'Não foi possível consultar o YouTube. Confira a ativação da API e as restrições da chave no servidor.'});
  return res.json({items:data.items||[],...(data.nextPageToken?{nextPageToken:data.nextPageToken}:{})});
 }catch(e){return res.status(e.status||502).json({error:e.status?e.message:'O servidor não conseguiu consultar o YouTube. Tente novamente.'});}
}

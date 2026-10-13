import {requireAdmin} from '../server/admin-auth.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({error:'Método inválido.'});
 try{
  await requireAdmin(req);const id=req.query?.video;
  if(typeof id!=='string'||!/^[-\w]{11}$/.test(id)||Object.keys(req.query).length!==1)return res.status(400).json({error:'Vídeo inválido.'});
  if(!process.env.YOUTUBE_API_KEY)return res.status(503).json({error:'A URL toca diretamente; configure YOUTUBE_API_KEY para identificar o canal.'});
  const url=new URL('https://www.googleapis.com/youtube/v3/videos');for(const [k,v] of Object.entries({id,part:'snippet,status',key:process.env.YOUTUBE_API_KEY}))url.searchParams.set(k,v);
  const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Não foi possível consultar os dados da live.');
  const item=(await response.json()).items?.[0];if(!item)return res.status(404).json({error:'Vídeo não encontrado ou privado.'});
  return res.json({channelId:item.snippet?.channelId,title:item.snippet?.title||'',embeddable:item.status?.embeddable!==false});
 }catch(e){return res.status(e.status||502).json({error:e.message});}
}

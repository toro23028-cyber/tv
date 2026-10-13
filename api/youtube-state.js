import {isActualLive} from '../player-policy.js';
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Método inválido.'});
 const id=req.query?.video;
 if(typeof id!=='string'||!/^[-\w]{11}$/.test(id)||Object.keys(req.query||{}).length!==1)return res.status(400).json({error:'Vídeo inválido.'});
 const key=process.env.YOUTUBE_API_KEY;if(!key)return res.status(503).json({error:'A verificação de live exige YOUTUBE_API_KEY.'});
 try{
  const url=new URL('https://www.googleapis.com/youtube/v3/videos');url.search=new URLSearchParams({id,part:'snippet,liveStreamingDetails',key});
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();
  const video=(await response.json()).items?.[0];
  res.setHeader('Cache-Control','public,max-age=15');res.setHeader('Vercel-CDN-Cache-Control','public,max-age=30');
  return res.json({live:isActualLive(video)});
 }catch{return res.status(502).json({error:'Não foi possível confirmar se o vídeo está ao vivo.'});}
}

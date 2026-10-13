const CHANNEL_ID=/^UC[\w-]{22}$/;

export default async function handler(req,res){
  if(req.method!=="GET")return res.status(405).json({error:"Método não permitido."});
  if(Object.keys(req.query||{}).length!==1||!Object.hasOwn(req.query||{},"channel"))return res.status(400).json({error:"Parâmetro inválido."});
  const source=String(req.query?.channel||"");
  const directId=CHANNEL_ID.test(source)?source:null;
  const handle=/^@?[\w.-]{3,30}$/.test(source)?source.replace(/^@/,""):null;
  if(!directId&&!handle)return res.status(400).json({error:"Canal do YouTube inválido."});
  const allowed=new Set(String(process.env.YOUTUBE_LIVE_CHANNEL_IDS||"").split(",").map(v=>v.trim()).filter(Boolean));
  const allowedHandles=new Set(String(process.env.YOUTUBE_LIVE_HANDLES||'').split(',').map(v=>v.trim().replace(/^@/,'').toLowerCase()).filter(Boolean));
  const apiKey=process.env.YOUTUBE_API_KEY;
  if(!apiKey)return res.status(503).json({error:"A busca automática ainda não foi configurada no servidor."});

  if(!allowed.size)return res.status(503).json({error:'Configure os IDs de canais permitidos no servidor.'});
  if(!directId&&!allowedHandles.has(handle.toLowerCase()))return res.status(403).json({error:'Este @handle não está liberado para busca automática. Use o ID UC do canal ou permita também o handle no servidor.'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    let channelId=directId;
    if(!channelId){
      const lookup=new URL("https://www.googleapis.com/youtube/v3/channels");
      for(const [key,value] of Object.entries({part:"id",forHandle:`@${handle}`,key:apiKey}))lookup.searchParams.set(key,value);
      const lookupResponse=await fetch(lookup,{signal:controller.signal}),lookupData=await lookupResponse.json();
      if(!lookupResponse.ok)return res.status(502).json({error:"Não foi possível identificar esse canal do YouTube."});
      channelId=lookupData.items?.[0]?.id;
      if(!CHANNEL_ID.test(channelId||""))return res.status(404).json({error:"Não encontrei esse canal do YouTube."});
    }
    if(!allowed.has(channelId))return res.status(403).json({error:"Este canal não está liberado para busca automática."});
    const url=new URL("https://www.googleapis.com/youtube/v3/search");
    for(const [key,value] of Object.entries({part:"snippet",channelId,eventType:"live",type:"video",order:"date",maxResults:"1",key:apiKey}))url.searchParams.set(key,value);
    const response=await fetch(url,{signal:controller.signal});
    const payload=await response.json();
    if(!response.ok){
      const reason=payload?.error?.errors?.[0]?.reason;
      const status=reason==="quotaExceeded"?429:502;
      return res.status(status).json({error:reason==="quotaExceeded"?"A cota diária de busca de lives do YouTube foi atingida.":"O YouTube não respondeu à busca da transmissão."});
    }
    res.setHeader("Cache-Control","public, max-age=60");
    res.setHeader("CDN-Cache-Control","public, max-age=900, stale-while-revalidate=300, stale-if-error=3600");
    res.setHeader("Vercel-CDN-Cache-Control","public, max-age=900, stale-while-revalidate=300, stale-if-error=3600");
    const item=payload.items?.find(v=>v.snippet?.channelId===channelId&&/^[\w-]{11}$/.test(v.id?.videoId||"")&&v.snippet?.liveBroadcastContent==="live");
    return res.status(200).json(item?{live:true,videoId:item.id?.videoId||null,title:item.snippet?.title||""}:{live:false,videoId:null});
  }catch{
    return res.status(502).json({error:"Não foi possível consultar o YouTube agora."});
  }finally{clearTimeout(timer);}
}

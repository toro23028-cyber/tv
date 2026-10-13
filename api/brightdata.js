import {requireAdmin} from '../server/admin-auth.js';
import {readBrightSnapshot} from '../server/brightdata.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({error:'Método inválido.'});
 try{
  await requireAdmin(req);
  if(Object.keys(req.query||{}).some(k=>k!=='snapshot')||typeof req.query?.snapshot!=='string')return res.status(400).json({error:'Informe o snapshot da Bright Data.'});
  const items=await readBrightSnapshot(req.query.snapshot,process.env.BRIGHTDATA_API_TOKEN);
  return res.json({items,count:items.length,limit:100});
 }catch(e){return res.status(e.status||502).json({error:e.message||'Não foi possível importar da Bright Data.'});}
}

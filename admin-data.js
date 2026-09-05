import {db,doc,collection,writeBatch,runTransaction} from './firebase';
import {findConflicts} from './schedule.js';
export function assertDocumentSize(data){
  if(new TextEncoder().encode(JSON.stringify(data)).byteLength>850000)throw new Error('Este cadastro ficou muito grande. Reduza imagens ou divida a playlist antes de salvar.');
}
export function cleanProgram(program){
  return Object.fromEntries(Object.entries(program).filter(([k,v])=>!k.startsWith('_')&&!['id','absStart','contKey','srcProgId'].includes(k)&&v!==undefined));
}
export async function commitPrograms(changes,removals=[]){
  if(changes.length+removals.length>400)throw new Error('Selecione até 400 alterações por operação.');
  const batch=writeBatch(db);
  for(const p of removals)batch.delete(doc(db,'programs',typeof p==='string'?p:p.id));
  for(const {id,...data} of changes){const clean=cleanProgram(data);assertDocumentSize(clean);batch.set(id?doc(db,'programs',id):doc(collection(db,'programs')),clean,{merge:!!id});}
  await batch.commit();
}
export function assertNoConflicts(programs,candidates,channels){
  const ids=new Set(candidates.map(p=>p.id).filter(Boolean));
  const accepted=programs.filter(p=>!ids.has(p.id));
  for(const [index,item] of candidates.entries()){
    const candidate={...item,id:item.id||`_validation_${index}`};
    if(!Number.isFinite(Number(candidate.horarioInicio))||Number(candidate.horarioInicio)<0||Number(candidate.horarioInicio)>=86400||!Number.isFinite(Number(candidate.duracao))||Number(candidate.duracao)<=0||Number(candidate.duracao)>2592000)throw new Error("Horário ou duração inválidos.");
    const ch=channels.find(c=>c.id===candidate.canalId);
    if(findConflicts(accepted,candidate,ch).length)throw new Error(`Conflito de horário em “${candidate.nome}”.`);
    accepted.push(candidate);
  }
}
export async function saveChannelNumber(id,data,channels){
  const number=Number(data.numero);
  if(!Number.isInteger(number)||number<1||number>9999)throw new Error('Use um número de canal de 1 a 9999.');
  if(!data.nome?.trim())throw new Error('Preencha o nome do canal.');
  if(channels.some(c=>c.id!==id&&Number(c.numero)===number))throw new Error('Esse número já pertence a outro canal.');
  assertDocumentSize(data);
  await runTransaction(db,async tx=>{
    const target=doc(db,'channels',id),lock=doc(db,'channelNumbers',String(number));
    const existing=await tx.get(target),reserved=await tx.get(lock);
    if(reserved.exists()&&reserved.data().channelId!==id)throw new Error('Esse número acabou de ser utilizado por outro canal.');
    const old=existing.data()?.numero;
    let oldLock=null,oldSnap=null;
    if(old&&Number(old)!==number){oldLock=doc(db,'channelNumbers',String(old));oldSnap=await tx.get(oldLock);}
    tx.set(target,{...data,numero:number,nome:data.nome.trim()},{merge:true});
    tx.set(lock,{channelId:id});
    if(oldSnap?.data()?.channelId===id)tx.delete(oldLock);
  });
}

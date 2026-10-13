import {findConflicts} from './schedule.js';
import {dateSecondsToAbsolute} from './clock.js';
export function assertDocumentSize(data){
  if(new TextEncoder().encode(JSON.stringify(data)).byteLength>850000)throw new Error('Este cadastro ficou muito grande. Reduza imagens ou divida a playlist antes de salvar.');
}
export function cleanProgram(program){
  return Object.fromEntries(Object.entries(program).filter(([k,v])=>!k.startsWith('_')&&!['id','absStart','contKey','srcProgId'].includes(k)&&v!==undefined));
}
export function assertNoConflicts(programs,candidates,channels){
  const ids=new Set(candidates.map(p=>p.id).filter(Boolean));
  const accepted=programs.filter(p=>!ids.has(p.id));
  for(const [index,item] of candidates.entries()){
    const candidate={...item,id:item.id||`_validation_${index}`};
    if(!Number.isInteger(Number(candidate.horarioInicio))||Number(candidate.horarioInicio)<0||Number(candidate.horarioInicio)>=86400||!Number.isInteger(Number(candidate.duracao))||Number(candidate.duracao)<=0||Number(candidate.duracao)>2592000)throw new Error("Horário ou duração inválidos.");
    const ch=channels.find(c=>c.id===candidate.canalId);
    if(!ch)throw new Error('Selecione um canal existente.');
    if(!candidate.nome?.trim())throw new Error('Preencha o nome do programa.');
    if(!Number.isFinite(dateSecondsToAbsolute(candidate.data)))throw new Error('Data inválida.');
    if(candidate.isTemplate)continue;
    if(findConflicts(accepted,candidate,ch).length)throw new Error(`Conflito de horário em “${candidate.nome}”.`);
    accepted.push(candidate);
  }
}

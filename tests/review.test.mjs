import test from 'node:test';
import assert from 'node:assert/strict';
import {dateSecondsToAbsolute,addBroadcastDays} from '../clock.js';
import {buildSchedule,buildGuideSchedule,getCurProg} from '../schedule.js';
import {assertNoConflicts,cleanProgram,assertDocumentSize} from '../program-validation.js';
const ch={id:'c'},date='2026-10-12';
const p=(patch={})=>({id:'p',nome:'Programa',canalId:'c',data:date,horarioInicio:3600,duracao:3600,...patch});
test('rejeita datas inexistentes em vez de avançar silenciosamente o calendário',()=>{
 for(const date of ['2026-02-30','2026-02-29','2026-04-31','2026-13-01','bad'])assert.ok(Number.isNaN(dateSecondsToAbsolute(date)));
 assert.ok(Number.isFinite(dateSecondsToAbsolute('2028-02-29')));
 assert.equal(addBroadcastDays('2028-02-28',1),'2028-02-29');
});
test('modelo não gera conflito contra a programação real nem entra no ar',()=>{
 assert.doesNotThrow(()=>assertNoConflicts([p()],[p({id:'modelo',isTemplate:true})],[ch]));
 assert.ok(buildSchedule([p({isTemplate:true})],'c',ch,date).every(p=>p.isPlaceholder));
});
test('validação exige canal, nome, data e segundos inteiros',()=>{
 for(const patch of [{canalId:'missing'},{nome:' '},{data:'2026-02-30'},{horarioInicio:1.5},{duracao:0},{duracao:1.2}])assert.throws(()=>assertNoConflicts([],[p(patch)],[ch]));
});
test('rejeita conflito da edição visual com programa no dia seguinte',()=>{
 const next=p({id:'next',data:'2026-10-13',horarioInicio:0});
 assert.throws(()=>assertNoConflicts([next],[p({horarioInicio:82800,duracao:7200})],[ch]),/Conflito/);
});
test('programação corrompida não cria segmentos negativos ou loop',()=>{
 for(const patch of [{horarioInicio:-1},{horarioInicio:86400},{horarioInicio:Infinity},{data:'2026-02-30'}]){
  const schedule=buildSchedule([p(patch)],'c',ch,date);
  assert.ok(schedule.every(x=>x.isPlaceholder));
 }
});
test('ciclo de sete dias cobre todas as viradas e a janela futura de 12h',()=>{
 const programs=Array.from({length:7},(_,i)=>p({id:`p${i}`,data:addBroadcastDays(date,i),horarioInicio:0,duracao:86400}));
 const channel={...ch,eternity:true,eternityAnchor:date,eternityDays:7};
 for(let day=0;day<21;day++){
  const guide=buildGuideSchedule(programs,'c',channel,addBroadcastDays(date,day));
  for(let t=82800;t<126000;t+=1800)assert.ok(!getCurProg(guide,t).isPlaceholder);
  assert.equal(getCurProg(guide,10).srcProgId,`p${day%7}`);
 }
});
test('limpeza preserva configuração live e remove dados de projeção',()=>{
 const clean=cleanProgram(p({_isProjected:true,absStart:100,id:'x',liveChannel:'@Trend',isLive:true}));
 assert.equal(clean.isLive,true);assert.equal(clean.liveChannel,'@Trend');
 assert.equal(clean.id,undefined);assert.equal(clean.absStart,undefined);assert.equal(clean._isProjected,undefined);
 assert.throws(()=>assertDocumentSize({text:'a'.repeat(850001)}),/grande/);
});

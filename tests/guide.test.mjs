import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGuideSchedule,getCurProg,getVideoPlaybackInfo,guideTime} from '../schedule.js';
import {normalizeNewsItem,newsDuration,prepareNewsPublication,countWords} from '../news.js';
const date='2026-09-05',ch={id:'c'};
const p=(extra={})=>({id:'p',nome:'Programa',canalId:'c',data:date,horarioInicio:82800,duracao:7200,youtubeId:'abcdefghijk',...extra});
test('guia inclui amanhã e preserva reprodução na passagem da meia-noite',()=>{
  const source=[p(),p({id:'next',data:'2026-09-06',horarioInicio:3600,duracao:43200})];
  const guide=buildGuideSchedule(source,'c',ch,date);
  assert.equal(getCurProg(guide,90000).srcProgId,'next');
  assert.equal(getCurProg(guide,129600).srcProgId,'next');
  assert.equal(getVideoPlaybackInfo(getCurProg(guide,88200),88200).position,5400);
  assert.equal(new Set(guide.map(p=>p.id)).size,guide.length);
});
test('eternity projeta as próximas 24 horas sem repetir antes da âncora',()=>{
  const guide=buildGuideSchedule([p({horarioInicio:0,duracao:86400})],'c',{...ch,eternity:true},date);
  for(let t=82800;t<169200;t+=1800)assert.ok(!getCurProg(guide,t).isPlaceholder);
  const future=buildGuideSchedule([p({data:'2026-09-07'})],'c',{...ch,eternity:true},date);
  assert.ok(future.every(p=>p.isPlaceholder));
});
test('guia vazio não inventa programação e cruza ano corretamente',()=>{
  const guide=buildGuideSchedule([p({data:'2027-01-01',horarioInicio:0})],'c',ch,'2026-12-31');
  assert.equal(getCurProg(guide,86400).srcProgId,'p');
  assert.ok(buildGuideSchedule([],'c',ch,date).every(p=>p.isPlaceholder));
  assert.equal(guideTime(90000),'Amanhã · 01:00');
});
test('programas modelo nunca entram na TV nem no ciclo eternity',()=>{
  const model=p({id:'model',isTemplate:true,horarioInicio:0,duracao:86400});
  assert.ok(buildGuideSchedule([model],'c',ch,date).every(item=>item.isPlaceholder));
  assert.ok(buildGuideSchedule([model],'c',{...ch,eternity:true},date).every(item=>item.isPlaceholder));
});
test('duração editorial permanece estável e começa na publicação',()=>{
  const item=normalizeNewsItem({title:'Uma notícia',durationMinutes:10},1000);
  assert.equal(newsDuration(item),10);
  assert.equal(prepareNewsPublication([item],2000000)[0].expiresAt,2600000);
  assert.equal(newsDuration({durationMinutes:1440}),30);
  assert.equal(countWords('  Uma  notícia\nimportante '),3);
});

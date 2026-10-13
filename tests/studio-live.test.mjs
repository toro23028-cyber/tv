import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGuideSchedule,getCurProg} from '../schedule.js';
import {normalizeGCColor} from '../news.js';
const channel={id:'c',nome:'Notícias',defaultLiveUrl:'https://youtube.com/live/abcdefghijk'};
test('live padrão cobre lacunas hoje e amanhã sem alterar o programa agendado',()=>{
 const scheduled={id:'p',canalId:'c',data:'2026-10-12',nome:'Playlist',horarioInicio:3600,duracao:3600,youtubeId:'12345678901'};
 const guide=buildGuideSchedule([scheduled],'c',channel,'2026-10-12');
 assert.equal(getCurProg(guide,0).liveUrl,channel.defaultLiveUrl);
 assert.equal(getCurProg(guide,4000).srcProgId,'p');assert.equal(getCurProg(guide,4000).isLive,undefined);
 assert.equal(getCurProg(guide,90000).isFallbackLive,true);
});
test('live padrão vazia ou inválida não inventa transmissão',()=>{
 for(const defaultLiveUrl of ['', 'https://example.com/live'])assert.ok(buildGuideSchedule([],'c',{...channel,defaultLiveUrl},'2026-10-12').every(p=>p.isPlaceholder));
});
test('live longa não vira maratona nem reinicia por blocos',()=>{
 const p={id:'live',canalId:'c',data:'2026-10-12',horarioInicio:0,duracao:86400,isLive:true,liveUrl:channel.defaultLiveUrl,nome:'Jornal'};
 const guide=buildGuideSchedule([p],'c',{id:'c'},'2026-10-12');
 assert.equal(guide.filter(p=>p.isLive).length,1);assert.equal(guide[0].isMaratona,false);assert.equal(guide[0].nome,'Jornal');
});
test('cor personalizada aceita somente hexadecimal válido',()=>{
 assert.equal(normalizeGCColor('#c6283e'),'#c6283e');assert.equal(normalizeGCColor('#ABC123'),'#ABC123');
 assert.equal(normalizeGCColor('red; background:url(x)'),'#1676eb');
});

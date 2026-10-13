import test from 'node:test';import assert from 'node:assert/strict';
import {buildGuideSchedule,getCurProg,getVideoPlaybackInfo} from '../schedule.js';
import {hlsURL} from '../automatic-schedule.js';
const bank=[{id:'a',nome:'Músicas',isTemplate:true,canalId:'c',duracao:3600,videos:[{youtubeUrl:'abcdefghijk',duration:300},{youtubeUrl:'12345678901',duration:400}]},{id:'b',nome:'Documentários',isTemplate:true,canalId:'c',duracao:3600,videos:[{youtubeUrl:'98765432109',duration:900}]}];
const ch={id:'c',nome:'Canal',autoMode:'playlists',autoPlaylistIds:['a','b'],autoShuffle:true};
test('grade automática cobre 48h, tem IDs únicos e é igual entre espectadores',()=>{
 const one=buildGuideSchedule(bank,'c',ch,'2026-10-12'),two=buildGuideSchedule(bank,'c',ch,'2026-10-12');assert.deepEqual(one,two);assert.equal(new Set(one.map(p=>p.id)).size,one.length);
 for(let now=0;now<172800;now+=300){const p=getCurProg(one,now);assert.ok(p&&!p.isPlaceholder);assert.ok(getVideoPlaybackInfo(p,now).videoId)}
 assert.notEqual(one[0].nome,one[1].nome);
});
test('programação manual e vinhetas têm prioridade sobre a reserva',()=>{
 const manual={id:'m',nome:'Manual',canalId:'c',data:'2026-10-12',horarioInicio:1800,duracao:900,youtubeId:'abcdefghijk'};
 const guide=buildGuideSchedule([...bank,manual],'c',ch,'2026-10-12');assert.equal(getCurProg(guide,2000).srcProgId,'m');assert.equal(getCurProg(guide,2800).isAutomatic,true);assert.deepEqual(getVideoPlaybackInfo(getCurProg(guide,2800),2800),getVideoPlaybackInfo(getCurProg(buildGuideSchedule(bank,'c',ch,'2026-10-12'),2800),2800));
});
test('live offline passa à reserva gravada, nova live assume as lacunas',()=>{
 const live={...ch,autoMode:'live',autoLiveChannel:'@canal',autoLiveStatus:'waiting'};
 assert.ok(buildGuideSchedule(bank,'c',live,'2026-10-12').every(p=>!p.isLive));
 const guide=buildGuideSchedule(bank,'c',{...live,autoLiveStatus:'live',autoLiveVideoId:'abcdefghijk',autoLiveTitle:'Nova live'},'2026-10-12');assert.equal(guide[0].nome,'Nova live');assert.equal(guide[0].liveUrl,'https://youtu.be/abcdefghijk');
});
test('HLS e retorno à reserva não ativam o fluxo YouTube',()=>{
 const hls={...ch,autoMode:'live',autoHlsUrl:'https://example.com/live.m3u8'};
 assert.equal(buildGuideSchedule(bank,'c',hls,'2026-10-12')[0].sourceType,'hls');
 assert.equal(buildGuideSchedule(bank,'c',{...hls,autoHlsStatus:'waiting'},'2026-10-12')[0].isLive,false);
 assert.equal(hlsURL('javascript:alert(1)'),null);assert.equal(hlsURL('http://example.com/live.m3u8'),null);
});
test('fontes indisponíveis não viram mídia inventada e modo manual continua igual',()=>{
 assert.ok(buildGuideSchedule([],'c',ch,'2026-10-12').every(p=>p.isPlaceholder));
 assert.ok(buildGuideSchedule(bank,'c',{...ch,autoMode:'off'},'2026-10-12').every(p=>p.isPlaceholder));
});

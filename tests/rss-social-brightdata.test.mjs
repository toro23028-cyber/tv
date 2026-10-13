import test from 'node:test';import assert from 'node:assert/strict';
import {socialVisible,mergeFeedQueue,editorialKey,normalizeNewsItem} from '../news.js';
import {buildGuideSchedule} from '../schedule.js';
import {fetchFeedURL} from '../server/feed-url.js';
import {boundedText} from '../server/admin-auth.js';
import {readBrightSnapshot} from '../server/brightdata.js';
test('tweets desaparecem fora do estúdio por padrão e opt-in exige canal de live',()=>{
 assert.equal(socialVisible({social:true},false,{autoMode:'live'}),false);
 assert.equal(socialVisible({social:true},true,{}),true);
 assert.equal(socialVisible({social:true,socialOutsideStudio:true},false,{autoMode:'live'}),true);
 assert.equal(socialVisible({social:true,socialOutsideStudio:true},false,{autoMode:'playlists'}),false);
});
test('canal antigo usa seu acervo sem configuração extra e off continua respeitado',()=>{
 const p={id:'p',canalId:'c',nome:'Acervo',data:'2026-10-11',horarioInicio:0,duracao:3600,videos:[{youtubeUrl:'abcdefghijk'}]};
 assert.ok(buildGuideSchedule([p],'c',{id:'c'},'2026-10-13').every(p=>!p.isPlaceholder));
 assert.ok(buildGuideSchedule([p],'c',{id:'c',autoMode:'off'},'2026-10-13').every(p=>p.isPlaceholder));
});
test('fila libera espaço das importações expiradas sem apagar rascunhos manuais',()=>{
 const old={id:'old',kind:'news',title:'Antiga',source:'RSS',autoImported:true,expiresAt:1};
 const manual={...old,id:'manual',title:'Manual',autoImported:false};const fresh={...old,id:'new',title:'Nova',expiresAt:10000};
 const result=mergeFeedQueue([old,manual],[fresh],[],1000);assert.equal(result.items.length,2);assert.equal(result.items[0].title,'Manual');
 assert.equal(mergeFeedQueue([], [old], [],1000,[editorialKey(old)]).fresh.length,0);
});
test('feed segue redirecionamento público e bloqueia destino local',async()=>{
 let calls=0;
 const fetcher=async()=>++calls===1?new Response(null,{status:302,headers:{location:'/rss-final'}}):new Response('<rss/>');
 const response=await fetchFeedURL('https://example.com/rss',{fetcher,resolver:async()=>[{address:'8.8.8.8'}]});assert.equal(await response.text(),'<rss/>');
 await assert.rejects(fetchFeedURL('https://example.com/rss',{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}),resolver:async()=>[{address:'8.8.8.8'}]}));
});
test('feed latin1 preserva caracteres portugueses',async()=>{
 assert.equal(await boundedText(new Response(Uint8Array.from([67,97,102,233]),{headers:{'content-type':'text/xml;charset=iso-8859-1'}})),'Café');
});
test('Bright Data converte conteúdo e perfil, limita importação e preserva revisão',async()=>{
 let calls=0;const fetcher=async()=>++calls===1?new Response(JSON.stringify({status:'ready'})):new Response(Array.from({length:110},(_,i)=>JSON.stringify({content:'Tweet '+i,user_name:'@perfil',url:'https://x.com/a/status/'+i})).join('\n'));
 const items=await readBrightSnapshot('s_1234567','token',fetcher);assert.equal(items.length,100);assert.equal(items[0].title,'Tweet 0');assert.equal(items[0].source,'@perfil');assert.equal(items[0].approved,false);
});
test('Bright Data pendente e chave ausente têm erro claro',async()=>{
 await assert.rejects(readBrightSnapshot('s_1234567',''),/BRIGHTDATA_API_TOKEN/);
 await assert.rejects(readBrightSnapshot('s_1234567','key',async()=>new Response(JSON.stringify({status:'running'}))),/processada/);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {studioAllowed,channelDisplayMode,isActualLive,toggleFullscreen} from '../player-policy.js';
import handler from '../api/youtube-state.js';
test('modo estúdio respeita canal e não herda escolha global',()=>{
 const settings={displayMode:'studio',channelModes:{a:'cinema',b:'studio'}};
 assert.equal(channelDisplayMode({id:'a',studioEnabled:true},settings),'cinema');assert.equal(channelDisplayMode({id:'b',studioEnabled:true},settings),'studio');assert.equal(channelDisplayMode({id:'c',studioEnabled:false},settings),'cinema');
 assert.equal(channelDisplayMode({id:'d',studioEnabled:true},settings),'studio');assert.equal(studioAllowed({newsEnabled:true}),true);
});
test('gravados e lives encerradas nunca são classificados ao vivo',()=>{
 assert.equal(isActualLive({snippet:{liveBroadcastContent:'none'}}),false);assert.equal(isActualLive({snippet:{liveBroadcastContent:'upcoming'}}),false);
 assert.equal(isActualLive({snippet:{liveBroadcastContent:'live'},liveStreamingDetails:{actualEndTime:'2026-10-13'}}),false);
 assert.equal(isActualLive({snippet:{liveBroadcastContent:'live'}}),true);
});
test('tela cheia mantém a composição do elemento do aplicativo',async()=>{
 const element={layout:'studio',calls:0,async requestFullscreen(){this.calls++}},doc={fullscreenElement:null};
 await toggleFullscreen(element,doc);assert.equal(element.layout,'studio');assert.equal(element.calls,1);
 doc.fullscreenElement=element;doc.exitFullscreen=async()=>{doc.fullscreenElement=null};await toggleFullscreen(element,doc);assert.equal(element.layout,'studio');assert.equal(doc.fullscreenElement,null);
});
test('verificação pública não acelera vídeo gravado ou concluído',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.YOUTUBE_API_KEY;process.env.YOUTUBE_API_KEY='test';
 try{for(const video of [{snippet:{liveBroadcastContent:'none'}},{snippet:{liveBroadcastContent:'live'},liveStreamingDetails:{actualEndTime:'end'}},{snippet:{liveBroadcastContent:'live'}}]){
 globalThis.fetch=async()=>({ok:true,json:async()=>({items:[video]})});const res={body:null,status(n){this.code=n;return this},setHeader(){},json(v){this.body=v;return this}};
 await handler({method:'GET',query:{video:'abcdefghijk'}},res);assert.equal(res.body.live,isActualLive(video));
 }}finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.YOUTUBE_API_KEY;else process.env.YOUTUBE_API_KEY=oldKey;}
});

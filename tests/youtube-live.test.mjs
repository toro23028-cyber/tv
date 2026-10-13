import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/youtube-live.js';

const channelId='UC1234567890123456789012',videoId='abcdefghijk';
function response(){return{code:0,headers:{},body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(name,value){this.headers[name]=value;}};}

test('a rota permite somente os canais configurados e devolve a live ativa com cache',async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.YOUTUBE_API_KEY,oldAllow=process.env.YOUTUBE_LIVE_CHANNEL_IDS;
  process.env.YOUTUBE_API_KEY='test-key';process.env.YOUTUBE_LIVE_CHANNEL_IDS=channelId;
  globalThis.fetch=async url=>{const parsed=new URL(url);assert.equal(parsed.searchParams.get('channelId'),channelId);assert.equal(parsed.searchParams.get('eventType'),'live');return{ok:true,json:async()=>({items:[{id:{videoId},snippet:{channelId,liveBroadcastContent:'live',title:'Programa ao vivo'}}]})};};
  try{const res=response();await handler({method:'GET',query:{channel:channelId}},res);assert.equal(res.code,200);assert.deepEqual(res.body,{live:true,videoId,title:'Programa ao vivo'});assert.match(res.headers['Vercel-CDN-Cache-Control'],/max-age=900/);}
  finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.YOUTUBE_API_KEY;else process.env.YOUTUBE_API_KEY=oldKey;if(oldAllow===undefined)delete process.env.YOUTUBE_LIVE_CHANNEL_IDS;else process.env.YOUTUBE_LIVE_CHANNEL_IDS=oldAllow;}
});

test('a rota rejeita parâmetros extras que poderiam contornar o cache',async()=>{
  const res=response();await handler({method:'GET',query:{channel:channelId,cacheBust:'1'}},res);assert.equal(res.code,400);
});

test('handle não autorizado é recusado antes de gastar uma consulta no YouTube',async()=>{
 const oldKey=process.env.YOUTUBE_API_KEY,oldAllow=process.env.YOUTUBE_LIVE_CHANNEL_IDS,oldHandles=process.env.YOUTUBE_LIVE_HANDLES,oldFetch=globalThis.fetch;
 process.env.YOUTUBE_API_KEY='test';process.env.YOUTUBE_LIVE_CHANNEL_IDS=channelId;delete process.env.YOUTUBE_LIVE_HANDLES;
 let called=false;globalThis.fetch=async()=>{called=true;throw new Error('consulta proibida');};
 try{const res=response();await handler({method:'GET',query:{channel:'@NaoPermitido'}},res);assert.equal(res.code,403);assert.equal(called,false);}
 finally{globalThis.fetch=oldFetch;for(const [key,value] of Object.entries({YOUTUBE_API_KEY:oldKey,YOUTUBE_LIVE_CHANNEL_IDS:oldAllow,YOUTUBE_LIVE_HANDLES:oldHandles})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

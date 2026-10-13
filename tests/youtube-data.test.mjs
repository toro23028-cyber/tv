import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/youtube-data.js';
const token=`x.${Buffer.from(JSON.stringify({sub:'tester',auth_time:Math.floor(Date.now()/1000)})).toString('base64url')}.x`;
const response=()=>({code:200,body:null,setHeader(){},status(n){this.code=n;return this},json(v){this.body=v;return this}});
async function run(query,{key='test-secret',upstream}={}){
 const oldFetch=globalThis.fetch,oldKey=process.env.YOUTUBE_API_KEY;let calls=[];
 process.env.YOUTUBE_API_KEY=key;
 globalThis.fetch=async url=>{calls.push(String(url));if(String(url).startsWith('https://firestore.googleapis.com'))return {ok:true,json:async()=>({fields:{enabled:{booleanValue:true}}})};return upstream||{ok:true,json:async()=>({items:[{id:'abcdefghijk'}],nextPageToken:'next'})}};
 try{const res=response();await handler({method:'GET',headers:{authorization:`Bearer ${token}`},query},res);return {res,calls};}
 finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.YOUTUBE_API_KEY;else process.env.YOUTUBE_API_KEY=oldKey;}
}
test('metadados usam somente a chave do servidor e não devolvem segredo',async()=>{
 const {res,calls}=await run({resource:'videos',id:'abcdefghijk'});assert.equal(res.code,200);
 const u=new URL(calls[1]);assert.equal(u.searchParams.get('key'),'test-secret');assert.equal(u.searchParams.get('part'),'snippet,contentDetails,status');assert.ok(!JSON.stringify(res.body).includes('test-secret'));
});
test('playlist mantém paginação pela função autenticada',async()=>{
 const {res,calls}=await run({resource:'playlistItems',playlistId:'PL1234567890',pageToken:'page_token'});assert.equal(res.body.nextPageToken,'next');assert.equal(new URL(calls[1]).searchParams.get('pageToken'),'page_token');
});
test('consultas arbitrárias e lote acima de 50 não gastam cota',async()=>{
 for(const query of [{resource:'search'}, {resource:'videos',id:'abcdefghijk',key:'evil'}, {resource:'videos',id:Array(51).fill('abcdefghijk').join(',')}]){const {res,calls}=await run(query);assert.equal(res.code,400);assert.equal(calls.length,1)}
});
test('chave ausente e cota excedida têm erro claro sem exposição',async()=>{
 const missing=await run({resource:'videos',id:'abcdefghijk'},{key:''});assert.equal(missing.res.code,503);assert.match(missing.res.body.error,/YOUTUBE_API_KEY/);
 const quota=await run({resource:'videos',id:'abcdefghijk'},{upstream:{ok:false,status:403,json:async()=>({error:{errors:[{reason:'quotaExceeded'}]}})}});assert.match(quota.res.body.error,/cota/);
});
test('metadados recusam acesso sem login',async()=>{
 const res=response();await handler({method:'GET',headers:{},query:{resource:'videos',id:'abcdefghijk'}},res);assert.equal(res.code,401);
});

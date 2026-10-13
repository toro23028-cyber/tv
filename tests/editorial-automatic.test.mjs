import test from 'node:test';
import assert from 'node:assert/strict';
import {tweetURL} from '../api/tweet-preview.js';
import {validateFeedURL,publicIPv4} from '../server/feed-url.js';
import {selectGCHeadlines} from '../news.js';
test('dois GCs não repetem a mesma manchete e seguem o ciclo',()=>{
 const news=[{id:'a'},{id:'b'},{id:'c'}];assert.deepEqual(selectGCHeadlines(news,2,true),[news[2],news[0]]);assert.equal(selectGCHeadlines(news.slice(0,1),0,true).length,1);assert.equal(selectGCHeadlines([],0,true).length,0);
});
test('tweet aceita apenas URL pública de status com domínio correto',()=>{
 assert.equal(tweetURL('https://x.com/perfil/status/12345?utm_source=foo'),'https://twitter.com/perfil/status/12345');
 for(const url of ['https://x.com/perfil','https://evil.com/perfil/status/1','https://x.com@evil.com/a/status/1','http://x.com/a/status/1'])assert.equal(tweetURL(url),null);
});
test('feed personalizado recusa IP, credenciais e domínio privado antes de baixar',async()=>{
 for(const url of ['https://127.0.0.1/x','https://a:b@example.com/rss','http://example.com/rss','https://feed.local/rss'])await assert.rejects(validateFeedURL(url,async()=>[{address:'8.8.8.8'}]));
 await assert.rejects(validateFeedURL('https://example.com/rss',async()=>[{address:'10.0.0.1'}]));
 assert.equal((await validateFeedURL('https://example.com/rss',async()=>[{address:'8.8.8.8'}])).pathname,'/rss');
});
test('validação de endereços bloqueia redes locais e reservadas',()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','192.168.1.1','169.254.169.254','100.64.1.1','198.18.1.1','::1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('8.8.8.8'),true);
});

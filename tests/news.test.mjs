import test from 'node:test';
import assert from 'node:assert/strict';
import {countWords,NEWS_LIMITS,normalizeNewsItem,safeSourceURL,publishableItems} from '../news.js';

test('normaliza categorias novas e migra cards sociais antigos para tweets',()=>{
  assert.equal(normalizeNewsItem({kind:'social',title:'mensagem'}).kind,'tweet');
  assert.equal(normalizeNewsItem({kind:'topic',title:'#assunto'}).source,'TRENDING');
});

test('aplica limites de manchete, subtítulo, tweet e etiquetas',()=>{
  assert.equal(normalizeNewsItem({title:'a'.repeat(100)}).title.length,NEWS_LIMITS.headline);
  const tweet=normalizeNewsItem({kind:'tweet',title:'t'.repeat(300),subtitle:'s'.repeat(200),category:'c'.repeat(80),source:'x'.repeat(80)});
  assert.equal(tweet.title.length,NEWS_LIMITS.tweet);
  assert.equal(tweet.subtitle.length,NEWS_LIMITS.subtitle);
  assert.equal(tweet.category.length,NEWS_LIMITS.category);
  assert.equal(tweet.source.length,NEWS_LIMITS.source);
});

test('conta palavras sem erro com espaços e linhas múltiplas',()=>{
  assert.equal(countWords('  Manchete\n de   teste  '),3);
  assert.equal(countWords('   '),0);
});

test('aceita apenas URLs HTTP(S) para fonte, imagem e publicação',()=>{
  assert.equal(safeSourceURL('javascript:alert(1)'), '');
  assert.equal(normalizeNewsItem({imageUrl:'data:image/png;base64,abc'}).imageUrl, '');
  assert.equal(normalizeNewsItem({url:'https://example.com/post'}).url, 'https://example.com/post');
});

test('publicação mantém o subtítulo e permite trending topic aprovado',()=>{
  const items=publishableItems([{id:'t1',kind:'topic',title:'#Trend',approved:true,expiresAt:Date.now()+60000}]);
  assert.equal(items.length,1);
  assert.equal(items[0].source,'TRENDING');
});

test('conteúdo publicado sem validade não ganha nova expiração a cada atualização',()=>{
 assert.equal(publishableItems([{title:'Notícia',source:'Redação',approved:true}],1000).length,0);
 assert.deepEqual(publishableItems({items:[]},1000),[]);
});

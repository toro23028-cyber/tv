import test from 'node:test';
import assert from 'node:assert/strict';
import {filterPrograms,makeBackup,prepareRestore,scheduleWarnings} from '../admin-tools.js';
const channels=[{id:'c',nome:'Teste'}],p={id:'p',nome:'Música especial',canalId:'c',data:'2026-10-12',horarioInicio:0,duracao:3600};
test('busca ignora acentos e filtra live/playlist',()=>{assert.equal(filterPrograms([p,{...p,id:'l',isLive:true}],'musica','live').length,1);assert.equal(filterPrograms([p],'nada').length,0)});
test('backup pode ser restaurado, ignora IDs existentes por padrão e aceita atualização explícita',()=>{const text=JSON.stringify(makeBackup([p],channels));assert.equal(prepareRestore(text,[],channels).changes.length,1);assert.equal(prepareRestore(text,[p],channels).skipped,1);assert.equal(prepareRestore(text,[p],channels,true).changes.length,1)});
test('restauração rejeita conflitos, canais ausentes, duplicação de IDs e formato inválido',()=>{const text=JSON.stringify(makeBackup([p],channels));assert.throws(()=>prepareRestore(text,[{...p,id:'q'}],channels),/Conflito/);assert.throws(()=>prepareRestore(text,[],[]),/canal/);assert.throws(()=>prepareRestore(JSON.stringify(makeBackup([p,p],channels)),[],channels),/repetidos/);assert.throws(()=>prepareRestore('{}',[],channels),/inválido/)});
test('pendências identificam ausência de programação e fonte de live',()=>{assert.equal(scheduleWarnings([],channels,p.data).length,1);assert.equal(scheduleWarnings([{...p,isLive:true}],channels,p.data).length,1);assert.equal(scheduleWarnings([p],channels,p.data).length,0)});

test('restauração recusa listas malformadas antes de gravar',()=>{for(const patch of [{tags:'HD'},{videos:{}},{sinopse:{text:'texto'}}])assert.throws(()=>prepareRestore(JSON.stringify(makeBackup([{...p,...patch}],channels)),[],channels),/inválid/)});

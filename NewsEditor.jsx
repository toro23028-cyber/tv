import {useEffect,useState,useRef} from 'react';
import {db,doc,getDoc,setDoc,writeBatch} from './firebase';
import {DEFAULT_NEWS_CONFIG,normalizeNewsItem,parseNewsImport,publishableItems,safeSourceURL} from './news';
import {assertDocumentSize} from './admin-data';
import NewsOverlay from './NewsOverlay';
export default function NewsEditor({channels,notify,onDirty}){
  const [channelId,setChannelId]=useState(''),[items,setItems]=useState([]),[config,setConfig]=useState(DEFAULT_NEWS_CONFIG),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[preview,setPreview]=useState(false);
  useEffect(()=>{onDirty?.(dirty);},[dirty,onDirty]);
  const channel=channels.find(c=>c.id===channelId),input=useRef(null);
  useEffect(()=>{if(!channelId&&channels.length)setChannelId(channels[0].id);},[channels,channelId]);
  useEffect(()=>{
    let active=true;if(!channelId)return;setLoading(true);setItems([]);setConfig(DEFAULT_NEWS_CONFIG);setDirty(false);setError('');
    getDoc(doc(db,'newsDrafts',channelId)).then(snap=>{if(active&&snap.exists()){setItems((snap.data().items||[]).map(p=>normalizeNewsItem(p)));setConfig({...DEFAULT_NEWS_CONFIG,...snap.data().config});}}).catch(()=>{if(active)setError('Não foi possível carregar os rascunhos. Reabra esta aba antes de editar.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[channelId]);
  useEffect(()=>{const h=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[dirty]);
  const change=(id,patch)=>{setItems(list=>list.map(p=>p.id===id?{...p,...patch}:p));setDirty(true);};
  const changeConfig=patch=>{setConfig(c=>({...c,...patch}));setDirty(true);};
  async function save(publish=false){
    if(!channelId||loading||busy||error)return;setBusy(true);
    try{
      const draft={items,config};assertDocumentSize(draft);
      if(publish){
        const approved=publishableItems(items);
        if(config.enabled&&items.some(p=>p.approved)&&!approved.length)throw new Error('As notícias aprovadas expiraram ou estão sem título/fonte. Revise antes de publicar.');
        const batch=writeBatch(db);batch.set(doc(db,'newsDrafts',channelId),draft);batch.set(doc(db,'newsPublished',channelId),{items:approved,config,updatedAt:Date.now()});batch.update(doc(db,'channels',channelId),{newsEnabled:!!config.enabled});await batch.commit();notify(`${approved.length} itens publicados no canal.`);
      }else{await setDoc(doc(db,'newsDrafts',channelId),draft);notify('Rascunho salvo.');}
      setDirty(false);
    }catch(e){notify(e.message||'Não foi possível salvar.');}finally{setBusy(false);}
  }
  async function importFile(file){
    if(!file)return;
    try{
      if(file.size>500000)throw new Error('Use um arquivo com até 500 KB.');
      const parsed=parseNewsImport(await file.text());if(items.length+parsed.length>100)throw new Error('Mantenha até 100 itens na redação.');
      const keys=new Set(items.map(p=>p.url||p.title));const additions=parsed.filter(p=>!keys.has(p.url||p.title));
      setItems(list=>[...list,...additions]);setDirty(true);notify(`${additions.length} itens importados para revisão.`);
    }catch(e){notify(e.message||'Arquivo inválido.');}finally{if(input.current)input.current.value='';}
  }
  return <section className="news-editor"><h2>Redação do canal</h2><p className="muted">Prepare as notícias, aprove o que pode entrar no ar e publique quando estiver pronto.</p>
    <label>Canal<select value={channelId} disabled={busy} onChange={e=>{if(dirty&&!confirm('Trocar de canal e descartar as alterações não salvas?'))return;setChannelId(e.target.value);}}>{channels.filter(c=>!c.isInfo).map(c=><option value={c.id} key={c.id}>{c.numero} · {c.nome}</option>)}</select></label>
    {loading&&<p>Carregando redação…</p>}{error&&<p role="alert">{error}</p>}
    <fieldset disabled={loading||busy||!!error||!channel}><legend>O que aparece na TV</legend><div className="news-options">{[['enabled','Ativar informações neste canal'],['ticker','Faixa de notícias'],['gc','Manchete em destaque'],['social','Card de publicação']].map(([key,label])=><label key={key}><input type="checkbox" checked={!!config[key]} onChange={e=>changeConfig({[key]:e.target.checked})}/>{label}</label>)}</div><div className="news-options"><label>Trocar manchete/card a cada (segundos)<input type="number" min="10" max="120" value={config.interval} onChange={e=>changeConfig({interval:Math.min(120,Math.max(10,Number(e.target.value)||20))})}/></label><label>Canto do card<select value={config.corner} onChange={e=>changeConfig({corner:e.target.value})}><option value="tr">Superior direito</option><option value="tl">Superior esquerdo</option><option value="br">Inferior direito</option><option value="bl">Inferior esquerdo</option></select></label></div>
      <div className="news-tools"><button onClick={()=>{if(items.length>=100){notify('Limite de 100 itens por redação.');return;}setItems([...items,normalizeNewsItem({})]);setDirty(true);}}>+ Nova notícia/publicação</button><button onClick={()=>input.current?.click()}>Importar RSS ou JSON</button><input ref={input} hidden type="file" accept=".json,.xml,.rss,.atom" onChange={e=>importFile(e.target.files[0])}/></div>
      <p className="muted">Importações entram sem aprovação. Somente título, fonte e link são utilizados. Cada item sai do ar ao expirar.</p>
      {items.map(item=><article key={item.id} className="news-item"><div className="news-options"><label>Tipo<select value={item.kind} onChange={e=>change(item.id,{kind:e.target.value})}><option value="news">Notícia</option><option value="social">Publicação manual</option></select></label><label>Fonte / autor<input value={item.source} maxLength={80} onChange={e=>change(item.id,{source:e.target.value})} placeholder="Nome do veículo ou @autor"/></label></div><label>Manchete ou texto<textarea maxLength={240} value={item.title} onChange={e=>change(item.id,{title:e.target.value})}/></label><label>Link da fonte<input type="url" value={item.url} onChange={e=>change(item.id,{url:e.target.value})} onBlur={()=>change(item.id,{url:safeSourceURL(item.url)})} placeholder="https://…"/></label><div className="news-options"><label><input type="checkbox" checked={item.approved} onChange={e=>change(item.id,{approved:e.target.checked})}/>Aprovada</label><label><input type="checkbox" checked={item.urgent} onChange={e=>change(item.id,{urgent:e.target.checked})}/>Urgente</label><span>{Date.now()>=item.expiresAt?'Expirada':'Expira em '+new Date(item.expiresAt).toLocaleString('pt-BR')}</span><button onClick={()=>change(item.id,{expiresAt:Date.now()+86400000})}>Renovar por 24h</button><button onClick={()=>{if(confirm('Remover este item da redação?')){setItems(items.filter(p=>p.id!==item.id));setDirty(true);}}}>Remover</button></div></article>)}
      {!items.length&&<p>Nenhuma notícia cadastrada neste canal.</p>}
      <div className="news-tools"><button onClick={()=>save(false)}>Salvar rascunho</button><button onClick={()=>setPreview(v=>!v)}>Ver prévia</button><button className="primary" onClick={()=>save(true)}>{busy?'Salvando…':'Publicar na TV'}</button></div>
      {preview&&<div className="news-preview"><span>Prévia · itens aprovados</span><NewsOverlay channel={channel} preview={{items:publishableItems(items),config:{...config,enabled:true}}}/></div>}
    </fieldset>
  </section>;
}

import {useEffect,useState,useRef} from 'react';
import {db,doc,getDoc,setDoc,writeBatch} from './firebase';
import {DEFAULT_NEWS_CONFIG,NEWS_DURATION_OPTIONS,NEWS_LIMITS,NEWS_WORD_LIMIT,countWords,newsDuration,prepareNewsPublication,normalizeNewsItem,parseNewsImport,publishableItems,safeSourceURL} from './news';
import {assertDocumentSize} from './admin-data';
import NewsOverlay from './NewsOverlay';

async function confirmWrite(promise){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('O servidor não confirmou em 15 segundos. A gravação pode estar pendente; confira a conexão e reabra a redação antes de tentar novamente.')),15000);})]);}
  finally{clearTimeout(timer);}
}

const KIND_LABEL={news:'Manchete',tweet:'Tweet',topic:'Trending topic'};
export default function NewsEditor({channels,notify,onDirty}){
  const [channelId,setChannelId]=useState(''),[items,setItems]=useState([]),[config,setConfig]=useState(DEFAULT_NEWS_CONFIG),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[preview,setPreview]=useState(false);
  const channel=channels.find(c=>c.id===channelId),input=useRef(null),[loadFailed,setLoadFailed]=useState(false);
  useEffect(()=>{onDirty?.(dirty);},[dirty,onDirty]);
  useEffect(()=>{if(!channelId&&channels.length)setChannelId(channels[0].id);},[channels,channelId]);
  useEffect(()=>{
    let active=true;if(!channelId)return;
    setLoading(true);setLoadFailed(false);setItems([]);setConfig(DEFAULT_NEWS_CONFIG);setDirty(false);setError('');
    getDoc(doc(db,'newsDrafts',channelId)).then(snap=>{if(active&&snap.exists()){setItems((Array.isArray(snap.data().items)?snap.data().items:[]).map(p=>normalizeNewsItem(p)));setConfig({...DEFAULT_NEWS_CONFIG,...snap.data().config});}}).catch(()=>{if(active){setLoadFailed(true);setError('Não foi possível carregar os rascunhos. Reabra esta aba antes de editar.');}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[channelId]);
  useEffect(()=>{const h=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[dirty]);
  const change=(id,patch)=>{setItems(list=>list.map(p=>p.id===id?{...p,...patch}:p));setDirty(true);};
  const changeConfig=patch=>{setConfig(c=>({...c,...patch}));setDirty(true);};
  const addItem=kind=>{
    if(items.length>=100){notify('Limite de 100 itens por redação.');return;}
    const defaults=kind==='topic'?{title:'',source:'TRENDING',category:'Assunto em alta'}:kind==='tweet'?{source:'',category:'Redes sociais'}:{source:'TREND TV',category:'Em pauta'};
    setItems(list=>[...list,normalizeNewsItem({kind,...defaults})]);setDirty(true);
  };
  const setItemDuration=(id,minutes)=>change(id,{durationMinutes:Number(minutes),expiresAt:Date.now()+Number(minutes)*60000});
  async function save(publish=false){
    if(!channelId||loading||busy||loadFailed)return;setBusy(true);setError('');
    try{
      if(!navigator.onLine)throw new Error('Sem conexão. Reconecte antes de salvar ou publicar.');
      const approvedInput=items.filter(p=>publish&&p.approved);
      if(publish&&config.enabled&&approvedInput.length>50)throw new Error('Libere até 50 itens por publicação. Desmarque os demais antes de publicar.');
      if(items.some(p=>p.kind==='news'&&(countWords(p.title)>NEWS_WORD_LIMIT||p.title.length>NEWS_LIMITS.headline||p.subtitle.length>NEWS_LIMITS.subtitle)))throw new Error('Ajuste as manchetes aos limites de caracteres e palavras exibidos nos campos.');
      if(items.some(p=>p.kind==='tweet'&&p.title.length>NEWS_LIMITS.tweet))throw new Error('Um tweet ultrapassou o limite de caracteres indicado.');
      if(approvedInput.some(p=>!p.title.trim()))throw new Error('Preencha o texto dos itens aprovados.');
      if(approvedInput.some(p=>!p.source.trim()&&p.kind!=='topic'))throw new Error('Informe a fonte, perfil ou autoria de cada item aprovado.');
      const savedItems=publish?prepareNewsPublication(items):items;
      const draft={items:savedItems,config};assertDocumentSize(draft);
      if(publish){
        const approved=publishableItems(savedItems);
        if(config.enabled&&approvedInput.length&&!approved.length)throw new Error('Os itens aprovados não podem ser publicados. Revise o texto e a fonte.');
        const batch=writeBatch(db);batch.set(doc(db,'newsDrafts',channelId),draft);batch.set(doc(db,'newsPublished',channelId),{items:approved,config,updatedAt:Date.now()});batch.update(doc(db,'channels',channelId),{newsEnabled:!!config.enabled});await confirmWrite(batch.commit());notify(config.enabled?`${approved.length} itens publicados no canal.`:'Pacote gráfico desativado neste canal.');
      }else{await confirmWrite(setDoc(doc(db,'newsDrafts',channelId),draft));notify('Rascunho salvo.');}
      setItems(savedItems);setDirty(false);
    }catch(e){const message=e.message||'Não foi possível salvar.';setError(message);notify(message);}finally{setBusy(false);}
  }
  async function importFile(file){
    if(!file)return;
    try{
      if(file.size>500000)throw new Error('Use um arquivo com até 500 KB.');
      const parsed=parseNewsImport(await file.text());
      const keys=new Set(items.map(p=>p.url||`${p.kind}:${p.title}`));const additions=parsed.filter(p=>!keys.has(p.url||`${p.kind}:${p.title}`));
      if(items.length+additions.length>100)throw new Error('Mantenha até 100 itens na redação.');
      setItems(list=>[...list,...additions]);setDirty(true);notify(`${additions.length} itens importados para revisão.`);
    }catch(e){notify(e.message||'Arquivo inválido.');}finally{if(input.current)input.current.value='';}
  }
  const prepared=prepareNewsPublication(items),previewItems=publishableItems(prepared);
  return <section className="news-editor">
    <header className="news-editor-heading"><div><span className="news-eyebrow">PACOTE GRÁFICO · AO VIVO</span><h2>Redação</h2><p className="muted">Monte a manchete e a fila de mensagens. Confira a prévia e publique no canal.</p></div><span className="news-count">{items.filter(p=>p.approved).length} aprovados · {items.length}/100</span></header>
    <label className="news-channel-select">Canal<select value={channelId} disabled={busy||loading||loadFailed} onChange={e=>{if(dirty&&!confirm('Trocar de canal e descartar as alterações não salvas?'))return;setChannelId(e.target.value);}}>{channels.filter(c=>!c.isInfo).map(c=><option value={c.id} key={c.id}>{c.numero} · {c.nome}</option>)}</select></label>
    {loading&&<p>Carregando redação…</p>}{error&&<p className="news-error" role="alert">{error}</p>}
    <fieldset className="news-controls" disabled={loading||busy||!channel||loadFailed}><legend>Exibição na TV</legend>
      <div className="news-feature-toggles">{[['enabled','Ativar pacote gráfico'],['gc','Manchete + subtítulo'],['ticker','Ticker inferior'],['social','Painel de mensagens']].map(([key,label])=><label key={key}><input type="checkbox" checked={!!config[key]} onChange={e=>changeConfig({[key]:e.target.checked})}/><span>{label}</span></label>)}</div>
      <div className="news-settings-row"><label>Alternar manchete<select value={config.interval} onChange={e=>changeConfig({interval:Number(e.target.value)})}><option value={10}>A cada 10 segundos</option><option value={15}>A cada 15 segundos</option><option value={20}>A cada 20 segundos</option><option value={30}>A cada 30 segundos</option><option value={45}>A cada 45 segundos</option><option value={60}>A cada 60 segundos</option></select></label><label>Velocidade da rolagem<select value={config.socialSpeed||34} onChange={e=>changeConfig({socialSpeed:Number(e.target.value)})}><option value={24}>Rápida · 24 s</option><option value={34}>Normal · 34 s</option><option value={48}>Lenta · 48 s</option><option value={64}>Bem lenta · 64 s</option></select></label><span className="news-template-note">Modelo PNG · TREND Wall 16:9</span></div>
    </fieldset>
    <fieldset className="news-content-fields" disabled={loading||busy||!channel||loadFailed}>
    <div className="news-add-bar"><div><strong>Adicionar à fila</strong><small>Os textos entram como rascunho; marque “Liberar na TV” para publicar.</small></div><button onClick={()=>addItem('news')}>＋ Manchete</button><button onClick={()=>addItem('tweet')}>＋ Tweet</button><button onClick={()=>addItem('topic')}>＋ Trending topic</button><button className="news-import-button" onClick={()=>input.current?.click()}>Importar RSS/JSON</button><input ref={input} hidden type="file" accept=".json,.xml,.rss,.atom" onChange={e=>importFile(e.target.files[0])}/></div>
    {items.map((item,index)=>{
      const limit=item.kind==='tweet'?NEWS_LIMITS.tweet:item.kind==='topic'?NEWS_LIMITS.topic:NEWS_LIMITS.headline;
      const wordCount=item.kind==='news'?countWords(item.title):null;
      return <article key={item.id} className={`news-item news-item-${item.kind}`}>
        <header><span className={`news-kind-badge kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span><span>Item {index+1}</span><button className="news-remove" onClick={()=>{if(confirm('Remover este item da redação?')){setItems(list=>list.filter(p=>p.id!==item.id));setDirty(true);}}}>Remover</button></header>
        <div className="news-form-grid">
          {item.kind==='news'?<>
            <label className="news-field-wide">Manchete<textarea maxLength={NEWS_LIMITS.headline} value={item.title} onChange={e=>change(item.id,{title:e.target.value})} placeholder="Escreva a informação principal em uma frase"/><small>{item.title.length}/{NEWS_LIMITS.headline} caracteres · {wordCount}/{NEWS_WORD_LIMIT} palavras</small></label>
            <label className="news-field-wide">Subtítulo / linha fina<textarea maxLength={NEWS_LIMITS.subtitle} value={item.subtitle} onChange={e=>change(item.id,{subtitle:e.target.value})} placeholder="Dê o contexto essencial em uma linha"/><small>{item.subtitle.length}/{NEWS_LIMITS.subtitle} caracteres</small></label>
            <label>Categoria<input maxLength={NEWS_LIMITS.category} value={item.category} onChange={e=>change(item.id,{category:e.target.value})} placeholder="Brasil, economia, urgente…"/><small>{item.category.length}/{NEWS_LIMITS.category}</small></label>
            <label>Fonte<input maxLength={NEWS_LIMITS.source} value={item.source} onChange={e=>change(item.id,{source:e.target.value})} placeholder="Veículo ou redação"/><small>{item.source.length}/{NEWS_LIMITS.source}</small></label>
            <label className="news-field-wide">Imagem da manchete · URL HTTPS<input type="url" value={item.imageUrl} onChange={e=>change(item.id,{imageUrl:e.target.value})} onBlur={()=>change(item.id,{imageUrl:safeSourceURL(item.imageUrl)})} placeholder="https://…/imagem.jpg"/></label>
            {item.imageUrl&&<img className="news-image-preview" src={item.imageUrl} alt="Prévia da imagem da manchete" onError={e=>{e.currentTarget.dataset.error='true';}} onLoad={e=>{delete e.currentTarget.dataset.error;}}/>}
          </>:<>
            <label className="news-field-wide">{item.kind==='tweet'?'Texto do tweet':'Trending topic'}<textarea maxLength={limit} value={item.title} onChange={e=>change(item.id,{title:e.target.value})} placeholder={item.kind==='tweet'?'Cole ou escreva a mensagem que deve aparecer na TV':'Ex.: #AssuntoDoMomento'}/><small>{item.title.length}/{limit} caracteres</small></label>
            <label>{item.kind==='tweet'?'Perfil / autor':'Identificação'}<input maxLength={NEWS_LIMITS.source} value={item.source} onChange={e=>change(item.id,{source:e.target.value})} placeholder={item.kind==='tweet'?'@perfil':'TRENDING'}/><small>{item.source.length}/{NEWS_LIMITS.source}</small></label>
            <label>Assunto / etiqueta<input maxLength={NEWS_LIMITS.category} value={item.category} onChange={e=>change(item.id,{category:e.target.value})} placeholder="Tema relacionado"/><small>{item.category.length}/{NEWS_LIMITS.category}</small></label>
          </>}
          <label className="news-field-wide">Link de referência<input type="url" value={item.url} onChange={e=>change(item.id,{url:e.target.value})} onBlur={()=>change(item.id,{url:safeSourceURL(item.url)})} placeholder="https://…"/></label>
        </div>
        <footer><label className="news-check"><input type="checkbox" checked={item.approved} onChange={e=>change(item.id,{approved:e.target.checked})}/>Liberar na TV</label><label className="news-check"><input type="checkbox" checked={item.urgent} onChange={e=>change(item.id,{urgent:e.target.checked})}/>Urgente</label><label className="news-duration">Tempo no ar<select value={newsDuration(item)} onChange={e=>setItemDuration(item.id,e.target.value)}>{NEWS_DURATION_OPTIONS.map(o=><option key={o.minutes} value={o.minutes}>{o.label}</option>)}</select></label><span>{item.approved&&Date.now()>=item.expiresAt?'Expirada':item.approved?'Publicada ao salvar':'Aguardando liberação'}</span></footer>
      </article>;
    })}
    {!items.length&&<div className="news-empty"><strong>A fila está vazia</strong><span>Adicione uma manchete, mensagem social ou tópico em alta.</span></div>}
    <div className="news-bottom-actions"><button onClick={()=>save(false)}>{busy?'Salvando…':'Salvar rascunho'}</button><button onClick={()=>setPreview(v=>!v)}>{preview?'Fechar prévia':'Prévia 16:9'}</button><button className="primary" onClick={()=>save(true)}>{busy?'Publicando…':`Publicar na TV · ${config.enabled?publishableItems(prepared).length:0}`}</button></div>
    {preview&&<div className="news-preview"><NewsOverlay channel={channel} preview={{items:previewItems,config:{...config,enabled:true}}}/></div>}
    </fieldset>
  </section>;
}

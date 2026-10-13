import {adminRequest,importEditorialSource} from './editorial-client';
import {useEffect,useState,useRef} from 'react';
import {db,doc,getDoc,setDoc,writeBatch} from './firebase';
import {DEFAULT_NEWS_CONFIG,GC_COLORS,normalizeGCColor,NEWS_DURATION_OPTIONS,NEWS_LIMITS,NEWS_WORD_LIMIT,countWords,newsDuration,prepareNewsPublication,normalizeNewsItem,parseNewsImport,publishableItems,safeSourceURL,dedupeEditorial,mergeEditorial} from './news';
import {assertDocumentSize} from './admin-data';
import {extractYouTubeId,normalizeYouTubeChannel} from './youtube-id';
import NewsOverlay from './NewsOverlay';

async function confirmWrite(promise){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('O servidor não confirmou em 15 segundos. A gravação pode estar pendente; confira a conexão e reabra a redação antes de tentar novamente.')),15000);})]);}
  finally{clearTimeout(timer);}
}

const KIND_LABEL={news:'Manchete',tweet:'Tweet',topic:'Trending topic'};
export default function NewsEditor({channels,notify,onDirty}){
  const [channelId,setChannelId]=useState(''),[items,setItems]=useState([]),[config,setConfig]=useState(DEFAULT_NEWS_CONFIG),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[preview,setPreview]=useState(false);
  const operationLock=useRef(false),addLock=useRef({}),feedLock=useRef(false),liveState=useRef(null);
  const [sources,setSources]=useState([]),[sourceId,setSourceId]=useState(''),[autoImport,setAutoImport]=useState(false),[feedBusy,setFeedBusy]=useState(false),[feedStatus,setFeedStatus]=useState('');
  const [defaultLiveUrl,setDefaultLiveUrl]=useState(''),[defaultLiveChannel,setDefaultLiveChannel]=useState('');
  const [previewDevice,setPreviewDevice]=useState('desktop');
  const channel=channels.find(c=>c.id===channelId),input=useRef(null),[loadFailed,setLoadFailed]=useState(false);
  useEffect(()=>{setDefaultLiveUrl(channel?.defaultLiveUrl||'');setDefaultLiveChannel(channel?.defaultLiveChannel||'');},[channelId,channel?.defaultLiveUrl,channel?.defaultLiveChannel]);
  liveState.current={channelId,items,loading,loadFailed};
  useEffect(()=>{onDirty?.(dirty);},[dirty,onDirty]);
  useEffect(()=>{if(!channelId&&channels.length)setChannelId(channels[0].id);},[channels,channelId]);
  useEffect(()=>{
    let active=true;if(!channelId)return;
    setLoading(true);setLoadFailed(false);setItems([]);setConfig(DEFAULT_NEWS_CONFIG);setDirty(false);setError('');
    getDoc(doc(db,'newsDrafts',channelId)).then(snap=>{if(active&&snap.exists()){setItems((Array.isArray(snap.data().items)?snap.data().items:[]).map(p=>normalizeNewsItem(p)));setConfig({...DEFAULT_NEWS_CONFIG,...snap.data().config});if(typeof snap.data().defaultLiveUrl==='string')setDefaultLiveUrl(snap.data().defaultLiveUrl);if(typeof snap.data().defaultLiveChannel==='string')setDefaultLiveChannel(snap.data().defaultLiveChannel);}}).catch(()=>{if(active){setLoadFailed(true);setError('Não foi possível carregar os rascunhos. Reabra esta aba antes de editar.');}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[channelId]);
  useEffect(()=>{const h=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[dirty]);
  const change=(id,patch)=>{setItems(list=>list.map(p=>p.id===id?{...p,...patch}:p));setDirty(true);};
  const changeConfig=patch=>{setConfig(c=>({...c,...patch}));setDirty(true);};
  const addItem=kind=>{
    if(Date.now()-(addLock.current[kind]||0)<500)return;addLock.current[kind]=Date.now();
    if(items.length>=100){notify('Limite de 100 itens por redação.');return;}
    const defaults=kind==='topic'?{title:'',source:'TRENDING',category:'Assunto em alta'}:kind==='tweet'?{source:'',category:'Redes sociais'}:{source:'TREND TV',category:'Em pauta'};
    setItems(list=>[...list,normalizeNewsItem({kind,...defaults})]);setDirty(true);
  };
  const setItemDuration=(id,minutes)=>change(id,{durationMinutes:Number(minutes),expiresAt:Date.now()+Number(minutes)*60000});
  async function save(publish=false){
    if(!channelId||loading||operationLock.current||feedLock.current||loadFailed)return;operationLock.current=true;setBusy(true);setError('');
    try{
      if(!navigator.onLine)throw new Error('Sem conexão. Reconecte antes de salvar ou publicar.');
      if(defaultLiveUrl.trim()&&!extractYouTubeId(defaultLiveUrl))throw new Error('Informe uma URL válida de vídeo/live do YouTube para a live padrão.');
      if(defaultLiveChannel.trim()&&!normalizeYouTubeChannel(defaultLiveChannel))throw new Error('Canal automático inválido. Use @handle ou ID UC.');
      const approvedInput=items.filter(p=>publish&&p.approved);
      if(publish&&config.enabled&&approvedInput.length>50)throw new Error('Libere até 50 itens por publicação. Desmarque os demais antes de publicar.');
      if(items.some(p=>p.kind==='news'&&(countWords(p.title)>NEWS_WORD_LIMIT||p.title.length>NEWS_LIMITS.headline||p.subtitle.length>NEWS_LIMITS.subtitle)))throw new Error('Ajuste as manchetes aos limites de caracteres e palavras exibidos nos campos.');
      if(items.some(p=>p.kind==='tweet'&&p.title.length>NEWS_LIMITS.tweet))throw new Error('Um tweet ultrapassou o limite de caracteres indicado.');
      if(approvedInput.some(p=>!p.title.trim()))throw new Error('Preencha o texto dos itens aprovados.');
      if(approvedInput.some(p=>!p.source.trim()&&p.kind!=='topic'))throw new Error('Informe a fonte, perfil ou autoria de cada item aprovado.');
      const unique=dedupeEditorial(items);const savedItems=publish?prepareNewsPublication(unique):unique;
      const draft={items:savedItems,config,defaultLiveUrl:defaultLiveUrl.trim(),defaultLiveChannel:defaultLiveChannel.trim()};assertDocumentSize(draft);
      if(publish){
        const approved=publishableItems(savedItems);
        if(config.enabled&&approvedInput.length&&!approved.length)throw new Error('Os itens aprovados não podem ser publicados. Revise o texto e a fonte.');
        const batch=writeBatch(db);batch.set(doc(db,'newsDrafts',channelId),draft);batch.set(doc(db,'newsPublished',channelId),{items:approved,config,updatedAt:Date.now()});batch.update(doc(db,'channels',channelId),{newsEnabled:!!config.enabled,defaultLiveUrl:defaultLiveUrl.trim(),defaultLiveChannel:normalizeYouTubeChannel(defaultLiveChannel)||''});await confirmWrite(batch.commit());notify(config.enabled?`${approved.length} itens publicados no canal.`:'Pacote gráfico desativado neste canal.');
      }else{await confirmWrite(setDoc(doc(db,'newsDrafts',channelId),draft));notify('Rascunho salvo.');}
      setItems(savedItems);setDirty(false);
    }catch(e){const message=e.message||'Não foi possível salvar.';setError(message);notify(message);}finally{operationLock.current=false;setBusy(false);}
  }
  async function importFile(file){
    if(!file||feedLock.current)return;feedLock.current=true;
    try{
      if(file.size>500000)throw new Error('Use um arquivo com até 500 KB.');
      const parsed=parseNewsImport(await file.text());
      const keys=new Set(items.map(p=>p.url||`${p.kind}:${p.title}`));const additions=parsed.filter(p=>!keys.has(p.url||`${p.kind}:${p.title}`));
      if(items.length+additions.length>100)throw new Error('Mantenha até 100 itens na redação.');
      setItems(list=>mergeEditorial(list,additions));setDirty(true);notify(`${additions.length} itens importados para revisão.`);
    }catch(e){notify(e.message||'Arquivo inválido.');}finally{feedLock.current=false;if(input.current)input.current.value='';}
  }
  async function refreshFeed(){
    const current=liveState.current;if(feedLock.current||!sourceId||!current?.channelId||current.loading||current.loadFailed||operationLock.current)return;
    const requestChannel=current.channelId;feedLock.current=true;setFeedBusy(true);
    try{const incoming=await importEditorialSource(sourceId);if(liveState.current.channelId!==requestChannel)return;const before=liveState.current.items.length,merged=mergeEditorial(liveState.current.items,incoming),added=merged.length-before;setItems(list=>mergeEditorial(list,incoming));if(added)setDirty(true);setFeedStatus(`${added} itens novos · ${incoming.length-added} repetidos ou acima do limite ignorados · ${merged.length}/100. Revisão necessária.`);}catch(e){setFeedStatus(e.message)}finally{feedLock.current=false;setFeedBusy(false);}
  }
  const refreshRef=useRef(refreshFeed);refreshRef.current=refreshFeed;
  useEffect(()=>{if(!autoImport||!sourceId)return;const first=setTimeout(()=>refreshRef.current(),0),timer=setInterval(()=>{if(!document.hidden)refreshRef.current()},5*60000);return()=>{clearTimeout(first);clearInterval(timer)};},[autoImport,sourceId,channelId]);
  const prepared=prepareNewsPublication(items),previewItems=publishableItems(prepared);
  return <section className="news-editor">
    <header className="news-editor-heading"><div><span className="news-eyebrow">PACOTE GRÁFICO · AO VIVO</span><h2>Redação</h2><p className="muted">Monte a manchete e a fila de mensagens. Confira a prévia e publique no canal.</p></div><span className="news-count">{items.filter(p=>p.approved).length} aprovados · {items.length}/100</span></header>
    <label className="news-channel-select">Canal<select value={channelId} disabled={busy||loading||loadFailed||feedBusy} onChange={e=>{if(dirty&&!confirm('Trocar de canal e descartar as alterações não salvas?'))return;setChannelId(e.target.value);}}>{channels.filter(c=>!c.isInfo).map(c=><option value={c.id} key={c.id}>{c.numero} · {c.nome}</option>)}</select></label>
    {loading&&<p>Carregando redação…</p>}{error&&<p className="news-error" role="alert">{error}</p>}
    <fieldset className="news-controls" disabled={loading||busy||!channel||loadFailed||feedBusy}><legend>Exibição na TV</legend>
      <div className="news-feature-toggles">{[['enabled','Ativar pacote gráfico'],['gc','Manchete + subtítulo'],['ticker','Ticker inferior'],['social','Painel de mensagens']].map(([key,label])=><label key={key}><input type="checkbox" checked={!!config[key]} onChange={e=>changeConfig({[key]:e.target.checked})}/><span>{label}</span></label>)}</div>
      <div className="news-settings-row"><label>Cor do GC<select value={config.gcColor||'#1676eb'} onChange={e=>changeConfig({gcColor:e.target.value})}>{GC_COLORS.map(c=><option value={c.value} key={c.value}>{c.label}</option>)}{!GC_COLORS.some(c=>c.value===config.gcColor)&&<option value={config.gcColor}>Personalizada</option>}</select></label><label>Cor personalizada<input type="color" value={normalizeGCColor(config.gcColor)} onChange={e=>changeConfig({gcColor:e.target.value})}/></label><label>Alternar manchete<select value={config.interval} onChange={e=>changeConfig({interval:Number(e.target.value)})}><option value={10}>A cada 10 segundos</option><option value={15}>A cada 15 segundos</option><option value={20}>A cada 20 segundos</option><option value={30}>A cada 30 segundos</option><option value={45}>A cada 45 segundos</option><option value={60}>A cada 60 segundos</option></select></label><label>Velocidade da rolagem<select value={config.socialSpeed||34} onChange={e=>changeConfig({socialSpeed:Number(e.target.value)})}><option value={24}>Rápida · 24 s</option><option value={34}>Normal · 34 s</option><option value={48}>Lenta · 48 s</option><option value={64}>Bem lenta · 64 s</option></select></label><span className="news-template-note">TREND Wall · GC responsivo</span></div>
    </fieldset>
    <fieldset className="news-controls" disabled={loading||busy||loadFailed||feedBusy}><legend>Live padrão do canal · preencher horários sem programação</legend><label>URL da live<input value={defaultLiveUrl} onChange={e=>{setDefaultLiveUrl(e.target.value);setDirty(true)}} placeholder="https://youtube.com/live/…"/></label><label>Canal para encontrar próximas lives (opcional)<input value={defaultLiveChannel} onChange={e=>{setDefaultLiveChannel(e.target.value);setDirty(true)}} placeholder="@handle ou UC…"/></label><p className="muted">Usada somente quando não existe programa agendado. Clique em Publicar na TV para aplicar; deixe vazia para desativar.</p></fieldset>
    <fieldset className="news-controls" disabled={loading||busy||loadFailed||feedBusy}><legend>Importação automática · RSS / JSON</legend><button onClick={async()=>{try{const data=await adminRequest('/api/editorial-feed');setSources(data.sources||[]);setSourceId(data.sources?.[0]?.id||'')}catch(e){setFeedStatus(e.message)}}}>Carregar fontes configuradas</button><label>Fonte<select value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Selecione</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.kind}</option>)}</select></label><label><input type="checkbox" checked={autoImport} onChange={e=>setAutoImport(e.target.checked)}/> Atualizar a cada 5 minutos enquanto esta Redação estiver aberta</label><button disabled={!sourceId} onClick={refreshFeed}>Importar agora</button><p className="muted">Notícias e tweets entram para revisão, sem aprovação automática. Configure fontes RSS/JSON no servidor. Esta opção não coleta trending topics diretamente do X.</p>{feedStatus&&<p role="status">{feedStatus}</p>}</fieldset>
    <fieldset className="news-content-fields" disabled={loading||busy||!channel||loadFailed||feedBusy}>
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
    {preview&&<section className="editor-studio-preview"><div className="news-tools"><button aria-pressed={previewDevice==='desktop'} onClick={()=>setPreviewDevice('desktop')}>TV / Desktop</button><button aria-pressed={previewDevice==='mobile'} onClick={()=>setPreviewDevice('mobile')}>Celular</button></div><div className={`news-preview tv-layout-studio preview-device-${previewDevice}`}><div className="editor-video-placeholder">ÁREA DO VÍDEO · ESTÚDIO</div><NewsOverlay channel={channel} studio preview={{items:previewItems,config:{...config,enabled:true}}}/></div><p className="muted">Prévia com os itens liberados. O vídeo do canal aparece na área principal durante a transmissão.</p></section>}
    </fieldset>
  </section>;
}

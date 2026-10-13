import {useState,useEffect,useMemo,useRef} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {useCatalog} from './Catalog';
import {getNow,getToday,fmtHM,broadcastDate,TIME_ZONE} from './clock';
import {buildGuideSchedule,guideTime,getCurProg,thumbnailForProgram} from './schedule';
import {useFavorites,shareChannel} from './preferences';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const route=ch=>`/canal/${encodeURIComponent(Number(ch.numero)>0?ch.numero:ch.id)}`;
function Logo({channel}){return channel.logoType==='custom'&&channel.logoUrl?<img className="channel-logo" src={channel.logoUrl} alt=""/>:<span className="channel-logo-fallback" aria-hidden="true">{channel.logo||'TV'}</span>;}
function Poster({src,alt='',className=''}){
  const [ready,setReady]=useState('');
  useEffect(()=>{let cancelled=false;if(!src){setReady('');return;}const image=new Image();image.src=src;const loaded=()=>{if(!cancelled)setReady(src);};if(image.complete&&image.naturalWidth)loaded();else image.onload=loaded;image.onerror=()=>{if(!cancelled)setReady('');};return()=>{cancelled=true;};},[src]);
  return ready?<img src={ready} alt={alt} className={className} decoding="async"/>:null;
}
function Progress({program,now,color}){
  if(!program)return null;const percent=Math.max(0,Math.min(100,(now-program.horarioInicio)/Math.max(1,program.duracao)*100));
  return <div className="program-progress" role="progressbar" aria-label="Progresso do programa" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(percent)}><span style={{width:`${percent}%`,background:color}}/></div>;
}
export default function Home(){
  const {channels,programs,loading,error}=useCatalog(),navigate=useNavigate();
  const [favorites,toggleFavorite]=useFavorites(),[now,setNow]=useState(getNow()),[activeId,setActiveId]=useState(null),[search,setSearch]=useState(''),[detail,setDetail]=useState(null),[paused,setPaused]=useState(false),[notice,setNotice]=useState('');
  const slider=useRef(null),today=getToday();
  useEffect(()=>{const tick=()=>setNow(getNow());const timer=setInterval(tick,1000);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
  const visible=useMemo(()=>channels.filter(c=>!c.isInfo),[channels]);
  const schedule=useMemo(()=>Object.fromEntries(visible.map(ch=>[ch.id,buildGuideSchedule(programs,ch.id,ch,today).filter(p=>!p.isPlaceholder)])),[programs,visible,today]);
  const index=Math.max(0,visible.findIndex(c=>c.id===activeId)),channel=visible[index];
  const current=channel?getCurProg(schedule[channel.id],now):null;
  const next=channel?schedule[channel.id]?.find(p=>p.horarioInicio>now):null;
  const sorted=useMemo(()=>[...visible].sort((a,b)=>Number(favorites.includes(b.id))-Number(favorites.includes(a.id))||Number(a.numero)-Number(b.numero)),[visible,favorites]);
  useEffect(()=>{
    if(visible.length<2||paused||detail||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const timer=setInterval(()=>{if(!document.hidden)setActiveId(visible[(index+1)%visible.length].id);},18000);return()=>clearInterval(timer);
  },[visible,index,paused,detail]);
  useEffect(()=>{
    for(const n of [index,(index+1)%visible.length,(index-1+visible.length)%visible.length]){
      const c=visible[n];if(!c)continue;const src=thumbnailForProgram(getCurProg(schedule[c.id],now));if(src){const img=new Image();img.src=src;}
    }
  },[index,visible,schedule,Math.floor(now/60)]);
  useEffect(()=>{if(!detail)return;const h=e=>{if(e.key==='Escape')setDetail(null);};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h);},[detail]);
  const query=normalize(search);
  const rows=[...sorted].sort((a,b)=>Number(b.id===channel?.id)-Number(a.id===channel?.id)).map(ch=>({ch,items:(schedule[ch.id]||[]).filter(p=>p.horarioFim>now&&p.horarioInicio<now+43200&&(!query||normalize(`${ch.nome} ${p.nome} ${p.sinopse}`).includes(query)))})).filter(row=>!query||row.items.length);
  if(loading)return <div className="page-message">Carregando TREND TV…</div>;
  return <main className="home-page">
    <header className="home-header"><Link className="brand" to="/">TREND TV</Link><nav><Link className="primary" to="/tv">▶ Assistir</Link><Link to="/admin">Admin</Link></nav></header>
    {channel?<section className="home-hero" style={{'--channel-color':channel.cor||'#19b8ef'}} onFocusCapture={()=>setPaused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaused(false);}}>
      {visible.map((ch,i)=>{
        const cur=getCurProg(schedule[ch.id],now);
        return <div key={ch.id} className={`hero-poster ${i===index?'active':''}`} aria-hidden="true"><Poster src={thumbnailForProgram(cur)} className="hero-photo"/></div>;
      })}
      <div className="hero-shade"/>
      <div className="hero-content">
        <div className="channel-kicker"><Logo channel={channel}/><span>{channel.numero} · {channel.nome}</span>{current&&<span className="live-label">AO VIVO</span>}</div>
        <h1>{current?.nome||'A próxima atração vem aí'}</h1>
        <p className="hero-synopsis">{current?.sinopse||'Explore os canais e encontre algo para assistir.'}</p>
        <p className="hero-meta">{current?`${fmtHM(current.horarioInicio)} – ${fmtHM(current.horarioFim)}`:'Sem programa neste horário'}{next&&` · A seguir: ${next.nome}`}</p>
        <Progress program={current} now={now} color={channel.cor}/>
        <div className="hero-actions"><Link className="primary light" to={route(channel)}>▶ Assistir</Link>{current&&<button onClick={()=>setDetail({program:current,channel})}>Informações</button>}<button aria-pressed={favorites.includes(channel.id)} onClick={()=>toggleFavorite(channel.id)}>{favorites.includes(channel.id)?'★ Favorito':'☆ Favoritar'}</button></div>
      </div>
      {visible.length>1&&<div className="hero-navigation"><button aria-label="Canal anterior" onClick={()=>setActiveId(visible[(index-1+visible.length)%visible.length].id)}>‹</button><span>{index+1} / {visible.length}</span><button aria-label="Próximo canal" onClick={()=>setActiveId(visible[(index+1)%visible.length].id)}>›</button><button aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?'Alternar capas':'Pausar capas'}</button></div>}
    </section>:<section className="page-message"><h1>Seus canais aparecem aqui</h1><p>Cadastre o primeiro canal no painel para começar.</p><Link to="/admin">Abrir painel</Link></section>}
    {error&&<p className="notice" role="alert">{error}</p>}
    <section className="home-section"><div className="section-title"><h2>Canais ao vivo</h2><span>{visible.length} canais{favorites.length?' · favoritos primeiro':''}</span><div><button aria-label="Rolar canais para a esquerda" onClick={()=>slider.current?.scrollBy({left:-500,behavior:'smooth'})}>‹</button><button aria-label="Rolar canais para a direita" onClick={()=>slider.current?.scrollBy({left:500,behavior:'smooth'})}>›</button></div></div>
      <div className="channel-slider" ref={slider}>{sorted.map(ch=>{const cur=getCurProg(schedule[ch.id],now);return <article className={`channel-card ${channel?.id===ch.id?'selected':''}`} key={ch.id} style={{'--channel-color':ch.cor}}>
        <button className="card-select" aria-label={`Ver ${ch.nome}`} onClick={()=>setActiveId(ch.id)}><div className="card-image"><Poster src={thumbnailForProgram(cur)}/><span className="card-placeholder"><Logo channel={ch}/></span>{cur&&<span className="live-label">AO VIVO</span>}<Progress program={cur} now={now} color={ch.cor}/></div><div className="card-copy"><span>{ch.numero} · {ch.nome}</span><strong>{cur?.nome||'Sem programação agora'}</strong><small>{cur?`${fmtHM(cur.horarioInicio)} – ${fmtHM(cur.horarioFim)}`:'Veja a programação do canal'}</small></div></button>
        <div className="card-actions"><Link to={route(ch)}>Assistir ↗</Link><button aria-label={`Favoritar ${ch.nome}`} aria-pressed={favorites.includes(ch.id)} onClick={()=>toggleFavorite(ch.id)}>{favorites.includes(ch.id)?'★':'☆'}</button></div>
      </article>;})}</div>
    </section>
    <section className="home-section" id="guia"><div className="section-title"><h2>Guia ao vivo</h2><span>Agora e próximas 12 horas</span></div>
      <label className="search-label">Buscar canal ou programa<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filme, música, documentário…"/></label>
      <div className="guide-rows">{rows.map(({ch,items})=><div key={ch.id} className="guide-row"><Link className="guide-channel" to={route(ch)}><Logo channel={ch}/><strong>{ch.numero} · {ch.nome}</strong></Link><div className="guide-slots">{items.length?items.map(p=>{const live=now>=p.horarioInicio&&now<p.horarioFim;return <button key={p.id} className={live?'is-live':''} onClick={()=>setDetail({channel:ch,program:p})}><small>{guideTime(p.horarioInicio)}{live?' · AO VIVO':''}</small><strong>{p.isJingle?'🎬 ':''}{p.nome}</strong>{live&&<Progress program={p} now={now} color={ch.cor}/>}</button>;}):<p className="muted">Nenhum programa nas próximas 12 horas.</p>}</div></div>)}{!rows.length&&<p className="muted">Nenhum programa encontrado. Tente outro nome.</p>}</div>
    </section>
    <footer className="home-footer"><span>TREND TV · {new Date().getFullYear()}</span><span>{TIME_ZONE==="America/Sao_Paulo"?"Horários de Brasília":TIME_ZONE}</span></footer>
    {detail&&<div className="modal-backdrop" onClick={()=>setDetail(null)}><section className="detail-card" role="dialog" aria-modal="true" aria-label={detail.program.nome} onClick={e=>e.stopPropagation()}><div className="detail-image"><Poster src={thumbnailForProgram(detail.program)}/></div><div className="detail-copy"><p>{detail.channel.nome} · {guideTime(detail.program.horarioInicio)} – {guideTime(detail.program.horarioFim)}</p><h2>{detail.program.nome}</h2><p>{detail.program.sinopse||'Acompanhe esta atração na programação do canal.'}</p><div className="hero-actions"><button className="primary" onClick={()=>navigate(route(detail.channel))}>Assistir ao canal</button><button onClick={async()=>{const text=await shareChannel(detail.channel,detail.program);if(text)setNotice(text);}}>Compartilhar</button><button autoFocus onClick={()=>setDetail(null)}>Fechar</button></div></div></section></div>}
    {notice&&<div role="status" className="tv-notice">{notice}</div>}
  </main>;
}

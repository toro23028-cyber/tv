import {useEffect,useState,useRef} from 'react';
import {broadcastTime,broadcastDate} from './clock';
import './editorial-wall.css';
import {db,doc,onSnapshot} from './firebase';
import {DEFAULT_NEWS_CONFIG,publishableItems,socialVisible,normalizeGCColor,selectGCHeadlines} from './news';

export default function NewsOverlay({channel,hidden=false,preview,studio=false,program}){
  const socialWindow=useRef(null),socialTrack=useRef(null);
  const [published,setPublished]=useState(null),[now,setNow]=useState(Date.now());
  useEffect(()=>{
    setPublished(null);if(preview||!channel?.newsEnabled)return;
    return onSnapshot(doc(db,'newsPublished',channel.id),snap=>setPublished(snap.exists()?snap.data():null),()=>setPublished(null));
  },[channel?.id,channel?.newsEnabled,!!preview]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const data=preview||published,config={...DEFAULT_NEWS_CONFIG,...data?.config};
  useEffect(()=>{const view=socialWindow.current,track=socialTrack.current;if(!view||!track)return;const measure=()=>{const distance=Math.max(0,track.scrollHeight-view.clientHeight);track.style.setProperty('--wall-travel',`${-distance}px`);track.style.animationPlayState=distance>0?'running':'paused';};measure();if(typeof ResizeObserver==='undefined'){window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);}const observer=new ResizeObserver(measure);observer.observe(view);observer.observe(track);return()=>observer.disconnect();},[data,hidden,config.enabled,studio,config.socialOutsideStudio]);
  if(hidden||!data||!config.enabled)return null;
  const items=publishableItems(data.items||[],now),news=items.filter(p=>p.kind==='news'),socialItems=items.filter(p=>p.kind==='tweet'||p.kind==='topic');
  const interval=Math.min(120,Math.max(10,Number(config.interval)||20))*1000;
  const index=Math.floor(now/interval),headline=news[index%Math.max(1,news.length)];
  const gcHeadlines=selectGCHeadlines(news,index,config.gcLayout==='dual'&&studio);
  if(!gcHeadlines.length&&studio)gcHeadlines.push(null);
  const scrollSeconds=Math.max(24,Math.min(90,Number(config.socialSpeed)||34));
  const showSocial=socialVisible(config,studio,channel);
  const fullTemplate=(studio||!!preview)&&!!config.gc&&!!headline&&!!config.ticker&&news.length>0&&showSocial&&socialItems.length>0;
  return <div className={`news-overlays ${studio?'studio':''} ${preview?'preview':''} ${fullTemplate?'full-template':''}`} style={{'--gc-accent':normalizeGCColor(config.gcColor)}} aria-label={studio?'Pacote gráfico do modo estúdio':'Informações do canal'}>
    
    {config.gc&&gcHeadlines.map((headline,slot)=><section key={headline?.id||'channel'} className={`news-gc ${slot===1?'gc-secondary':''} ${gcHeadlines.length>1?'gc-dual':''} ${headline?.urgent?'urgent':''} ${headline?.imageUrl?'has-image':''}`} aria-live="polite">
      <span className="news-gc-label"><b>{headline?.urgent?'URGENTE':headline?.category||'EM PAUTA'}</b><i>{headline?.source||channel?.nome}</i></span>{studio&&slot===0&&<div className="news-gc-clock"><time>{broadcastTime(new Date(now))}</time><small>{broadcastDate(new Date(now),{day:'2-digit',month:'2-digit'})} · {program?.isLive?'AO VIVO':'TREND TV'}</small></div>}
      {headline?.imageUrl&&<img className="news-gc-thumb" src={headline.imageUrl} alt="" onError={e=>{e.currentTarget.style.visibility='hidden';}}/>}
      <strong>{headline?.title||program?.nome||channel?.nome||'TREND TV'}</strong>{headline?.subtitle&&<p>{headline.subtitle}</p>}
    </section>)}
    {showSocial&&<aside className="social-wall" aria-label="Mensagens e trending topics">
      <header><span>NA CONVERSA</span><b>{socialItems.length} mensagens</b></header>
      {socialItems.length>0?<div className="social-wall-window" ref={socialWindow}><div className="social-wall-track" ref={socialTrack} style={{animationDuration:`${scrollSeconds}s`,animationPlayState:socialItems.length>1?'running':'paused'}}>
        {[0].map(copy=><div className="social-wall-copy" key={copy}>{socialItems.map((item,i)=><article className={`social-card ${item.kind==='topic'?'topic-card':''} ${item.urgent?'urgent':''}`} key={`${item.id}-${copy}`}>
          <div><span>{item.kind==='topic'?'TRENDING TOPIC':'POST NA CONVERSA'}</span><small>{item.category||item.source}</small></div>
          <p>{item.title}</p>
          {item.kind==='tweet'&&<footer>{item.source}{item.url&&<a href={item.url} target="_blank" rel="noreferrer">Abrir publicação ↗</a>}</footer>}
          {item.kind==='topic'&&<footer>{item.source||'TRENDING'}{item.url&&<a href={item.url} target="_blank" rel="noreferrer">Ver assunto ↗</a>}</footer>}
          {item.kind==='news'&&item.subtitle&&<small>{item.subtitle}</small>}
        </article>)}</div>)}
      </div></div>:<p className="social-empty">Sem mensagens liberadas no momento.</p>}
    </aside>}
    {config.ticker&&news.length>0&&<div className="news-ticker"><b>AGORA</b><div className="ticker-window"><div className="ticker-track" style={{animationDuration:`${Math.max(30,news.reduce((n,p)=>n+p.title.length,0)/10)}s`}}>{[0,1].map(copy=><div className="ticker-copy" key={copy} aria-hidden={copy===1}>{news.map(p=><span key={`${p.id}-${copy}`} className={p.urgent?'urgent-text':''}>{p.urgent?'URGENTE · ':''}{p.title}<small> — {p.source}</small></span>)}</div>)}</div></div></div>}
  </div>;
}

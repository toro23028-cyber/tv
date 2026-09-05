import {useEffect,useState} from 'react';
import {db,doc,onSnapshot} from './firebase';
import {DEFAULT_NEWS_CONFIG,publishableItems} from './news';
export default function NewsOverlay({channel,hidden=false,preview}){
  const [published,setPublished]=useState(null),[now,setNow]=useState(Date.now());
  useEffect(()=>{
    setPublished(null);if(preview||!channel?.newsEnabled)return;
    return onSnapshot(doc(db,'newsPublished',channel.id),snap=>setPublished(snap.exists()?snap.data():null),()=>setPublished(null));
  },[channel?.id,channel?.newsEnabled,!!preview]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const data=preview||published,config={...DEFAULT_NEWS_CONFIG,...data?.config};
  if(hidden||!data||!config.enabled)return null;
  const items=publishableItems(data.items||[],now),news=items.filter(p=>p.kind==='news'),posts=items.filter(p=>p.kind==='social');
  const interval=Math.min(120,Math.max(10,Number(config.interval)||20))*1000;
  const index=Math.floor(now/interval),headline=news[index%news.length],post=posts[index%posts.length];
  return <div className={`news-overlays ${preview?'preview':''}`} aria-label="Informações do canal">
    {config.gc&&headline&&<div key={headline.id} className={`news-gc ${headline.urgent?'urgent':''}`}><span>{headline.urgent?'URGENTE':'EM PAUTA'} · {headline.source}</span><strong>{headline.title}</strong></div>}
    {config.social&&post&&<div className={`social-overlay corner-${config.corner||'tr'}`} key={post.id}><small>PUBLICAÇÃO · {post.source}</small><p>{post.title}</p>{post.url&&<small>{new URL(post.url).hostname}</small>}</div>}
    {config.ticker&&news.length>0&&<div className="news-ticker"><b>AGORA</b><div className="ticker-window"><div className="ticker-track" style={{animationDuration:`${Math.max(30,news.reduce((n,p)=>n+p.title.length,0)/10)}s`}}>{[0,1].map(copy=><div className="ticker-copy" key={copy} aria-hidden={copy===1}>{news.map(p=><span key={p.id} className={p.urgent?'urgent-text':''}>{p.urgent?'URGENTE · ':''}{p.title}<small> — {p.source}</small></span>)}</div>)}</div></div></div>}
  </div>;
}

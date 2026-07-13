import { useState, useEffect, useRef, useCallback } from "react";
import { db, collection, onSnapshot } from "./firebase";
import { getTodayPrograms, getThumbnailForChannel } from "./TV";

function fmtHM(s){ s=Number(s); return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}` }
function getNow(){ const n=new Date(); return n.getHours()*3600+n.getMinutes()*60+n.getSeconds() }

function LiveDot(){
  const [v,setV]=useState(true);
  useEffect(()=>{const i=setInterval(()=>setV(x=>!x),900);return()=>clearInterval(i)},[]);
  return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:800,color:"#f44336",opacity:v?1:0.2,transition:"opacity 0.4s"}}>
    <span style={{width:7,height:7,borderRadius:"50%",background:"#f44336",boxShadow:"0 0 8px #f44336"}}/>AO VIVO
  </span>;
}

function ProgressBar({start,end,cor}){
  const now=getNow();
  const pct=Math.max(0,Math.min(100,((now-start)/Math.max(1,end-start))*100));
  return <div style={{height:3,background:"rgba(255,255,255,0.15)",borderRadius:2,overflow:"hidden",width:"100%"}}>
    <div style={{width:`${pct}%`,height:"100%",background:cor||"#e50914",borderRadius:2,transition:"width 30s linear"}}/>
  </div>;
}

function HeroSlide({ch,cur,next,thumb,active}){
  const [imgOk,setImgOk]=useState(false);
  useEffect(()=>setImgOk(false),[thumb]);
  return (
    <div style={{position:"absolute",inset:0,opacity:active?1:0,transition:"opacity 1s ease",pointerEvents:active?"auto":"none"}}>
      {thumb&&<img src={thumb} alt="" onLoad={()=>setImgOk(true)} onError={()=>setImgOk(false)}
        style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",
          filter:"brightness(0.5) saturate(1.1)",opacity:imgOk?1:0,transition:"opacity 0.7s"}}/>}
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse at 55% 35%,${ch.cor||"#c0392b"}33 0%,transparent 60%)`}}/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#0a0c12 0%,rgba(10,12,18,0.55) 45%,transparent 75%)"}}/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(to right,rgba(10,12,18,0.9) 0%,rgba(10,12,18,0.4) 40%,transparent 65%)"}}/>
      <div style={{position:"absolute",bottom:0,left:0,padding:"clamp(28px,5vw,72px) clamp(20px,5vw,64px)",maxWidth:600,width:"100%"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
          {ch.logoType==="custom"&&ch.logoUrl
            ?<img src={ch.logoUrl} alt="" style={{height:20,objectFit:"contain"}}/>
            :<span style={{fontSize:18}}>{ch.logo||"📺"}</span>}
          <span style={{fontSize:11,fontWeight:800,color:ch.cor||"#e50914",letterSpacing:2,textTransform:"uppercase"}}>{ch.nome}</span>
          <span style={{width:1,height:11,background:"rgba(255,255,255,0.25)",margin:"0 2px"}}/>
          <LiveDot/>
        </div>
        {cur&&!cur.isPlaceholder?<>
          <h1 style={{fontSize:"clamp(1.9rem,4.5vw,3.2rem)",fontWeight:900,color:"#fff",lineHeight:1.08,margin:"0 0 12px",
            textShadow:"0 2px 24px rgba(0,0,0,0.9)",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {cur.nome}
          </h1>
          {cur.sinopse&&<p style={{fontSize:"clamp(13px,1.3vw,15px)",color:"rgba(255,255,255,0.72)",lineHeight:1.65,margin:"0 0 16px",
            display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {cur.sinopse}
          </p>}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"rgba(255,255,255,0.5)"}}>{fmtHM(cur.horarioInicio)} – {fmtHM(cur.horarioFim)}</span>
            {next&&!next.isPlaceholder&&<>
              <span style={{color:"rgba(255,255,255,0.2)"}}>·</span>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>A seguir: <strong style={{color:"rgba(255,255,255,0.65)"}}>{next.nome}</strong></span>
            </>}
          </div>
          <div style={{marginBottom:18,maxWidth:320}}><ProgressBar start={cur.horarioInicio} end={cur.horarioFim} cor={ch.cor||"#e50914"}/></div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <a href={`/tv?canal=${ch.numero||ch.id}`} style={{padding:"12px 30px",borderRadius:6,border:"none",cursor:"pointer",
              background:"#fff",color:"#000",fontSize:15,fontWeight:800,textDecoration:"none",
              display:"inline-flex",alignItems:"center",gap:8,letterSpacing:0.3,
              transition:"background 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#ddd"}
              onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
              ▶ Assistir Agora
            </a>
            <button onClick={()=>window.location.href=`/tv?canal=${ch.numero||ch.id}`}
              style={{padding:"12px 24px",borderRadius:6,border:"1px solid rgba(255,255,255,0.28)",
                background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer",
                backdropFilter:"blur(8px)",transition:"background 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.2)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"}>
              ℹ Ver Canal
            </button>
          </div>
        </>:<>
          <h1 style={{fontSize:"clamp(1.6rem,3.5vw,2.6rem)",fontWeight:800,color:"#fff",margin:"0 0 16px"}}>Sem programação</h1>
          <a href={`/tv?canal=${ch.numero||ch.id}`} style={{padding:"12px 30px",borderRadius:6,background:"#fff",color:"#000",
            fontSize:15,fontWeight:800,textDecoration:"none",display:"inline-block"}}>Sintonizar</a>
        </>}
      </div>
    </div>
  );
}

function ChannelCard({ch,cur,thumb,isActive,onClick}){
  const [hover,setHover]=useState(false);
  return <div onClick={onClick}
    onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{flexShrink:0,width:200,borderRadius:10,overflow:"hidden",cursor:"pointer",
      border:`2px solid ${isActive?ch.cor||"#e50914":"transparent"}`,
      transform:hover||isActive?"scale(1.05)":"scale(1)",
      transition:"transform 0.2s,border-color 0.2s,box-shadow 0.2s",
      boxShadow:isActive?`0 0 20px ${ch.cor||"#e50914"}55`:"none",
      background:"#111"}}>
    <div style={{position:"relative",paddingBottom:"56.25%",background:`linear-gradient(135deg,${ch.cor||"#c0392b"}22,#111)`}}>
      {thumb&&<img src={thumb} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",opacity:0.85}}
        onError={e=>e.target.style.display="none"}/>}
      {(!thumb)&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,opacity:0.35}}>
        {ch.logoType==="custom"&&ch.logoUrl
          ?<img src={ch.logoUrl} alt="" style={{width:48,height:48,objectFit:"contain"}}/>
          :<span>{ch.logo||"📺"}</span>}
      </div>}
      <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.75),transparent 60%)"}}/>
      <div style={{position:"absolute",top:6,left:6,background:"#e50914",color:"#fff",fontSize:9,
        fontWeight:800,padding:"2px 6px",borderRadius:3,letterSpacing:0.8}}>● AO VIVO</div>
      <div style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.65)",color:"#fff",
        fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:3}}>{ch.numero}</div>
      {cur&&!cur.isPlaceholder&&<div style={{position:"absolute",bottom:0,left:0,right:0,padding:"0 8px 6px"}}>
        <ProgressBar start={cur.horarioInicio} end={cur.horarioFim} cor={ch.cor||"#e50914"}/>
      </div>}
    </div>
    <div style={{padding:"8px 10px 10px"}}>
      <div style={{fontSize:10,fontWeight:800,color:ch.cor||"#e50914",letterSpacing:0.5,marginBottom:4,textTransform:"uppercase"}}>{ch.nome}</div>
      <div style={{fontSize:12,fontWeight:600,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
        {cur&&!cur.isPlaceholder?cur.nome:"Sem programação"}
      </div>
      {cur&&!cur.isPlaceholder&&<div style={{fontSize:10,color:"#666",marginTop:3}}>{fmtHM(cur.horarioInicio)} – {fmtHM(cur.horarioFim)}</div>}
    </div>
  </div>;
}

function ChannelSlider({channels,todayByChannel,thumbnails,activeId,onSelect}){
  const trackRef=useRef(null);
  const [canL,setCanL]=useState(false);
  const [canR,setCanR]=useState(true);
  const now=getNow();

  const upd=useCallback(()=>{
    const el=trackRef.current; if(!el)return;
    setCanL(el.scrollLeft>8);
    setCanR(el.scrollLeft+el.clientWidth<el.scrollWidth-8);
  },[]);

  useEffect(()=>{
    const el=trackRef.current; if(!el)return;
    el.addEventListener("scroll",upd,{passive:true});
    window.addEventListener("resize",upd);
    upd();
    return()=>{el.removeEventListener("scroll",upd);window.removeEventListener("resize",upd)};
  },[upd]);

  const scroll=d=>{trackRef.current?.scrollTo({left:trackRef.current.scrollLeft+d*440,behavior:"smooth"})};
  const vis=channels.filter(c=>!c.isInfo);

  return <div style={{position:"relative"}}>
    {canL&&<button onClick={()=>scroll(-1)} style={{position:"absolute",left:0,top:0,bottom:0,width:52,zIndex:5,
      border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"flex-start",paddingLeft:4,
      background:"linear-gradient(to right,rgba(10,12,18,0.95),transparent)",color:"#fff",fontSize:28,fontWeight:300}}>‹</button>}
    {canR&&<button onClick={()=>scroll(1)} style={{position:"absolute",right:0,top:0,bottom:0,width:52,zIndex:5,
      border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:4,
      background:"linear-gradient(to left,rgba(10,12,18,0.95),transparent)",color:"#fff",fontSize:28,fontWeight:300}}>›</button>}
    <div ref={trackRef} style={{display:"flex",gap:10,overflowX:"auto",padding:"4px 0 12px",
      scrollbarWidth:"none",msOverflowStyle:"none"}} onScroll={upd}>
      {vis.map(ch=>{
        const sched=todayByChannel[ch.id]||[];
        const cur=sched.find(p=>now>=p.horarioInicio&&now<p.horarioFim)||sched[0];
        return <ChannelCard key={ch.id} ch={ch} cur={cur} thumb={thumbnails[ch.id]}
          isActive={ch.id===activeId} onClick={()=>onSelect(ch)}/>;
      })}
    </div>
    <style>{`div::-webkit-scrollbar{display:none}`}</style>
  </div>;
}

export default function Home(){
  const [channels,setChannels]=useState([]);
  const [programs,setPrograms]=useState([]);
  const [loading,setLoading]=useState(true);
  const [heroIdx,setHeroIdx]=useState(0);
  const [tick,setTick]=useState(0);

  useEffect(()=>{const i=setInterval(()=>setTick(t=>t+1),30000);return()=>clearInterval(i)},[]);

  useEffect(()=>{
    let done={ch:false,pr:false};
    const chk=()=>{if(done.ch&&done.pr)setLoading(false)};
    const u1=onSnapshot(collection(db,"channels"),snap=>{
      setChannels(snap.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>(a.numero||0)-(b.numero||0)));
      done.ch=true;chk();
    },()=>{done.ch=true;chk()});
    const u2=onSnapshot(collection(db,"programs"),snap=>{
      setPrograms(snap.docs.map(d=>({...d.data(),id:d.id})));
      done.pr=true;chk();
    },()=>{done.pr=true;chk()});
    return()=>{u1();u2()};
  },[]);

  const todayByChannel=getTodayPrograms(programs,channels);
  const now=getNow();
  const vis=channels.filter(c=>!c.isInfo);

  const thumbnails={};
  for(const ch of vis) thumbnails[ch.id]=getThumbnailForChannel(programs,channels,ch.id);

  const safeIdx=vis.length>0?((heroIdx%vis.length)+vis.length)%vis.length:0;
  const heroCh=vis[safeIdx];
  const heroSched=heroCh?todayByChannel[heroCh.id]||[]:[];
  const heroCur=heroSched.find(p=>now>=p.horarioInicio&&now<p.horarioFim)||heroSched[0];
  const heroNext=heroCur?heroSched[heroSched.findIndex(p=>p.id===heroCur?.id)+1]:null;

  // Auto-avança hero a cada 20s
  useEffect(()=>{
    if(vis.length<2)return;
    const t=setInterval(()=>setHeroIdx(i=>(i+1)%vis.length),20000);
    return()=>clearInterval(t);
  },[vis.length]);

  if(loading) return(
    <div style={{height:"100vh",background:"#0a0c12",display:"flex",alignItems:"center",
      justifyContent:"center",color:"#888",fontFamily:"system-ui"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:12}}>📺</div>
        <div style={{fontSize:14}}>Carregando TREND TV...</div>
      </div>
    </div>
  );

  if(!heroCh) return(
    <div style={{height:"100vh",background:"#0a0c12",display:"flex",alignItems:"center",
      justifyContent:"center",color:"#888",fontFamily:"system-ui"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:12}}>📺</div>
        <div>Nenhum canal disponível.</div>
        <a href="/admin" style={{color:"#1a73e8",fontSize:13,marginTop:12,display:"block"}}>Configurar canais →</a>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:"#0a0c12",
      fontFamily:"'Segoe UI','Roboto',system-ui,sans-serif",color:"#fff"}}>

      {/* ── HEADER FIXO ── */}
      <header style={{position:"fixed",top:0,left:0,right:0,zIndex:200,height:60,
        padding:"0 clamp(16px,4vw,48px)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        background:"linear-gradient(to bottom,rgba(10,12,18,0.96) 0%,transparent 100%)",
        backdropFilter:"blur(4px)"}}>
        <div style={{fontSize:17,fontWeight:900,letterSpacing:4,color:"#fff",
          textShadow:"0 1px 6px rgba(0,0,0,0.5)"}}>TREND TV</div>
        <div style={{display:"flex",gap:10}}>
          <a href="/tv" style={{padding:"8px 22px",borderRadius:5,border:"none",
            background:"#e50914",color:"#fff",fontWeight:700,fontSize:13,
            textDecoration:"none",letterSpacing:0.5,transition:"background 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="#c0392b"}
            onMouseLeave={e=>e.currentTarget.style.background="#e50914"}>▶ Ver TV</a>
          <a href="/admin" style={{padding:"8px 16px",borderRadius:5,
            border:"1px solid rgba(255,255,255,0.18)",background:"transparent",
            color:"#bbb",fontSize:13,textDecoration:"none",
            transition:"color 0.15s,border-color 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor="rgba(255,255,255,0.4)"}}
            onMouseLeave={e=>{e.currentTarget.style.color="#bbb";e.currentTarget.style.borderColor="rgba(255,255,255,0.18)"}}>Admin</a>
        </div>
      </header>

      {/* ── HERO ── */}
      <div style={{position:"relative",height:"clamp(500px,78vh,740px)",overflow:"hidden"}}>
        {vis.map((ch,i)=>{
          const sched=todayByChannel[ch.id]||[];
          const cur=sched.find(p=>now>=p.horarioInicio&&now<p.horarioFim)||sched[0];
          const next=cur?sched[sched.findIndex(p=>p.id===cur?.id)+1]:null;
          return <HeroSlide key={ch.id} ch={ch} cur={cur} next={next}
            thumb={thumbnails[ch.id]} active={i===safeIdx}/>;
        })}

        {/* Dots */}
        {vis.length>1&&<div style={{position:"absolute",bottom:24,left:"50%",
          transform:"translateX(-50%)",display:"flex",gap:7,zIndex:10}}>
          {vis.map((_,i)=><button key={i} onClick={()=>setHeroIdx(i)} style={{
            width:i===safeIdx?28:8,height:8,borderRadius:4,border:"none",cursor:"pointer",
            background:i===safeIdx?"#fff":"rgba(255,255,255,0.3)",
            transition:"all 0.35s ease",padding:0}}/>)}
        </div>}

        {/* Setas laterais do hero */}
        {vis.length>1&&<>
          <button onClick={()=>setHeroIdx(i=>(i-1+vis.length)%vis.length)}
            style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",zIndex:10,
              width:44,height:44,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.2)",
              background:"rgba(0,0,0,0.4)",color:"#fff",fontSize:20,cursor:"pointer",
              backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",
              transition:"background 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.15)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0.4)"}>‹</button>
          <button onClick={()=>setHeroIdx(i=>(i+1)%vis.length)}
            style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",zIndex:10,
              width:44,height:44,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.2)",
              background:"rgba(0,0,0,0.4)",color:"#fff",fontSize:20,cursor:"pointer",
              backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",
              transition:"background 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.15)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0.4)"}>›</button>
        </>}
      </div>

      {/* ── SLIDER DE CANAIS ── */}
      <section style={{marginTop:-52,position:"relative",zIndex:10,
        padding:"0 clamp(16px,4vw,48px) 36px"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:14}}>
          <h2 style={{fontSize:16,fontWeight:700,margin:0,color:"#fff",letterSpacing:0.3}}>Canais ao vivo</h2>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>{vis.length} canais</span>
        </div>
        <ChannelSlider channels={channels} todayByChannel={todayByChannel}
          thumbnails={thumbnails} activeId={heroCh?.id}
          onSelect={ch=>{const i=vis.findIndex(c=>c.id===ch.id);if(i>=0)setHeroIdx(i);}}/>
      </section>

      {/* ── A SEGUIR ── */}
      <section style={{padding:"0 clamp(16px,4vw,48px) 64px"}}>
        <h2 style={{fontSize:16,fontWeight:700,margin:"0 0 14px",color:"#fff",letterSpacing:0.3}}>A seguir</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:10}}>
          {vis.map(ch=>{
            const sched=todayByChannel[ch.id]||[];
            const upcoming=sched.filter(p=>p.horarioInicio>now&&!p.isPlaceholder).slice(0,3);
            if(!upcoming.length)return null;
            return(
              <div key={ch.id} style={{background:"rgba(255,255,255,0.04)",
                border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"14px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                  {ch.logoType==="custom"&&ch.logoUrl
                    ?<img src={ch.logoUrl} alt="" style={{height:16,objectFit:"contain"}}/>
                    :<span style={{fontSize:15}}>{ch.logo||"📺"}</span>}
                  <span style={{fontSize:11,fontWeight:800,color:ch.cor||"#4fc3f7",
                    letterSpacing:0.5,textTransform:"uppercase"}}>{ch.nome}</span>
                </div>
                {upcoming.map((p,i)=><div key={p.id} style={{display:"flex",gap:10,
                  alignItems:"flex-start",paddingTop:i>0?8:0,
                  borderTop:i>0?"1px solid rgba(255,255,255,0.05)":undefined}}>
                  <span style={{fontSize:12,fontWeight:700,color:"#888",minWidth:42,textAlign:"right",paddingTop:2}}>
                    {fmtHM(p.horarioInicio)}
                  </span>
                  <span style={{fontSize:13,fontWeight:600,color:"#e0e0e0",flex:1,
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.nome}</span>
                </div>)}
              </div>
            );
          }).filter(Boolean)}
        </div>
      </section>

      <footer style={{borderTop:"1px solid rgba(255,255,255,0.05)",
        padding:"18px clamp(16px,4vw,48px)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        fontSize:11,color:"rgba(255,255,255,0.25)"}}>
        <span>TREND TV · {new Date().getFullYear()}</span>
        <div style={{display:"flex",gap:16}}>
          <a href="/tv" style={{color:"rgba(255,255,255,0.35)",textDecoration:"none"}}>TV</a>
          <a href="/admin" style={{color:"rgba(255,255,255,0.35)",textDecoration:"none"}}>Admin</a>
        </div>
      </footer>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { db, collection, onSnapshot } from "./firebase";
import { getTodayPrograms, getThumbnailForChannel } from "./TV";

// ─── helpers ────────────────────────────────────────────────
function fmtHM(s){s=Number(s);return`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}`}
function getNow(){const n=new Date();return n.getHours()*3600+n.getMinutes()*60+n.getSeconds()}

// ─── LivePulse ──────────────────────────────────────────────
function LivePulse(){
  const[v,setV]=useState(true);
  useEffect(()=>{const i=setInterval(()=>setV(x=>!x),900);return()=>clearInterval(i)},[]);
  return<span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,fontWeight:800,
    color:"#ff3a3a",letterSpacing:1,opacity:v?1:0.15,transition:"opacity 0.5s"}}>
    <span style={{width:6,height:6,borderRadius:"50%",background:"#ff3a3a",
      boxShadow:`0 0 ${v?8:0}px #ff3a3a`,transition:"box-shadow 0.5s"}}/>AO VIVO
  </span>;
}

// ─── ProgressBar ────────────────────────────────────────────
function Bar({start,end,cor}){
  const pct=Math.max(0,Math.min(100,((getNow()-start)/Math.max(1,end-start))*100));
  return<div style={{height:3,background:"rgba(255,255,255,0.18)",borderRadius:2,overflow:"hidden"}}>
    <div style={{width:`${pct}%`,height:"100%",background:cor||"#e50914",borderRadius:2,transition:"width 20s linear"}}/>
  </div>;
}

// ─── Hero (100vh, Netflix-style) ────────────────────────────
function Hero({ch,cur,next,thumb,active,onWatch}){
  const[loaded,setLoaded]=useState(false);
  useEffect(()=>setLoaded(false),[thumb]);
  if(!ch)return null;
  const cor=ch.cor||"#c0392b";
  return(
    <div style={{position:"absolute",inset:0,opacity:active?1:0,transition:"opacity 1s ease",
      pointerEvents:active?"auto":"none",overflow:"hidden"}}>

      {/* Imagem de fundo */}
      {thumb&&<img src={thumb} alt="" onLoad={()=>setLoaded(true)}
        onError={e=>{
          // maxresdefault não existe para todos os vídeos → tenta hqdefault
          if(e.target.src.includes("maxresdefault")){
            e.target.src=e.target.src.replace("maxresdefault","hqdefault");
          } else {
            setLoaded(false);
          }
        }}
        style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",
          objectPosition:"center 20%",
          filter:"brightness(0.42) saturate(1.15)",
          opacity:loaded?1:0,transition:"opacity 0.8s"}}/>}

      {/* Gradiente de cor do canal (atmosfera) */}
      <div style={{position:"absolute",inset:0,
        background:`radial-gradient(ellipse 80% 60% at 70% 30%, ${cor}28 0%, transparent 65%)`}}/>

      {/* Vignette inferior — espaço para conteúdo */}
      <div style={{position:"absolute",inset:0,
        background:"linear-gradient(to top, #060608 0%, rgba(6,6,8,0.82) 30%, rgba(6,6,8,0.2) 65%, transparent 100%)"}}/>

      {/* Vignette lateral esquerda — onde fica o texto */}
      <div style={{position:"absolute",inset:0,
        background:"linear-gradient(to right, rgba(6,6,8,0.94) 0%, rgba(6,6,8,0.6) 35%, rgba(6,6,8,0.15) 60%, transparent 80%)"}}/>

      {/* Conteúdo */}
      <div style={{position:"absolute",bottom:0,left:0,
        padding:"clamp(32px,5vw,80px) clamp(24px,5vw,72px)",
        maxWidth:"min(600px,60vw)",width:"100%"}}>

        {/* Canal */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
          {ch.logoType==="custom"&&ch.logoUrl
            ?<img src={ch.logoUrl} alt="" style={{height:22,objectFit:"contain",filter:"drop-shadow(0 1px 4px rgba(0,0,0,0.8))"}}/>
            :<span style={{fontSize:20}}>{ch.logo||"📺"}</span>}
          <span style={{fontSize:10,fontWeight:800,color:cor,letterSpacing:2.5,textTransform:"uppercase",
            textShadow:`0 0 20px ${cor}88`}}>{ch.nome}</span>
          <span style={{width:1,height:10,background:"rgba(255,255,255,0.2)"}}/>
          <LivePulse/>
        </div>

        {cur&&!cur.isPlaceholder?<>
          {/* Título */}
          <h1 style={{fontSize:"clamp(2rem,4.5vw,3.6rem)",fontWeight:900,color:"#fff",
            lineHeight:1.05,margin:"0 0 12px",letterSpacing:"-0.02em",
            textShadow:"0 2px 30px rgba(0,0,0,0.9)",
            display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {cur.nome}
          </h1>

          {/* Sinopse */}
          {cur.sinopse&&<p style={{fontSize:"clamp(13px,1.3vw,15px)",color:"rgba(255,255,255,0.7)",
            lineHeight:1.7,margin:"0 0 18px",
            display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {cur.sinopse}
          </p>}

          {/* Meta */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:500}}>
              {fmtHM(cur.horarioInicio)} – {fmtHM(cur.horarioFim)}
            </span>
            {next&&!next.isPlaceholder&&<>
              <span style={{color:"rgba(255,255,255,0.2)"}}>•</span>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>
                A seguir: <strong style={{color:"rgba(255,255,255,0.62)",fontWeight:600}}>{next.nome}</strong>
              </span>
            </>}
          </div>

          {/* Barra de progresso */}
          <div style={{marginBottom:22,maxWidth:320}}>
            <Bar start={cur.horarioInicio} end={cur.horarioFim} cor={cor}/>
          </div>

          {/* Botões */}
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <button onClick={onWatch}
              style={{padding:"13px 34px",borderRadius:5,border:"none",cursor:"pointer",
                background:"#fff",color:"#000",fontSize:16,fontWeight:800,
                display:"inline-flex",alignItems:"center",gap:9,letterSpacing:0.2,
                transition:"all 0.15s",boxShadow:"0 4px 20px rgba(0,0,0,0.5)"}}
              onMouseEnter={e=>e.currentTarget.style.transform="scale(1.04)"}
              onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
              ▶ Assistir
            </button>
            <a href={`/tv?canal=${ch.numero||ch.id}`}
              style={{padding:"13px 26px",borderRadius:5,textDecoration:"none",cursor:"pointer",
                border:"1px solid rgba(255,255,255,0.3)",
                background:"rgba(255,255,255,0.12)",
                color:"#fff",fontSize:16,fontWeight:600,
                backdropFilter:"blur(10px)",
                display:"inline-flex",alignItems:"center",gap:8,
                transition:"all 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.22)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.12)"}>
              + Informações
            </a>
          </div>
        </>:<>
          <h1 style={{fontSize:"clamp(1.8rem,4vw,3rem)",fontWeight:900,color:"#fff",margin:"0 0 20px"}}>
            Sem programação agora
          </h1>
          <a href={`/tv?canal=${ch.numero||ch.id}`}
            style={{padding:"13px 34px",borderRadius:5,background:"#fff",color:"#000",
              fontSize:16,fontWeight:800,textDecoration:"none",display:"inline-block"}}>
            Sintonizar
          </a>
        </>}
      </div>
    </div>
  );
}

// ─── Card do Slider ──────────────────────────────────────────
function Card({ch,cur,thumb,active,onClick}){
  const[hover,setHover]=useState(false);
  const highlight=active||hover;
  const cor=ch.cor||"#e50914";
  return(
    <div onClick={onClick}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{flexShrink:0,width:clampW,cursor:"pointer",position:"relative",
        borderRadius:8,overflow:"hidden",
        border:`2px solid ${highlight?cor:"transparent"}`,
        transform:highlight?"scale(1.07) translateY(-4px)":"scale(1)",
        transition:"transform 0.22s cubic-bezier(.22,1,.36,1), border-color 0.2s, box-shadow 0.2s",
        boxShadow:highlight?`0 8px 32px ${cor}44`:"0 2px 8px rgba(0,0,0,0.5)",
        background:"#111"}}>
      {/* Thumb */}
      <div style={{position:"relative",paddingBottom:"56.25%",background:`linear-gradient(135deg,${cor}22,#0a0c12)`}}>
        {thumb&&<img src={thumb} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",
          objectFit:"cover",opacity:0.88}}
          onError={e=>{
            if(e.target.src.includes("maxresdefault")){
              e.target.src=e.target.src.replace("maxresdefault","hqdefault");
            } else {
              e.target.style.display="none";
            }
          }}/>}
        {!thumb&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",
          justifyContent:"center",fontSize:32,opacity:0.3}}>
          {ch.logoType==="custom"&&ch.logoUrl
            ?<img src={ch.logoUrl} alt="" style={{width:44,height:44,objectFit:"contain"}}/>
            :<span>{ch.logo||"📺"}</span>}
        </div>}
        <div style={{position:"absolute",inset:0,
          background:"linear-gradient(to top,rgba(0,0,0,0.8) 0%,transparent 55%)"}}/>
        {/* AO VIVO badge */}
        <div style={{position:"absolute",top:6,left:6,background:"#e50914",color:"#fff",fontSize:8,
          fontWeight:900,padding:"2px 5px",borderRadius:2,letterSpacing:0.8}}>● AO VIVO</div>
        {/* Número */}
        <div style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.7)",color:"#fff",
          fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:3}}>{ch.numero}</div>
        {/* Progress */}
        {cur&&!cur.isPlaceholder&&<div style={{position:"absolute",bottom:0,left:0,right:0,padding:"0 6px 5px"}}>
          <Bar start={cur.horarioInicio} end={cur.horarioFim} cor={cor}/>
        </div>}
      </div>
      {/* Info */}
      <div style={{padding:"7px 9px 9px"}}>
        <div style={{fontSize:9,fontWeight:900,color:cor,letterSpacing:1,textTransform:"uppercase",marginBottom:3}}>{ch.nome}</div>
        <div style={{fontSize:12,fontWeight:600,color:"#e8e8e8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
          {cur&&!cur.isPlaceholder?cur.nome:"Sem programação"}
        </div>
        {cur&&!cur.isPlaceholder&&<div style={{fontSize:10,color:"#666",marginTop:2}}>
          {fmtHM(cur.horarioInicio)} – {fmtHM(cur.horarioFim)}
        </div>}
      </div>
    </div>
  );
}

const clampW=190; // largura dos cards

// ─── Slider ─────────────────────────────────────────────────
function Slider({channels,todayByChannel,thumbnails,activeId,onSelect}){
  const ref=useRef(null);
  const[canL,setL]=useState(false);
  const[canR,setR]=useState(true);
  const now=getNow();

  const upd=useCallback(()=>{
    const el=ref.current;if(!el)return;
    setL(el.scrollLeft>8);
    setR(el.scrollLeft+el.clientWidth<el.scrollWidth-8);
  },[]);

  useEffect(()=>{
    const el=ref.current;if(!el)return;
    el.addEventListener("scroll",upd,{passive:true});
    window.addEventListener("resize",upd);
    upd();
    return()=>{el.removeEventListener("scroll",upd);window.removeEventListener("resize",upd)};
  },[upd]);

  const go=d=>ref.current?.scrollTo({left:ref.current.scrollLeft+d*(clampW+10)*3,behavior:"smooth"});
  const vis=channels.filter(c=>!c.isInfo);

  return(
    <div style={{position:"relative"}}>
      {/* Seta esquerda */}
      {canL&&<button onClick={()=>go(-1)} style={{
        position:"absolute",left:-2,top:0,bottom:12,width:56,zIndex:10,border:"none",cursor:"pointer",
        background:"linear-gradient(to right,rgba(6,6,8,0.95) 0%,rgba(6,6,8,0.7) 60%,transparent 100%)",
        color:"#fff",fontSize:30,fontWeight:200,display:"flex",alignItems:"center",justifyContent:"flex-start",
        paddingLeft:6,transition:"opacity 0.2s"}}>‹</button>}
      {/* Seta direita */}
      {canR&&<button onClick={()=>go(1)} style={{
        position:"absolute",right:-2,top:0,bottom:12,width:56,zIndex:10,border:"none",cursor:"pointer",
        background:"linear-gradient(to left,rgba(6,6,8,0.95) 0%,rgba(6,6,8,0.7) 60%,transparent 100%)",
        color:"#fff",fontSize:30,fontWeight:200,display:"flex",alignItems:"center",justifyContent:"flex-end",
        paddingRight:6,transition:"opacity 0.2s"}}>›</button>}
      {/* Track */}
      <div ref={ref} onScroll={upd} style={{display:"flex",gap:10,overflowX:"auto",
        padding:"6px 2px 14px",scrollbarWidth:"none",msOverflowStyle:"none"}}>
        {vis.map(ch=>{
          const sched=todayByChannel[ch.id]||[];
          const cur=sched.find(p=>now>=p.horarioInicio&&now<p.horarioFim)||sched[0];
          return<Card key={ch.id} ch={ch} cur={cur} thumb={thumbnails[ch.id]}
            active={ch.id===activeId} onClick={()=>onSelect(ch)}/>;
        })}
      </div>
      <style>{`div::-webkit-scrollbar{display:none}`}</style>
    </div>
  );
}

// ─── HOME ────────────────────────────────────────────────────
export default function Home(){
  const[channels,setChannels]=useState([]);
  const[programs,setPrograms]=useState([]);
  const[loading,setLoading]=useState(true);
  const[heroIdx,setHeroIdx]=useState(0);
  const timerRef=useRef(null);

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

  // Thumbnails para todos os canais
  const thumbnails={};
  for(const ch of vis)thumbnails[ch.id]=getThumbnailForChannel(programs,channels,ch.id);

  const safeIdx=vis.length?((heroIdx%vis.length)+vis.length)%vis.length:0;
  const heroCh=vis[safeIdx]||null;
  const heroSched=heroCh?todayByChannel[heroCh.id]||[]:[];
  const heroCur=heroSched.find(p=>now>=p.horarioInicio&&now<p.horarioFim)||heroSched[0];
  const heroNext=heroCur?heroSched[heroSched.findIndex(p=>p.id===heroCur?.id)+1]:null;

  // Avança hero a cada 18s, reseta ao trocar manualmente
  const startTimer=useCallback(()=>{
    clearInterval(timerRef.current);
    if(vis.length<2)return;
    timerRef.current=setInterval(()=>setHeroIdx(i=>(i+1)%vis.length),18000);
  },[vis.length]);

  useEffect(()=>{startTimer();return()=>clearInterval(timerRef.current)},[startTimer]);

  const goHero=i=>{setHeroIdx(i);startTimer()};

  if(loading)return(
    <div style={{height:"100vh",background:"#060608",display:"flex",alignItems:"center",
      justifyContent:"center",fontFamily:"system-ui"}}>
      <div style={{textAlign:"center",color:"#555"}}>
        <div style={{fontSize:48,marginBottom:14}}>📺</div>
        <div style={{fontSize:13,letterSpacing:1}}>Carregando TREND TV...</div>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:"#060608",
      fontFamily:"'Segoe UI','Roboto',system-ui,sans-serif",color:"#fff"}}>

      {/* ── HEADER FLUTUANTE ── */}
      <header style={{position:"fixed",top:0,left:0,right:0,zIndex:500,height:68,
        padding:"0 clamp(20px,4vw,56px)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        background:"linear-gradient(to bottom,rgba(6,6,8,0.97) 0%,rgba(6,6,8,0.7) 70%,transparent 100%)",
        backdropFilter:"blur(2px)"}}>
        <div style={{fontSize:16,fontWeight:900,letterSpacing:5,color:"#fff",
          textShadow:"0 0 30px rgba(255,255,255,0.15)"}}>TREND TV</div>
        <nav style={{display:"flex",gap:10,alignItems:"center"}}>
          <a href="/tv" style={{padding:"9px 26px",borderRadius:5,border:"none",cursor:"pointer",
            background:"#e50914",color:"#fff",fontWeight:700,fontSize:13,textDecoration:"none",
            letterSpacing:0.5,transition:"background 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="#b0060f"}
            onMouseLeave={e=>e.currentTarget.style.background="#e50914"}>▶ Assistir</a>
          <a href="/admin" style={{padding:"9px 18px",borderRadius:5,
            border:"1px solid rgba(255,255,255,0.16)",background:"transparent",
            color:"rgba(255,255,255,0.7)",fontSize:13,textDecoration:"none",
            transition:"all 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor="rgba(255,255,255,0.35)"}}
            onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.7)";e.currentTarget.style.borderColor="rgba(255,255,255,0.16)"}}>Admin</a>
        </nav>
      </header>

      {/* ── HERO 85vh ── */}
      <div style={{position:"relative",height:"clamp(520px,85vh,800px)",overflow:"hidden",background:"#060608"}}>
        {vis.map((ch,i)=>{
          const sched=todayByChannel[ch.id]||[];
          const cur=sched.find(p=>now>=p.horarioInicio&&now<p.horarioFim)||sched[0];
          const next=cur?sched[sched.findIndex(p=>p.id===cur?.id)+1]:null;
          return<Hero key={ch.id} ch={ch} cur={cur} next={next}
            thumb={thumbnails[ch.id]} active={i===safeIdx}
            onWatch={()=>window.location.href=`/tv?canal=${ch.numero||ch.id}`}/>;
        })}

        {/* Dots */}
        {vis.length>1&&<div style={{position:"absolute",bottom:28,left:"50%",
          transform:"translateX(-50%)",display:"flex",gap:8,zIndex:20}}>
          {vis.map((_,i)=><button key={i} onClick={()=>goHero(i)} style={{
            width:i===safeIdx?32:8,height:8,borderRadius:4,border:"none",cursor:"pointer",
            background:i===safeIdx?"#fff":"rgba(255,255,255,0.28)",
            transition:"all 0.35s ease",padding:0}}/>)}
        </div>}

        {/* Setas do hero */}
        {vis.length>1&&<>
          <button onClick={()=>goHero((safeIdx-1+vis.length)%vis.length)}
            style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",zIndex:20,
              width:46,height:46,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.2)",
              background:"rgba(0,0,0,0.45)",color:"#fff",fontSize:22,cursor:"pointer",
              backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",
              transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.18)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0.45)"}>‹</button>
          <button onClick={()=>goHero((safeIdx+1)%vis.length)}
            style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",zIndex:20,
              width:46,height:46,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.2)",
              background:"rgba(0,0,0,0.45)",color:"#fff",fontSize:22,cursor:"pointer",
              backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",
              transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.18)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0.45)"}>›</button>
        </>}
      </div>

      {/* ── SLIDER — abaixo do hero, sem sobreposição ── */}
      <div style={{background:"linear-gradient(to bottom,#060608 0%,#060608 100%)",
        padding:"28px clamp(20px,4vw,56px) 0"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:12}}>
          <h2 style={{fontSize:15,fontWeight:700,margin:0,letterSpacing:0.5,color:"#fff"}}>Canais ao vivo</h2>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.28)"}}>{vis.length} canais</span>
        </div>
        <Slider channels={channels} todayByChannel={todayByChannel}
          thumbnails={thumbnails} activeId={heroCh?.id}
          onSelect={ch=>{const i=vis.findIndex(c=>c.id===ch.id);if(i>=0)goHero(i);}}/>
      </div>

      {/* ── A SEGUIR ── */}
      {vis.some(ch=>(todayByChannel[ch.id]||[]).some(p=>p.horarioInicio>now&&!p.isPlaceholder))&&(
      <section style={{padding:"24px clamp(20px,4vw,56px) 64px"}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:"0 0 14px",letterSpacing:0.5,color:"#fff"}}>A seguir</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
          {vis.map(ch=>{
            const upcoming=(todayByChannel[ch.id]||[]).filter(p=>p.horarioInicio>now&&!p.isPlaceholder).slice(0,3);
            if(!upcoming.length)return null;
            const cor=ch.cor||"#4fc3f7";
            return(
              <div key={ch.id} style={{background:"rgba(255,255,255,0.035)",
                border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"13px 15px",
                transition:"border-color 0.2s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=`${cor}44`}
                onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.06)"}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                  {ch.logoType==="custom"&&ch.logoUrl
                    ?<img src={ch.logoUrl} alt="" style={{height:15,objectFit:"contain"}}/>
                    :<span style={{fontSize:14}}>{ch.logo||"📺"}</span>}
                  <span style={{fontSize:9,fontWeight:900,color:cor,letterSpacing:1.5,textTransform:"uppercase"}}>{ch.nome}</span>
                </div>
                {upcoming.map((p,i)=>(
                  <div key={p.id} style={{display:"flex",gap:9,alignItems:"flex-start",
                    paddingTop:i?8:0,borderTop:i?"1px solid rgba(255,255,255,0.05)":undefined}}>
                    <span style={{fontSize:11,fontWeight:700,color:"#777",minWidth:40,
                      textAlign:"right",paddingTop:1,flexShrink:0}}>{fmtHM(p.horarioInicio)}</span>
                    <span style={{fontSize:12,fontWeight:600,color:"#ddd",flex:1,
                      whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.nome}</span>
                  </div>
                ))}
              </div>
            );
          }).filter(Boolean)}
        </div>
      </section>
      )}

      {/* ── FOOTER ── */}
      <footer style={{borderTop:"1px solid rgba(255,255,255,0.04)",
        padding:"16px clamp(20px,4vw,56px)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        fontSize:11,color:"rgba(255,255,255,0.2)"}}>
        <span style={{letterSpacing:1}}>TREND TV {new Date().getFullYear()}</span>
        <div style={{display:"flex",gap:14}}>
          <a href="/tv" style={{color:"rgba(255,255,255,0.3)",textDecoration:"none",transition:"color 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color="#fff"}
            onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.3)"}>TV</a>
          <a href="/admin" style={{color:"rgba(255,255,255,0.3)",textDecoration:"none",transition:"color 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color="#fff"}
            onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.3)"}>Admin</a>
        </div>
      </footer>
    </div>
  );
}

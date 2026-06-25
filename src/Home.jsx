import { useState, useEffect, useMemo } from "react";
import { db, collection, onSnapshot } from "./firebase";
import { useNavigate } from "react-router-dom";

// ─── helpers (mesmos do TV.jsx) ───────────────────────────────
function getNow(){ const n=new Date(); return n.getHours()*3600+n.getMinutes()*60+n.getSeconds() }
function fmtHM(s){ return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}` }
function fmtDur(s){ const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h${m>0?`${m}min`:""}`:m>0?`${m}min`:"<1min" }
function getToday(){ return new Date().toISOString().split("T")[0] }
function ytThumb(id){ return id?`https://img.youtube.com/vi/${id}/maxresdefault.jpg`:null }
function ytThumbMed(id){ return id?`https://img.youtube.com/vi/${id}/mqdefault.jpg`:null }
function extractYTId(s){ if(!s)return null; const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/]; for(const r of p){const m=s.match(r);if(m)return m[1]} return null }

function buildScheduleToday(programs, channelId){
  const today = getToday();
  return programs
    .filter(p => p.canalId === channelId && p.data === today)
    .sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio))
    .map(p => ({
      ...p,
      horarioInicio: Number(p.horarioInicio),
      horarioFim:    Number(p.horarioFim),
      duracao:       Number(p.duracao),
    }));
}

function getCurrent(sched){
  const s = getNow();
  return sched.find(p => s >= p.horarioInicio && s < p.horarioFim) || null;
}

function getUpcoming(sched, limit=3){
  const s = getNow();
  return sched.filter(p => p.horarioInicio > s).slice(0, limit);
}

function ChLogo({ ch, size=32 }){
  if(ch.logoType==="custom" && ch.logoUrl)
    return <img src={ch.logoUrl} alt="" style={{width:size,height:size,borderRadius:4,objectFit:"cover"}} />;
  return <span style={{fontSize:size*0.8,lineHeight:1}}>{ch.logo||"📺"}</span>;
}

function LiveBadge({ big }){
  const [v,setV] = useState(true);
  useEffect(()=>{ const i=setInterval(()=>setV(x=>!x),800); return()=>clearInterval(i); },[]);
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,
      fontSize:big?13:10,fontWeight:800,color:"#ff3b3b",
      opacity:v?1:0.3,transition:"opacity 0.3s"}}>
      <span style={{width:big?9:7,height:big?9:7,borderRadius:"50%",
        background:"#ff3b3b",boxShadow:"0 0 6px #ff3b3b",flexShrink:0}}/>
      AO VIVO
    </span>
  );
}

// ─── Progresso do programa atual ──────────────────────────────
function ProgressBar({ prog }){
  const [pct,setPct] = useState(0);
  useEffect(()=>{
    const update=()=>{
      const el = getNow() - prog.horarioInicio;
      setPct(Math.min(100,(el/prog.duracao)*100));
    };
    update();
    const i=setInterval(update,5000);
    return()=>clearInterval(i);
  },[prog]);
  return (
    <div style={{height:3,background:"rgba(255,255,255,0.1)",borderRadius:2,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${pct}%`,borderRadius:2,
        background:"linear-gradient(90deg,#e53935,#ff7043)",
        transition:"width 5s linear"}}/>
    </div>
  );
}

// ─── HERO — programa destaque do canal principal ───────────────
function Hero({ channel, program, onWatch }){
  const [imgErr,setImgErr] = useState(false);
  if(!program || !channel) return null;

  const ytId   = extractYTId(program.youtubeId || program.videos?.[0]?.youtubeUrl);
  const thumb  = !imgErr && ytThumb(ytId);
  const elapsed = getNow() - program.horarioInicio;
  const remain  = program.horarioFim - getNow();

  return (
    <div style={{position:"relative",width:"100%",height:"clamp(280px,45vw,520px)",
      overflow:"hidden",borderRadius:"0 0 16px 16px"}}>

      {/* Thumbnail de fundo */}
      {thumb
        ? <img src={thumb} alt="" onError={()=>setImgErr(true)}
            style={{position:"absolute",inset:0,width:"100%",height:"100%",
              objectFit:"cover",filter:"brightness(0.4)"}}/>
        : <div style={{position:"absolute",inset:0,
            background:`radial-gradient(ellipse at 30% 50%,${channel.cor||"#1a73e8"}22,#0a0c12)`}}/>
      }

      {/* Gradiente para legibilidade */}
      <div style={{position:"absolute",inset:0,
        background:"linear-gradient(90deg,rgba(10,12,18,0.95) 0%,rgba(10,12,18,0.5) 50%,transparent 100%)"}}/>
      <div style={{position:"absolute",inset:0,
        background:"linear-gradient(0deg,rgba(10,12,18,1) 0%,transparent 40%)"}}/>

      {/* Conteúdo */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"clamp(16px,4vw,40px)"}}>
        {/* Canal */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{width:32,height:32,borderRadius:6,
            background:`${channel.cor}33`,border:`1px solid ${channel.cor}66`,
            display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
            <ChLogo ch={channel} size={channel.logoType==="custom"?32:20}/>
          </div>
          <span style={{fontSize:13,fontWeight:700,color:channel.cor}}>{channel.nome}</span>
          <span style={{marginLeft:4}}><LiveBadge big/></span>
        </div>

        {/* Título */}
        <h1 style={{margin:"0 0 8px",fontSize:"clamp(22px,4vw,42px)",
          fontWeight:900,color:"#fff",lineHeight:1.15,
          maxWidth:600,textShadow:"0 2px 12px rgba(0,0,0,0.8)"}}>
          {program.nome}
        </h1>

        {/* Sinopse */}
        {program.sinopse && (
          <p style={{margin:"0 0 12px",fontSize:"clamp(12px,1.5vw,15px)",
            color:"rgba(255,255,255,0.7)",lineHeight:1.6,
            maxWidth:520,
            display:"-webkit-box",WebkitLineClamp:2,
            WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {program.sinopse}
          </p>
        )}

        {/* Meta */}
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14,flexWrap:"wrap"}}>
          <span style={{fontSize:13,color:"#aaa"}}>
            {fmtHM(program.horarioInicio)} – {fmtHM(program.horarioFim)}
          </span>
          <span style={{fontSize:12,color:"#666"}}>
            {remain > 0 ? `Termina em ${fmtDur(remain)}` : "Ao vivo"}
          </span>
          {program.classificacao && program.classificacao !== "L" && (
            <span style={{fontSize:11,fontWeight:800,padding:"2px 7px",borderRadius:4,
              background:{"10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#000"}[program.classificacao]||"#888",
              color:"#000"}}>
              {program.classificacao}
            </span>
          )}
          {program.tags?.slice(0,3).map(t=>(
            <span key={t} style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:3,
              background:"rgba(255,255,255,0.1)",color:"#ccc"}}>{t}</span>
          ))}
        </div>

        {/* Barra de progresso */}
        <div style={{maxWidth:400,marginBottom:16}}>
          <ProgressBar prog={program}/>
        </div>

        {/* CTA */}
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button onClick={()=>onWatch(channel.id)}
            style={{padding:"12px 28px",borderRadius:8,border:"none",cursor:"pointer",
              background:"linear-gradient(135deg,#e53935,#c62828)",color:"#fff",
              fontSize:15,fontWeight:800,display:"flex",alignItems:"center",gap:8,
              boxShadow:"0 4px 20px rgba(229,57,53,0.4)",
              transition:"transform 0.15s,box-shadow 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.03)";e.currentTarget.style.boxShadow="0 6px 28px rgba(229,57,53,0.55)"}}
            onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.boxShadow="0 4px 20px rgba(229,57,53,0.4)"}}>
            ▶ Assistir Agora
          </button>
          <button onClick={()=>onWatch(null)}
            style={{padding:"12px 24px",borderRadius:8,cursor:"pointer",
              background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
              color:"#fff",fontSize:14,fontWeight:600,
              backdropFilter:"blur(8px)",transition:"background 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.18)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"}>
            📺 Ver Todos os Canais
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Card de canal no grid ─────────────────────────────────────
function ChannelCard({ channel, program, onWatch }){
  const ytId  = program ? extractYTId(program.youtubeId || program.videos?.[0]?.youtubeUrl) : null;
  const thumb = ytThumbMed(ytId);
  const [imgErr,setImgErr] = useState(false);
  const remain = program ? program.horarioFim - getNow() : 0;

  return (
    <div onClick={()=>onWatch(channel.id)}
      style={{borderRadius:10,overflow:"hidden",cursor:"pointer",
        background:"#14161e",border:"1px solid rgba(255,255,255,0.07)",
        transition:"transform 0.18s,border-color 0.18s,box-shadow 0.18s"}}
      onMouseEnter={e=>{
        e.currentTarget.style.transform="translateY(-3px)";
        e.currentTarget.style.borderColor=`${channel.cor}66`;
        e.currentTarget.style.boxShadow=`0 8px 32px rgba(0,0,0,0.5)`;
      }}
      onMouseLeave={e=>{
        e.currentTarget.style.transform="translateY(0)";
        e.currentTarget.style.borderColor="rgba(255,255,255,0.07)";
        e.currentTarget.style.boxShadow="none";
      }}>

      {/* Thumbnail */}
      <div style={{position:"relative",aspectRatio:"16/9",background:
        `radial-gradient(ellipse at center,${channel.cor}18,#0a0c12)`}}>
        {thumb && !imgErr
          ? <img src={thumb} alt="" onError={()=>setImgErr(true)}
              style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
          : <div style={{width:"100%",height:"100%",display:"flex",
              alignItems:"center",justifyContent:"center"}}>
              <ChLogo ch={channel} size={40}/>
            </div>
        }
        {/* Overlay escuro */}
        <div style={{position:"absolute",inset:0,
          background:"linear-gradient(0deg,rgba(10,12,18,0.9) 0%,transparent 50%)"}}/>
        {/* Badge AO VIVO */}
        {program && (
          <div style={{position:"absolute",top:8,left:8}}>
            <LiveBadge/>
          </div>
        )}
        {/* Número do canal */}
        <div style={{position:"absolute",top:8,right:8,
          fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.5)",
          background:"rgba(0,0,0,0.5)",padding:"2px 6px",borderRadius:4}}>
          {channel.numero}
        </div>
      </div>

      {/* Info */}
      <div style={{padding:"10px 12px 12px"}}>
        {/* Canal header */}
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
          <div style={{width:24,height:24,borderRadius:4,flexShrink:0,
            background:`${channel.cor}22`,border:`1px solid ${channel.cor}44`,
            display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
            <ChLogo ch={channel} size={channel.logoType==="custom"?24:15}/>
          </div>
          <span style={{fontSize:11,fontWeight:700,color:channel.cor,
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {channel.nome}
          </span>
        </div>

        {program ? (<>
          <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:3,
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3}}>
            {program.nome}
          </div>
          <div style={{fontSize:11,color:"#666",marginBottom:6}}>
            {fmtHM(program.horarioInicio)} – {fmtHM(program.horarioFim)}
            {remain>0 && <span style={{color:"#555",marginLeft:6}}>• {fmtDur(remain)} restante</span>}
          </div>
          <ProgressBar prog={program}/>
        </>) : (
          <div style={{fontSize:12,color:"#444",fontStyle:"italic"}}>Sem programação agora</div>
        )}
      </div>
    </div>
  );
}

// ─── Lista de próximos programas ──────────────────────────────
function UpcomingList({ channels, allPrograms }){
  const today = getToday();
  const now   = getNow();

  const upcoming = useMemo(()=>{
    const items = [];
    channels.forEach(ch => {
      const sched = buildScheduleToday(allPrograms, ch.id);
      sched.filter(p => p.horarioInicio > now && p.horarioInicio < now + 3*3600)
        .slice(0,2)
        .forEach(p => items.push({ ...p, channel:ch }));
    });
    return items.sort((a,b)=>a.horarioInicio - b.horarioInicio).slice(0,8);
  },[channels, allPrograms, now]);

  if(upcoming.length===0) return null;

  return (
    <section style={{padding:"0 clamp(12px,4vw,40px) 40px"}}>
      <h2 style={{fontSize:"clamp(16px,2.5vw,22px)",fontWeight:800,color:"#fff",
        margin:"0 0 16px",display:"flex",alignItems:"center",gap:10}}>
        <span style={{width:4,height:22,borderRadius:2,background:"#1a73e8",display:"inline-block"}}/>
        A seguir nas próximas horas
      </h2>
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,
        scrollbarWidth:"thin"}}>
        {upcoming.map(prog=>{
          const ytId = extractYTId(prog.youtubeId || prog.videos?.[0]?.youtubeUrl);
          const thumb = ytThumbMed(ytId);
          const [imgErr,setImgErr] = useState(false);
          const inMin = Math.round((prog.horarioInicio - now)/60);
          return (
            <div key={prog.id} style={{flexShrink:0,width:200,borderRadius:8,
              background:"#14161e",border:"1px solid rgba(255,255,255,0.06)",overflow:"hidden"}}>
              {/* Thumb */}
              <div style={{position:"relative",aspectRatio:"16/9",
                background:`linear-gradient(135deg,${prog.channel.cor}18,#0a0c12)`}}>
                {thumb && !imgErr
                  ? <img src={thumb} alt="" onError={()=>setImgErr(true)}
                      style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  : <div style={{width:"100%",height:"100%",display:"flex",
                      alignItems:"center",justifyContent:"center"}}>
                      <ChLogo ch={prog.channel} size={28}/>
                    </div>
                }
                <div style={{position:"absolute",bottom:5,right:6,
                  fontSize:9,fontWeight:800,color:"#4fc3f7",
                  background:"rgba(0,0,0,0.7)",padding:"2px 5px",borderRadius:3}}>
                  {inMin < 60 ? `em ${inMin}min` : `às ${fmtHM(prog.horarioInicio)}`}
                </div>
              </div>
              {/* Info */}
              <div style={{padding:"8px 10px"}}>
                <div style={{fontSize:10,color:prog.channel.cor,fontWeight:700,marginBottom:3}}>
                  {prog.channel.nome}
                </div>
                <div style={{fontSize:12,fontWeight:600,color:"#ddd",lineHeight:1.3,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {prog.nome}
                </div>
                <div style={{fontSize:10,color:"#555",marginTop:3}}>
                  {fmtHM(prog.horarioInicio)} • {fmtDur(prog.duracao)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── MAIN LANDING PAGE ────────────────────────────────────────
export default function Home(){
  const navigate = useNavigate();
  const [channels,  setChannels]  = useState([]);
  const [programs,  setPrograms]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [clock,     setClock]     = useState(new Date());

  // Relógio do header
  useEffect(()=>{
    const i=setInterval(()=>setClock(new Date()),1000);
    return()=>clearInterval(i);
  },[]);

  // Firebase
  useEffect(()=>{
    let done={ch:false,pr:false};
    const done_=()=>{ if(done.ch&&done.pr) setLoading(false); };
    const u1=onSnapshot(collection(db,"channels"),snap=>{
      const list=snap.docs.map(d=>({...d.data(),id:d.id}))
        .sort((a,b)=>(a.numero||0)-(b.numero||0))
        .filter(c=>!c.isInfo);
      setChannels(list); done.ch=true; done_();
    },()=>{done.ch=true;done_();});
    const u2=onSnapshot(collection(db,"programs"),snap=>{
      setPrograms(snap.docs.map(d=>({...d.data(),id:d.id})));
      done.pr=true; done_();
    },()=>{done.pr=true;done_();});
    const t=setTimeout(()=>setLoading(false),6000);
    return()=>{ u1();u2();clearTimeout(t); };
  },[]);

  // Programa atual de cada canal
  const channelNow = useMemo(()=>{
    const map={};
    channels.forEach(ch=>{
      const sched=buildScheduleToday(programs,ch.id);
      map[ch.id]=getCurrent(sched)||null;
    });
    return map;
  },[channels,programs]);

  // Canal destaque: o primeiro que tiver programa ao vivo
  const heroChannel = channels.find(ch=>channelNow[ch.id]) || channels[0];
  const heroProgram = heroChannel ? channelNow[heroChannel.id] : null;

  const goWatch = (channelId)=>{
    if(channelId) navigate(`/tv?canal=${channelId}`);
    else navigate("/tv");
  };

  // ── LOADING ──
  if(loading) return (
    <div style={{width:"100%",height:"100vh",background:"#0a0c12",
      display:"flex",alignItems:"center",justifyContent:"center",
      fontFamily:"'Segoe UI',sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:56,marginBottom:16,animation:"pulse 1.5s ease infinite"}}>📺</div>
        <div style={{fontSize:16,color:"#555",fontWeight:600}}>Carregando TREND TV...</div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:0.5;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}`}</style>
    </div>
  );

  // ── RENDER ──
  return (
    <div style={{minHeight:"100vh",background:"#0a0c12",
      fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",color:"#fff"}}>

      {/* ── NAVBAR ── */}
      <nav style={{position:"sticky",top:0,zIndex:100,
        background:"rgba(10,12,18,0.92)",backdropFilter:"blur(12px)",
        borderBottom:"1px solid rgba(255,255,255,0.07)",
        padding:"0 clamp(12px,4vw,40px)",
        display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>

        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>📺</span>
          <span style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:1}}>TREND</span>
          <span style={{fontSize:18,fontWeight:900,
            background:"linear-gradient(135deg,#e53935,#ff7043)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>TV</span>
        </div>

        {/* Links */}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:5,
            fontSize:13,fontWeight:700,color:"#ff3b3b",marginRight:8}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#ff3b3b",
              boxShadow:"0 0 6px #ff3b3b",display:"inline-block"}}/>
            {String(clock.getHours()).padStart(2,"0")}:{String(clock.getMinutes()).padStart(2,"0")}
          </div>
          <button onClick={()=>navigate("/tv")}
            style={{padding:"8px 20px",borderRadius:6,border:"none",cursor:"pointer",
              background:"linear-gradient(135deg,#e53935,#c62828)",
              color:"#fff",fontSize:13,fontWeight:700}}>
            ▶ Assistir Agora
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      {heroChannel && heroProgram && (
        <Hero channel={heroChannel} program={heroProgram} onWatch={goWatch}/>
      )}

      {/* ── GRID DE CANAIS ── */}
      <section style={{padding:"32px clamp(12px,4vw,40px) 24px"}}>
        <h2 style={{fontSize:"clamp(16px,2.5vw,22px)",fontWeight:800,color:"#fff",
          margin:"0 0 16px",display:"flex",alignItems:"center",gap:10}}>
          <span style={{width:4,height:22,borderRadius:2,background:"#e53935",display:"inline-block"}}/>
          Ao vivo agora
          <span style={{fontSize:13,fontWeight:600,color:"#555",marginLeft:4}}>
            — {channels.filter(ch=>channelNow[ch.id]).length} canais no ar
          </span>
        </h2>

        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fill,minmax(clamp(160px,22vw,240px),1fr))",
          gap:"clamp(8px,1.5vw,16px)",
        }}>
          {channels.map(ch=>(
            <ChannelCard key={ch.id} channel={ch}
              program={channelNow[ch.id]}
              onWatch={goWatch}/>
          ))}
        </div>
      </section>

      {/* ── PRÓXIMOS ── */}
      <UpcomingList channels={channels} allPrograms={programs}/>

      {/* ── FOOTER ── */}
      <footer style={{borderTop:"1px solid rgba(255,255,255,0.06)",
        padding:"20px clamp(12px,4vw,40px)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>📺</span>
          <span style={{fontSize:13,fontWeight:700,color:"#555"}}>TREND TV</span>
        </div>
        <div style={{display:"flex",gap:16,fontSize:12,color:"#444"}}>
          <button onClick={()=>navigate("/tv")}
            style={{background:"none",border:"none",cursor:"pointer",
              color:"#666",fontSize:12,padding:0}}>
            Assistir →
          </button>
        </div>
      </footer>

      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
      `}</style>
    </div>
  );
}

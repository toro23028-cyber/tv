import { useState, useEffect } from "react";
import { db, collection, onSnapshot } from "./firebase";
import { getTodayPrograms, getThumbnailForChannel } from "./TV";

// ============================================
// HOME — Landing page da TREND TV
// Usa getTodayPrograms() exportado do TV.jsx para resolver
// programas projetados pelo eternity corretamente.
// ============================================

function fmtHM(s){ s=Number(s); return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}` }
function getNow(){ const n=new Date(); return n.getHours()*3600+n.getMinutes()*60+n.getSeconds() }

export default function Home(){
  const [channels, setChannels] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Tick a cada 30s para atualizar progresso
  useEffect(()=>{const i=setInterval(()=>setTick(t=>t+1),30000);return()=>clearInterval(i)},[]);

  useEffect(()=>{
    let done={ch:false,pr:false};
    const done_check=()=>{ if(done.ch&&done.pr) setLoading(false); };
    const u1=onSnapshot(collection(db,"channels"),snap=>{
      const list=snap.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>(a.numero||0)-(b.numero||0));
      setChannels(list); done.ch=true; done_check();
    },()=>{done.ch=true;done_check()});
    const u2=onSnapshot(collection(db,"programs"),snap=>{
      setPrograms(snap.docs.map(d=>({...d.data(),id:d.id}))); done.pr=true; done_check();
    },()=>{done.pr=true;done_check()});
    return()=>{u1();u2()};
  },[]);

  // Resolve programas de hoje — funciona com eternity
  const todayByChannel = getTodayPrograms(programs, channels);
  const now = getNow();

  const visibleChannels = channels.filter(ch=>!ch.isInfo);

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#0a0c12",display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontFamily:"system-ui"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:12}}>📺</div>
        <div>Carregando TREND TV...</div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#0a0c12",fontFamily:"'Segoe UI','Roboto',system-ui,sans-serif",color:"#fff"}}>
      {/* Header */}
      <div style={{background:"rgba(0,0,0,0.6)",backdropFilter:"blur(12px)",borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"16px clamp(12px,4vw,40px)",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
        <div style={{fontSize:22,fontWeight:800,letterSpacing:2}}>📺 TREND TV</div>
        <div style={{fontSize:13,color:"#888"}}>Ao vivo agora</div>
      </div>

      {/* Grid de canais */}
      <div style={{padding:"32px clamp(12px,4vw,40px) 48px",display:"flex",flexDirection:"column",gap:32}}>
        <h2 style={{fontSize:18,fontWeight:700,color:"#fff",margin:0}}>Canais ao vivo</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
          {visibleChannels.map(ch=>{
            const sched = todayByChannel[ch.id] || [];
            const cur = sched.find(p=>now>=p.horarioInicio&&now<p.horarioFim) || sched[0];
            const next = cur ? sched[sched.findIndex(p=>p.id===cur.id)+1] : null;
            const thumb = getThumbnailForChannel(programs, channels, ch.id);
            const pct = cur ? Math.min(100,((now-cur.horarioInicio)/Math.max(1,cur.duracao))*100) : 0;

            return (
              <a key={ch.id} href={`/tv?canal=${ch.numero||ch.id}`}
                style={{textDecoration:"none",display:"block",background:"rgba(255,255,255,0.04)",borderRadius:12,border:"1px solid rgba(255,255,255,0.07)",overflow:"hidden",transition:"all 0.2s",cursor:"pointer"}}
                onMouseEnter={e=>{e.currentTarget.style.border=`1px solid ${ch.cor||"#1a73e8"}88`;e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 32px ${ch.cor||"#1a73e8"}22`}}
                onMouseLeave={e=>{e.currentTarget.style.border="1px solid rgba(255,255,255,0.07)";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=""}}>

                {/* Thumbnail */}
                <div style={{position:"relative",paddingBottom:"56.25%",background:`linear-gradient(135deg,${ch.cor||"#1a73e8"}22,#111)`,overflow:"hidden"}}>
                  {thumb
                    ? <img src={thumb} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>
                    : <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:48,opacity:0.4}}>
                        {ch.logoType==="custom"&&ch.logoUrl
                          ? <img src={ch.logoUrl} alt="" style={{width:64,height:64,objectFit:"contain"}}/>
                          : <span>{ch.logo||"📺"}</span>}
                      </div>}
                  {/* Badge AO VIVO */}
                  <div style={{position:"absolute",top:10,left:10,background:"#f44336",color:"#fff",fontSize:10,fontWeight:800,padding:"3px 8px",borderRadius:4,letterSpacing:1}}>● AO VIVO</div>
                  {/* Número do canal */}
                  <div style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.72)",color:"#fff",fontSize:12,fontWeight:700,padding:"3px 8px",borderRadius:4}}>{ch.numero}</div>
                </div>

                {/* Info */}
                <div style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    {ch.logoType==="custom"&&ch.logoUrl
                      ? <img src={ch.logoUrl} alt="" style={{width:20,height:20,objectFit:"contain",borderRadius:3}}/>
                      : <span style={{fontSize:16}}>{ch.logo||"📺"}</span>}
                    <span style={{fontSize:13,fontWeight:700,color:ch.cor||"#4fc3f7"}}>{ch.nome}</span>
                  </div>
                  {cur&&!cur.isPlaceholder
                    ? <>
                        <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cur.nome}</div>
                        <div style={{fontSize:11,color:"#888",marginBottom:8}}>{fmtHM(cur.horarioInicio)} – {fmtHM(cur.horarioFim)}</div>
                        {/* Barra de progresso */}
                        <div style={{height:3,background:"rgba(255,255,255,0.1)",borderRadius:2,overflow:"hidden"}}>
                          <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${ch.cor||"#1a73e8"},${ch.cor||"#4fc3f7"})`,borderRadius:2,transition:"width 1s linear"}}/>
                        </div>
                        {next&&!next.isPlaceholder&&<div style={{fontSize:10,color:"#666",marginTop:6}}>A seguir: {next.nome} · {fmtHM(next.horarioInicio)}</div>}
                      </>
                    : <div style={{fontSize:13,color:"#555"}}>Sem programação agora</div>}
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

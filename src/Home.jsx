import { useState, useEffect, useMemo, useCallback } from "react";
import { db, collection, onSnapshot } from "./firebase";
import { useNavigate } from "react-router-dom";

// ─── Helpers ──────────────────────────────────────────────────
function getNow(){ const n=new Date(); return n.getHours()*3600+n.getMinutes()*60+n.getSeconds() }
function fmtHM(s){ return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}` }
function fmtDur(s){ const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h${m>0?`${m}min`:""}`:m>0?`${m}min`:"<1min" }
function getToday(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function ytThumb(id){ return id?`https://img.youtube.com/vi/${id}/maxresdefault.jpg`:null }
function ytThumbMed(id){ return id?`https://img.youtube.com/vi/${id}/mqdefault.jpg`:null }
function extractYTId(s){ if(!s)return null; const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/]; for(const r of p){const m=s.match(r);if(m)return m[1]} return null }

function buildScheduleToday(programs, channelId, channel){
  // Canal HLS: programa virtual cobrindo 24h
  if (channel?.streamUrl) {
    return [{
      id: `_live_${channelId}`,
      canalId: channelId,
      nome: `Programação ${channel.nome || "ao vivo"}`,
      horarioInicio: 0, horarioFim: 86400, duracao: 86400,
      isLive: true, classificacao: "L", tags: ["AO VIVO"],
    }];
  }
  const today = getToday();
  return programs
    .filter(p => p.canalId === channelId && p.data === today)
    .sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio))
    .map(p => ({ ...p, horarioInicio:Number(p.horarioInicio), horarioFim:Number(p.horarioFim), duracao:Number(p.duracao) }));
}
function getCurrent(sched){ const s=getNow(); return sched.find(p=>s>=p.horarioInicio&&s<p.horarioFim)||null; }

// ─── Lembretes (localStorage) ─────────────────────────────────
const REM_KEY = "trendtv_reminders";
function loadReminders(){ try{ return JSON.parse(localStorage.getItem(REM_KEY)||"[]"); }catch{ return []; } }
function saveReminders(list){ localStorage.setItem(REM_KEY, JSON.stringify(list)); }

function useReminders(){
  const [reminders, setReminders] = useState(loadReminders);
  const add = useCallback((prog, ch) => {
    const now = getNow();
    const delay = (prog.horarioInicio - now - 300) * 1000; // 5 min antes
    if(delay <= 0){ alert("Programa começa em menos de 5 minutos!"); return; }
    if(!("Notification" in window)){ alert("Seu navegador não suporta notificações."); return; }
    Notification.requestPermission().then(perm => {
      if(perm !== "granted"){ alert("Permita notificações nas configurações do navegador."); return; }
      const id = `${prog.id}_${Date.now()}`;
      const item = { id, progNome:prog.nome, chNome:ch.nome, chId:ch.id, horario:prog.horarioInicio, data:getToday() };
      const updated = [...loadReminders().filter(r=>r.id!==id), item];
      saveReminders(updated);
      setReminders(updated);
      setTimeout(()=>{
        new Notification(`📺 ${prog.nome} começa em 5 min!`, { body:`${ch.nome} • ${fmtHM(prog.horarioInicio)}`, icon:"/icons/icon-192.png" });
        const afterRemove = loadReminders().filter(r=>r.id!==id);
        saveReminders(afterRemove); setReminders(afterRemove);
      }, delay);
      alert(`✅ Lembrete agendado! Você será notificado 5 minutos antes.`);
    });
  }, []);
  const remove = useCallback((id) => {
    const updated = loadReminders().filter(r=>r.id!==id);
    saveReminders(updated); setReminders(updated);
  }, []);
  const hasReminder = useCallback((progId) =>
    loadReminders().some(r=>r.progNome && r.id.startsWith(progId)), []);
  return { reminders, add, remove, hasReminder };
}

// ─── Componentes base ─────────────────────────────────────────
function ChLogo({ ch, size=32 }){
  if(ch.logoType==="custom"&&ch.logoUrl)
    return <img src={ch.logoUrl} alt="" style={{width:size,height:size,borderRadius:4,objectFit:"cover"}}/>;
  return <span style={{fontSize:size*0.8,lineHeight:1}}>{ch.logo||"📺"}</span>;
}
function LiveBadge({ big }){
  const [v,setV]=useState(true);
  useEffect(()=>{ const i=setInterval(()=>setV(x=>!x),800); return()=>clearInterval(i); },[]);
  return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:big?13:10,fontWeight:800,color:"#ff3b3b",opacity:v?1:0.3,transition:"opacity 0.3s"}}>
    <span style={{width:big?9:7,height:big?9:7,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 6px #ff3b3b",flexShrink:0}}/>AO VIVO
  </span>;
}
function ProgressBar({ prog }){
  const [pct,setPct]=useState(0);
  useEffect(()=>{
    const u=()=>setPct(Math.min(100,((getNow()-prog.horarioInicio)/prog.duracao)*100));
    u(); const i=setInterval(u,5000); return()=>clearInterval(i);
  },[prog]);
  return <div style={{height:3,background:"rgba(255,255,255,0.1)",borderRadius:2,overflow:"hidden"}}>
    <div style={{height:"100%",width:`${pct}%`,borderRadius:2,background:"linear-gradient(90deg,#e53935,#ff7043)",transition:"width 5s linear"}}/>
  </div>;
}

// ─── HERO CAROUSEL (3 canais em destaque) ─────────────────────
function HeroCarousel({ heroItems, onWatch }){
  const [idx, setIdx] = useState(0);
  const [imgErr, setImgErr] = useState({});

  // Avança automático a cada 6s
  useEffect(()=>{
    if(heroItems.length<=1) return;
    const i = setInterval(()=>setIdx(x=>(x+1)%heroItems.length), 6000);
    return()=>clearInterval(i);
  },[heroItems.length]);

  if(!heroItems.length) return null;
  const { channel, program } = heroItems[idx];
  const ytId  = extractYTId(program.youtubeId || program.videos?.[0]?.youtubeUrl);
  const thumb = !imgErr[idx] && ytThumb(ytId);
  const remain = program.horarioFim - getNow();

  return (
    <div style={{position:"relative",width:"100%",height:"clamp(280px,45vw,520px)",overflow:"hidden",borderRadius:"0 0 16px 16px"}}>
      {/* Fundo */}
      {thumb
        ? <img src={thumb} alt="" onError={()=>setImgErr(p=>({...p,[idx]:true}))}
            style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",filter:"brightness(0.38)",transition:"opacity 0.5s"}}/>
        : <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse at 30% 50%,${channel.cor||"#1a73e8"}22,#0a0c12)`}}/>
      }
      <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,rgba(10,12,18,0.95) 0%,rgba(10,12,18,0.5) 55%,transparent 100%)"}}/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(0deg,rgba(10,12,18,1) 0%,transparent 40%)"}}/>

      {/* Conteúdo */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"clamp(16px,4vw,40px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{width:32,height:32,borderRadius:6,background:`${channel.cor}33`,border:`1px solid ${channel.cor}66`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
            <ChLogo ch={channel} size={channel.logoType==="custom"?32:20}/>
          </div>
          <span style={{fontSize:13,fontWeight:700,color:channel.cor}}>{channel.nome}</span>
          <span style={{marginLeft:4}}><LiveBadge big/></span>
        </div>
        <h1 style={{margin:"0 0 8px",fontSize:"clamp(22px,4vw,42px)",fontWeight:900,color:"#fff",lineHeight:1.15,maxWidth:600,textShadow:"0 2px 12px rgba(0,0,0,0.8)"}}>
          {program.nome}
        </h1>
        {program.sinopse && (
          <p style={{margin:"0 0 12px",fontSize:"clamp(12px,1.5vw,15px)",color:"rgba(255,255,255,0.7)",lineHeight:1.6,maxWidth:520,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {program.sinopse}
          </p>
        )}
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14,flexWrap:"wrap"}}>
          <span style={{fontSize:13,color:"#aaa"}}>{fmtHM(program.horarioInicio)} – {fmtHM(program.horarioFim)}</span>
          {remain>0 && <span style={{fontSize:12,color:"#666"}}>Termina em {fmtDur(remain)}</span>}
        </div>
        <div style={{maxWidth:400,marginBottom:16}}><ProgressBar prog={program}/></div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>onWatch(channel.id)}
            style={{padding:"12px 28px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#e53935,#c62828)",color:"#fff",fontSize:15,fontWeight:800,display:"flex",alignItems:"center",gap:8,boxShadow:"0 4px 20px rgba(229,57,53,0.4)"}}>
            ▶ Assistir Agora
          </button>
        </div>
      </div>

      {/* Dots de navegação */}
      {heroItems.length > 1 && (
        <div style={{position:"absolute",bottom:20,right:"clamp(12px,4vw,40px)",display:"flex",gap:6}}>
          {heroItems.map((_,i)=>(
            <button key={i} onClick={()=>setIdx(i)}
              style={{width:i===idx?24:8,height:8,borderRadius:4,border:"none",cursor:"pointer",
                background:i===idx?"#e53935":"rgba(255,255,255,0.3)",transition:"all 0.3s",padding:0}}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal Guia do Dia (programação completa de um canal) ──────
function GuiaModal({ channels, allPrograms, initialChannelId, onClose, onWatch }){
  const [selCh, setSelCh] = useState(initialChannelId || channels[0]?.id);
  const { reminders, add:addReminder } = useReminders();
  const ch  = channels.find(c=>c.id===selCh)||channels[0];
  const now = getNow();

  const sched = useMemo(()=>{
    const today = getToday();
    const ch = channels.find(c=>c.id===selCh);
    return buildScheduleToday(allPrograms, selCh, ch);
  },[allPrograms,selCh,channels]);

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.88)",overflowY:"auto",display:"flex",flexDirection:"column"}}>
      <div onClick={e=>e.stopPropagation()} style={{maxWidth:720,width:"100%",margin:"0 auto",padding:20,minHeight:"100vh"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,position:"sticky",top:0,background:"rgba(0,0,0,0.95)",padding:"16px 0",zIndex:5}}>
          <div>
            <div style={{fontSize:20,fontWeight:700,color:"#fff"}}>📺 Programação</div>
            <div style={{fontSize:12,color:"#888",marginTop:2}}>{new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",width:40,height:40,borderRadius:"50%",cursor:"pointer",fontSize:18}}>✕</button>
        </div>
        {/* Seletor de canal */}
        <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:8}}>
          {channels.map(c=>(
            <button key={c.id} onClick={()=>setSelCh(c.id)}
              style={{padding:"8px 16px",borderRadius:6,cursor:"pointer",flexShrink:0,
                background:selCh===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",
                border:selCh===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",
                color:selCh===c.id?"#fff":"#888",fontSize:12,fontWeight:600,
                display:"flex",alignItems:"center",gap:6}}>
              <ChLogo ch={c} size={16}/>{c.nome}
            </button>
          ))}
        </div>
        {/* Lista de programas */}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {sched.length===0 && !channels.find(c=>c.id===selCh)?.streamUrl && <div style={{padding:40,textAlign:"center",color:"#555"}}>Sem programação para este canal hoje.</div>}
          {sched.map(prog=>{
            const isNow  = now>=prog.horarioInicio&&now<prog.horarioFim;
            const isPast = now>=prog.horarioFim;
            const isFut  = now<prog.horarioInicio;
            const hasRem = reminders.some(r=>r.id.startsWith(prog.id));
            return (
              <div key={prog.id} style={{display:"flex",gap:14,padding:"14px 16px",borderRadius:10,
                background:isNow?"rgba(26,115,232,0.15)":"rgba(255,255,255,0.04)",
                border:isNow?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.06)",
                opacity:isPast?0.4:1}}>
                <div style={{minWidth:70,textAlign:"center",paddingTop:2}}>
                  <div style={{fontSize:17,fontWeight:700,color:isNow?"#4fc3f7":"#fff"}}>{fmtHM(prog.horarioInicio)}</div>
                  <div style={{fontSize:10,color:"#555",marginTop:2}}>{fmtHM(prog.horarioFim)}</div>
                  {isNow&&<div style={{marginTop:6}}><LiveBadge/></div>}
                </div>
                <div style={{width:3,borderRadius:2,background:isNow?ch?.cor:"rgba(255,255,255,0.08)",flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:600,color:isNow?"#fff":"#ccc",marginBottom:4}}>{prog.nome}</div>
                  {prog.sinopse&&<div style={{fontSize:12,color:"#888",lineHeight:1.5,marginBottom:4}}>{prog.sinopse}</div>}
                  <div style={{fontSize:11,color:"#666"}}>⏱ {fmtDur(prog.duracao)}</div>
                </div>
                {/* Ações */}
                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  {isNow && (
                    <button onClick={()=>{onWatch(prog.canalId);onClose();}}
                      style={{padding:"7px 10px",borderRadius:6,border:"none",cursor:"pointer",background:"#e53935",color:"#fff",fontSize:11,fontWeight:700}}>
                      ▶ Assistir
                    </button>
                  )}
                  {isFut && !hasRem && (
                    <button onClick={()=>addReminder(prog, ch)}
                      style={{padding:"7px 10px",borderRadius:6,cursor:"pointer",background:"rgba(255,152,0,0.1)",border:"1px solid rgba(255,152,0,0.25)",color:"#ff9800",fontSize:11,fontWeight:600}}>
                      🔔 Lembrete
                    </button>
                  )}
                  {isFut && hasRem && (
                    <div style={{padding:"7px 10px",borderRadius:6,background:"rgba(255,152,0,0.08)",border:"1px solid rgba(255,152,0,0.15)",color:"#ff9800",fontSize:10,textAlign:"center"}}>
                      🔔 Agendado
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Card de canal no grid ─────────────────────────────────────
function ChannelCard({ channel, program, onWatch }){
  const ytId  = program?extractYTId(program.youtubeId||program.videos?.[0]?.youtubeUrl):null;
  const thumb = ytThumbMed(ytId);
  const [imgErr,setImgErr] = useState(false);
  const remain = program?program.horarioFim-getNow():0;
  return (
    <div onClick={()=>onWatch(channel.id)}
      style={{borderRadius:10,overflow:"hidden",cursor:"pointer",background:"#14161e",
        border:"1px solid rgba(255,255,255,0.07)",transition:"transform 0.18s,border-color 0.18s,box-shadow 0.18s"}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.borderColor=`${channel.cor}66`;e.currentTarget.style.boxShadow="0 8px 32px rgba(0,0,0,0.5)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.borderColor="rgba(255,255,255,0.07)";e.currentTarget.style.boxShadow="none";}}>
      <div style={{position:"relative",aspectRatio:"16/9",background:`radial-gradient(ellipse at center,${channel.cor}18,#0a0c12)`}}>
        {thumb&&!imgErr
          ?<img src={thumb} alt="" onError={()=>setImgErr(true)} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
          :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}><ChLogo ch={channel} size={40}/></div>
        }
        <div style={{position:"absolute",inset:0,background:"linear-gradient(0deg,rgba(10,12,18,0.9) 0%,transparent 50%)"}}/>
        {program&&<div style={{position:"absolute",top:8,left:8}}><LiveBadge/></div>}
        <div style={{position:"absolute",top:8,right:8,fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.5)",background:"rgba(0,0,0,0.5)",padding:"2px 6px",borderRadius:4}}>{channel.numero}</div>
      </div>
      <div style={{padding:"10px 12px 12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
          <div style={{width:24,height:24,borderRadius:4,flexShrink:0,background:`${channel.cor}22`,border:`1px solid ${channel.cor}44`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
            <ChLogo ch={channel} size={channel.logoType==="custom"?24:15}/>
          </div>
          <span style={{fontSize:11,fontWeight:700,color:channel.cor,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{channel.nome}</span>
        </div>
        {program?(<>
          <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3}}>{program.nome}</div>
          <div style={{fontSize:11,color:"#666",marginBottom:6}}>{fmtHM(program.horarioInicio)} – {fmtHM(program.horarioFim)}{remain>0&&<span style={{color:"#555",marginLeft:6}}>• {fmtDur(remain)} restante</span>}</div>
          <ProgressBar prog={program}/>
        </>):(<div style={{fontSize:12,color:"#444",fontStyle:"italic"}}>Sem programação agora</div>)}
      </div>
    </div>
  );
}

// ─── Card de "A seguir" com lembrete ──────────────────────────
function UpcomingCard({ prog, now, onReminderAdd }){
  const [imgErr,setImgErr] = useState(false);
  const ytId  = extractYTId(prog.youtubeId||prog.videos?.[0]?.youtubeUrl);
  const thumb = ytThumbMed(ytId);
  const inMin = Math.round((prog.horarioInicio-now)/60);
  const { reminders, add } = useReminders();
  const hasRem = reminders.some(r=>r.id.startsWith(prog.id));
  return (
    <div style={{flexShrink:0,width:200,borderRadius:8,background:"#14161e",border:"1px solid rgba(255,255,255,0.06)",overflow:"hidden"}}>
      <div style={{position:"relative",aspectRatio:"16/9",background:`linear-gradient(135deg,${prog.channel.cor}18,#0a0c12)`}}>
        {thumb&&!imgErr
          ?<img src={thumb} alt="" onError={()=>setImgErr(true)} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}><ChLogo ch={prog.channel} size={28}/></div>
        }
        <div style={{position:"absolute",bottom:5,right:6,fontSize:9,fontWeight:800,color:"#4fc3f7",background:"rgba(0,0,0,0.7)",padding:"2px 5px",borderRadius:3}}>
          {inMin<60?`em ${inMin}min`:`às ${fmtHM(prog.horarioInicio)}`}
        </div>
      </div>
      <div style={{padding:"8px 10px 10px"}}>
        <div style={{fontSize:10,color:prog.channel.cor,fontWeight:700,marginBottom:2}}>{prog.channel.nome}</div>
        <div style={{fontSize:12,fontWeight:600,color:"#ddd",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:6}}>{prog.nome}</div>
        <div style={{fontSize:10,color:"#555",marginBottom:8}}>{fmtHM(prog.horarioInicio)} • {fmtDur(prog.duracao)}</div>
        {/* Botão lembrete */}
        {hasRem
          ?<div style={{fontSize:10,color:"#ff9800",fontWeight:600,display:"flex",alignItems:"center",gap:4}}><span>🔔</span>Lembrete agendado</div>
          :<button onClick={()=>add(prog, prog.channel)}
            style={{width:"100%",padding:"6px 0",borderRadius:5,cursor:"pointer",
              background:"rgba(255,152,0,0.1)",border:"1px solid rgba(255,152,0,0.25)",
              color:"#ff9800",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
            🔔 Lembrete
          </button>
        }
      </div>
    </div>
  );
}

// ─── Lista "A seguir" ─────────────────────────────────────────
function UpcomingList({ channels, allPrograms }){
  const now = getNow();
  const upcoming = useMemo(()=>{
    const items=[];
    channels.forEach(ch=>{
      const sched=buildScheduleToday(allPrograms,ch.id,ch);
      sched.filter(p=>p.horarioInicio>now&&p.horarioInicio<now+3*3600)
        .slice(0,2).forEach(p=>items.push({...p,channel:ch}));
    });
    return items.sort((a,b)=>a.horarioInicio-b.horarioInicio).slice(0,12);
  },[channels,allPrograms]);
  if(!upcoming.length) return null;
  return (
    <section style={{padding:"0 clamp(12px,4vw,40px) 40px"}}>
      <h2 style={{fontSize:"clamp(16px,2.5vw,22px)",fontWeight:800,color:"#fff",margin:"0 0 16px",display:"flex",alignItems:"center",gap:10}}>
        <span style={{width:4,height:22,borderRadius:2,background:"#1a73e8",display:"inline-block"}}/>
        A seguir
      </h2>
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8}}>
        {upcoming.map(prog=><UpcomingCard key={prog.id} prog={prog} now={now}/>)}
      </div>
    </section>
  );
}

// ─── Painel "Meus Lembretes" ──────────────────────────────────
function RemindersPanel({ onClose, onWatch }){
  const { reminders, remove } = useReminders();
  const now = getNow();
  const today = getToday();
  const active = reminders.filter(r=>r.data===today&&r.horario>now);
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:"16px 16px 0 0",maxWidth:480,width:"100%",maxHeight:"70vh",overflow:"auto",border:"1px solid rgba(255,255,255,0.1)"}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:16,fontWeight:700,color:"#fff"}}>🔔 Meus Lembretes</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:18}}>✕</button>
        </div>
        <div style={{padding:16}}>
          {active.length===0
            ?<div style={{padding:32,textAlign:"center",color:"#555",fontSize:14}}>Nenhum lembrete agendado para hoje.</div>
            :active.map(r=>(
              <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{r.progNome}</div>
                  <div style={{fontSize:11,color:"#888",marginTop:2}}>{r.chNome} • {fmtHM(r.horario)}</div>
                </div>
                <button onClick={()=>remove(r.id)} style={{padding:"5px 10px",borderRadius:4,cursor:"pointer",background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.2)",color:"#f44336",fontSize:11}}>Remover</button>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

// ─── MAIN LANDING PAGE ────────────────────────────────────────
export default function Home(){
  const navigate  = useNavigate();
  const [channels,  setChannels]  = useState([]);
  const [programs,  setPrograms]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [clock,     setClock]     = useState(new Date());
  const [showGuia,  setShowGuia]  = useState(false);
  const [showRems,  setShowRems]  = useState(false);
  const [showAllCh, setShowAllCh] = useState(false);
  const { reminders } = useReminders();

  useEffect(()=>{ const i=setInterval(()=>setClock(new Date()),1000); return()=>clearInterval(i); },[]);

  useEffect(()=>{
    let done={ch:false,pr:false};
    const done_=()=>{ if(done.ch&&done.pr) setLoading(false); };
    const t=setTimeout(()=>setLoading(false),6000);
    const u1=onSnapshot(collection(db,"channels"),snap=>{
      const list=snap.docs.map(d=>({...d.data(),id:d.id})).filter(c=>!c.isInfo).sort((a,b)=>(a.numero||0)-(b.numero||0));
      setChannels(list); done.ch=true; done_();
    },()=>{done.ch=true;done_();});
    const u2=onSnapshot(collection(db,"programs"),snap=>{
      setPrograms(snap.docs.map(d=>({...d.data(),id:d.id})));
      done.pr=true; done_();
    },()=>{done.pr=true;done_();});
    return()=>{ u1();u2();clearTimeout(t); };
  },[]);

  const channelNow = useMemo(()=>{
    const map={};
    channels.forEach(ch=>{ map[ch.id]=getCurrent(buildScheduleToday(programs,ch.id,ch))||null; });
    return map;
  },[channels,programs]);

  // Até 3 canais com programa ao vivo para o carousel
  const heroItems = useMemo(()=>
    channels.filter(ch=>channelNow[ch.id]).slice(0,3).map(ch=>({channel:ch,program:channelNow[ch.id]}))
  ,[channels,channelNow]);

  const goWatch = (channelId)=>{
    if(channelId) navigate(`/tv?canal=${channelId}`);
    else navigate("/tv");
  };

  const INITIAL_SHOW = 6;
  const visibleChannels = showAllCh ? channels : channels.slice(0, INITIAL_SHOW);
  const activeReminders = reminders.filter(r=>r.data===getToday()&&r.horario>getNow()).length;

  if(loading) return (
    <div style={{width:"100%",height:"100vh",background:"#0a0c12",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:56,marginBottom:16,animation:"pulse 1.5s ease infinite"}}>📺</div>
        <div style={{fontSize:16,color:"#555",fontWeight:600}}>Carregando TREND TV...</div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:0.5;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}`}</style>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#0a0c12",fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",color:"#fff"}}>

      {/* ── NAVBAR ── */}
      <nav style={{position:"sticky",top:0,zIndex:100,background:"rgba(10,12,18,0.92)",backdropFilter:"blur(12px)",borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"0 clamp(12px,4vw,40px)",display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>📺</span>
          <span style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:1}}>TREND</span>
          <span style={{fontSize:18,fontWeight:900,background:"linear-gradient(135deg,#e53935,#ff7043)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>TV</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{fontSize:13,fontWeight:700,color:"#ff3b3b",display:"flex",alignItems:"center",gap:5,marginRight:4}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 6px #ff3b3b",display:"inline-block"}}/>
            {String(clock.getHours()).padStart(2,"0")}:{String(clock.getMinutes()).padStart(2,"0")}
          </div>
          {/* Lembretes */}
          <button onClick={()=>setShowRems(true)} style={{position:"relative",padding:"7px 12px",borderRadius:6,cursor:"pointer",background:"rgba(255,152,0,0.1)",border:"1px solid rgba(255,152,0,0.2)",color:"#ff9800",fontSize:13}}>
            🔔{activeReminders>0&&<span style={{position:"absolute",top:-4,right:-4,width:16,height:16,borderRadius:"50%",background:"#e53935",color:"#fff",fontSize:9,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>{activeReminders}</span>}
          </button>
          <button onClick={()=>setShowGuia(true)} style={{padding:"7px 16px",borderRadius:6,cursor:"pointer",background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",fontSize:13,fontWeight:600}}>
            📅 Programação
          </button>
          <button onClick={()=>navigate("/tv")} style={{padding:"8px 20px",borderRadius:6,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#e53935,#c62828)",color:"#fff",fontSize:13,fontWeight:700}}>
            ▶ Assistir
          </button>
        </div>
      </nav>

      {/* ── HERO CAROUSEL ── */}
      <HeroCarousel heroItems={heroItems} onWatch={goWatch}/>

      {/* ── GRID DE CANAIS ── */}
      <section style={{padding:"32px clamp(12px,4vw,40px) 24px"}}>
        <h2 style={{fontSize:"clamp(16px,2.5vw,22px)",fontWeight:800,color:"#fff",margin:"0 0 16px",display:"flex",alignItems:"center",gap:10}}>
          <span style={{width:4,height:22,borderRadius:2,background:"#e53935",display:"inline-block"}}/>
          Ao vivo agora
          <span style={{fontSize:13,fontWeight:600,color:"#555",marginLeft:4}}>— {channels.filter(ch=>channelNow[ch.id]).length} canais no ar</span>
        </h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(clamp(160px,22vw,240px),1fr))",gap:"clamp(8px,1.5vw,16px)"}}>
          {visibleChannels.map(ch=><ChannelCard key={ch.id} channel={ch} program={channelNow[ch.id]} onWatch={goWatch}/>)}
        </div>
        {channels.length>INITIAL_SHOW&&(
          <div style={{textAlign:"center",marginTop:20}}>
            <button onClick={()=>setShowAllCh(x=>!x)}
              style={{padding:"10px 28px",borderRadius:8,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#aaa",fontSize:13,fontWeight:600}}>
              {showAllCh?`▲ Ver menos`:`▼ Ver mais ${channels.length-INITIAL_SHOW} canais`}
            </button>
          </div>
        )}
      </section>

      {/* ── A SEGUIR ── */}
      <UpcomingList channels={channels} allPrograms={programs}/>

      {/* ── FOOTER ── */}
      <footer style={{borderTop:"1px solid rgba(255,255,255,0.06)",padding:"20px clamp(12px,4vw,40px)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>📺</span>
          <span style={{fontSize:13,fontWeight:700,color:"#555"}}>TREND TV</span>
        </div>
        <div style={{display:"flex",gap:16}}>
          <button onClick={()=>setShowGuia(true)} style={{background:"none",border:"none",cursor:"pointer",color:"#666",fontSize:12,padding:0}}>Programação</button>
          <button onClick={()=>navigate("/tv")} style={{background:"none",border:"none",cursor:"pointer",color:"#666",fontSize:12,padding:0}}>Assistir →</button>
        </div>
      </footer>

      {/* ── MODAIS ── */}
      {showGuia&&<GuiaModal channels={channels} allPrograms={programs} initialChannelId={channels[0]?.id} onClose={()=>setShowGuia(false)} onWatch={(id)=>{goWatch(id);setShowGuia(false);}}/>}
      {showRems&&<RemindersPanel onClose={()=>setShowRems(false)} onWatch={goWatch}/>}

      <style>{`*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}`}</style>
    </div>
  );
}

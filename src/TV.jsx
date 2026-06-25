import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, collection, onSnapshot, updateDoc, addDoc, doc } from "./firebase";

// ============================================
// FALLBACK DATA
// ============================================
const FALLBACK_CHANNELS = [
  { id:"_info", numero:0, nome:"Sobre", logo:"ℹ️", logoType:"emoji", logoUrl:null, cor:"#78909C", isInfo:true },
];
const FALLBACK_PROGRAMS = [
  { id:"fb1", canalId:"_info", nome:"Bem-vindo à TVWEB", sinopse:"Configure canais e programas no painel /admin para começar!", duracao:3600, horarioInicio:0, horarioFim:3600, classificacao:"L", tags:["HD"], data:"" },
];
const VOLTAMOS_JA = {
  id: "_voltamos", nome: "Voltamos já!", sinopse: "Programação em breve",
  duracao: 600, horarioInicio: 0, horarioFim: 600,
  horarioTexto: "00:00", horarioFimTexto: "00:10",
  classificacao: "L", tags: ["HD"], youtubeId: null, isPlaceholder: true
};

// ============================================
// HELPERS
// ============================================
function getNow(){ const n=new Date(); return n.getHours()*3600+n.getMinutes()*60+n.getSeconds() }
function fmtHM(s){ return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}` }
function fD(s){ const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h${m>0?String(m).padStart(2,"0")+"min":""}`: `${m}min` }
const CC={L:"#0f0","10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#000"};
function getToday(){ return new Date().toISOString().split("T")[0] }
function extractYTId(s){ if(!s)return null; const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/]; for(const r of p){const m=s.match(r);if(m)return m[1]} return null }

// ============================================================
// ✅ FIX 1: BASE_DATE DINÂMICA — nunca expira, rolling window
// Em vez de hardcode "2026-06-24", usa o início do dia atual
// como âncora, garantindo que o sistema funcione para sempre.
// ============================================================
const QUEUE_DAYS = 7; // Escalável: mude para 15, 30, etc.

function getBaseDate() {
  const now = new Date();
  // Início do dia de hoje às 00:00:00 UTC
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dateSecondsToAbsolute(dateStr, secondsInDay) {
  const BASE_DATE = getBaseDate();
  const targetDate = new Date(dateStr + "T00:00:00Z");
  const daysDiff = Math.floor((targetDate - BASE_DATE) / (1000 * 60 * 60 * 24));
  return daysDiff * 86400 + secondsInDay;
}

function getAbsoluteNow() {
  const BASE_DATE = getBaseDate();
  const now = new Date();
  return Math.floor((now - BASE_DATE) / 1000);
}

function absoluteToDateSeconds(absSeconds) {
  const BASE_DATE = getBaseDate();
  const dayNum = Math.floor(absSeconds / 86400);
  const secondsInDay = absSeconds % 86400;
  const targetDate = new Date(BASE_DATE.getTime() + dayNum * 24 * 60 * 60 * 1000);
  const dateStr = targetDate.toISOString().split("T")[0];
  return { date: dateStr, seconds: secondsInDay };
}

// ============================================
// SCHEDULE BUILDER
// ============================================
function buildSchedule(programs, channelId) {
  const today = getToday();
  const dayProgs = programs
    .filter(p => p.canalId === channelId && p.data === today)
    .sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio))
    .map(p => ({
      ...p,
      horarioInicio: Number(p.horarioInicio), horarioFim: Number(p.horarioFim),
      duracao: Number(p.duracao),
      horarioTexto: fmtHM(Number(p.horarioInicio)), horarioFimTexto: fmtHM(Number(p.horarioFim)),
    }));

  if (dayProgs.length > 0) {
    const withGaps = [];
    for (let i = 0; i < dayProgs.length; i++) {
      if (i === 0 && dayProgs[i].horarioInicio > 0) {
        let cur = 0;
        while (cur < dayProgs[i].horarioInicio) {
          const gapEnd = Math.min(cur + 600, dayProgs[i].horarioInicio);
          withGaps.push({ ...VOLTAMOS_JA, id:`_gap_${i}_${cur}`, horarioInicio:cur, horarioFim:gapEnd, duracao:gapEnd-cur, horarioTexto:fmtHM(cur), horarioFimTexto:fmtHM(gapEnd) });
          cur = gapEnd;
        }
      }
      withGaps.push(dayProgs[i]);
      if (i < dayProgs.length - 1 && dayProgs[i].horarioFim < dayProgs[i+1].horarioInicio) {
        let cur = dayProgs[i].horarioFim;
        while (cur < dayProgs[i+1].horarioInicio) {
          const gapEnd = Math.min(cur + 600, dayProgs[i+1].horarioInicio);
          withGaps.push({ ...VOLTAMOS_JA, id:`_gap_${i}_${cur}`, horarioInicio:cur, horarioFim:gapEnd, duracao:gapEnd-cur, horarioTexto:fmtHM(cur), horarioFimTexto:fmtHM(gapEnd) });
          cur = gapEnd;
        }
      }
    }
    if (dayProgs[dayProgs.length-1].horarioFim < 86400) {
      let cur = dayProgs[dayProgs.length-1].horarioFim;
      while (cur < 86400) {
        const gapEnd = Math.min(cur + 600, 86400);
        withGaps.push({ ...VOLTAMOS_JA, id:`_gap_end_${cur}`, horarioInicio:cur, horarioFim:gapEnd, duracao:gapEnd-cur, horarioTexto:fmtHM(cur), horarioFimTexto:fmtHM(gapEnd) });
        cur = gapEnd;
      }
    }
    return withGaps;
  }

  // Sem programação hoje: repete o que existir em loop
  const anyProgs = programs.filter(p => p.canalId === channelId).sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio));
  if (anyProgs.length === 0) return [];
  const schedule = []; let cur = 0, idx = 0;
  while (cur < 86400) {
    const src = anyProgs[idx % anyProgs.length];
    const dur = Number(src.duracao) || 3600;
    const end = cur + dur;
    schedule.push({ ...src, id:`${src.id}_rep${idx}`, horarioInicio:cur, horarioFim:end, duracao:dur, horarioTexto:fmtHM(cur), horarioFimTexto:fmtHM(end) });
    cur = end; idx++;
  }
  return schedule;
}

function getCurProg(schedule) {
  if (!schedule || schedule.length === 0) return null;
  const s = getNow();
  return schedule.find(p => s >= p.horarioInicio && s < p.horarioFim) || null;
}
function getElapsed(prog) { return Math.max(0, getNow() - prog.horarioInicio) }

// ============================================================
// ✅ FIX 2: getVideoList — extrai lista ordenada de vídeos
// Prioriza o array videos[], fallback para youtubeId antigo.
// ============================================================
function getVideoList(prog) {
  if (!prog) return [];
  const fromArray = (prog.videos || [])
    .map(v => extractYTId(v?.youtubeUrl || v?.url || ""))
    .filter(Boolean);
  if (fromArray.length > 0) return fromArray;
  const single = extractYTId(prog.youtubeId);
  return single ? [single] : [];
}

// ============================================
// SMALL COMPONENTS
// ============================================
function ChLogo({ch, size=28}) {
  if (ch.logoType==="custom" && ch.logoUrl) return <img src={ch.logoUrl} alt="" style={{width:size,height:size,borderRadius:4,objectFit:"cover"}} />;
  return <span style={{fontSize:size*0.85}}>{ch.logo || "📺"}</span>;
}

function LiveDot({big}){
  const[v,setV]=useState(true);
  useEffect(()=>{const i=setInterval(()=>setV(x=>!x),800);return()=>clearInterval(i)},[]);
  return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:big?14:11,fontWeight:800,color:"#ff3b3b",opacity:v?1:0.3,transition:"opacity 0.3s"}}>
    <span style={{width:big?10:8,height:big?10:8,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 8px #ff3b3b"}}/>AO VIVO
  </span>;
}

function Badge({c,big}){ return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:big?30:22,height:big?30:22,borderRadius:4,background:CC[c]||"#888",color:c==="L"||c==="18"?"#fff":"#000",fontSize:big?13:10,fontWeight:800}}>{c}</span> }
function Tag({t}){ const c={HD:"#1a73e8","4K":"#e91e63",DUB:"#4caf50",LEG:"#ff9800","5.1":"#9c27b0"}; return <span style={{fontSize:10,fontWeight:700,padding:"3px 7px",borderRadius:3,background:c[t]||"#555",color:"#fff"}}>{t}</span> }

function shareProgram(prog,ch){ const text=`📺 ${prog.nome}\n🕐 ${prog.horarioTexto} - ${prog.horarioFimTexto}\n📡 ${ch?.nome||"TVWEB"}`; if(navigator.share)navigator.share({title:prog.nome,text,url:window.location.href}).catch(()=>{}); else{navigator.clipboard?.writeText(text);alert("Copiado!")} }
function scheduleNotif(prog,ch,min=5){ const ns=getNow();const ts=prog.horarioInicio-min*60;const delay=(ts-ns)*1000;if(delay<=0){alert("Já começou!");return}if(!("Notification"in window)){alert("Sem suporte.");return}Notification.requestPermission().then(p=>{if(p!=="granted")return;setTimeout(()=>{new Notification(`📺 ${prog.nome} em ${min}min!`,{body:`${ch?.nome} · ${prog.horarioTexto}`})},delay);alert("✅ Lembrete definido!")}) }

// ============================================
// OSD HEADER
// ============================================
function OSDHeader({channel,program,visible,videoIndex,videoTotal}){
  const[t,setT]=useState(new Date());
  useEffect(()=>{const i=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(i)},[]);
  const ds=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  if(!program||!channel) return null;
  return <div style={{
    position:"absolute",top:0,left:0,right:0,zIndex:10,
    background:"linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 70%, transparent 100%)",
    padding:"20px 30px 40px",
    transform:visible?"translateY(0)":"translateY(-100%)",
    transition:"transform 0.6s ease",
    pointerEvents:visible?"auto":"none",
  }}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        <div style={{width:60,height:60,borderRadius:8,background:`${channel.cor}33`,border:`2px solid ${channel.cor}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
          <ChLogo ch={channel} size={channel.logoType==="custom"?60:40}/>
        </div>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
            <span style={{fontSize:28,fontWeight:800,color:"#fff"}}>{channel.numero}</span>
            <span style={{fontSize:22,fontWeight:700,color:channel.cor}}>{channel.nome}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
            <span style={{fontSize:20,fontWeight:700,color:"#fff"}}>{program.nome}</span>
            {/* ✅ FIX 2: Indicador de vídeo atual quando há múltiplos */}
            {videoTotal > 1 && (
              <span style={{fontSize:12,fontWeight:700,padding:"3px 8px",borderRadius:4,background:"rgba(156,39,176,0.4)",border:"1px solid rgba(156,39,176,0.6)",color:"#ce93d8"}}>
                {videoIndex + 1}/{videoTotal}
              </span>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
            <span style={{fontSize:15,color:"#bbb"}}>{program.horarioTexto} - {program.horarioFimTexto}</span>
            <Badge c={program.classificacao} big/>
            {program.tags?.map(t=><Tag key={t} t={t}/>)}
          </div>
        </div>
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        <div style={{fontSize:32,fontWeight:800,color:"#fff",letterSpacing:1,lineHeight:1}}>
          {String(t.getHours()).padStart(2,"0")}:{String(t.getMinutes()).padStart(2,"0")}
        </div>
        <div style={{fontSize:14,color:"#aaa",marginTop:4}}>
          {ds[t.getDay()]} {t.getDate()}/{t.getMonth()+1}
        </div>
        <div style={{fontSize:16,fontWeight:800,color:"rgba(255,255,255,0.5)",letterSpacing:3,marginTop:8}}>TREND TV</div>
      </div>
    </div>
  </div>;
}

// ============================================
// OSD FOOTER
// ============================================
function OSDFooter({program,nextProgram,onOpenEPG,onOpenFull,onFullscreen,visible}){
  const[el,setEl]=useState(0);
  const[isFullscreen,setIsFullscreen]=useState(false);

  useEffect(()=>{
    if(!program) return;
    const u=()=>setEl(getElapsed(program)); u();
    const i=setInterval(u,1000); return()=>clearInterval(i);
  },[program]);

  useEffect(()=>{
    const h=()=>setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange",h);
    return()=>document.removeEventListener("fullscreenchange",h);
  },[]);

  if(!program) return null;
  const pct=Math.min((el/program.duracao)*100,100);

  return <div style={{
    position:"absolute",bottom:0,left:0,right:0,zIndex:10,
    background:"linear-gradient(0deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 70%, transparent 100%)",
    padding:"40px 30px 20px",
    transform:visible?"translateY(0)":"translateY(100%)",
    transition:"transform 0.6s ease",
    pointerEvents:visible?"auto":"none",
  }}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
      <span style={{fontSize:15,fontWeight:700,color:"#fff",minWidth:55}}>{fmtHM(program.horarioInicio + el)}</span>
      <div style={{flex:1,height:5,background:"rgba(255,255,255,0.15)",borderRadius:3,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#1a73e8,#4fc3f7)",borderRadius:3,transition:"width 1s linear"}}/>
      </div>
      <span style={{fontSize:13,color:"#888",minWidth:55,textAlign:"right"}}>{program.horarioFimTexto}</span>
    </div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <LiveDot big/>
        {nextProgram && <span style={{fontSize:13,color:"#777"}}>A seguir: <span style={{color:"#bbb",fontWeight:600}}>{nextProgram.nome}</span> · {nextProgram.horarioTexto}</span>}
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={e=>{e.stopPropagation();onOpenEPG()}} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",padding:"10px 22px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:600}}>▲ Guia Rápido</button>
        <button onClick={e=>{e.stopPropagation();onOpenFull()}} style={{background:"rgba(26,115,232,0.2)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"10px 22px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:600}}>📺 Programação</button>
        <button onClick={e=>{e.stopPropagation();onFullscreen()}} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",padding:"10px 22px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:600}}>{isFullscreen?"↙ Sair":"⛶ Tela Cheia"}</button>
      </div>
    </div>
  </div>;
}

// ============================================
// EPG COMPACTO
// ============================================
function EPGCompact({channels,allPrograms,currentChannelId,onSelectChannel,onSelectProgram,onOpenFull,onClose}){
  const now=getNow();
  const scrollRef=useRef(null);
  const ROW_H=130, PX=400;
  const totalW=PX*24;
  const nowPx=(now/86400)*totalW;
  const secToPx=(sec)=>(Number(sec)/86400)*totalW;
  const[clock,setClock]=useState(new Date());
  useEffect(()=>{const i=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(i)},[]);

  useEffect(()=>{
    if(scrollRef.current) scrollRef.current.scrollLeft=Math.max(0,nowPx-300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const scroll=(dir)=>{if(scrollRef.current)scrollRef.current.scrollLeft+=dir*400};
  const sortedChannels = useMemo(()=>[
    ...channels.filter(ch=>ch.id===currentChannelId),
    ...channels.filter(ch=>ch.id!==currentChannelId),
  ],[channels,currentChannelId]);

  return <div onClick={e=>e.stopPropagation()} style={{position:"absolute",bottom:0,left:0,right:0,zIndex:20,animation:"slideUp 0.3s ease"}}>
    <div style={{background:"rgba(10,12,18,0.98)",borderTop:"1px solid rgba(255,255,255,0.1)",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:20,fontWeight:800,color:"#fff",letterSpacing:2}}>GUIA</span>
        <LiveDot/>
        <span style={{fontSize:20,fontWeight:700,color:"#4fc3f7",marginLeft:8}}>{String(clock.getHours()).padStart(2,"0")}:{String(clock.getMinutes()).padStart(2,"0")}:{String(clock.getSeconds()).padStart(2,"0")}</span>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onOpenFull} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"8px 18px",borderRadius:4,cursor:"pointer",fontSize:13,fontWeight:600}}>📺 Ver Completa</button>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
      </div>
    </div>
    <div style={{background:"rgba(10,12,18,0.98)",display:"flex",overflow:"hidden",maxHeight:"60vh",minHeight:320}}>
      <div style={{minWidth:140,borderRight:"1px solid rgba(255,255,255,0.08)",flexShrink:0,overflowY:"auto"}}>
        <div style={{height:35}}/>
        {sortedChannels.map(ch=><div key={ch.id} onClick={()=>onSelectChannel(ch.id)} style={{height:ROW_H,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.05)",background:ch.id===currentChannelId?"rgba(26,115,232,0.15)":"transparent",borderLeft:ch.id===currentChannelId?"3px solid #1a73e8":"none"}}>
          <div style={{textAlign:"center"}}><ChLogo ch={ch} size={36}/><div style={{fontSize:12,fontWeight:600,color:ch.id===currentChannelId?"#fff":"#888",marginTop:4}}>{ch.nome}</div></div>
        </div>)}
      </div>
      <div ref={scrollRef} style={{flex:1,overflowX:"auto",overflowY:"hidden",position:"relative"}}>
        <div style={{position:"relative",height:35,borderBottom:"1px solid rgba(255,255,255,0.1)",width:totalW}}>
          {Array.from({length:25}).map((_,h)=>{
            const x=secToPx(h*3600);
            return <div key={h} style={{position:"absolute",left:x,top:0,bottom:0,borderLeft:"1px solid rgba(255,255,255,0.1)"}}>
              <span style={{fontSize:13,color:"#ccc",fontWeight:600,padding:"8px 8px",whiteSpace:"nowrap",display:"inline-block"}}>{String(h).padStart(2,"0")}:00</span>
            </div>;
          })}
          <div style={{position:"absolute",top:0,bottom:-ROW_H*channels.length,left:nowPx,width:3,background:"#ff3b3b",zIndex:5,boxShadow:"0 0 12px #ff3b3b",pointerEvents:"none"}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:"#ff3b3b",position:"absolute",top:-3,left:-3.5}}/>
          </div>
        </div>
        {sortedChannels.map(ch=>{
          const sched=buildSchedule(allPrograms,ch.id);
          const cur=getCurProg(sched);
          const isCurrent=ch.id===currentChannelId;
          return <div key={ch.id} style={{position:"relative",height:ROW_H,borderBottom:"1px solid rgba(255,255,255,0.05)",borderLeft:isCurrent?"3px solid #1a73e8":"none",width:totalW,background:isCurrent?"rgba(26,115,232,0.08)":"transparent"}}>
            {sched.filter(p=>Number(p.horarioFim)<=86400&&!p.isPlaceholder&&Number(p.horarioFim)>getNow()).map(prog=>{
              const startSec=Number(prog.horarioInicio), dur=Number(prog.duracao);
              const left=secToPx(startSec), w=Math.max(secToPx(dur),80);
              const isNow=cur?.id===prog.id;
              const needsRepeat=w>500;
              const needsTriple=w>900;
              return <div key={prog.id} onClick={()=>{onSelectChannel(ch.id);onSelectProgram(prog)}}
                style={{position:"absolute",left,width:w,top:0,bottom:2,cursor:"pointer",overflow:"hidden",background:isNow?isCurrent?"rgba(60,70,90,0.95)":"rgba(40,44,60,0.95)":isCurrent?"rgba(35,40,55,0.7)":"rgba(30,32,44,0.6)",borderRight:"1px solid rgba(255,255,255,0.06)",borderLeft:"1px solid rgba(255,255,255,0.03)",boxSizing:"border-box",transition:"background 0.2s"}}
                onMouseEnter={e=>e.currentTarget.style.background=isNow?isCurrent?"rgba(70,85,110,1)":"rgba(60,70,90,1)":isCurrent?"rgba(50,60,75,0.9)":"rgba(45,50,65,0.9)"}
                onMouseLeave={e=>e.currentTarget.style.background=isNow?isCurrent?"rgba(60,70,90,0.95)":"rgba(40,44,60,0.95)":isCurrent?"rgba(35,40,55,0.7)":"rgba(30,32,44,0.6)"}>
                <div style={{position:"absolute",left:12,top:10,right:12}}>
                  <div style={{fontSize:11,color:"#aaa",marginBottom:4,fontWeight:500}}>{prog.horarioTexto}{isNow&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,background:"#f44336",color:"#fff"}}>AO VIVO</span>}</div>
                  <div style={{fontSize:15,fontWeight:700,color:isNow?"#fff":"#ddd",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{prog.nome}</div>
                </div>
                {needsRepeat&&<div style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
                  <div style={{fontSize:15,fontWeight:700,color:isNow?"rgba(255,255,255,0.7)":"rgba(221,221,221,0.6)",whiteSpace:"nowrap"}}>{prog.nome}</div>
                </div>}
                {needsTriple&&<div style={{position:"absolute",right:12,bottom:10}}>
                  <div style={{fontSize:14,fontWeight:600,color:isNow?"rgba(255,255,255,0.5)":"rgba(221,221,221,0.4)",whiteSpace:"nowrap",textAlign:"right"}}>{prog.nome}</div>
                </div>}
              </div>;
            })}
            {sched.length===0&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#555",fontSize:13}}>Sem programação</div>}
          </div>;
        })}
      </div>
    </div>
    <div style={{background:"rgba(10,12,18,0.98)",padding:"10px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"#666"}}>
      <button onClick={()=>scroll(-1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 16px",borderRadius:4,cursor:"pointer",fontSize:13}}>← Anterior</button>
      <div style={{display:"flex",gap:24}}><span>↑↓ = Canal</span><span>ESC = Fechar</span><span>G = Guia</span></div>
      <button onClick={()=>scroll(1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 16px",borderRadius:4,cursor:"pointer",fontSize:13}}>Próximo →</button>
    </div>
  </div>;
}

// ============================================
// FULL DAY SCHEDULE
// ============================================
function FullDay({channels,allPrograms,currentChannelId,onClose,onProgramClick}){
  const[viewCh,setVCh]=useState(currentChannelId);
  const sched=buildSchedule(allPrograms,viewCh);
  const ns=getNow();
  const ch=channels.find(c=>c.id===viewCh)||channels[0];
  return <div onClick={e=>{e.stopPropagation();onClose()}} style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.92)",overflowY:"auto"}}>
    <div onClick={e=>e.stopPropagation()} style={{maxWidth:720,margin:"0 auto",padding:20,minHeight:"100vh"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,position:"sticky",top:0,background:"rgba(0,0,0,0.95)",padding:"16px 0",zIndex:5}}>
        <div><div style={{fontSize:20,fontWeight:700,color:"#fff"}}>📺 Programação Completa</div><div style={{fontSize:12,color:"#888",marginTop:2}}>{new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div></div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",width:40,height:40,borderRadius:"50%",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:8}}>
        {channels.map(c=><button key={c.id} onClick={()=>setVCh(c.id)} style={{padding:"10px 18px",borderRadius:6,cursor:"pointer",flexShrink:0,background:viewCh===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:viewCh===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:viewCh===c.id?"#fff":"#888",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}><ChLogo ch={c} size={18}/> {c.nome}</button>)}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {sched.length===0&&<div style={{padding:40,textAlign:"center",color:"#555"}}>Sem programação para este canal hoje.</div>}
        {sched.filter(p=>p.horarioFim<=86400&&p.horarioFim>getNow()).map(prog=>{
          const isNow=ns>=prog.horarioInicio&&ns<prog.horarioFim;
          const isPast=ns>=prog.horarioFim;
          return <div key={prog.id} onClick={()=>onProgramClick(prog)} style={{display:"flex",gap:14,padding:"16px 18px",borderRadius:10,cursor:"pointer",background:isNow?"rgba(26,115,232,0.15)":isPast?"rgba(255,255,255,0.015)":"rgba(255,255,255,0.04)",border:isNow?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.06)",opacity:isPast?0.4:1,transition:"all 0.2s"}}>
            <div style={{minWidth:75,textAlign:"center",paddingTop:2}}>
              <div style={{fontSize:18,fontWeight:700,color:isNow?"#4fc3f7":"#fff"}}>{prog.horarioTexto}</div>
              <div style={{fontSize:11,color:"#555",marginTop:2}}>{prog.horarioFimTexto}</div>
              {isNow&&<div style={{marginTop:6}}><LiveDot/></div>}
            </div>
            <div style={{width:3,borderRadius:2,background:isNow?ch.cor:"rgba(255,255,255,0.08)",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}>
                <span style={{fontSize:16,fontWeight:600,color:isNow?"#fff":"#ccc"}}>{prog.nome}</span>
                <Badge c={prog.classificacao}/>
                {prog.tags?.map(t=><Tag key={t} t={t}/>)}
              </div>
              <div style={{fontSize:13,color:"#999",lineHeight:1.6,marginBottom:6}}>{prog.sinopse}</div>
              <div style={{fontSize:11,color:"#666"}}>⏱ {fD(prog.duracao)}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,paddingTop:2}}>
              <button onClick={e=>{e.stopPropagation();shareProgram(prog,ch)}} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 10px",borderRadius:6,cursor:"pointer",fontSize:12}}>📤</button>
              {!isNow&&!isPast&&<button onClick={e=>{e.stopPropagation();scheduleNotif(prog,ch)}} style={{background:"rgba(255,152,0,0.1)",border:"1px solid rgba(255,152,0,0.2)",color:"#ff9800",padding:"8px 10px",borderRadius:6,cursor:"pointer",fontSize:12}}>🔔</button>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}

// ============================================
// PROGRAM MODAL
// ============================================
function ProgModal({program,channel,onClose,onWatch}){
  if(!program) return null;
  const isNow=getNow()>=Number(program.horarioInicio)&&getNow()<Number(program.horarioFim);
  const isFut=getNow()<Number(program.horarioInicio);
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#1a1c24",borderRadius:10,maxWidth:500,width:"100%",border:"1px solid rgba(255,255,255,0.1)",overflow:"hidden"}}>
      <div style={{height:140,background:`linear-gradient(135deg,${channel?.cor||"#333"}33,#0a0c12)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
        <ChLogo ch={channel||{logo:"📺"}} size={64}/>
        <div style={{position:"absolute",top:12,right:12,display:"flex",gap:4}}><Badge c={program.classificacao}/>{program.tags?.map(t=><Tag key={t} t={t}/>)}</div>
        {isNow&&<div style={{position:"absolute",top:12,left:12}}><LiveDot big/></div>}
      </div>
      <div style={{padding:24}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}><span style={{fontSize:14,color:channel?.cor,fontWeight:700}}>{channel?.nome}</span></div>
        <div style={{fontSize:24,fontWeight:700,color:"#fff",marginBottom:8}}>{program.nome}</div>
        <div style={{fontSize:14,color:"#999",lineHeight:1.6,marginBottom:16}}>{program.sinopse}</div>
        <div style={{display:"flex",gap:16,fontSize:13,color:"#666",marginBottom:16}}><span>⏰ {program.horarioTexto} - {program.horarioFimTexto}</span><span>⏱ {fD(Number(program.duracao))}</span></div>
        <div style={{display:"flex",gap:8}}>
          {isNow&&onWatch&&<button onClick={()=>{onWatch(program.canalId);onClose()}} style={{flex:1,padding:12,background:"linear-gradient(135deg,#f44336,#e91e63)",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>▶ Assistir Agora</button>}
          <button onClick={()=>shareProgram(program,channel)} style={{flex:1,padding:12,background:"rgba(76,175,80,0.15)",border:"1px solid rgba(76,175,80,0.3)",borderRadius:6,color:"#4caf50",cursor:"pointer",fontSize:13,fontWeight:600}}>📤 Compartilhar</button>
          {isFut&&<button onClick={()=>scheduleNotif(program,channel)} style={{flex:1,padding:12,background:"rgba(255,152,0,0.15)",border:"1px solid rgba(255,152,0,0.3)",borderRadius:6,color:"#ff9800",cursor:"pointer",fontSize:13,fontWeight:600}}>🔔 Lembrete</button>}
          <button onClick={onClose} style={{flex:1,padding:12,background:"rgba(26,115,232,0.2)",border:"1px solid rgba(26,115,232,0.3)",borderRadius:6,color:"#4fc3f7",cursor:"pointer",fontSize:13,fontWeight:600}}>Fechar</button>
        </div>
      </div>
    </div>
  </div>;
}

// ============================================================
// ✅ FIX 3: PLAYER STATE — gerencia qual vídeo está tocando
// Separado do componente principal para evitar re-renders
// desnecessários causados pelo tick de 3s.
// ============================================================
function usePlayerState(cp, curCh) {
  const videoListRef  = useRef([]);
  const videoIndexRef = useRef(0);
  const prevProgIdRef = useRef(null);
  const ytKeyRef      = useRef("");
  const ytStartRef    = useRef(0);
  const [playerState, setPlayerState] = useState({
    ytKey: "", src: null, videoIndex: 0, videoTotal: 0,
  });

  const buildSrc = useCallback((videoId, startSec, muted) => {
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${muted?1:0}&start=${Math.floor(startSec)}&controls=0&disablekb=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&fs=0&playsinline=1&enablejsapi=0`;
  }, []);

  // Chamado quando o programa muda
  const onProgramChange = useCallback((prog, muted) => {
    const list = getVideoList(prog);
    videoListRef.current  = list;
    videoIndexRef.current = 0;
    prevProgIdRef.current = prog.id;

    // Calcula o vídeo correto baseado no tempo decorrido
    // Se há múltiplos vídeos e duração conhecida de cada um,
    // poderíamos calcular qual está no ar. Por ora, começa do 0
    // com o start correto dentro do programa.
    const elapsed = getElapsed(prog);
    ytStartRef.current = elapsed;
    ytKeyRef.current   = `${curCh}_${prog.id}_0_${Date.now()}`;

    const videoId = list[0] || null;
    setPlayerState({
      ytKey: ytKeyRef.current,
      src: buildSrc(videoId, elapsed, muted),
      videoIndex: 0,
      videoTotal: list.length,
    });
  }, [curCh, buildSrc]);

  // Avança para o próximo vídeo na lista
  const nextVideo = useCallback((muted) => {
    const list = videoListRef.current;
    const next = videoIndexRef.current + 1;
    if (next >= list.length) return false; // não há próximo

    videoIndexRef.current = next;
    ytKeyRef.current = `${curCh}_${prevProgIdRef.current}_${next}_${Date.now()}`;

    setPlayerState(prev => ({
      ...prev,
      ytKey: ytKeyRef.current,
      src: buildSrc(list[next], 0, muted),
      videoIndex: next,
    }));
    return true;
  }, [curCh, buildSrc]);

  // Atualiza src quando muted muda (sem trocar vídeo)
  const updateMuted = useCallback((muted) => {
    const list = videoListRef.current;
    const idx  = videoIndexRef.current;
    const videoId = list[idx] || null;
    if (!videoId) return;
    ytKeyRef.current = ytKeyRef.current + "_um";
    setPlayerState(prev => ({
      ...prev,
      ytKey: ytKeyRef.current,
      src: buildSrc(videoId, 0, muted),
    }));
  }, [buildSrc]);

  return { playerState, prevProgIdRef, onProgramChange, nextVideo, updateMuted };
}

// ============================================
// MAIN APP
// ============================================
export default function TVWeb(){
  const [channels, setChannels]   = useState([]);
  const [allPrograms, setAllProgs] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [firebaseError, setFBErr] = useState(false);
  const [curCh, setCurCh]         = useState(null);
  const [showEPG, setEPG]         = useState(false);
  const [showFull, setFull]       = useState(false);
  const [showOSD, setOSD]         = useState(true);
  const [selProg, setSP]          = useState(null);
  const [fade, setFade]           = useState(false);
  const [muted, setMuted]         = useState(true);
  const [playerError, setPlayerError] = useState(false);

  // ============================================================
  // ✅ FIX 4: TICK OTIMIZADO
  // - clearInterval garantido pelo cleanup do useEffect
  // - Tick só recalcula o programa atual, sem re-renderizar o player
  // - Intervalo aumentado para 5s (3s era desnecessariamente rápido)
  // ============================================================
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(i); // ← cleanup garantido
  }, []);

  const hideTimer      = useRef(null);
  const cRef           = useRef(null);
  const wRef           = useRef(null);
  const lastClickTime  = useRef(0);

  // ============================================
  // FIREBASE REAL-TIME
  // ============================================
  useEffect(() => {
    let loaded = { channels: false, programs: false };
    const fallbackTimer = setTimeout(() => {
      setLoading(false);
      if (!loaded.channels && !loaded.programs) setFBErr(true);
    }, 8000);

    const unsubCh = onSnapshot(collection(db, "channels"), (snap) => {
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const sorted = list.sort((a,b) => (a.numero||0) - (b.numero||0));
      if (sorted.length > 0) { setChannels(sorted); setCurCh(prev => prev || sorted[0].id); }
      else { setChannels(FALLBACK_CHANNELS); setCurCh("_info"); }
      loaded.channels = true;
      if (loaded.channels && loaded.programs) { setLoading(false); clearTimeout(fallbackTimer); }
    }, (err) => {
      console.error("Firebase channels:", err);
      setChannels(FALLBACK_CHANNELS);
      setFBErr(true);
      loaded.channels = true;
      if (loaded.channels && loaded.programs) setLoading(false);
    });

    const unsubPr = onSnapshot(collection(db, "programs"), (snap) => {
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setAllProgs(list.length > 0 ? list : FALLBACK_PROGRAMS);
      loaded.programs = true;
      if (loaded.channels && loaded.programs) { setLoading(false); clearTimeout(fallbackTimer); }
    }, (err) => {
      console.error("Firebase programs:", err);
      setAllProgs(FALLBACK_PROGRAMS);
      loaded.programs = true;
      if (loaded.channels && loaded.programs) setLoading(false);
    });

    return () => { unsubCh(); unsubPr(); clearTimeout(fallbackTimer); };
  }, []);

  // ============================================
  // DERIVED STATE
  // ============================================
  const ch = channels.find(c => c.id === curCh) || channels[0];

  // useMemo com tick na dependência: recalcula o programa atual a cada tick
  const schedule = useMemo(
    () => ch ? buildSchedule(allPrograms, ch.id) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPrograms, ch?.id, tick]
  );

  const cp = useMemo(() => getCurProg(schedule), [schedule]);
  const ci = schedule.findIndex(p => p.id === cp?.id);
  const np = ci >= 0 ? schedule[ci + 1] : null;

  // ============================================
  // PLAYER STATE HOOK
  // ============================================
  const { playerState, prevProgIdRef, onProgramChange, nextVideo, updateMuted } =
    usePlayerState(cp, curCh);

  // ============================================================
  // ✅ FIX 2 + 5: AUTO VIDEO SWITCH & SEQUÊNCIA DE VÍDEOS
  // Quando o programa muda → reseta para o primeiro vídeo
  // O botão "Próximo vídeo" ou fim do iframe avança na lista
  // ============================================================
  useEffect(() => {
    if (!cp || cp.id === prevProgIdRef.current) return;
    setPlayerError(false);
    onProgramChange(cp, muted);

    // Auto-save progresso
    (async () => {
      try {
        const prog = allPrograms.find(p => p.id === cp.id);
        if (!prog) return;
        await updateDoc(doc(db, "progress", curCh), {
          currentProgramId: cp.id, currentProgramName: prog.nome,
          timestamp: new Date(), absoluteSeconds: getAbsoluteNow(),
        }).catch(() =>
          addDoc(collection(db, "progress"), {
            canalId: curCh, currentProgramId: cp.id,
            currentProgramName: prog.nome, timestamp: new Date(),
            absoluteSeconds: getAbsoluteNow(),
          })
        );
      } catch (err) { console.error("Auto-save:", err); }
    })();
  // prevProgIdRef é um ref, não precisa entrar nas deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cp?.id, curCh]);

  // ============================================
  // OSD VISIBILITY
  // ============================================
  const showOSDNow = useCallback(() => {
    clearTimeout(hideTimer.current);
    setOSD(true);
    hideTimer.current = setTimeout(() => {
      setOSD(false);
    }, 20000);
  }, []);

  useEffect(() => { showOSDNow(); return () => clearTimeout(hideTimer.current); }, [showOSDNow]);
  useEffect(() => { if (showEPG || showFull) { clearTimeout(hideTimer.current); setOSD(true); } }, [showEPG, showFull]);

  // ============================================
  // UNMUTE
  // ============================================
  const handleUnmute = useCallback(() => {
    setMuted(false);
    updateMuted(false);
  }, [updateMuted]);

  // ============================================
  // CHANNEL SWITCHING
  // ============================================
  const swCh = useCallback((id) => {
    if (id === curCh) return;
    setFade(true);
    setPlayerError(false);
    setTimeout(() => { setCurCh(id); setFade(false); }, 300);
    showOSDNow();
  }, [curCh, showOSDNow]);

  const swDir = useCallback((dir) => {
    const i = channels.findIndex(c => c.id === curCh);
    if (i < 0) return;
    const n = dir > 0
      ? (i < channels.length - 1 ? channels[i+1].id : channels[0].id)
      : (i > 0 ? channels[i-1].id : channels[channels.length-1].id);
    swCh(n);
  }, [curCh, channels, swCh]);

  // ============================================
  // KEYBOARD
  // ============================================
  useEffect(() => {
    const h = (e) => {
      if (e.key === "ArrowUp")   swDir(-1);
      else if (e.key === "ArrowDown")  swDir(1);
      else if (e.key === "Escape") { setEPG(false); setFull(false); setSP(null); }
      else if (e.key === "g" || e.key === "G") {
        if (showFull) { setFull(false); setEPG(true); }
        else if (showEPG) setEPG(false);
        else setEPG(true);
      }
      showOSDNow();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [swDir, showOSDNow, showEPG, showFull]);

  // ============================================
  // MOUSE WHEEL
  // ============================================
  const handleWheel = useCallback((e) => {
    if (showEPG || showFull) return;
    if (wRef.current) return;
    wRef.current = setTimeout(() => { wRef.current = null; }, 400);
    swDir(e.deltaY > 0 ? 1 : -1);
  }, [swDir, showEPG, showFull]);

  // ============================================
  // CLICK
  // ============================================
  const handleVideoClick = useCallback(() => {
    if (showEPG || showFull || selProg) return;
    const now = Date.now();
    if (now - lastClickTime.current < 300) {
      if (!document.fullscreenElement) cRef.current?.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
    lastClickTime.current = now;
    if (muted) handleUnmute();
    showOSDNow();
  }, [muted, handleUnmute, showOSDNow, showEPG, showFull, selProg]);

  // ============================================
  // NEXT VIDEO (botão manual ou erro)
  // ============================================
  const handleNextVideo = useCallback(() => {
    const advanced = nextVideo(muted);
    if (!advanced) {
      // Não há próximo vídeo — mostra erro temporário
      setPlayerError(true);
      setTimeout(() => setPlayerError(false), 5000);
    } else {
      setPlayerError(false);
    }
  }, [nextVideo, muted]);

  // ============================================
  // LOADING
  // ============================================
  if (loading) return (
    <div style={{width:"100%",height:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontFamily:"system-ui",fontSize:16}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16}}>📺</div>
        Carregando TVWEB...
      </div>
    </div>
  );
  if (!ch) return null;

  const { src: ytSrc, ytKey, videoIndex, videoTotal } = playerState;
  const showPlayer = ytSrc && !cp?.isPlaceholder;

  // ============================================
  // RENDER
  // ============================================
  return (
    <div
      ref={cRef}
      onWheel={handleWheel}
      onMouseMove={showOSDNow}
      style={{width:"100%",height:"100vh",background:"#000",position:"relative",fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",overflow:"hidden",cursor:"default",userSelect:"none"}}
    >
      {/* ===== YOUTUBE PLAYER ===== */}
      <div style={{position:"absolute",inset:0,zIndex:1,opacity:fade?0:1,transition:"opacity 0.5s"}}>
        {showPlayer ? (
          <iframe
            key={ytKey}
            src={ytSrc}
            allow="autoplay; encrypted-media"
            allowFullScreen={false}
            style={{width:"100%",height:"100%",border:"none",pointerEvents:"none"}}
            title={cp?.nome || "TVWEB"}
          />
        ) : (
          <div style={{width:"100%",height:"100%",background:`radial-gradient(ellipse at center,${ch.cor||"#1a73e8"}15,#0a0c12 70%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {cp?.isPlaceholder ? (
              <div style={{textAlign:"center",maxWidth:600}}>
                <div style={{fontSize:140,marginBottom:30,opacity:0.8}}>📺</div>
                <div style={{fontSize:48,fontWeight:700,color:"#fff",marginBottom:16}}>Voltamos já!</div>
                <div style={{fontSize:18,color:"#999"}}>Programação em breve</div>
              </div>
            ) : (
              <div style={{textAlign:"center",opacity:0.15}}><ChLogo ch={ch} size={100}/><div style={{fontSize:24,color:"#fff",marginTop:8,fontWeight:700}}>{ch.nome}</div></div>
            )}
          </div>
        )}
      </div>

      {/* ===== CLICK BARRIER ===== */}
      <div onClick={handleVideoClick} style={{position:"absolute",inset:0,zIndex:2}} />

      {/* ===== WATERMARK ===== */}
      <div style={{position:"absolute",top:16,right:20,fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.12)",letterSpacing:2,zIndex:3,pointerEvents:"none"}}>TVWEB</div>

      {/* ===== UNMUTE BUTTON ===== */}
      {muted && (
        <button onClick={e=>{e.stopPropagation();handleUnmute()}} style={{
          position:"absolute",bottom:"50%",left:"50%",transform:"translate(-50%,50%)",zIndex:15,
          background:"rgba(0,0,0,0.85)",border:"1px solid rgba(255,255,255,0.2)",
          color:"#fff",padding:"14px 32px",borderRadius:30,cursor:"pointer",
          fontSize:16,fontWeight:700,display:"flex",alignItems:"center",gap:10,
          animation:"pulseFull 2s ease infinite",
        }}>🔇 Clique para ativar o som</button>
      )}

      {/* ===== PLAYER ERROR OVERLAY ===== */}
      {playerError && (
        <div style={{
          position:"absolute",bottom:"40%",left:"50%",transform:"translateX(-50%)",zIndex:15,
          background:"rgba(0,0,0,0.85)",border:"1px solid rgba(244,67,54,0.4)",
          color:"#f44336",padding:"12px 24px",borderRadius:8,fontSize:14,fontWeight:600,
          display:"flex",alignItems:"center",gap:10,
        }}>
          ⚠️ Sem mais vídeos neste programa. Aguarde o próximo...
        </div>
      )}

      {/* ✅ FIX 2: BOTÃO PRÓXIMO VÍDEO (visível no OSD quando há múltiplos) */}
      {videoTotal > 1 && showOSD && !showEPG && !showFull && (
        <button
          onClick={e => { e.stopPropagation(); handleNextVideo(); }}
          style={{
            position:"absolute",top:"50%",right:80,transform:"translateY(-50%)",zIndex:15,
            background:"rgba(0,0,0,0.7)",border:"1px solid rgba(156,39,176,0.5)",
            color:"#ce93d8",padding:"10px 18px",borderRadius:8,cursor:"pointer",
            fontSize:13,fontWeight:700,display:"flex",flexDirection:"column",
            alignItems:"center",gap:4,
          }}
        >
          <span style={{fontSize:20}}>⏭</span>
          <span>{videoIndex + 1}/{videoTotal}</span>
        </button>
      )}

      {/* ===== OSD HEADER ===== */}
      <OSDHeader
        channel={ch} program={cp}
        visible={showOSD && !showEPG && !showFull}
        videoIndex={videoIndex}
        videoTotal={videoTotal}
      />

      {/* ===== OSD FOOTER ===== */}
      <OSDFooter
        program={cp} nextProgram={np}
        visible={showOSD && !showEPG && !showFull}
        onOpenEPG={() => setEPG(true)}
        onOpenFull={() => setFull(true)}
        onFullscreen={() => {
          if (!document.fullscreenElement) cRef.current?.requestFullscreen?.();
          else document.exitFullscreen?.();
        }}
      />

      {/* ===== CHANNEL SIDEBAR ===== */}
      <div style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",zIndex:15,display:"flex",flexDirection:"column",gap:4,opacity:showOSD&&!showEPG&&!showFull?0.7:0,transition:"opacity 0.3s",pointerEvents:showOSD&&!showEPG&&!showFull?"auto":"none"}}>
        {channels.map(c => (
          <div key={c.id} onClick={e=>{e.stopPropagation();swCh(c.id)}} style={{width:40,height:40,borderRadius:4,background:c.id===curCh?"rgba(26,115,232,0.3)":"rgba(0,0,0,0.5)",border:c.id===curCh?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden"}}>
            <ChLogo ch={c} size={c.logoType==="custom"?40:22}/>
          </div>
        ))}
      </div>

      {/* ===== FIREBASE ERROR NOTICE ===== */}
      {firebaseError && (
        <div style={{position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",zIndex:20,background:"rgba(255,152,0,0.15)",border:"1px solid rgba(255,152,0,0.3)",color:"#ff9800",padding:"8px 16px",borderRadius:6,fontSize:12,fontWeight:600}}>
          ⚠️ Modo offline — dados em cache
        </div>
      )}

      {/* ===== EPG / FULL / MODAL ===== */}
      {showEPG && (
        <EPGCompact
          channels={channels} allPrograms={allPrograms} currentChannelId={curCh}
          onSelectChannel={id => { swCh(id); setEPG(false); }}
          onSelectProgram={setSP}
          onOpenFull={() => { setEPG(false); setFull(true); }}
          onClose={() => setEPG(false)}
        />
      )}
      {showFull && (
        <FullDay
          channels={channels} allPrograms={allPrograms} currentChannelId={curCh}
          onClose={() => setFull(false)} onProgramClick={setSP}
        />
      )}
      {selProg && (
        <ProgModal
          program={selProg}
          channel={channels.find(c => buildSchedule(allPrograms, c.id).some(p => p.id === selProg.id)) || ch}
          onClose={() => setSP(null)}
          onWatch={(chId) => { swCh(chId); setEPG(false); setFull(false); }}
        />
      )}

      <style>{`
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes slideDown{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes pulseFull{0%,100%{opacity:.6;transform:translate(-50%,50%) scale(1)}50%{opacity:1;transform:translate(-50%,50%) scale(1.05)}}
        ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
        *{box-sizing:border-box;margin:0;padding:0}
      `}</style>
    </div>
  );
}

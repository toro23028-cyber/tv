import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, collection, onSnapshot } from "./firebase";

// ============================================
// FALLBACK DATA (shown when Firebase is empty)
// ============================================
const FALLBACK_CHANNELS = [
  { id:"_info", numero:0, nome:"Sobre", logo:"ℹ️", logoType:"emoji", logoUrl:null, cor:"#78909C", isInfo:true },
];
const FALLBACK_PROGRAMS = [
  { id:"fb1", canalId:"_info", nome:"Bem-vindo à TVWEB", sinopse:"Configure canais e programas no painel /admin para começar!", duracao:3600, horarioInicio:0, horarioFim:3600, classificacao:"L", tags:["HD"], data:"" },
];

// "Voltamos já" slide for gaps
const VOLTAMOS_JA = {
  id: "_voltamos",
  nome: "Voltamos já!",
  sinopse: "Programação em breve",
  duracao: 600,
  horarioInicio: 0,
  horarioFim: 600,
  horarioTexto: "00:00",
  horarioFimTexto: "00:10",
  classificacao: "L",
  tags: ["HD"],
  youtubeId: null,
  isPlaceholder: true
};

// ============================================
// HELPERS
// ============================================
function getNow(){ const n=new Date(); return n.getHours()*3600+n.getMinutes()*60+n.getSeconds() }
function fT(s){ return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}` }
function fD(s){ const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h${m>0?String(m).padStart(2,"0")+"min":""}`: `${m}min` }
function fmtSec(s){ const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}` }
const CC={L:"#0f0","10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#000"};

function getToday(){ return new Date().toISOString().split("T")[0] }

function extractYTId(s){ if(!s)return null; const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/]; for(const r of p){const m=s.match(r);if(m)return m[1]} return null }

function buildSchedule(programs, channelId) {
  const today = getToday();
  const dayProgs = programs
    .filter(p => p.canalId === channelId && p.data === today)
    .sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio))
    .map(p => ({
      ...p,
      horarioInicio: Number(p.horarioInicio),
      horarioFim: Number(p.horarioFim),
      duracao: Number(p.duracao),
      horarioTexto: fmtSec(Number(p.horarioInicio)),
      horarioFimTexto: fmtSec(Number(p.horarioFim)),
    }));

  if (dayProgs.length > 0) {
    // Fill gaps with "Voltamos já"
    const withGaps = [];
    for (let i = 0; i < dayProgs.length; i++) {
      if (i === 0 && dayProgs[i].horarioInicio > 0) {
        // Gap before first program
        let cur = 0;
        while (cur < dayProgs[i].horarioInicio) {
          const gapEnd = Math.min(cur + 600, dayProgs[i].horarioInicio);
          withGaps.push({
            ...VOLTAMOS_JA,
            id: `_gap_${i}_${cur}`,
            horarioInicio: cur,
            horarioFim: gapEnd,
            duracao: gapEnd - cur,
            horarioTexto: fmtSec(cur),
            horarioFimTexto: fmtSec(gapEnd),
          });
          cur = gapEnd;
        }
      }
      withGaps.push(dayProgs[i]);
      // Gap after this program
      if (i < dayProgs.length - 1 && dayProgs[i].horarioFim < dayProgs[i + 1].horarioInicio) {
        let cur = dayProgs[i].horarioFim;
        while (cur < dayProgs[i + 1].horarioInicio) {
          const gapEnd = Math.min(cur + 600, dayProgs[i + 1].horarioInicio);
          withGaps.push({
            ...VOLTAMOS_JA,
            id: `_gap_${i}_${cur}`,
            horarioInicio: cur,
            horarioFim: gapEnd,
            duracao: gapEnd - cur,
            horarioTexto: fmtSec(cur),
            horarioFimTexto: fmtSec(gapEnd),
          });
          cur = gapEnd;
        }
      }
    }
    // Gap after last program
    if (dayProgs[dayProgs.length - 1].horarioFim < 86400) {
      let cur = dayProgs[dayProgs.length - 1].horarioFim;
      while (cur < 86400) {
        const gapEnd = Math.min(cur + 600, 86400);
        withGaps.push({
          ...VOLTAMOS_JA,
          id: `_gap_end_${cur}`,
          horarioInicio: cur,
          horarioFim: gapEnd,
          duracao: gapEnd - cur,
          horarioTexto: fmtSec(cur),
          horarioFimTexto: fmtSec(gapEnd),
        });
        cur = gapEnd;
      }
    }
    return withGaps;
  }

  // No programs for today — try repeating any programs from this channel
  const anyProgs = programs
    .filter(p => p.canalId === channelId)
    .sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio));
  if (anyProgs.length === 0) return [];
  const schedule = [];
  let cur = 0, idx = 0;
  while (cur < 86400) {
    const src = anyProgs[idx % anyProgs.length];
    const dur = Number(src.duracao) || 3600;
    const end = cur + dur;
    schedule.push({
      ...src,
      id: `${src.id}_rep${idx}`,
      horarioInicio: cur, horarioFim: end, duracao: dur,
      horarioTexto: fmtSec(cur), horarioFimTexto: fmtSec(end),
    });
    cur = end; idx++;
  }
  return schedule;
}

function getCurProg(schedule) {
  if (!schedule || schedule.length === 0) return null;
  const s = getNow();
  return schedule.find(p => s >= p.horarioInicio && s < p.horarioFim) || null;
}

function getElapsed(prog) { return getNow() - prog.horarioInicio }

function ChLogo({ch, size=28}) {
  if (ch.logoType==="custom" && ch.logoUrl) return <img src={ch.logoUrl} alt="" style={{width:size,height:size,borderRadius:4,objectFit:"cover"}} />;
  return <span style={{fontSize:size*0.85}}>{ch.logo || "📺"}</span>;
}

// ============================================
// SMALL COMPONENTS
// ============================================
function LiveDot(){ const[v,setV]=useState(true); useEffect(()=>{const i=setInterval(()=>setV(x=>!x),800);return()=>clearInterval(i)},[]); return <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:"#ff3b3b",opacity:v?1:0.3,transition:"opacity 0.3s"}}><span style={{width:8,height:8,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 6px #ff3b3b"}}/>AO VIVO</span> }

function Clock(){ const[t,setT]=useState(new Date()); useEffect(()=>{const i=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(i)},[]); const d=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"]; return <div style={{color:"#ccc",textAlign:"right",fontSize:13,lineHeight:1.3}}><div style={{fontSize:22,fontWeight:700,color:"#fff",letterSpacing:1}}>{String(t.getHours()).padStart(2,"0")}:{String(t.getMinutes()).padStart(2,"0")}</div><div>{d[t.getDay()]} {t.getDate()}/{t.getMonth()+1}</div></div> }

function PBar({program}){ const[el,setEl]=useState(0); useEffect(()=>{const u=()=>setEl(getElapsed(program));u();const i=setInterval(u,1000);return()=>clearInterval(i)},[program]); const pct=Math.min((el/program.duracao)*100,100); return <div style={{display:"flex",alignItems:"center",gap:8,width:"100%",fontSize:11,color:"#aaa"}}><span style={{minWidth:40,textAlign:"right"}}>{fT(el)}</span><div style={{flex:1,height:4,background:"#333",borderRadius:2,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#1a73e8,#4fc3f7)",borderRadius:2,transition:"width 1s linear"}}/></div><span style={{minWidth:40}}>{fT(program.duracao)}</span></div> }

function Badge({c}){ return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:4,background:CC[c]||"#888",color:c==="L"||c==="18"?"#fff":"#000",fontSize:10,fontWeight:800}}>{c}</span> }
function Tag({t}){ const c={HD:"#1a73e8","4K":"#e91e63",DUB:"#4caf50",LEG:"#ff9800","5.1":"#9c27b0"}; return <span style={{fontSize:9,fontWeight:700,padding:"2px 5px",borderRadius:3,background:c[t]||"#555",color:"#fff"}}>{t}</span> }

function shareProgram(prog,ch){ const text=`📺 ${prog.nome}\n🕐 ${prog.horarioTexto} - ${prog.horarioFimTexto}\n📡 ${ch?.nome||"TVWEB"}`; if(navigator.share)navigator.share({title:prog.nome,text,url:window.location.href}).catch(()=>{}); else{navigator.clipboard?.writeText(text);alert("Copiado!")} }
function scheduleNotif(prog,ch,min=5){ const ns=getNow();const ts=prog.horarioInicio-min*60;const delay=(ts-ns)*1000;if(delay<=0){alert("Já começou!");return}if(!("Notification"in window)){alert("Sem suporte.");return}Notification.requestPermission().then(p=>{if(p!=="granted")return;setTimeout(()=>{new Notification(`📺 ${prog.nome} em ${min}min!`,{body:`${ch?.nome} · ${prog.horarioTexto}`})},delay);alert(`✅ Lembrete definido!`)}) }

function FsBtn({cRef}){ const[fs,setFs]=useState(false);const[pulse,setPulse]=useState(true); useEffect(()=>{const h=()=>setFs(!!document.fullscreenElement);document.addEventListener("fullscreenchange",h);const t=setTimeout(()=>setPulse(false),6000);return()=>{document.removeEventListener("fullscreenchange",h);clearTimeout(t)}},[]); return <button onClick={()=>{if(!document.fullscreenElement)cRef.current?.requestFullscreen?.();else document.exitFullscreen?.()}} style={{position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",zIndex:15,background:"rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",padding:"6px 14px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:600,animation:pulse?"pulseFull 2s ease infinite":"none"}}>{fs?"↙ Sair":"↗ Tela Cheia"}</button> }

// ============================================
// INFO BAR
// ============================================
function InfoBar({channel,program,nextProgram,onOpenEPG,onOpenFull}){
  if(!program) return null;
  return <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:10,background:"linear-gradient(transparent, rgba(0,0,0,0.95))",padding:"40px 24px 16px"}}>
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16}}>
      <div style={{flex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
          <ChLogo ch={channel} size={20}/><span style={{fontSize:13,color:channel.cor,fontWeight:700}}>{channel.nome}</span>
          <Badge c={program.classificacao}/>{program.tags?.map(t => <Tag key={t} t={t}/>)}<LiveDot/>
        </div>
        <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:4}}>{program.nome}</div>
        <div style={{fontSize:12,color:"#999",marginBottom:8}}>{program.horarioTexto} - {program.horarioFimTexto}</div>
        <PBar program={program}/>
      </div>
      <Clock/>
    </div>
    {nextProgram && <div style={{marginTop:8,fontSize:11,color:"#666"}}>A seguir: <span style={{color:"#aaa"}}>{nextProgram.nome}</span> · {nextProgram.horarioTexto}</div>}
    <div style={{display:"flex",justifyContent:"center",gap:10,marginTop:12}}>
      <button onClick={onOpenEPG} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",padding:"8px 20px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600}}>▲ Guia Rápido</button>
      <button onClick={onOpenFull} style={{background:"rgba(26,115,232,0.2)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"8px 20px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600}}>📺 Programação Completa</button>
    </div>
  </div>;
}

// ============================================
// EPG COMPACTO
// ============================================
function EPGCompact({channels,allPrograms,currentChannelId,onSelectChannel,onSelectProgram,onOpenFull,onClose}){
  const now=getNow();
  const scrollRef=useRef(null);
  const ROW_H=140, PX=400;
  const nowPx = (now/86400) * PX * 24;
  
  useEffect(()=>{
    if(scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, nowPx - 200);
    }
  },[nowPx]);

  const scroll = (dir) => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft += dir * 300;
    }
  };
  
  const timeMarks=[];
  for(let i=0;i<96;i++){
    const h=Math.floor(i/4);
    const m=(i%4)*15;
    timeMarks.push({label:m===0?`${String(h).padStart(2,"0")}:00`:"",isFull:m===0,position:(i/96)*PX*24})
  }

  return <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:20,animation:"slideUp 0.3s ease"}}>
    <div style={{background:"rgba(16,18,26,0.98)",borderTop:"1px solid rgba(255,255,255,0.1)",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:1}}>GUIA</span><LiveDot/></div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onOpenFull} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"8px 18px",borderRadius:4,cursor:"pointer",fontSize:13,fontWeight:600}}>📺 Ver Completa</button>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
      </div>
    </div>
    <div style={{background:"rgba(16,18,26,0.98)",display:"flex",overflow:"hidden",maxHeight:ROW_H*Math.min(channels.length,5)+50}}>
      <div style={{minWidth:140,borderRight:"1px solid rgba(255,255,255,0.08)",flexShrink:0}}>
        <div style={{height:35}}/>
        {channels.map(ch => <div key={ch.id} onClick={()=>onSelectChannel(ch.id)} style={{height:ROW_H,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.05)",background:ch.id===currentChannelId?"rgba(26,115,232,0.1)":"transparent",transition:"background 0.2s"}}>
          <div style={{textAlign:"center"}}><ChLogo ch={ch} size={40}/><div style={{fontSize:13,fontWeight:600,color:ch.id===currentChannelId?"#fff":"#999",marginTop:6}}>{ch.nome}</div></div>
        </div>)}
      </div>
      <div ref={scrollRef} style={{flex:1,overflowX:"auto",overflowY:"hidden"}}>
        <div style={{display:"flex",height:35,borderBottom:"1px solid rgba(255,255,255,0.1)",position:"relative"}}>
          {timeMarks.map((t,i) => <div key={i} style={{minWidth:PX/4,fontSize:t.isFull?14:11,color:t.isFull?"#ccc":"#666",padding:"8px 10px",borderLeft:t.isFull?"1px solid rgba(255,255,255,0.1)":"1px solid rgba(255,255,255,0.03)",fontWeight:t.isFull?600:400,whiteSpace:"nowrap"}}>{t.label}</div>)}
          <div style={{position:"absolute",top:0,bottom:-ROW_H*channels.length,left:nowPx,width:3,background:"#ff3b3b",zIndex:5,boxShadow:"0 0 12px #ff3b3b",pointerEvents:"none"}}><div style={{width:10,height:10,borderRadius:"50%",background:"#ff3b3b",position:"absolute",top:-3,left:-3.5}}/></div>
        </div>
        {channels.map(ch => {
          const sched = buildSchedule(allPrograms, ch.id);
          const cur = getCurProg(sched);
          return <div key={ch.id} style={{display:"flex",height:ROW_H,borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
            {sched.filter(p=>p.horarioFim<=86400).map(prog => {
              const w=Math.max((prog.duracao/86400)*PX*24,80);
              const isNow=cur?.id===prog.id;
              const isLong = prog.duracao > 3600;
              return <div key={prog.id} onClick={()=>{onSelectChannel(ch.id);onSelectProgram(prog)}}
                style={{minWidth:w,maxWidth:w,height:ROW_H-2,padding:"14px 16px",cursor:"pointer",overflow:"hidden",background:isNow?"rgba(40,44,60,0.95)":"rgba(30,32,44,0.6)",borderRight:"1px solid rgba(255,255,255,0.06)",display:"flex",flexDirection:"column",justifyContent:"center",transition:"background 0.2s"}}
                onMouseEnter={e=>e.currentTarget.style.background=isNow?"rgba(60,70,90,1)":"rgba(45,50,65,0.9)"}
                onMouseLeave={e=>e.currentTarget.style.background=isNow?"rgba(40,44,60,0.95)":"rgba(30,32,44,0.6)"}>
                <div style={{fontSize:12,color:"#aaa",marginBottom:8,fontWeight:500}}>{prog.horarioTexto}{isNow&&<span style={{marginLeft:8,fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:3,background:"#f44336",color:"#fff"}}>AO VIVO</span>}</div>
                <div style={{fontSize:18,fontWeight:700,color:isNow?"#fff":"#ddd",lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:isLong?2:3,WebkitBoxOrient:"vertical"}}>{prog.nome}{isLong&&<div style={{fontSize:16,marginTop:4}}>{prog.nome}</div>}</div>
              </div>;
            })}
            {sched.length===0 && <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#555",fontSize:13}}>Sem programação</div>}
          </div>;
        })}
      </div>
    </div>
    <div style={{background:"rgba(16,18,26,0.98)",padding:"10px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"#666"}}>
      <button onClick={()=>scroll(-1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:12}}>← Anterior</button>
      <div style={{display:"flex",gap:24}}><span>↑↓ = Canal</span><span>ESC = Fechar</span><span>G = Guia</span></div>
      <button onClick={()=>scroll(1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:12}}>Próximo →</button>
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

  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.92)",overflowY:"auto"}}>
    <div onClick={e=>e.stopPropagation()} style={{maxWidth:720,margin:"0 auto",padding:20,minHeight:"100vh"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,position:"sticky",top:0,background:"rgba(0,0,0,0.95)",padding:"16px 0",zIndex:5}}>
        <div><div style={{fontSize:20,fontWeight:700,color:"#fff"}}>📺 Programação Completa</div><div style={{fontSize:12,color:"#888",marginTop:2}}>{new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div></div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",width:40,height:40,borderRadius:"50%",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:8}}>
        {channels.map(c => <button key={c.id} onClick={()=>setVCh(c.id)} style={{padding:"10px 18px",borderRadius:6,cursor:"pointer",flexShrink:0,background:viewCh===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:viewCh===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:viewCh===c.id?"#fff":"#888",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}><ChLogo ch={c} size={18}/> {c.nome}</button>)}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {sched.length===0 && <div style={{padding:40,textAlign:"center",color:"#555"}}>Sem programação para este canal hoje. Adicione programas no <a href="/admin" style={{color:"#4fc3f7"}}>painel admin</a>.</div>}
        {sched.filter(p=>p.horarioFim<=86400).map(prog => {
          const isNow=ns>=prog.horarioInicio&&ns<prog.horarioFim;
          const isPast=ns>=prog.horarioFim;
          return <div key={prog.id} onClick={()=>onProgramClick(prog)} style={{display:"flex",gap:14,padding:"16px 18px",borderRadius:10,cursor:"pointer",background:isNow?"rgba(26,115,232,0.15)":isPast?"rgba(255,255,255,0.015)":"rgba(255,255,255,0.04)",border:isNow?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.06)",opacity:isPast?0.45:1,transition:"all 0.2s"}}>
            <div style={{minWidth:75,textAlign:"center",paddingTop:2}}><div style={{fontSize:18,fontWeight:700,color:isNow?"#4fc3f7":"#fff"}}>{prog.horarioTexto}</div><div style={{fontSize:11,color:"#555",marginTop:2}}>{prog.horarioFimTexto}</div>{isNow&&<div style={{marginTop:6}}><LiveDot/></div>}</div>
            <div style={{width:3,borderRadius:2,background:isNow?ch.cor:"rgba(255,255,255,0.08)",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}><span style={{fontSize:16,fontWeight:600,color:isNow?"#fff":"#ccc"}}>{prog.nome}</span><Badge c={prog.classificacao}/>{prog.tags?.map(t => <Tag key={t} t={t}/>)}</div>
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
function ProgModal({program,channel,onClose}){
  if(!program) return null;
  const isNow=getNow()>=program.horarioInicio&&getNow()<program.horarioFim;
  const isFut=getNow()<program.horarioInicio;
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#1a1c24",borderRadius:10,maxWidth:500,width:"100%",border:"1px solid rgba(255,255,255,0.1)",overflow:"hidden"}}>
      <div style={{height:140,background:`linear-gradient(135deg,${channel?.cor||"#333"}33,#0a0c12)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
        <ChLogo ch={channel||{logo:"📺"}} size={64}/>
        <div style={{position:"absolute",top:12,right:12,display:"flex",gap:4}}><Badge c={program.classificacao}/>{program.tags?.map(t => <Tag key={t} t={t}/>)}</div>
        {isNow&&<div style={{position:"absolute",top:12,left:12}}><LiveDot/></div>}
      </div>
      <div style={{padding:24}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}><span style={{fontSize:12,color:channel?.cor}}>{channel?.nome}</span></div>
        <div style={{fontSize:22,fontWeight:700,color:"#fff",marginBottom:8}}>{program.nome}</div>
        <div style={{fontSize:13,color:"#999",lineHeight:1.6,marginBottom:16}}>{program.sinopse}</div>
        <div style={{display:"flex",gap:16,fontSize:12,color:"#666",marginBottom:16}}><span>⏰ {program.horarioTexto} - {program.horarioFimTexto}</span><span>⏱ {fD(program.duracao)}</span></div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>shareProgram(program,channel)} style={{flex:1,padding:10,background:"rgba(76,175,80,0.15)",border:"1px solid rgba(76,175,80,0.3)",borderRadius:6,color:"#4caf50",cursor:"pointer",fontSize:12,fontWeight:600}}>📤 Compartilhar</button>
          {isFut&&<button onClick={()=>scheduleNotif(program,channel)} style={{flex:1,padding:10,background:"rgba(255,152,0,0.15)",border:"1px solid rgba(255,152,0,0.3)",borderRadius:6,color:"#ff9800",cursor:"pointer",fontSize:12,fontWeight:600}}>🔔 Lembrete</button>}
          <button onClick={onClose} style={{flex:1,padding:10,background:"rgba(26,115,232,0.2)",border:"1px solid rgba(26,115,232,0.3)",borderRadius:6,color:"#4fc3f7",cursor:"pointer",fontSize:12,fontWeight:600}}>Fechar</button>
        </div>
      </div>
    </div>
  </div>;
}

// ============================================
// MAIN APP
// ============================================
export default function TVWeb(){
  const [channels, setChannels] = useState([]);
  const [allPrograms, setAllPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [curCh, setCurCh] = useState(null);
  const [showEPG, setEPG] = useState(false);
  const [showFull, setFull] = useState(false);
  const [showInfo, setInfo] = useState(true);
  const [selProg, setSP] = useState(null);
  const [showBlur, setShowBlur] = useState(true);
  
  useEffect(() => {
    const timer = setTimeout(() => setShowBlur(false), 7000);
    return () => clearTimeout(timer);
  }, []);
  const hRef=useRef(null); const cRef=useRef(null); const wRef=useRef(null);

  // ========== FIREBASE REAL-TIME ==========
  useEffect(() => {
    const unsubCh = onSnapshot(collection(db, "channels"), (snap) => {
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const sorted = list.sort((a,b) => (a.numero||0) - (b.numero||0));
      if (sorted.length > 0) {
        setChannels(sorted);
        setCurCh(prev => prev || sorted[0].id);
      } else {
        setChannels(FALLBACK_CHANNELS);
        setCurCh("_info");
      }
    });

    const unsubPr = onSnapshot(collection(db, "programs"), (snap) => {
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      if (list.length > 0) {
        setAllPrograms(list);
      } else {
        setAllPrograms(FALLBACK_PROGRAMS);
      }
      setLoading(false);
    });

    return () => { unsubCh(); unsubPr(); };
  }, []);

  // ========== DERIVED STATE ==========
  const CHANNELS = channels;
  const ch = CHANNELS.find(c=>c.id===curCh) || CHANNELS[0];
  const schedule = ch ? buildSchedule(allPrograms, ch.id) : [];
  const cp = getCurProg(schedule);
  const ci = schedule.findIndex(p=>p.id===cp?.id);
  const np = ci>=0 ? schedule[ci+1] : null;

  // ========== YOUTUBE IFRAME (stable - only recalculates on program change) ==========
  const ytVideoId = cp ? extractYTId(cp.youtubeId || cp.videos?.[0]?.youtubeUrl) : null;
  const ytKey = `${curCh}_${cp?.id || "none"}_${allPrograms.length}`;
  const [muted, setMuted] = useState(true);

  const ytStartRef = useRef(0);
  const ytKeyRef = useRef("");
  const lastClickTimeRef = useRef(0);

  // Sync YouTube start position when program changes
  useEffect(() => {
    ytKeyRef.current = ytKey;
    ytStartRef.current = cp ? Math.max(0, Math.floor(getElapsed(cp))) : 0;
  }, [ytKey, cp]);

  const ytSrc = ytVideoId
    ? `https://www.youtube.com/embed/${ytVideoId}?autoplay=1&mute=${muted?1:0}&start=${ytStartRef.current}&controls=0&disablekb=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&fs=0&playsinline=1&enablejsapi=1`
    : null;

  // Unmute handler - recalculates start position
  const handleUnmute = useCallback(() => {
    if (cp) ytStartRef.current = Math.max(0, Math.floor(getElapsed(cp)));
    ytKeyRef.current = ytKeyRef.current + "_unmuted";
    setMuted(false);
  }, [cp]);

  // ========== CHANNEL SWITCHING ==========
  const swCh = useCallback(id => {
    if(id===curCh) return;
    setFade(true);
    setTimeout(()=>{setCurCh(id);setFade(false)},300);
    setInfo(true); rHide();
  },[curCh]);

  const swDir = useCallback(dir => {
    const i=CHANNELS.findIndex(c=>c.id===curCh);
    if(i<0) return;
    let n;
    if(dir>0) n=i<CHANNELS.length-1?CHANNELS[i+1].id:CHANNELS[0].id;
    else n=i>0?CHANNELS[i-1].id:CHANNELS[CHANNELS.length-1].id;
    swCh(n);
  },[curCh,CHANNELS,swCh]);

  const rHide = useCallback(()=>{
    clearTimeout(hRef.current);
    setInfo(true);
    hRef.current=setTimeout(()=>{if(!showEPG&&!showFull)setInfo(false)},5000);
  },[showEPG,showFull]);

  useEffect(()=>{rHide();return()=>clearTimeout(hRef.current)},[]);

  // Keyboard
  useEffect(()=>{const h=e=>{if(e.key==="ArrowUp")swDir(-1);else if(e.key==="ArrowDown")swDir(1);else if(e.key==="Escape"){setEPG(false);setFull(false);setSP(null)}else if(e.key==="g"||e.key==="G"){if(showFull){setFull(false);setEPG(true)}else if(showEPG)setEPG(false);else setEPG(true)}rHide()};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[swDir,rHide,showEPG,showFull]);

  // Mouse wheel
  const handleWheel=useCallback(e=>{if(showEPG||showFull)return;if(wRef.current)return;wRef.current=setTimeout(()=>{wRef.current=null},400);swDir(e.deltaY>0?1:-1)},[swDir,showEPG,showFull]);
  
  const handleClick = useCallback(() => {
    const now = Date.now();
    // Double click = fullscreen
    if (now - lastClickTimeRef.current < 300) {
      if (!document.fullscreenElement) cRef.current?.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
    lastClickTimeRef.current = now;
    
    // Any click unmutes or closes EPG
    if (showEPG) { setEPG(false); return; }
    if (muted) handleUnmute();
    else rHide();
  }, [showEPG, muted, handleUnmute, rHide]);

  // ========== LOADING ==========
  if (loading) return <div style={{width:"100%",height:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontFamily:"system-ui",fontSize:16}}>
    <div style={{textAlign:"center"}}><div style={{fontSize:48,marginBottom:16}}>📺</div>Carregando TVWEB...</div>
  </div>;

  if (!ch) return null;

  // ========== RENDER ==========
  return <div ref={cRef} onWheel={handleWheel} onMouseMove={rHide}
    style={{width:"100%",height:"100vh",background:"#000",position:"relative",fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",overflow:"hidden",cursor:"default",userSelect:"none"}}>

    {/* TV SCREEN */}
    <div onClick={handleClick} style={{position:"absolute",inset:0,background:"#000",transition:"opacity 0.5s",opacity:fade?0:1}}>
      {/* YouTube Player */}
      {ytSrc && !cp?.isPlaceholder ? (
        <div style={{position:"absolute",inset:0}}>
          <iframe
            key={ytKeyRef.current}
            src={ytSrc}
            allow="autoplay; encrypted-media"
            allowFullScreen={false}
            style={{width:"100%",height:"100%",border:"none",pointerEvents:"none"}}
            title={cp?.nome || "TVWEB"}
          />
          {/* Transparent overlay to block interaction (no pause/seek) */}
          <div style={{position:"absolute",inset:0,zIndex:2}} />
          {/* Unmute button */}
          {muted && (
            <button onClick={handleUnmute} style={{
              position:"absolute",bottom:showInfo?200:30,left:"50%",transform:"translateX(-50%)",zIndex:5,
              background:"rgba(0,0,0,0.8)",border:"1px solid rgba(255,255,255,0.2)",
              color:"#fff",padding:"10px 24px",borderRadius:24,cursor:"pointer",
              fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:8,
              animation:"pulseFull 2s ease infinite",
            }}>🔇 Clique para ativar o som</button>
          )}
        </div>
      ) : (
        /* Fallback - "Voltamos já" or no channel */
        <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse at center,${ch.cor||"#1a73e8"}15,#0a0c12 70%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {cp?.isPlaceholder ? (
            // "Voltamos já" slide
            <div style={{textAlign:"center",maxWidth:600}}>
              <div style={{fontSize:140,marginBottom:30,opacity:0.8}}>📺</div>
              <div style={{fontSize:48,fontWeight:700,color:"#fff",marginBottom:16}}>Voltamos já!</div>
              <div style={{fontSize:18,color:"#999",marginBottom:30}}>Programação em breve</div>
              <div style={{display:"flex",gap:12,justifyContent:"center",fontSize:12,color:"#666"}}>
                <span>⏱ {cp?.duracao ? fD(cp.duracao) : "em breve"}</span>
              </div>
            </div>
          ) : (
            // Channel logo fallback
            <div style={{textAlign:"center",opacity:0.15}}><div style={{fontSize:100}}><ChLogo ch={ch} size={100}/></div><div style={{fontSize:24,color:"#fff",marginTop:8,fontWeight:700}}>{ch.nome}</div></div>
          )}
        </div>
      )}
      {/* Watermark */}
      <div style={{position:"absolute",top:16,right:20,fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.15)",letterSpacing:2,zIndex:3,textShadow:"0 1px 3px rgba(0,0,0,0.8)"}}>TVWEB</div>
      {/* Channel indicator - LARGER on channel change */}
      {showInfo && <div style={{position:"absolute",top:20,left:20,background:"rgba(0,0,0,0.7)",padding:"8px 16px",borderRadius:6,border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",gap:12,zIndex:3,animation:"slideDown 0.4s ease"}}><span style={{fontSize:32,fontWeight:700,color:"#fff"}}>{ch.numero}</span><div><div style={{fontSize:16,fontWeight:700,color:ch.cor}}>{ch.nome}</div><div style={{fontSize:12,color:"#aaa",marginTop:2}}>Canal {ch.numero}</div></div></div>}
    </div>

    {showInfo && <FsBtn cRef={cRef}/>}
    {showInfo&&!showEPG&&!showFull && <div style={{position:"absolute",left:20,top:"50%",transform:"translateY(-50%)",zIndex:15,display:"flex",flexDirection:"column",alignItems:"center",gap:4,opacity:0.5}}><span style={{fontSize:16,color:"#888"}}>▲</span><span style={{writingMode:"vertical-lr",letterSpacing:2,fontSize:9,color:"#888"}}>SCROLL</span><span style={{fontSize:16,color:"#888"}}>▼</span></div>}
    {showInfo&&!showEPG&&!showFull && <InfoBar channel={ch} program={cp} nextProgram={np} onOpenEPG={()=>setEPG(true)} onOpenFull={()=>setFull(true)}/>}

    <div style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",zIndex:15,display:"flex",flexDirection:"column",gap:4,opacity:showInfo&&!showEPG&&!showFull?0.7:0,transition:"opacity 0.3s"}}>
      {CHANNELS.map(c => <div key={c.id} onClick={()=>swCh(c.id)} style={{width:36,height:36,borderRadius:4,background:c.id===curCh?"rgba(26,115,232,0.3)":"rgba(0,0,0,0.4)",border:c.id===curCh?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden"}}><ChLogo ch={c} size={c.logoType==="custom"?36:20}/></div>)}
    </div>

    {/* Dark blur on top of screen - hides YouTube info */}
    {showBlur && <div style={{position:"absolute",top:0,left:0,right:0,height:200,background:"linear-gradient(180deg, rgba(0,0,0,0.9) 0%, transparent 100%)",zIndex:6,backdropFilter:"blur(8px)",transition:"opacity 0.5s",opacity:showBlur?1:0,pointerEvents:"none"}}/>}

    {/* Dark blur behind EPG */}
    {showBlur && showEPG && <div style={{position:"absolute",bottom:0,left:0,right:0,height:400,background:"rgba(0,0,0,0.7)",zIndex:19,backdropFilter:"blur(4px)",transition:"opacity 0.5s",pointerEvents:"none"}}/>}

    {showEPG && <EPGCompact channels={CHANNELS} allPrograms={allPrograms} currentChannelId={curCh} onSelectChannel={swCh} onSelectProgram={setSP} onOpenFull={()=>{setEPG(false);setFull(true)}} onClose={()=>setEPG(false)}/>}
    {showFull && <FullDay channels={CHANNELS} allPrograms={allPrograms} currentChannelId={curCh} onClose={()=>setFull(false)} onProgramClick={setSP}/>}
    {selProg && <ProgModal program={selProg} channel={CHANNELS.find(c=>buildSchedule(allPrograms,c.id).some(p=>p.id===selProg.id))||ch} onClose={()=>setSP(null)}/>}

    <style>{`
      @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes slideDown{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes pulseFull{0%,100%{opacity:.6;transform:translateX(-50%) scale(1)}50%{opacity:1;transform:translateX(-50%) scale(1.05)}}
      ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
      *{box-sizing:border-box;margin:0;padding:0}
    `}</style>
  </div>;
}

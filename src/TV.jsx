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
function getToday(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
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

// ─────────────────────────────────────────────────────────────────
// buildMultiDaySchedule — gera programação contínua de DAYS dias
// a partir de hoje, em "segundos absolutos" (dia 0 = hoje 00:00).
// Retorna itens com: absStart, absEnd, dateLabel (ex: "Qua 25/6")
// ─────────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
function dayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const ds = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  return `${ds[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
}
function buildMultiDaySchedule(programs, channelId, days = 3) {
  const today = getToday();
  const result = [];
  for (let d = 0; d < days; d++) {
    const dateStr  = addDays(today, d);
    const offset   = d * 86400; // segundos do início deste dia no timeline absoluto
    const dayProgs = programs
      .filter(p => p.canalId === channelId && p.data === dateStr)
      .sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio))
      .map(p => ({
        ...p,
        horarioInicio: Number(p.horarioInicio),
        horarioFim:    Number(p.horarioFim),
        duracao:       Number(p.duracao),
        absStart:      offset + Number(p.horarioInicio),
        absEnd:        offset + Number(p.horarioFim),
        horarioTexto:  fmtHM(Number(p.horarioInicio)),
        horarioFimTexto: fmtHM(Number(p.horarioFim)),
        dateLabel:     dayLabel(dateStr),
        dayOffset:     d,
      }));
    // Preenche gaps com "Voltamos já"
    const withGaps = [];
    let cur = 0;
    for (let i = 0; i < dayProgs.length; i++) {
      while (cur < dayProgs[i].horarioInicio) {
        const gapEnd = Math.min(cur + 600, dayProgs[i].horarioInicio);
        withGaps.push({ ...VOLTAMOS_JA,
          id:`_gap_${d}_${cur}`, isPlaceholder:true,
          horarioInicio:cur, horarioFim:gapEnd, duracao:gapEnd-cur,
          absStart:offset+cur, absEnd:offset+gapEnd,
          horarioTexto:fmtHM(cur), horarioFimTexto:fmtHM(gapEnd),
          dateLabel:dayLabel(dateStr), dayOffset:d,
        });
        cur = gapEnd;
      }
      withGaps.push(dayProgs[i]);
      cur = dayProgs[i].horarioFim;
    }
    // Gap final até meia-noite
    while (cur < 86400) {
      const gapEnd = Math.min(cur + 600, 86400);
      withGaps.push({ ...VOLTAMOS_JA,
        id:`_gap_${d}_end_${cur}`, isPlaceholder:true,
        horarioInicio:cur, horarioFim:gapEnd, duracao:gapEnd-cur,
        absStart:offset+cur, absEnd:offset+gapEnd,
        horarioTexto:fmtHM(cur), horarioFimTexto:fmtHM(gapEnd),
        dateLabel:dayLabel(dateStr), dayOffset:d,
      });
      cur = gapEnd;
    }
    result.push(...withGaps);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// getVideoList — retorna lista de { id, titulo, duracao }
// Prioriza videos[], fallback para youtubeId.
// ─────────────────────────────────────────────────────────────
function getVideoList(prog) {
  if (!prog) return [];
  const fromArray = (prog.videos || [])
    .map(v => ({
      id:     extractYTId(v?.youtubeUrl || v?.url || ""),
      titulo: v?.titulo || "",
      duracao: Number(v?.duracao || 0),
    }))
    .filter(v => v.id);
  if (fromArray.length > 0) return fromArray;
  const single = extractYTId(prog.youtubeId);
  return single ? [{ id: single, titulo: prog.nome || "", duracao: Number(prog.duracao || 0) }] : [];
}

// Dado o tempo decorrido no programa e a lista de vídeos,
// retorna { index, startInVideo } — qual vídeo está tocando e em que segundo.
function resolveVideoIndex(videoList, elapsedInProg) {
  if (!videoList.length) return { index: 0, startInVideo: 0 };
  let acc = 0;
  for (let i = 0; i < videoList.length; i++) {
    const dur = videoList[i].duracao || 0;
    // Se não há duração cadastrada (0), assume que está no i-ésimo vídeo
    if (dur === 0 || elapsedInProg < acc + dur || i === videoList.length - 1) {
      return { index: i, startInVideo: Math.max(0, elapsedInProg - acc) };
    }
    acc += dur;
  }
  return { index: videoList.length - 1, startInVideo: 0 };
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
function OSDHeader({channel,program,visible,videoIndex,videoTotal,episodioTitulo}){
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
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
            <span style={{fontSize:20,fontWeight:700,color:"#fff"}}>{program.nome}</span>
            {videoTotal > 1 && (
              <span style={{fontSize:12,fontWeight:700,padding:"3px 9px",borderRadius:4,
                background:"rgba(156,39,176,0.45)",border:"1px solid rgba(156,39,176,0.7)",
                color:"#e1bee7",letterSpacing:0.3}}>
                Ep {videoIndex + 1}/{videoTotal}
              </span>
            )}
          </div>
          {/* Título do episódio (quando diferente do nome do programa) */}
          {videoTotal > 1 && episodioTitulo && episodioTitulo !== program.nome && (
            <div style={{fontSize:14,color:"#ce93d8",marginBottom:2,
              maxWidth:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {episodioTitulo}
            </div>
          )}
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
  const scrollRef  = useRef(null);
  const RULER_H    = 36;
  const ROW_H      = 82;
  const PX_PER_SEC = 0.11;  // ~396px/hora
  const EPG_DAYS   = 3;     // hoje + amanhã + depois

  // Relógio reativo
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // Segundos desde meia-noite LOCAL (hoje = dia 0)
  const nowSec    = clock.getHours()*3600 + clock.getMinutes()*60 + clock.getSeconds();
  // "Agora" em segundos absolutos no timeline multi-dia
  const nowAbs    = nowSec; // dia 0 começa em 0, dia 1 em 86400, etc.

  // A régua começa 20 min antes do agora e vai até EPG_DAYS*86400
  const LOOK_BACK  = 20 * 60;
  const rulerStart = Math.max(0, nowAbs - LOOK_BACK);
  const rulerEnd   = EPG_DAYS * 86400;
  const totalW     = (rulerEnd - rulerStart) * PX_PER_SEC;

  // Converte segundos absolutos → pixels
  const absToPx = (abs) => (Number(abs) - rulerStart) * PX_PER_SEC;
  // Pixel da linha AGORA
  const nowPx   = absToPx(nowAbs);

  // Scroll inicial: AGORA fica na borda esquerda
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trava scroll para não voltar antes do rulerStart
  const handleScroll = useCallback(() => {
    if (scrollRef.current && scrollRef.current.scrollLeft < 0)
      scrollRef.current.scrollLeft = 0;
  }, []);

  const scrollNext = () => {
    if (scrollRef.current) scrollRef.current.scrollLeft += 300;
  };

  const sortedChannels = useMemo(() => [
    ...channels.filter(ch => ch.id === currentChannelId),
    ...channels.filter(ch => ch.id !== currentChannelId),
  ], [channels, currentChannelId]);

  // Marcações horárias: uma por hora no range visível
  // Inclui meia-hora como marcação menor
  const rulerMarks = useMemo(() => {
    const marks = [];
    // Começa na hora cheia seguinte ao rulerStart
    const firstHour = Math.ceil(rulerStart / 3600);
    for (let abs = firstHour * 3600; abs < rulerEnd; abs += 1800) {
      const isFullHour = abs % 3600 === 0;
      const dayNum     = Math.floor(abs / 86400);
      const secInDay   = abs % 86400;
      marks.push({ abs, isFullHour, dayNum, secInDay });
    }
    return marks;
  }, [rulerStart, rulerEnd]);

  // Separadores de dia (meia-noite de cada dia seguinte)
  const daySeparators = useMemo(() => {
    const seps = [];
    for (let d = 1; d < EPG_DAYS; d++) {
      seps.push({ abs: d * 86400, label: dayLabel(addDays(getToday(), d)) });
    }
    return seps;
  }, []);

  return (
    <div onClick={e => e.stopPropagation()}
      style={{position:"absolute",bottom:0,left:0,right:0,zIndex:20,animation:"slideUp 0.3s ease"}}>

      {/* ── HEADER ── */}
      <div style={{background:"rgba(10,12,18,0.98)",borderTop:"1px solid rgba(255,255,255,0.1)",
        padding:"9px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:18,fontWeight:800,color:"#fff",letterSpacing:2}}>GUIA</span>
          <LiveDot/>
          <span style={{fontSize:18,fontWeight:700,color:"#4fc3f7"}}>
            {String(clock.getHours()).padStart(2,"0")}:{String(clock.getMinutes()).padStart(2,"0")}:{String(clock.getSeconds()).padStart(2,"0")}
          </span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {/* Indicador de dias visíveis */}
          <span style={{fontSize:11,color:"#555",marginRight:4}}>
            Hoje · Amanhã · {dayLabel(addDays(getToday(), 2)).split(" ")[0]}
          </span>
          <button onClick={onOpenFull}
            style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",
              color:"#4fc3f7",padding:"7px 16px",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600}}>
            📺 Ver Completa
          </button>
          <button onClick={onClose}
            style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
              color:"#aaa",width:34,height:34,borderRadius:"50%",cursor:"pointer",fontSize:16,
              display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>

      {/* ── CORPO ── */}
      <div style={{background:"rgba(10,12,18,0.98)",display:"flex",
        overflow:"hidden",maxHeight:"58vh",minHeight:280}}>

        {/* Coluna fixa de canais */}
        <div style={{width:130,borderRight:"1px solid rgba(255,255,255,0.08)",
          flexShrink:0,background:"rgba(10,12,18,0.98)"}}>
          <div style={{height:RULER_H,borderBottom:"1px solid rgba(255,255,255,0.07)"}}/>
          {sortedChannels.map(ch => {
            const isCur = ch.id === currentChannelId;
            return (
              <div key={ch.id} onClick={() => onSelectChannel(ch.id)}
                style={{height:ROW_H,display:"flex",alignItems:"center",justifyContent:"center",
                  cursor:"pointer",
                  borderBottom:"1px solid rgba(255,255,255,0.05)",
                  background:isCur?"rgba(26,115,232,0.13)":"rgba(14,16,24,0.6)",
                  borderLeft:isCur?"3px solid #1a73e8":"3px solid transparent"}}>
                <div style={{textAlign:"center"}}>
                  <ChLogo ch={ch} size={32}/>
                  <div style={{fontSize:10,fontWeight:600,marginTop:3,
                    color:isCur?"#fff":"#666",maxWidth:90,overflow:"hidden",
                    textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ch.nome}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Grid scrollável */}
        <div ref={scrollRef} onScroll={handleScroll}
          style={{flex:1,overflowX:"auto",overflowY:"hidden",position:"relative"}}>

          {/* ── RÉGUA ── */}
          <div style={{position:"relative",height:RULER_H,width:totalW,
            borderBottom:"1px solid rgba(255,255,255,0.08)",
            background:"rgba(10,12,18,0.98)",flexShrink:0}}>

            {/* Separadores de dia na régua — faixa colorida + label */}
            {daySeparators.map(({abs, label}) => {
              const x = absToPx(abs);
              return (
                <div key={abs} style={{position:"absolute",left:x,top:0,bottom:0,
                  borderLeft:"2px solid rgba(26,115,232,0.5)",zIndex:3,pointerEvents:"none"}}>
                  <div style={{position:"absolute",top:0,left:3,
                    fontSize:10,fontWeight:700,color:"#4fc3f7",
                    background:"rgba(10,12,18,0.95)",padding:"2px 6px",
                    borderRadius:"0 0 4px 0",whiteSpace:"nowrap",lineHeight:`${RULER_H}px`}}>
                    {label}
                  </div>
                </div>
              );
            })}

            {/* Marcações horárias */}
            {rulerMarks.map(({abs, isFullHour, secInDay}) => {
              const x = absToPx(abs);
              // Não renderiza label se colidirá com separador de dia (< 40px de distância)
              const nearSep = daySeparators.some(s => Math.abs(absToPx(s.abs) - x) < 45);
              return (
                <div key={abs} style={{position:"absolute",left:x,top:0,bottom:0,
                  borderLeft:isFullHour
                    ? "1px solid rgba(255,255,255,0.1)"
                    : "1px solid rgba(255,255,255,0.04)"}}>
                  {isFullHour && !nearSep && (
                    <span style={{fontSize:11,fontWeight:600,
                      color:"rgba(255,255,255,0.45)",
                      padding:"0 5px",lineHeight:`${RULER_H}px`,
                      whiteSpace:"nowrap",display:"block"}}>
                      {String(Math.floor(secInDay/3600)).padStart(2,"0")}:00
                    </span>
                  )}
                </div>
              );
            })}

            {/* Marcação de meia-hora em cinza muito sutil */}
            {rulerMarks.filter(m => !m.isFullHour).map(({abs, secInDay}) => {
              const x = absToPx(abs);
              return (
                <div key={`hf_${abs}`} style={{position:"absolute",left:x,top:"60%",bottom:0}}>
                  <span style={{fontSize:8,color:"rgba(255,255,255,0.2)",
                    padding:"0 3px",display:"block",whiteSpace:"nowrap"}}>
                    {String(Math.floor(secInDay/3600)).padStart(2,"0")}:30
                  </span>
                </div>
              );
            })}

            {/* Linha vermelha AGORA */}
            <div style={{position:"absolute",top:0,left:nowPx,width:2,
              bottom:-(ROW_H * sortedChannels.length),
              background:"#e53935",zIndex:10,
              boxShadow:"0 0 6px rgba(229,57,53,0.7)",pointerEvents:"none"}}>
              <div style={{position:"absolute",top:-6,left:-5,width:0,height:0,
                borderLeft:"6px solid transparent",borderRight:"6px solid transparent",
                borderTop:"8px solid #e53935"}}/>
            </div>
          </div>

          {/* ── LINHAS DE CANAL ── */}
          {sortedChannels.map(ch => {
            const isCurrent  = ch.id === currentChannelId;
            const multiSched = buildMultiDaySchedule(allPrograms, ch.id, EPG_DAYS);
            const cur        = getCurProg(buildSchedule(allPrograms, ch.id));

            // Filtra: só programas visíveis no range (não placeholders, não encerrados)
            const visible = multiSched.filter(p =>
              !p.isPlaceholder &&
              p.absEnd > nowAbs &&
              p.absStart < rulerEnd
            );

            return (
              <div key={ch.id} style={{
                position:"relative",height:ROW_H,width:totalW,
                borderBottom:"1px solid rgba(255,255,255,0.05)",
                background:isCurrent?"rgba(26,115,232,0.04)":"rgba(12,14,22,0.5)",
              }}>

                {/* Separadores de dia nas faixas de canal */}
                {daySeparators.map(({abs, label}) => {
                  const x = absToPx(abs);
                  return (
                    <div key={abs} style={{position:"absolute",left:x,top:0,bottom:0,
                      width:2,background:"rgba(26,115,232,0.25)",zIndex:5,pointerEvents:"none"}}/>
                  );
                })}

                {visible.map(prog => {
                  const isNow      = cur?.id === prog.id || cur?.id === prog.id?.replace(/_rep\d+$/, "");
                  const visualLeft = isNow ? nowPx : Math.max(0, absToPx(prog.absStart));
                  const visualW    = Math.max(absToPx(prog.absEnd) - visualLeft, 48);

                  const pct = isNow
                    ? Math.min(100, ((nowAbs - prog.absStart) / (prog.absEnd - prog.absStart)) * 100)
                    : 0;

                  // Mostra o label do dia dentro do bloco se ele atravessa a meia-noite
                  const showDayLabel = prog.dayOffset > 0 && absToPx(prog.absStart) >= 0;

                  return (
                    <div key={prog.id}
                      onClick={() => { onSelectChannel(ch.id); onSelectProgram(prog); }}
                      style={{
                        position:"absolute",left:visualLeft,width:visualW,
                        top:3,bottom:3,
                        cursor:"pointer",overflow:"hidden",borderRadius:3,
                        background: isNow
                          ? isCurrent ? "rgba(48,62,88,1)" : "rgba(32,40,60,1)"
                          : prog.dayOffset === 1
                            ? isCurrent ? "rgba(26,34,52,0.9)" : "rgba(18,22,38,0.85)"
                            : prog.dayOffset === 2
                              ? isCurrent ? "rgba(22,28,46,0.85)" : "rgba(15,18,32,0.8)"
                              : isCurrent ? "rgba(28,34,50,0.9)"  : "rgba(20,24,38,0.85)",
                        borderLeft: isNow
                          ? "3px solid #e53935"
                          : "1px solid rgba(255,255,255,0.05)",
                        borderTop:"1px solid rgba(255,255,255,0.05)",
                        borderRight:"1px solid rgba(255,255,255,0.04)",
                        borderBottom:"1px solid rgba(255,255,255,0.03)",
                        boxSizing:"border-box",transition:"background 0.12s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = isNow
                        ? "rgba(60,78,112,1)"
                        : "rgba(38,46,68,0.95)"}
                      onMouseLeave={e => e.currentTarget.style.background = isNow
                        ? isCurrent ? "rgba(48,62,88,1)" : "rgba(32,40,60,1)"
                        : prog.dayOffset === 1
                          ? isCurrent ? "rgba(26,34,52,0.9)" : "rgba(18,22,38,0.85)"
                          : prog.dayOffset === 2
                            ? isCurrent ? "rgba(22,28,46,0.85)" : "rgba(15,18,32,0.8)"
                            : isCurrent ? "rgba(28,34,50,0.9)"  : "rgba(20,24,38,0.85)"}
                    >
                      {/* Barra de progresso no bloco ao vivo */}
                      {isNow && (
                        <div style={{position:"absolute",bottom:0,left:0,height:2,
                          width:`${pct}%`,background:"#e53935",
                          transition:"width 1s linear",borderRadius:"0 1px 0 0"}}/>
                      )}

                      <div style={{padding:"5px 8px 4px 9px"}}>
                        {/* Horário */}
                        <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
                          <span style={{fontSize:10,fontWeight:600,
                            color:isNow?"#ef9a9a":"#777"}}>
                            {prog.horarioTexto}
                          </span>
                          <span style={{fontSize:9,color:"#444"}}>–</span>
                          <span style={{fontSize:10,color:"#555"}}>
                            {prog.horarioFimTexto}
                          </span>
                          {isNow && (
                            <span style={{fontSize:8,fontWeight:800,
                              padding:"1px 4px",borderRadius:2,
                              background:"#c62828",color:"#fff",letterSpacing:0.3}}>
                              AO VIVO
                            </span>
                          )}
                          {/* Badge do dia no bloco (amanhã / depois) */}
                          {!isNow && prog.dayOffset > 0 && visualW > 120 && (
                            <span style={{fontSize:8,fontWeight:700,
                              padding:"1px 4px",borderRadius:2,
                              background:"rgba(26,115,232,0.3)",
                              border:"1px solid rgba(26,115,232,0.4)",
                              color:"#90caf9",marginLeft:2}}>
                              {prog.dayOffset === 1 ? "amanhã" : prog.dateLabel.split(" ")[0]}
                            </span>
                          )}
                        </div>
                        {/* Nome */}
                        <div style={{fontSize:13,fontWeight:isNow?700:600,
                          color:isNow?"#fff":prog.dayOffset>0?"#aaa":"#ccc",
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                          lineHeight:1.25}}>
                          {prog.nome}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {buildSchedule(allPrograms, ch.id).length === 0 && (
                  <div style={{position:"absolute",inset:0,display:"flex",
                    alignItems:"center",paddingLeft:12,color:"#333",fontSize:11}}>
                    Sem programação
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{background:"rgba(10,12,18,0.98)",padding:"8px 16px",
        borderTop:"1px solid rgba(255,255,255,0.06)",
        display:"flex",justifyContent:"space-between",alignItems:"center",
        fontSize:11,color:"#555"}}>
        <div style={{display:"flex",gap:20}}>
          <span>↑↓ = Canal</span>
          <span>ESC = Fechar</span>
          <span>G = Guia</span>
        </div>
        <button onClick={scrollNext}
          style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
            color:"#aaa",padding:"7px 20px",borderRadius:4,cursor:"pointer",
            fontSize:12,fontWeight:600}}>
          Próximo →
        </button>
      </div>
    </div>
  );
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
          return <div key={prog.id} style={{display:"flex",gap:14,padding:"16px 18px",borderRadius:10,background:isNow?"rgba(26,115,232,0.15)":isPast?"rgba(255,255,255,0.015)":"rgba(255,255,255,0.04)",border:isNow?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.06)",opacity:isPast?0.4:1,transition:"all 0.2s"}}>
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
          {/* "Assistir Agora" removido — programação linear, usuário assiste o canal atual */}
          <button onClick={()=>shareProgram(program,channel)} style={{flex:1,padding:12,background:"rgba(76,175,80,0.15)",border:"1px solid rgba(76,175,80,0.3)",borderRadius:6,color:"#4caf50",cursor:"pointer",fontSize:13,fontWeight:600}}>📤 Compartilhar</button>
          {isFut&&<button onClick={()=>scheduleNotif(program,channel)} style={{flex:1,padding:12,background:"rgba(255,152,0,0.15)",border:"1px solid rgba(255,152,0,0.3)",borderRadius:6,color:"#ff9800",cursor:"pointer",fontSize:13,fontWeight:600}}>🔔 Lembrete</button>}
          <button onClick={onClose} style={{flex:1,padding:12,background:"rgba(26,115,232,0.2)",border:"1px solid rgba(26,115,232,0.3)",borderRadius:6,color:"#4fc3f7",cursor:"pointer",fontSize:13,fontWeight:600}}>Fechar</button>
        </div>
      </div>
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────
// usePlayerState — playlist-aware
// • Ao trocar de programa: usa resolveVideoIndex para descobrir
//   qual episódio está no ar agora (usando duração de cada vídeo)
// • nextVideo: avança para o próximo episódio
// • updateMuted: recarrega sem trocar de vídeo
// ─────────────────────────────────────────────────────────────
function usePlayerState(cp, curCh) {
  const videoListRef  = useRef([]);   // [{ id, titulo, duracao }]
  const videoIndexRef = useRef(0);
  const prevProgIdRef = useRef(null);
  const ytKeyRef      = useRef("");
  const [playerState, setPlayerState] = useState({
    ytKey: "", src: null, videoIndex: 0, videoTotal: 0, episodioTitulo: "",
  });

  const buildSrc = useCallback((videoId, startSec, muted) => {
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${muted?1:0}&start=${Math.floor(Math.max(0,startSec))}&controls=0&disablekb=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&fs=0&playsinline=1&enablejsapi=0`;
  }, []);

  // Chamado quando o programa muda — descobre qual episódio está no ar
  const onProgramChange = useCallback((prog, muted) => {
    const list    = getVideoList(prog);
    const elapsed = getElapsed(prog);
    // resolveVideoIndex usa a duração individual de cada vídeo
    // para calcular exatamente qual episódio deve estar tocando
    const { index, startInVideo } = resolveVideoIndex(list, elapsed);

    videoListRef.current  = list;
    videoIndexRef.current = index;
    prevProgIdRef.current = prog.id;
    ytKeyRef.current      = `${curCh}_${prog.id}_${index}_${Date.now()}`;

    setPlayerState({
      ytKey:          ytKeyRef.current,
      src:            buildSrc(list[index]?.id, startInVideo, muted),
      videoIndex:     index,
      videoTotal:     list.length,
      episodioTitulo: list[index]?.titulo || "",
    });
  }, [curCh, buildSrc]);

  // Avança para o próximo episódio (manual ou automático)
  const nextVideo = useCallback((muted) => {
    const list = videoListRef.current;
    const next = videoIndexRef.current + 1;
    if (next >= list.length) return false;

    videoIndexRef.current = next;
    ytKeyRef.current = `${curCh}_${prevProgIdRef.current}_${next}_${Date.now()}`;

    setPlayerState(prev => ({
      ...prev,
      ytKey:          ytKeyRef.current,
      src:            buildSrc(list[next]?.id, 0, muted),
      videoIndex:     next,
      episodioTitulo: list[next]?.titulo || "",
    }));
    return true;
  }, [curCh, buildSrc]);

  // Recarrega src ao desmutar sem trocar de episódio
  const updateMuted = useCallback((muted) => {
    const list    = videoListRef.current;
    const idx     = videoIndexRef.current;
    const videoId = list[idx]?.id;
    if (!videoId) return;
    ytKeyRef.current = ytKeyRef.current + "_um";
    setPlayerState(prev => ({
      ...prev,
      ytKey: ytKeyRef.current,
      src:   buildSrc(videoId, 0, muted),
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
  // Lê ?canal=ID da URL (vindo da Landing Page)
  const _initialCh = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("canal") || null; }
    catch { return null; }
  }, []);
  const [curCh, setCurCh] = useState(_initialCh);
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
  // wRef removido — mouse wheel desativado
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
      else { setChannels(FALLBACK_CHANNELS); setCurCh(prev => prev || "_info"); }
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
  // AUTO VIDEO SWITCH — ao trocar de programa E auto-avanço
  // de episódio dentro de uma playlist.
  // ─ Ao trocar de programa: onProgramChange recalcula qual
  //   episódio deve estar tocando agora via resolveVideoIndex.
  // ─ A cada tick (5s): verifica se o episódio atual terminou
  //   e avança automaticamente para o próximo se necessário.
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

  // ─────────────────────────────────────────────────────────────
  // AUTO-AVANÇO DE EPISÓDIO dentro de playlist (roda a cada tick)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cp || !playerState.ytKey) return;
    const { videoIndex, videoTotal } = playerState;
    if (videoTotal <= 1) return;
    const list    = getVideoList(cp);
    const elapsed = getElapsed(cp);
    const { index: shouldBeIdx } = resolveVideoIndex(list, elapsed);
    if (shouldBeIdx > videoIndex) nextVideo(muted);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // ============================================
  // OSD VISIBILITY
  // ============================================
  const showOSDNow = useCallback(() => {
    clearTimeout(hideTimer.current);
    setOSD(true);
    // Só agenda o auto-hide quando nenhum menu está aberto
    hideTimer.current = setTimeout(() => {
      setOSD(false);
    }, 20000);
  }, []); // showEPG/showFull não entram nas deps: o timer é resetado pelo useEffect abaixo

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
    setPlayerError(false); // limpa erro ao trocar canal
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

  // Mouse wheel desativado — troca de canal só por clique consciente no EPG/sidebar.

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

  // handleNextVideo removido — TV linear, usuário não controla episódios.

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

  const { src: ytSrc, ytKey, videoIndex, videoTotal, episodioTitulo } = playerState;
  const showPlayer = ytSrc && !cp?.isPlaceholder;

  // ============================================
  // RENDER
  // ============================================
  return (
    <div
      ref={cRef}
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

      {/* ===== WATERMARK + HOME BUTTON ===== */}
      <div style={{position:"absolute",top:0,left:0,right:0,zIndex:3,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",pointerEvents:"none"}}>
        {/* Botão Home — só visível com OSD */}
        <a href="/" onClick={e=>{e.stopPropagation();}}
          style={{pointerEvents:"auto",opacity:showOSD&&!showEPG&&!showFull?0.7:0,
            transition:"opacity 0.3s",display:"flex",alignItems:"center",gap:6,
            textDecoration:"none",color:"rgba(255,255,255,0.8)",fontSize:12,fontWeight:700,
            background:"rgba(0,0,0,0.5)",padding:"5px 12px",borderRadius:20,
            border:"1px solid rgba(255,255,255,0.1)"}}>
          🏠 Home
        </a>
        <div style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.12)",letterSpacing:2}}>TVWEB</div>
      </div>

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

      {/* Indicador de episódio — só leitura, sem botão de pular */}
      {videoTotal > 1 && showOSD && !showEPG && !showFull && (
        <div style={{
          position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",zIndex:15,
          background:"rgba(0,0,0,0.6)",border:"1px solid rgba(156,39,176,0.35)",
          color:"#ce93d8",padding:"5px 14px",borderRadius:20,
          fontSize:12,fontWeight:700,pointerEvents:"none",letterSpacing:0.3,
        }}>
          Ep {videoIndex + 1}/{videoTotal}
        </div>
      )}

      {/* ===== OSD HEADER ===== */}
      <OSDHeader
        channel={ch} program={cp}
        visible={showOSD && !showEPG && !showFull}
        videoIndex={videoIndex}
        videoTotal={videoTotal}
        episodioTitulo={episodioTitulo}
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
          onSelectProgram={setSP}   {/* modal só mostra info, não troca conteúdo */}
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
          channel={channels.find(c => c.id === selProg.canalId) || ch}
          onClose={() => setSP(null)}
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

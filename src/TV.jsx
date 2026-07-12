import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, collection, onSnapshot, setDoc, doc } from "./firebase";

// ============================================
// REGRAS FUNDAMENTAIS DO PLAYER — NÃO REMOVER
// ============================================
// 1. SINCRONIZAÇÃO DE VÍDEO: O YouTube SEMPRE respeita o horário da programação.
//    Se o espectador sintoniza às 17h55, o vídeo começa no trecho que corresponde
//    a 17h55 na timeline. Isso é garantido por:
//    - buildSchedule calcula mediaOffset (segundos desde o início real do programa)
//    - ytStartRef = getElapsed(programa) + mediaOffset
//    - O iframe do YouTube recebe ?start=N com esse valor exato
//    - Isso vale para programas normais, maratona (blocos virtuais) e eternity
//
// 2. GC DE MÚSICA (canais com isMusic=true) — LÓGICA CORRIGIDA:
//    - O GC agora é 100% SINCRONIZADO com o tempo REAL do clipe de música.
//    - INÍCIO do clipe: aparece quando o clipe atinge 5s até 30s (5s delay + 25s duração)
//    - FIM do clipe: aparece nos últimos 30s do clipe, some nos últimos 5s (deixa "limpo")
//    - NÃO depende mais de "quando o usuário sintonizou". É baseado na posição absoluta do vídeo.
//    - Isso garante que o GC entre no momento certo da música, independentemente de quando
//      o espectador mudou de canal.
//    - Canais comuns: GC NUNCA entra sozinho, só com gcAlways=true no programa ou canal
//
// 3. PLAYLISTS DE MÚSICA (padrão recomendado):
//    - Todo programa de música DEVE ter o array `videos` com { youtubeUrl, titulo, duration }
//    - `duration` (em segundos) é OBRIGATÓRIO e deve ser o tempo EXATO do vídeo.
//    - A `duracao` do programa deve ser a soma das durações de UM ciclo da playlist.
//    - O player faz loop automático da playlist quando o tempo excede.
//    - Durações incorretas = dessincronia do GC e troca errada de clipe.
//    - Use o botão "🔍 Buscar Todos" no Admin para calcular durações automaticamente.
// ============================================

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
// Formata horário que pode ultrapassar 24h: 90000s → "01:00 (+1d)"
function fmtHMX(s){ s=Number(s); if(s<86400)return fmtHM(s); const d=Math.floor(s/86400); return `${fmtHM(s%86400)} (+${d}d)` }
// Duração legível, suporta >24h: 90000s → "1d 1h"
function fD(s){ s=Number(s); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); if(h>=24){const d=Math.floor(h/24),hr=h%24;return `${d}d${hr>0?` ${hr}h`:""}${d===0&&m>0?`${m}min`:""}`} return h>0?`${h}h${m>0?String(m).padStart(2,"0")+"min":""}`: `${m}min` }
const CC={L:"#0f0","10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#000"};
function getToday(){ return new Date().toISOString().split("T")[0] }
function extractYTId(s){ if(!s)return null; const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/]; for(const r of p){const m=s.match(r);if(m)return m[1]} return null }

// ============================================
// TOLERÂNCIA DE TRANSIÇÃO: evita cortar o final dos clipes.
// Quando o tick de 3s avança o elapsed para além da duração calculada,
// o sistema esperaria trocar de vídeo imediatamente.
// Adicionamos 2s de margem: o vídeo atual continua até pelo menos 2s após
// o ponto de troca calculado, dando tempo pro YouTube terminar o clipe.
// ============================================
const VIDEO_TRANSITION_BUFFER = 2; // segundos de margem no final de cada clipe

function getVideoPlaybackInfo(prog) {
  if (!prog) return null;
  const elapsed = Math.max(0, getElapsed(prog) + (prog.mediaOffset || 0));
  const videos = prog.videos || [];

  // Caso 1: Sem array de vídeos (programa simples ou fallback)
  if (videos.length === 0) {
    const dur = Number(prog.duracao) || 3600;
    const pos = dur > 0 ? elapsed % dur : 0;
    return {
      videoIndex: 0,
      position: pos,
      duration: dur,
      remaining: dur - pos,
      videoId: extractYTId(prog.youtubeId),
      title: prog.nome || "",
      isSingle: true
    };
  }

  // Duração efetiva de cada vídeo — usa o campo duration quando disponível
  // Fallback inteligente: distribui a duração total do programa igualmente
  const totalProgDur = Number(prog.duracao) || 0;
  const getDur = (v, idx) => {
    const d = Number(v.duration);
    if (d > 0) return d;
    // Sem duration individual: divide a duração total igualmente entre os vídeos
    return totalProgDur > 0 ? Math.floor(totalProgDur / videos.length) : 240;
  };

  // Caso 2: Playlist com múltiplos vídeos
  let acc = 0;
  for (let i = 0; i < videos.length; i++) {
    const dur = getDur(videos[i], i);
    const boundary = acc + dur;
    // Margem de buffer: só troca pro próximo vídeo após VIDEO_TRANSITION_BUFFER segundos
    // além do ponto de troca. Isso evita cortar o finalzinho do clipe.
    const effectiveBoundary = (i < videos.length - 1) ? boundary + VIDEO_TRANSITION_BUFFER : boundary;
    if (elapsed < effectiveBoundary) {
      const pos = elapsed - acc;
      return {
        videoIndex: i,
        position: Math.max(0, pos),
        duration: dur,
        remaining: Math.max(0, boundary - elapsed), // remaining usa o boundary real (sem buffer)
        videoId: extractYTId(videos[i].youtubeUrl),
        title: videos[i].titulo || prog.nome || "",
        isSingle: false
      };
    }
    acc += dur;
  }

  // Caso 3: Passou do fim da playlist → faz loop (comum em canais de música)
  const totalDur = acc;
  if (totalDur > 0) {
    const loopedElapsed = elapsed % totalDur;
    let acc2 = 0;
    for (let i = 0; i < videos.length; i++) {
      const dur = getDur(videos[i], i);
      const boundary = acc2 + dur;
      const effectiveBoundary = (i < videos.length - 1) ? boundary + VIDEO_TRANSITION_BUFFER : boundary;
      if (loopedElapsed < effectiveBoundary) {
        const pos = loopedElapsed - acc2;
        return {
          videoIndex: i,
          position: Math.max(0, pos),
          duration: dur,
          remaining: Math.max(0, boundary - loopedElapsed),
          videoId: extractYTId(videos[i].youtubeUrl),
          title: videos[i].titulo || prog.nome || "",
          isSingle: false
        };
      }
      acc2 += dur;
    }
  }

  // Fallback final
  const firstDur = getDur(videos[0], 0);
  return {
    videoIndex: 0,
    position: 0,
    duration: firstDur,
    remaining: firstDur,
    videoId: extractYTId(videos[0]?.youtubeUrl || prog.youtubeId),
    title: videos[0]?.titulo || prog.nome || "",
    isSingle: videos.length <= 1
  };
}

// ============ TIMELINE ABSOLUTA (7 dias contínuos) ============
const QUEUE_DAYS=7; // Mudar para 15, 30, etc conforme necessário - escalável!
const BASE_DATE=new Date("2026-01-01T00:00:00Z");
const BLOCO_PADRAO=10800;      // 3h - tamanho padrão do bloco de Maratona
const AUTO_MARATONA_MIN=21600; // 6h - acima disso vira Maratona automaticamente
function dateSecondsToAbsolute(dateStr,secondsInDay){
  const targetDate=new Date(dateStr+"T00:00:00Z");
  const daysDiff=Math.floor((targetDate-BASE_DATE)/(1000*60*60*24));
  return daysDiff*86400+Number(secondsInDay);
}
function getAbsoluteNow(){
  const now=new Date();
  const local=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
  return dateSecondsToAbsolute(getToday(),local);
}
function absoluteToDateSeconds(absSeconds){
  const dayNum=Math.floor(absSeconds/86400);
  const secondsInDay=absSeconds%86400;
  const targetDate=new Date(BASE_DATE.getTime()+dayNum*24*60*60*1000);
  const dateStr=targetDate.toISOString().split("T")[0];
  return {date:dateStr,seconds:secondsInDay};
}

// Emite blocos (virtuais) de uma instância de programa dentro da janela do dia.
// Programa curto → 1 item. Playlist longa / maratona → blocos de 3h "Maratona X (i/N)".
function emitBlocks(inst, dayAbs){
  const absStart=inst.absStart, totalDur=Number(inst.duracao)||0, absEnd=absStart+totalDur;
  const winS=Math.max(absStart,dayAbs), winE=Math.min(absEnd,dayAbs+86400);
  if(winE<=winS||totalDur<=0) return [];
  const blocoSize=Math.max(1800,Number(inst.blocoDuracao)||BLOCO_PADRAO);
  const isMaratona=inst.maratona===true||totalDur>AUTO_MARATONA_MIN;
  const contKey=`${inst.id}@${absStart}`; // mesma mídia contínua entre blocos/dias
  const fimRel=absEnd-dayAbs;
  const base={
    ...inst,
    srcProgId:inst.id, contKey,
    duracaoTotal:totalDur,
    fimReal:fimRel, fimRealTexto:fmtHMX(fimRel),
    isMaratona,
  };
  const out=[];
  if(!isMaratona||totalDur<=blocoSize){
    const s=winS-dayAbs,e=winE-dayAbs;
    out.push({...base,
      id:`${inst.id}@${absStart}_seg${s}`,
      nome:inst.maratona===true?`Maratona ${inst.nome}`:inst.nome,
      horarioInicio:s,horarioFim:e,duracao:e-s,
      mediaOffset:winS-absStart,
      blocoInfo:null,
      horarioTexto:fmtHM(s),horarioFimTexto:fmtHM(Math.min(e,86400)),
    });
    return out;
  }
  // Split em blocos alinhados ao início do programa
  let total=Math.ceil(totalDur/blocoSize);
  // último bloco muito curto (<15min) funde com o anterior
  const lastLen=totalDur-(total-1)*blocoSize;
  const mergeLast=total>1&&lastLen<900;
  if(mergeLast)total-=1;
  for(let k=0;k<total;k++){
    const bS=absStart+k*blocoSize;
    const bE=(k===total-1)?absEnd:absStart+(k+1)*blocoSize;
    const cS=Math.max(bS,dayAbs), cE=Math.min(bE,dayAbs+86400);
    if(cE<=cS)continue;
    const s=cS-dayAbs,e=cE-dayAbs;
    out.push({...base,
      id:`${inst.id}@${absStart}_b${k}`,
      nome:`Maratona ${inst.nome} (${k+1}/${total})`,
      horarioInicio:s,horarioFim:e,duracao:e-s,
      mediaOffset:cS-absStart,
      blocoInfo:{i:k+1,total},
      horarioTexto:fmtHM(s),horarioFimTexto:fmtHM(Math.min(e,86400)),
    });
  }
  return out;
}

function fillGaps(items){
  const sorted=[...items].sort((a,b)=>a.horarioInicio-b.horarioInicio);
  const withGaps=[];let cur=0;
  const pushGaps=(from,to)=>{let c=from;while(c<to){const gE=Math.min(c+600,to);withGaps.push({...VOLTAMOS_JA,id:`_gap_${c}`,horarioInicio:c,horarioFim:gE,duracao:gE-c,horarioTexto:fmtHM(c),horarioFimTexto:fmtHM(gE)});c=gE}};
  for(const it of sorted){
    if(it.horarioInicio>cur)pushGaps(cur,it.horarioInicio);
    withGaps.push(it);
    cur=Math.max(cur,it.horarioFim);
  }
  if(cur<86400)pushGaps(cur,86400);
  return withGaps;
}

// buildSchedule v2: janela do dia projetada da timeline absoluta.
// Suporta: programas atravessando meia-noite, Maratona (blocos virtuais) e Eternity (loop por canal).
function buildSchedule(programs, channelId, channel) {
  const dayAbs=dateSecondsToAbsolute(getToday(),0);
  const dated=programs
    .filter(p=>p.canalId===channelId&&p.data&&!p.isJingle)
    .map(p=>({...p,duracao:Number(p.duracao),absStart:dateSecondsToAbsolute(p.data,Number(p.horarioInicio))}))
    .sort((a,b)=>a.absStart-b.absStart);

  let instances=[];
  if(dated.length>0){
    if(channel?.eternity){
      // ETERNITY: a grade do canal (ciclo de N dias, ancorado no 1º dia com programa) repete para sempre
      const days=Math.max(1,Number(channel.eternityDays)||1);
      const cycle=days*86400;
      const anchor=Math.floor(dated[0].absStart/86400)*86400;
      const baseN=Math.floor((dayAbs-anchor)/cycle);
      for(const p of dated){
        for(const n of [baseN-1,baseN,baseN+1]){
          const shifted=p.absStart+n*cycle;
          if(shifted+p.duracao>dayAbs&&shifted<dayAbs+86400)
            instances.push({...p,absStart:shifted});
        }
      }
    } else {
      instances=dated.filter(p=>p.absStart+p.duracao>dayAbs&&p.absStart<dayAbs+86400);
    }
  }

  let items=[];
  for(const inst of instances)items.push(...emitBlocks(inst,dayAbs));

  if(items.length>0)return fillGaps(items);

  // FALLBACK: sem nada intersectando hoje → repete a lista de programas do canal o dia todo
  const anyProgs=programs.filter(p=>p.canalId===channelId).sort((a,b)=>Number(a.horarioInicio)-Number(b.horarioInicio));
  if(anyProgs.length===0)return [];
  const schedule=[];let cur=0,idx=0;
  while(cur<86400){
    const src=anyProgs[idx%anyProgs.length];const dur=Number(src.duracao)||3600;
    const inst={...src,id:`${src.id}_rep${idx}`,duracao:dur,absStart:dayAbs+cur};
    schedule.push(...emitBlocks(inst,dayAbs));
    cur+=dur;idx++;
  }
  return schedule;
}

function getCurProg(schedule) {
  if (!schedule || schedule.length === 0) return null;
  const s = getNow();
  return schedule.find(p => s >= p.horarioInicio && s < p.horarioFim) || null;
}
function getElapsed(prog) { return getNow() - prog.horarioInicio }

// Encontra qual programa está rodando AGORA em qualquer hora dos 7 dias
function getCurrentProgramAbsolute(programs, channelId) {
  const now = getAbsoluteNow();
  for (const prog of programs.filter(p => p.canalId === channelId)) {
    const progStart = dateSecondsToAbsolute(prog.data, Number(prog.horarioInicio));
    const progEnd = progStart + Number(prog.duracao);
    if (now >= progStart && now < progEnd) {
      return { prog, startAbs: progStart, elapsed: now - progStart };
    }
  }
  return null;
}

function ChLogo({ch, size=28}) {
  if (ch.logoType==="custom" && ch.logoUrl) return <img src={ch.logoUrl} alt="" style={{width:size,height:size,borderRadius:4,objectFit:"cover"}} />;
  return <span style={{fontSize:size*0.85}}>{ch.logo || "📺"}</span>;
}

// ============================================
// SMALL COMPONENTS
// ============================================
function LiveDot({big}){ const[v,setV]=useState(true); useEffect(()=>{const i=setInterval(()=>setV(x=>!x),800);return()=>clearInterval(i)},[]); return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:big?14:11,fontWeight:800,color:"#ff3b3b",opacity:v?1:0.3,transition:"opacity 0.3s"}}><span style={{width:big?10:8,height:big?10:8,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 8px #ff3b3b"}}/>AO VIVO</span> }

function Badge({c,big}){ return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:big?30:22,height:big?30:22,borderRadius:4,background:CC[c]||"#888",color:c==="L"||c==="18"?"#fff":"#000",fontSize:big?13:10,fontWeight:800}}>{c}</span> }
function Tag({t}){ const c={HD:"#1a73e8","4K":"#e91e63",DUB:"#4caf50",LEG:"#ff9800","5.1":"#9c27b0"}; return <span style={{fontSize:10,fontWeight:700,padding:"3px 7px",borderRadius:3,background:c[t]||"#555",color:"#fff"}}>{t}</span> }

function shareProgram(prog,ch){ const text=`📺 ${prog.nome}\n🕐 ${prog.horarioTexto} - ${prog.horarioFimTexto}\n📡 ${ch?.nome||"TVWEB"}`; if(navigator.share)navigator.share({title:prog.nome,text,url:window.location.href}).catch(()=>{}); else{navigator.clipboard?.writeText(text);alert("Copiado!")} }
function scheduleNotif(prog,ch,min=5){ const ns=getNow();const ts=prog.horarioInicio-min*60;const delay=(ts-ns)*1000;if(delay<=0){alert("Já começou!");return}if(!("Notification"in window)){alert("Sem suporte.");return}Notification.requestPermission().then(p=>{if(p!=="granted")return;setTimeout(()=>{new Notification(`📺 ${prog.nome} em ${min}min!`,{body:`${ch?.nome} · ${prog.horarioTexto}`})},delay);alert(`✅ Lembrete definido!`)}) }

// ============================================
// GC (Gerador de Caracteres) - lower-third estilo canal de clipes
// LÓGICA NOVA E CORRIGIDA: 100% baseada na posição REAL do vídeo atual
// ============================================
const GC_DELAY=5, GC_DURATION=25, GC_END_LEAD=30;

function GCBar({channel,program,nextProgram}){
  const isMusic=!!channel?.isMusic;
  // gcNever no programa SOBRESCREVE gcAlways do canal — permite desativar por programa
  const gcNever=!!(program?.gcNever);
  const gcAlways=!gcNever&&!!(program?.gcAlways||channel?.gcAlways);
  const [visible,setVisible]=useState(false);
  const contKey=program?.contKey||program?.id;

  useEffect(()=>{
    if(!program||program.isPlaceholder||gcNever){setVisible(false);return}
    if(gcAlways){setVisible(true);return}
    if(!isMusic){setVisible(false);return}

    const upd=()=>{
      const vInfo = getVideoPlaybackInfo(program);
      if(!vInfo){ setVisible(false); return; }
      const showIntro = vInfo.position >= GC_DELAY && vInfo.position < (GC_DELAY + GC_DURATION);
      const showOutro = vInfo.remaining <= GC_END_LEAD && vInfo.remaining > (GC_END_LEAD - GC_DURATION);
      setVisible(showIntro || showOutro);
    };

    upd();
    const i=setInterval(upd,500);
    return()=>clearInterval(i);
  },[contKey,channel?.id,gcAlways,gcNever,isMusic,program]);

  // Título atual: usa o vídeo correto da playlist quando disponível
  // (calculado aqui, fora do useEffect, para reutilizar sem segunda chamada)
  const vInfoRender = (!program||program.isPlaceholder) ? null : getVideoPlaybackInfo(program);
  if(!program||program.isPlaceholder||!visible)return null;
  const vInfo = vInfoRender;
  const nowTitle = vInfo?.title || (isMusic ? (program.videos?.[0]?.titulo || program.nome) : program.nome);

  let nextTitle = null;
  if(isMusic){
    const videos = program.videos || [];
    if(videos.length > 1 && vInfo){
      const nextIdx = (vInfo.videoIndex + 1) % videos.length;
      nextTitle = videos[nextIdx]?.titulo || null;
    }
    if(!nextTitle && nextProgram && !nextProgram.isPlaceholder && (nextProgram.contKey||nextProgram.id)!==contKey){
      nextTitle = nextProgram.videos?.[0]?.titulo || nextProgram.nome;
    }
  }

  const sub = isMusic
    ? (nextTitle ? `A seguir: ${nextTitle}` : null)
    : ((program.videos?.[0]?.titulo && program.videos[0].titulo !== program.nome) ? program.videos[0].titulo : (channel?.nome || null));

  return <div style={{
    position:"absolute",left:"7%",bottom:"16%",zIndex:9,maxWidth:"62%",
    animation:"gcIn 0.5s cubic-bezier(0.22,1,0.36,1)",
    pointerEvents:"none",
  }}>
    <div style={{
      background:"linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.72) 75%, transparent 100%)",
      borderLeft:`6px solid ${channel?.cor||"#1a73e8"}`,
      padding:"18px 56px 18px 24px",borderRadius:"0 12px 12px 0",
      backdropFilter:"blur(2px)",
    }}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <span style={{fontSize:18}}>♪</span>
        <span style={{fontSize:14,fontWeight:800,color:channel?.cor||"#4fc3f7",letterSpacing:2,textTransform:"uppercase"}}>{channel?.nome||"TVWEB"}</span>
        {isMusic&&<span style={{fontSize:11,fontWeight:800,color:"#0f0",background:"rgba(0,255,0,0.1)",border:"1px solid rgba(0,255,0,0.25)",padding:"2px 8px",borderRadius:3,letterSpacing:1}}>TOCANDO AGORA</span>}
        {program.blocoInfo&&<span style={{fontSize:12,fontWeight:700,color:"#bbb",background:"rgba(255,255,255,0.12)",padding:"2px 8px",borderRadius:3}}>BLOCO {program.blocoInfo.i}/{program.blocoInfo.total}</span>}
      </div>
      <div style={{fontSize:30,fontWeight:800,color:"#fff",lineHeight:1.15,textShadow:"0 2px 8px rgba(0,0,0,0.8)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nowTitle}</div>
      {sub&&<div style={{fontSize:17,fontWeight:500,color:"#ccc",marginTop:5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sub}</div>}
    </div>
  </div>;
}

// ============================================
// OSD HEADER (TV-style top bar)
// ============================================
function OSDHeader({channel,program,visible}){
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
      {/* LEFT: Channel info */}
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
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
            <span style={{fontSize:15,color:"#bbb"}}>{program.horarioTexto} - {program.horarioFimTexto}</span>
            <Badge c={program.classificacao} big/>
            {program.tags?.map(t=><Tag key={t} t={t}/>)}
          </div>
        </div>
      </div>
      {/* RIGHT: Clock + TREND TV */}
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
// OSD FOOTER (TV-style bottom bar)
// ============================================
function OSDFooter({program,nextProgram,onOpenEPG,onOpenFull,onOpenSettings,onFullscreen,visible}){
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
  const endText=program.fimRealTexto||program.horarioFimTexto;
  const spansDay=program.fimReal>86400;
  return <div style={{
    position:"absolute",bottom:0,left:0,right:0,zIndex:10,
    background:"linear-gradient(0deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 70%, transparent 100%)",
    padding:"40px 30px 20px",
    transform:visible?"translateY(0)":"translateY(100%)",
    transition:"transform 0.6s ease",
    pointerEvents:visible?"auto":"none",
  }}>
    {/* Progress bar */}
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
      <span style={{fontSize:15,fontWeight:700,color:"#fff",minWidth:55}}>{fmtHM(program.horarioInicio + el)}</span>
      <div style={{flex:1,height:5,background:"rgba(255,255,255,0.15)",borderRadius:3,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#1a73e8,#4fc3f7)",borderRadius:3,transition:"width 1s linear"}}/>
      </div>
      <span style={{fontSize:13,color:spansDay?"#ffca28":"#888",minWidth:55,textAlign:"right",fontWeight:spansDay?700:400}}>{endText}</span>
    </div>
    {/* Info row */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <LiveDot big/>
        {program.blocoInfo&&<span style={{fontSize:12,fontWeight:800,color:"#ffca28",background:"rgba(255,202,40,0.12)",border:"1px solid rgba(255,202,40,0.3)",padding:"4px 10px",borderRadius:4,letterSpacing:1}}>🏃 MARATONA · BLOCO {program.blocoInfo.i}/{program.blocoInfo.total}</span>}
        {(program.blocoInfo||spansDay)&&<span style={{fontSize:13,color:"#aaa"}}>Termina às <span style={{color:"#fff",fontWeight:700}}>{endText}</span>{program.duracaoTotal?<span style={{color:"#777"}}> · total {fD(program.duracaoTotal)}</span>:null}</span>}
        {nextProgram && <span style={{fontSize:13,color:"#777"}}>A seguir: <span style={{color:"#bbb",fontWeight:600}}>{nextProgram.nome}</span> · {nextProgram.horarioTexto}</span>}
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={e=>{e.stopPropagation();onOpenEPG()}} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",padding:"10px 22px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:600}}>▲ Guia Rápido</button>
        <button onClick={e=>{e.stopPropagation();onOpenSettings()}} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"#ccc",padding:"10px 16px",borderRadius:6,cursor:"pointer",fontSize:14}}>⚙️</button>
        <button onClick={e=>{e.stopPropagation();onFullscreen()}} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",padding:"10px 22px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:600}}>{isFullscreen?"↙ Sair":"⛶ Tela Cheia"}</button>
      </div>
    </div>
  </div>;
}

// ============================================
// EPG COMPACTO (with clock + sticky names)
// ============================================
function EPGCompact({channels,allPrograms,currentChannelId,onSelectChannel,onSelectProgram,onOpenFull,onClose}){
  const now=getNow();
  const scrollRef=useRef(null);
  const ROW_H=130, PX=400;
  const totalW=PX*24;
  const nowPx=(now/86400)*totalW;
  const secToPx=(sec)=>(Number(sec)/86400)*totalW;
  const[clock,setClock]=useState(new Date());
  const[canScrollL,setCanScrollL]=useState(false);
  const[canScrollR,setCanScrollR]=useState(true);
  useEffect(()=>{const i=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(i)},[]);

  const updScrollState=()=>{
    const el=scrollRef.current; if(!el)return;
    setCanScrollL(el.scrollLeft>10);
    setCanScrollR(el.scrollLeft+el.clientWidth<el.scrollWidth-10);
  };
  useEffect(()=>{
    const el=scrollRef.current; if(!el)return;
    // Posiciona no "agora" (com margem à esquerda para mostrar o que já passou)
    el.scrollLeft=Math.max(0,nowPx-260);
    updScrollState();
    const on=()=>updScrollState();
    el.addEventListener("scroll",on);
    return()=>el.removeEventListener("scroll",on);
  },[]);

  // Rola por passos de "meia tela" — comportamento igual ao Globoplay
  const scroll=(dir)=>{
    const el=scrollRef.current; if(!el)return;
    const step=Math.max(300,el.clientWidth*0.6);
    el.scrollTo({left:el.scrollLeft+dir*step,behavior:"smooth"});
  };

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
    {/* GRADE: UM único container de scroll (X e Y) — coluna de canais e grade
        se movem SEMPRE juntas. Canais = sticky à esquerda; horas = sticky no topo.
        Rolar para baixo revela a programação de TODOS os canais.
        Botões laterais (‹ ›) fazem navegação horizontal — sem scrollbar visível. */}
    <div style={{position:"relative"}}>
      <div ref={scrollRef} className="epg-scroll" style={{background:"rgba(10,12,18,0.98)",overflow:"auto",maxHeight:"60vh",minHeight:320,scrollbarWidth:"none"}}>
        <div style={{width:140+totalW,position:"relative"}}>
        {/* Linha vermelha do AGORA (atravessa todas as linhas) */}
        <div style={{position:"absolute",left:140+nowPx,top:35,bottom:0,width:3,background:"#ff3b3b",zIndex:6,boxShadow:"0 0 12px #ff3b3b",pointerEvents:"none"}}/>
        {/* HEADER de horas — sticky no topo */}
        <div style={{display:"flex",position:"sticky",top:0,zIndex:8}}>
          <div style={{width:140,flexShrink:0,height:35,position:"sticky",left:0,zIndex:9,background:"rgb(12,14,20)",borderRight:"1px solid rgba(255,255,255,0.08)",borderBottom:"1px solid rgba(255,255,255,0.1)"}}/>
          <div style={{position:"relative",height:35,width:totalW,flexShrink:0,background:"rgb(12,14,20)",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
            {Array.from({length:25}).map((_,h)=>{
              const x=secToPx(h*3600);
              return <div key={h} style={{position:"absolute",left:x,top:0,bottom:0,borderLeft:"1px solid rgba(255,255,255,0.1)"}}>
                <span style={{fontSize:13,color:"#ccc",fontWeight:600,padding:"8px 8px",whiteSpace:"nowrap",display:"inline-block"}}>{String(h).padStart(2,"0")}:00</span>
              </div>;
            })}
            <div style={{position:"absolute",left:nowPx-3.5,bottom:-2,width:10,height:10,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 8px #ff3b3b",zIndex:7}}/>
          </div>
        </div>
        {/* LINHAS: canal (sticky esquerda) + programas — mesma linha, mesmo scroll */}
        {[...channels.filter(ch=>ch.id===currentChannelId),...channels.filter(ch=>ch.id!==currentChannelId)].map(ch=>{
          const sched=buildSchedule(allPrograms,ch.id,ch);
          const cur=getCurProg(sched);
          const isCurrent=ch.id===currentChannelId;
          return <div key={ch.id} style={{display:"flex"}}>
            <div onClick={()=>onSelectChannel(ch.id)} style={{width:140,flexShrink:0,height:ROW_H,position:"sticky",left:0,zIndex:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",background:isCurrent?"rgb(26,34,50)":"rgb(12,14,20)",borderRight:"1px solid rgba(255,255,255,0.08)",borderBottom:"1px solid rgba(255,255,255,0.05)",borderLeft:isCurrent?"3px solid #1a73e8":"3px solid transparent",boxSizing:"border-box"}}>
              <div style={{textAlign:"center"}}><ChLogo ch={ch} size={36}/><div style={{fontSize:12,fontWeight:600,color:isCurrent?"#fff":"#888",marginTop:4}}>{ch.nome}</div></div>
            </div>
            <div style={{position:"relative",height:ROW_H,width:totalW,flexShrink:0,borderBottom:"1px solid rgba(255,255,255,0.05)",background:isCurrent?"rgba(26,115,232,0.08)":"transparent",boxSizing:"border-box"}}>
              {sched.filter(p=>Number(p.horarioFim)<=86400&&!p.isPlaceholder).map(prog=>{
                const startSec=Number(prog.horarioInicio), dur=Number(prog.duracao);
                const left=secToPx(startSec), w=Math.max(secToPx(dur),80);
                const isNow=cur?.id===prog.id;
                const isPast=Number(prog.horarioFim)<=now;
                const needsRepeat=w>500;
                const needsTriple=w>900;
                return <div key={prog.id} onClick={()=>{onSelectChannel(ch.id);onSelectProgram(prog)}}
                  style={{position:"absolute",left,width:w,top:0,bottom:2,cursor:"pointer",overflow:"hidden",background:isNow?isCurrent?"rgba(60,70,90,0.95)":"rgba(40,44,60,0.95)":isCurrent?"rgba(35,40,55,0.7)":"rgba(30,32,44,0.6)",borderRight:"1px solid rgba(255,255,255,0.06)",borderLeft:"1px solid rgba(255,255,255,0.03)",boxSizing:"border-box",transition:"background 0.2s",opacity:isPast?0.42:1}}
                  onMouseEnter={e=>{e.currentTarget.style.background=isNow?isCurrent?"rgba(70,85,110,1)":"rgba(60,70,90,1)":isCurrent?"rgba(50,60,75,0.9)":"rgba(45,50,65,0.9)";if(isPast)e.currentTarget.style.opacity=0.7}}
                  onMouseLeave={e=>{e.currentTarget.style.background=isNow?isCurrent?"rgba(60,70,90,0.95)":"rgba(40,44,60,0.95)":isCurrent?"rgba(35,40,55,0.7)":"rgba(30,32,44,0.6)";if(isPast)e.currentTarget.style.opacity=0.42}}>
                  <div style={{position:"absolute",left:12,top:10,right:12}}>
                    <div style={{fontSize:11,color:"#aaa",marginBottom:4,fontWeight:500}}>{prog.horarioTexto}{isNow&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,background:"#f44336",color:"#fff"}}>AO VIVO</span>}{isPast&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,background:"rgba(255,255,255,0.12)",color:"#aaa"}}>JÁ EXIBIDO</span>}</div>
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
            </div>
          </div>;
        })}
        </div>
      </div>
      {/* Botões laterais estilo Globoplay — só aparecem quando dá pra rolar */}
      <button onClick={()=>scroll(-1)} disabled={!canScrollL} title="Ver mais cedo (Shift+←)" style={{position:"absolute",left:6,top:"50%",transform:"translateY(-50%)",zIndex:20,width:44,height:70,borderRadius:6,background:"rgba(0,0,0,0.72)",border:"1px solid rgba(255,255,255,0.18)",color:canScrollL?"#fff":"#555",cursor:canScrollL?"pointer":"default",fontSize:26,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",transition:"opacity 0.2s",opacity:canScrollL?1:0.35,pointerEvents:canScrollL?"auto":"none",backdropFilter:"blur(6px)"}}>‹</button>
      <button onClick={()=>scroll(1)} disabled={!canScrollR} title="Ver mais tarde (Shift+→)" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",zIndex:20,width:44,height:70,borderRadius:6,background:"rgba(0,0,0,0.72)",border:"1px solid rgba(255,255,255,0.18)",color:canScrollR?"#fff":"#555",cursor:canScrollR?"pointer":"default",fontSize:26,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",transition:"opacity 0.2s",opacity:canScrollR?1:0.35,pointerEvents:canScrollR?"auto":"none",backdropFilter:"blur(6px)"}}>›</button>
    </div>
    <div style={{background:"rgba(10,12,18,0.98)",padding:"10px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"#666"}}>
      <button onClick={()=>scroll(-1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 16px",borderRadius:4,cursor:"pointer",fontSize:13}}>← Anterior</button>
      <div style={{display:"flex",gap:24,flexWrap:"wrap"}}><span>‹ › = Navegar no tempo</span><span>↕ Rolar = Todos os canais</span><span>↑↓ = Canal</span><span>Shift+←→ = Tempo</span><span>ESC = Fechar</span></div>
      <button onClick={()=>scroll(1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 16px",borderRadius:4,cursor:"pointer",fontSize:13}}>Próximo →</button>
    </div>
  </div>;
}

// ============================================
// FULL DAY SCHEDULE
// ============================================
function FullDay({channels,allPrograms,currentChannelId,onClose,onProgramClick}){
  const[viewCh,setVCh]=useState(currentChannelId);
  const ch=channels.find(c=>c.id===viewCh)||channels[0];
  const sched=buildSchedule(allPrograms,viewCh,ch);
  const ns=getNow();
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
            <div style={{minWidth:75,textAlign:"center",paddingTop:2}}><div style={{fontSize:18,fontWeight:700,color:isNow?"#4fc3f7":"#fff"}}>{prog.horarioTexto}</div><div style={{fontSize:11,color:"#555",marginTop:2}}>{prog.horarioFimTexto}</div>{isNow&&<div style={{marginTop:6}}><LiveDot/></div>}</div>
            <div style={{width:3,borderRadius:2,background:isNow?ch.cor:"rgba(255,255,255,0.08)",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}><span style={{fontSize:16,fontWeight:600,color:isNow?"#fff":"#ccc"}}>{prog.nome}</span><Badge c={prog.classificacao}/>{prog.tags?.map(t=><Tag key={t} t={t}/>)}</div>
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

// ============================================
// MAIN APP
// ============================================

// ============================================
// PERSISTENT CLOCK (aparece sempre ou em intervalos)
// Configurável via settings: clockMode = "always"|"15min"|"30min"|"off"
// ============================================
function PersistentClock({channel, clockMode="off"}){
  const [t,setT]=useState(new Date());
  const [visible,setVisible]=useState(false);
  useEffect(()=>{const i=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(i)},[]);
  useEffect(()=>{
    if(clockMode==="always"){setVisible(true);return}
    if(clockMode==="off"){setVisible(false);return}
    const mins=clockMode==="15min"?15:30;
    // Aparece nos primeiros 10s de cada intervalo
    const check=()=>{
      const m=new Date().getMinutes(),s=new Date().getSeconds();
      setVisible(m%mins===0&&s<10);
    };
    check();
    const i=setInterval(check,1000);
    return()=>clearInterval(i);
  },[clockMode]);
  if(!visible)return null;
  const ds=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  return <div style={{
    position:"absolute",top:20,right:24,zIndex:8,pointerEvents:"none",
    background:"rgba(0,0,0,0.55)",borderRadius:10,padding:"10px 18px",
    backdropFilter:"blur(4px)",border:`1px solid ${channel?.cor||"#1a73e8"}44`,
  }}>
    <div style={{fontSize:36,fontWeight:800,color:"#fff",letterSpacing:2,lineHeight:1,textAlign:"right"}}>
      {String(t.getHours()).padStart(2,"0")}:{String(t.getMinutes()).padStart(2,"0")}
    </div>
    <div style={{fontSize:12,color:"#aaa",textAlign:"right",marginTop:3}}>
      {ds[t.getDay()]} {t.getDate()}/{t.getMonth()+1}
    </div>
  </div>;
}

// ============================================
// NEXT-UP OVERLAY ("Em X minutos: Nome do Programa")
// Aparece quando faltam ≤ nextUpMinutes para o próximo programa.
// Configurável: nextUpMode = "off"|"5min"|"10min"|"15min"
// ============================================
function NextUpOverlay({nextProgram, clockMode, nextUpMode="off"}){
  const [now,setNow]=useState(getNow());
  useEffect(()=>{const i=setInterval(()=>setNow(getNow()),5000);return()=>clearInterval(i)},[]);
  if(!nextProgram||nextProgram.isPlaceholder)return null;
  if(nextUpMode==="off")return null;
  const mins={"5min":5,"10min":10,"15min":15}[nextUpMode]||10;
  const remaining=nextProgram.horarioInicio-now;
  const remMins=Math.floor(remaining/60);
  if(remaining<=0||remMins>mins)return null;
  const label=remMins<=1?"Em menos de 1 minuto":`Em ${remMins} minuto${remMins>1?"s":""}`;
  // Posição: embaixo do relógio se visível, caso contrário no topo
  const topOffset=clockMode!=="off"?110:20;
  return <div style={{
    position:"absolute",top:topOffset,right:24,zIndex:8,pointerEvents:"none",
    background:"rgba(0,0,0,0.72)",borderRadius:10,padding:"10px 18px",maxWidth:320,
    backdropFilter:"blur(4px)",border:"1px solid rgba(255,255,255,0.12)",
    animation:"gcIn 0.5s ease",
  }}>
    <div style={{fontSize:11,fontWeight:700,color:"#ffca28",letterSpacing:1,marginBottom:4}}>{label}</div>
    <div style={{fontSize:15,fontWeight:700,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nextProgram.nome}</div>
    <div style={{fontSize:12,color:"#888",marginTop:2}}>{nextProgram.horarioTexto}</div>
  </div>;
}

// ============================================
// SETTINGS MENU (relógio + próximo programa)
// Abre com tecla S ou clique em ⚙️
// ============================================
function SettingsMenu({settings,onSave,onClose}){
  const [clockMode,setClockMode]=useState(settings.clockMode||"off");
  const [nextUpMode,setNextUpMode]=useState(settings.nextUpMode||"off");
  const save=()=>{onSave({clockMode,nextUpMode});onClose()};
  const BtnGrp=({label,value,setValue,options})=><div style={{marginBottom:16}}>
    <div style={{fontSize:12,fontWeight:700,color:"#aaa",marginBottom:8,letterSpacing:0.5}}>{label}</div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      {options.map(o=><button key={o.v} onClick={()=>setValue(o.v)} style={{padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,background:value===o.v?"#1a73e8":"rgba(255,255,255,0.06)",border:value===o.v?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.1)",color:value===o.v?"#fff":"#aaa"}}>{o.l}</button>)}
    </div>
  </div>;
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,padding:28,width:380,border:"1px solid rgba(255,255,255,0.1)",boxShadow:"0 20px 60px rgba(0,0,0,0.6)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <span style={{fontSize:16,fontWeight:700,color:"#fff"}}>⚙️ Configurações</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <BtnGrp label="🕐 RELÓGIO NA TELA" value={clockMode} setValue={setClockMode} options={[{v:"off",l:"Desligado"},{v:"always",l:"Sempre"},{v:"15min",l:"A cada 15min"},{v:"30min",l:"A cada 30min"}]}/>
      <BtnGrp label="📺 AVISAR PRÓXIMO PROGRAMA" value={nextUpMode} setValue={setNextUpMode} options={[{v:"off",l:"Não avisar"},{v:"5min",l:"5 min antes"},{v:"10min",l:"10 min antes"},{v:"15min",l:"15 min antes"}]}/>
      <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:16,marginTop:4,display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{padding:"10px 18px",borderRadius:6,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:13}}>Cancelar</button>
        <button onClick={save} style={{padding:"10px 22px",borderRadius:6,cursor:"pointer",background:"linear-gradient(135deg,#1a73e8,#4fc3f7)",border:"none",color:"#fff",fontSize:13,fontWeight:700}}>Salvar</button>
      </div>
    </div>
  </div>;
}

// ============================================
// PRE-LOADER do próximo vídeo (buffer invisível)
// Monta um iframe oculto com o próximo vídeo para pré-carregar.
// Garante transição suave sem tela preta entre clipes.
// ============================================
function VideoPreloader({nextVideoId}){
  const [preloadId,setPreloadId]=useState(null);
  // Pré-carrega 8s antes do fim (tempo suficiente pro iframe iniciar)
  useEffect(()=>{
    if(!nextVideoId){setPreloadId(null);return}
    const t=setTimeout(()=>setPreloadId(nextVideoId),100);
    return()=>{clearTimeout(t);setPreloadId(null)};
  },[nextVideoId]);
  if(!preloadId)return null;
  return <iframe
    key={`preload_${preloadId}`}
    src={`https://www.youtube.com/embed/${preloadId}?autoplay=0&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&enablejsapi=0`}
    style={{position:"fixed",width:1,height:1,opacity:0,pointerEvents:"none",border:"none",left:-9999,top:-9999}}
    title="preload"
    allow="autoplay"
    tabIndex={-1}
    aria-hidden="true"
  />;
}


// Retorna a chave a usar na URL para um canal:
// prefere o número (ex: 2), só usa o ID do Firebase como último recurso
function channelUrlKey(ch){
  if(!ch)return null;
  const n=Number(ch.numero);
  return (n&&n>0)?String(n):ch.id;
}
export default function TVWeb(){
  const [channels, setChannels] = useState([]);
  const [allPrograms, setAllPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  // Canal inicial: lê da URL (?canal=NUMERO ou ?canal=ID)
  const [curCh, setCurCh] = useState(()=>{
    try{
      const params=new URLSearchParams(window.location.search);
      return params.get("canal")||null;
    }catch{return null}
  });
  const [showEPG, setEPG] = useState(false);
  const [showFull, setFull] = useState(false);
  const [showOSD, setOSD] = useState(true);
  const [selProg, setSP] = useState(null);
  const [fade, setFade] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  // Settings: persistido em localStorage (leve, sem precisar de Firestore)
  const [settings, setSettings] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem("tvweb_settings")||"{}") }catch{ return {} }
  });
  const saveSettings = (s) => {
    setSettings(s);
    try{ localStorage.setItem("tvweb_settings", JSON.stringify(s)) }catch{}
  };
  // Tick: 1s para transições suaves de vídeo na playlist
  const [tick, setTick] = useState(0);
  useEffect(()=>{const i=setInterval(()=>setTick(t=>t+1),1000);return()=>clearInterval(i)},[]);

  // Index de skip: quando um vídeo é bloqueado, avança pro próximo
  const [skipVideoIndex,setSkipVideoIndex]=useState(null); // {progId, fromIndex}

  const hideTimer=useRef(null);
  const cRef=useRef(null);
  const wRef=useRef(null);
  const lastClickTimeRef=useRef(0);
  const ytKeyRef=useRef("");
  const ytStartRef=useRef(0);
  const prevProgIdRef=useRef(null);
  // Vídeos bloqueados por direitos autorais — set de videoIds a pular
  const [blockedVideos,setBlockedVideos]=useState(()=>{
    try{return new Set(JSON.parse(localStorage.getItem("tvweb_blocked")||"[]"))}catch{return new Set()}
  });
  const blockVideo=useCallback((videoId)=>{
    if(!videoId)return;
    setBlockedVideos(prev=>{
      const next=new Set(prev);next.add(videoId);
      try{localStorage.setItem("tvweb_blocked",JSON.stringify([...next]))}catch{}
      return next;
    });
  },[]);

  // ========== FIREBASE REAL-TIME ==========
  useEffect(() => {
    let loaded = { channels: false, programs: false };
    const fallbackTimer = setTimeout(()=>setLoading(false),5000);
    const unsubCh = onSnapshot(collection(db,"channels"),(snap)=>{
      const list=snap.docs.map(d=>({...d.data(),id:d.id}));
      const sorted=list.sort((a,b)=>(a.numero||0)-(b.numero||0));
      if(sorted.length>0){
        setChannels(sorted);
        setCurCh(prev=>{
          let resolved=null;
          if(prev){
            // prev pode ser um NUMERO (da URL ?canal=2) ou um ID do Firebase
            const byId=sorted.find(c=>c.id===prev);
            if(byId)resolved=prev; // já é um ID válido
            else{
              const byNum=sorted.find(c=>String(c.numero)===String(prev));
              if(byNum)resolved=byNum.id; // era um número, resolve pro ID
            }
          }
          if(!resolved)resolved=sorted[0].id; // fallback: primeiro canal
          // Sempre normaliza a URL para o formato limpo (?canal=NUMERO)
          // Corrige URLs com ID do Firebase (ex: ?canal=TYb2xqCnhk1zAR5o12Rt)
          try{
            const url=new URL(window.location);
            const chObj=sorted.find(c=>c.id===resolved);
            const key=channelUrlKey(chObj)||resolved;
            const current=url.searchParams.get("canal");
            if(current!==key){
              url.searchParams.set("canal",key);
              window.history.replaceState({},"",url);
            }
          }catch{}
          return resolved;
        });
      }
      else{setChannels(FALLBACK_CHANNELS);setCurCh("_info")}
      loaded.channels=true;
      if(loaded.channels&&loaded.programs){setLoading(false);clearTimeout(fallbackTimer)}
    },(err)=>{console.error("Firebase channels err:",err);setChannels(FALLBACK_CHANNELS);loaded.channels=true;if(loaded.channels&&loaded.programs)setLoading(false)});
    const unsubPr = onSnapshot(collection(db,"programs"),(snap)=>{
      const list=snap.docs.map(d=>({...d.data(),id:d.id}));
      if(list.length>0)setAllPrograms(list); else setAllPrograms(FALLBACK_PROGRAMS);
      loaded.programs=true;
      if(loaded.channels&&loaded.programs){setLoading(false);clearTimeout(fallbackTimer)}
    },(err)=>{console.error("Firebase programs err:",err);setAllPrograms(FALLBACK_PROGRAMS);loaded.programs=true;if(loaded.channels&&loaded.programs)setLoading(false)});
    return()=>{unsubCh();unsubPr();clearTimeout(fallbackTimer)};
  },[]);

  // ========== DERIVED STATE (recalcs every tick) ==========
  const CHANNELS=channels;
  const ch=CHANNELS.find(c=>c.id===curCh)||CHANNELS[0];
  const schedule=useMemo(()=>ch?buildSchedule(allPrograms,ch.id,ch):[],[allPrograms,ch]);
  const cp=getCurProg(schedule);
  const ci=schedule.findIndex(p=>p.id===cp?.id);
  const np=ci>=0?schedule[ci+1]:null;

  // ========== AUTO VIDEO SWITCH ==========
  // Resolve QUAL vídeo da playlist está tocando agora e EM QUAL SEGUNDO.
  // Usa a função central getVideoPlaybackInfo para garantir consistência com o GC.
  const resolveCurrentVideo=useCallback(()=>{
    const info = getVideoPlaybackInfo(cp);
    if (!info) return {videoId:null,start:0,videoIndex:0,videoTitle:""};
    const videos = cp?.videos||[];
    let {videoId,videoIndex} = info;
    // Pula vídeos bloqueados — avança até encontrar um disponível
    let attempts=0;
    while(videoId&&blockedVideos.has(videoId)&&attempts<videos.length){
      attempts++;
      videoIndex=(videoIndex+1)%videos.length;
      videoId=extractYTId(videos[videoIndex]?.youtubeUrl)||null;
    }
    // Se skipVideoIndex está ativo para este programa, força o próximo
    if(skipVideoIndex&&cp&&skipVideoIndex.progId===cp.id&&videoIndex===skipVideoIndex.fromIndex){
      const nextIdx=(videoIndex+1)%Math.max(1,videos.length);
      const nextId=extractYTId(videos[nextIdx]?.youtubeUrl)||null;
      if(nextId&&!blockedVideos.has(nextId)){
        return {videoId:nextId,start:0,videoIndex:nextIdx,videoTitle:videos[nextIdx]?.titulo||""};
      }
    }
    return {
      videoId,
      start: attempts>0?0:Math.floor(info.position), // se pulou, começa do início
      videoIndex,
      videoTitle: videos[videoIndex]?.titulo||info.title
    };
  },[cp,blockedVideos,skipVideoIndex]);

  const currentVideo=resolveCurrentVideo();

  // Limpa skipVideoIndex após o skip acontecer (quando videoKey muda)
  useEffect(()=>{
    if(skipVideoIndex&&cp&&skipVideoIndex.progId===cp.id){
      const timer=setTimeout(()=>setSkipVideoIndex(null),2000);
      return()=>clearTimeout(timer);
    }
  },[skipVideoIndex,cp?.id]);

  // Próximo vídeo para pré-carregar
  const nextVideoForPreload = (() => {
    if(!cp||!currentVideo.videoId)return null;
    const videos = cp.videos||[];
    if(videos.length<=1)return null;
    // Só pré-carrega quando faltam ≤8s para trocar de vídeo
    const info = getVideoPlaybackInfo(cp);
    if(!info||info.remaining>8)return null;
    const nextIdx = (info.videoIndex+1) % videos.length;
    return extractYTId(videos[nextIdx]?.youtubeUrl)||null;
  })();

  // Força novo iframe quando o VÍDEO muda (não só o programa)
  const videoKey=`${curCh}_${cp?.id}_v${currentVideo.videoIndex}_${currentVideo.videoId}`;
  useEffect(()=>{
    if(cp&&videoKey!==prevProgIdRef.current){
      prevProgIdRef.current=videoKey;
      ytStartRef.current=currentVideo.start;
      ytKeyRef.current=`${videoKey}_${Date.now()}`;
    }
  },[videoKey,currentVideo.start]);

  // AUTO-SAVE: Salva progresso quando muda de programa
  const savedKeyRef=useRef(null);
  useEffect(()=>{
    if(!cp||cp.id===savedKeyRef.current)return;
    savedKeyRef.current=cp.id;
    (async()=>{
      try {
        const srcId=cp.srcProgId||cp.id;
        const prog = allPrograms.find(p => p.id === srcId);
        if (prog) {
          await setDoc(doc(db,"progress",String(curCh)),{
            canalId:curCh,
            currentProgramId:srcId,
            currentProgramName:cp.nome||prog.nome,
            timestamp:new Date(),
            absoluteSeconds:getAbsoluteNow()
          },{merge:true});
        }
      } catch(err){ console.error("Auto-save progress err:",err); }
    })();
  },[cp?.id,curCh,allPrograms]);

  const ytVideoId=currentVideo.videoId;
  const ytSrc=ytVideoId
    ?`https://www.youtube.com/embed/${ytVideoId}?autoplay=1&mute=${muted?1:0}&start=${ytStartRef.current}&controls=0&disablekb=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&fs=0&playsinline=1&cc_load_policy=0&cc_lang_pref=none&enablejsapi=1&origin=${encodeURIComponent(typeof window!=="undefined"?window.location.origin:"")}`
    :null;

  // ========== DETECÇÃO DE VÍDEO BLOQUEADO (postMessage YouTube API) ==========
  // Deve ficar APÓS ytVideoId estar definido na cadeia de render
  useEffect(()=>{
    const handler=(e)=>{
      if(!e.data||typeof e.data!=="string")return;
      try{
        const msg=JSON.parse(e.data);
        const errCode=msg.event==="infoDelivery"?msg.info?.errorCode:
                      msg.event==="onError"?msg.info:null;
        if(errCode===100||errCode===101||errCode===150){
          console.warn("TV: vídeo bloqueado, pulando. código:",errCode);
          blockVideo(ytVideoId);
          if(cp){
            const info=getVideoPlaybackInfo(cp);
            if(info)setSkipVideoIndex({progId:cp.id,fromIndex:info.videoIndex});
          }
        }
      }catch{}
    };
    window.addEventListener("message",handler);
    return()=>window.removeEventListener("message",handler);
  },[cp,ytVideoId,blockVideo]);

  // ========== OSD VISIBILITY (20 seconds) ==========
  const showOSDNow=useCallback(()=>{
    clearTimeout(hideTimer.current);
    setOSD(true);
    hideTimer.current=setTimeout(()=>{if(!showEPG&&!showFull)setOSD(false)},20000);
  },[showEPG,showFull]);

  useEffect(()=>{showOSDNow();return()=>clearTimeout(hideTimer.current)},[showOSDNow]);

  // Keep OSD visible while EPG/Full are open
  useEffect(()=>{if(showEPG||showFull)setOSD(true)},[showEPG,showFull]);

  // ========== UNMUTE ==========
  const handleUnmute=useCallback(()=>{
    if(cp){
      // Para playlists multi-vídeo: usa getVideoPlaybackInfo que já calcula o vídeo correto e posição
      const info=getVideoPlaybackInfo(cp);
      ytStartRef.current=info?Math.floor(info.position):Math.max(0,Math.floor(getElapsed(cp)+(cp.mediaOffset||0)));
    }
    ytKeyRef.current=ytKeyRef.current+"_unmuted";
    setMuted(false);
  },[cp]);
  // ========== CHANNEL SWITCHING ==========
  const swCh=useCallback(id=>{
    if(id===curCh)return;
    setFade(true);
    setTimeout(()=>{
      setCurCh(id);setFade(false);
      // Atualiza a URL sem recarregar (cada canal tem sua URL para compartilhar)
      try{
        const ch=channels.find(c=>c.id===id);
        const key=channelUrlKey(ch)||id;
        const url=new URL(window.location);
        url.searchParams.set("canal",key);
        window.history.replaceState({},"",url);
      }catch{}
    },300);
    showOSDNow();
  },[curCh,showOSDNow,channels]);

  const swDir=useCallback(dir=>{
    const i=CHANNELS.findIndex(c=>c.id===curCh);if(i<0)return;
    const n=dir>0?(i<CHANNELS.length-1?CHANNELS[i+1].id:CHANNELS[0].id):(i>0?CHANNELS[i-1].id:CHANNELS[CHANNELS.length-1].id);
    swCh(n);
  },[curCh,CHANNELS,swCh]);

  // ========== KEYBOARD ==========
  useEffect(()=>{const h=e=>{
    // Shift+←/→ dentro do guia = navegar no tempo (não trocar canal)
    if(showEPG&&e.shiftKey&&(e.key==="ArrowLeft"||e.key==="ArrowRight")){
      const el=document.querySelector(".epg-scroll");
      if(el){const step=Math.max(300,el.clientWidth*0.6);el.scrollTo({left:el.scrollLeft+(e.key==="ArrowRight"?1:-1)*step,behavior:"smooth"})}
      e.preventDefault(); return;
    }
    if(e.key==="ArrowUp")swDir(-1);
    else if(e.key==="ArrowDown")swDir(1);
    else if(e.key==="Escape"){setEPG(false);setFull(false);setSP(null);setShowSettings(false)}
    else if(e.key==="g"||e.key==="G"){if(showFull){setFull(false);setEPG(true)}else if(showEPG)setEPG(false);else setEPG(true)}
    else if(e.key==="s"||e.key==="S"){const tag=(document.activeElement?.tagName||"").toLowerCase();if(tag!=="input"&&tag!=="textarea"&&tag!=="select")setShowSettings(v=>!v)}
    showOSDNow();
  };window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[swDir,showOSDNow,showEPG,showFull]);

  // ========== MOUSE WHEEL ==========
  const handleWheel=useCallback(e=>{
    if(showEPG||showFull)return;
    if(wRef.current)return;
    wRef.current=setTimeout(()=>{wRef.current=null},400);
    swDir(e.deltaY>0?1:-1);
  },[swDir,showEPG,showFull]);

  // ========== CLICK HANDLER (on the video overlay only) ==========
  const handleVideoClick=useCallback(()=>{
    // Don't activate audio if menus are open
    if(showEPG||showFull||selProg||showSettings)return;
    
    const now=Date.now();
    if(now-lastClickTimeRef.current<300){
      if(!document.fullscreenElement)cRef.current?.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
    lastClickTimeRef.current=now;
    // Any click on video area activates audio
    if(muted)handleUnmute();
    showOSDNow();
  },[muted,handleUnmute,showOSDNow,showEPG,showFull,selProg]);

  // ========== LOADING ==========
  if(loading) return <div style={{width:"100%",height:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontFamily:"system-ui",fontSize:16}}>
    <div style={{textAlign:"center"}}><div style={{fontSize:48,marginBottom:16}}>📺</div>Carregando TVWEB...</div>
  </div>;
  if(!ch) return null;

  // ========== RENDER ==========
  return <div ref={cRef} onWheel={handleWheel} onMouseMove={showOSDNow}
    style={{width:"100%",height:"100vh",background:"#000",position:"relative",fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",overflow:"hidden",cursor:"default",userSelect:"none"}}>

    {/* ===== YOUTUBE PLAYER (completely isolated) ===== */}
    <div style={{position:"absolute",inset:0,zIndex:1,opacity:fade?0:1,transition:"opacity 0.5s"}}>
      {ytSrc && !cp?.isPlaceholder ? (
        <iframe
          key={ytKeyRef.current}
          src={ytSrc}
          allow="autoplay; encrypted-media"
          allowFullScreen={false}
          style={{width:"100%",height:"100%",border:"none",pointerEvents:"none"}}
          title={cp?.nome||"TVWEB"}
        />
      ) : (
        <div style={{width:"100%",height:"100%",background:`radial-gradient(ellipse at center,${ch.cor||"#1a73e8"}15,#0a0c12 70%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {cp?.isPlaceholder?(
            <div style={{textAlign:"center",maxWidth:600}}>
              <div style={{fontSize:140,marginBottom:30,opacity:0.8}}>📺</div>
              <div style={{fontSize:48,fontWeight:700,color:"#fff",marginBottom:16}}>Voltamos já!</div>
              <div style={{fontSize:18,color:"#999"}}>Programação em breve</div>
            </div>
          ):(
            <div style={{textAlign:"center",opacity:0.15}}><ChLogo ch={ch} size={100}/><div style={{fontSize:24,color:"#fff",marginTop:8,fontWeight:700}}>{ch.nome}</div></div>
          )}
        </div>
      )}
    </div>

    {/* Barras pretas cobrindo topo/base do iframe — escondem título e logo do YouTube.
        Ficam acima do player (zIndex:1) mas abaixo do click barrier (zIndex:2). */}
    {ytSrc&&!cp?.isPlaceholder&&<>
      <div style={{position:"absolute",top:0,left:0,right:0,height:"12%",background:"#000",pointerEvents:"none",zIndex:2,opacity:fade?0:1,transition:"opacity 0.5s"}}/>
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:"8%",background:"#000",pointerEvents:"none",zIndex:2,opacity:fade?0:1,transition:"opacity 0.5s"}}/>
    </>}

    {/* ===== CLICK BARRIER (completely above iframe, below menus) ===== */}
    <div onClick={handleVideoClick} style={{position:"absolute",inset:0,zIndex:2}} />

    {/* ===== WATERMARK ===== */}
    <div style={{position:"absolute",top:16,right:20,fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.12)",letterSpacing:2,zIndex:3,pointerEvents:"none"}}>TVWEB</div>

    {/* ===== UNMUTE BUTTON ===== */}
    {muted&&<button onClick={e=>{e.stopPropagation();handleUnmute()}} style={{
      position:"absolute",bottom:"50%",left:"50%",transform:"translate(-50%,50%)",zIndex:15,
      background:"rgba(0,0,0,0.85)",border:"1px solid rgba(255,255,255,0.2)",
      color:"#fff",padding:"14px 32px",borderRadius:30,cursor:"pointer",
      fontSize:16,fontWeight:700,display:"flex",alignItems:"center",gap:10,
      animation:"pulseFull 2s ease infinite",
    }}>🔇 Clique para ativar o som</button>}

    {/* ===== VIDEO PRELOADER (buffer invisível do próximo clipe) ===== */}
    {nextVideoForPreload&&<VideoPreloader nextVideoId={nextVideoForPreload}/>}

    {/* ===== GC (lower-third de música/programa) ===== */}
    {!showEPG&&!showFull&&!cp?.isJingle&&<GCBar channel={ch} program={cp} nextProgram={np}/>}

    {/* ===== RELÓGIO PERSISTENTE (apenas quando OSD está oculto, pois OSDHeader já tem relógio) ===== */}
    {!showOSD&&!showEPG&&!showFull&&settings.clockMode&&settings.clockMode!=="off"&&<PersistentClock channel={ch} clockMode={settings.clockMode}/>}

    {/* ===== PRÓXIMO PROGRAMA ("Em X minutos...") — só quando OSD está oculto ===== */}
    {!showOSD&&!showEPG&&!showFull&&np&&settings.nextUpMode&&settings.nextUpMode!=="off"&&<NextUpOverlay nextProgram={np} clockMode={settings.clockMode||"off"} nextUpMode={settings.nextUpMode}/>}

    {/* ===== MENU DE CONFIGURAÇÕES ===== */}
    {showSettings&&<SettingsMenu settings={settings} onSave={saveSettings} onClose={()=>setShowSettings(false)}/>}

    {/* ===== OSD HEADER (TV-style, 20s) ===== */}
    <OSDHeader channel={ch} program={cp} visible={showOSD&&!showEPG&&!showFull&&!cp?.isJingle}/>

    {/* ===== OSD FOOTER (TV-style, 20s) ===== */}
    <OSDFooter program={cp} nextProgram={np} visible={showOSD&&!showEPG&&!showFull&&!cp?.isJingle}
      onOpenEPG={()=>setEPG(true)} onOpenFull={()=>setFull(true)} onOpenSettings={()=>setShowSettings(true)} onFullscreen={()=>{if(!document.fullscreenElement)cRef.current?.requestFullscreen?.();else document.exitFullscreen?.()}}/>


    {/* ===== EPG / FULL / MODAL (above everything) ===== */}
    {showEPG&&<EPGCompact channels={CHANNELS} allPrograms={allPrograms} currentChannelId={curCh} onSelectChannel={id=>{swCh(id);setEPG(false)}} onSelectProgram={setSP} onOpenFull={()=>{setEPG(false);setFull(true)}} onClose={()=>setEPG(false)}/>}
    {showFull&&<FullDay channels={CHANNELS} allPrograms={allPrograms} currentChannelId={curCh} onClose={()=>setFull(false)} onProgramClick={setSP}/>}
    {selProg&&<ProgModal program={selProg} channel={CHANNELS.find(c=>c.id===(selProg.canalId||selProg.srcProgId&&allPrograms.find(p=>p.id===selProg.srcProgId)?.canalId))||ch} onClose={()=>setSP(null)} onWatch={(chId)=>{swCh(chId);setEPG(false);setFull(false)}}/>}

    <style>{`
      @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes slideDown{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes pulseFull{0%,100%{opacity:.6;transform:translate(-50%,50%) scale(1)}50%{opacity:1;transform:translate(-50%,50%) scale(1.05)}}
      @keyframes gcIn{from{transform:translateX(-40px);opacity:0}to{transform:translateX(0);opacity:1}}
      .epg-scroll::-webkit-scrollbar{height:0;width:8px}
      .epg-scroll::-webkit-scrollbar-track{background:transparent}
      .epg-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}
      ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
      *{box-sizing:border-box;margin:0;padding:0}
    `}</style>
  </div>;
}

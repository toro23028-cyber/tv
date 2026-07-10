import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, collection, addDoc, updateDoc, deleteDoc, onSnapshot, doc } from "./firebase";

const DURATION_PRESETS = [
  { label:"15min", value:900 },{ label:"30min", value:1800 },{ label:"40min", value:2400 },
  { label:"45min", value:2700 },{ label:"1h", value:3600 },{ label:"1h30", value:5400 },
  { label:"2h", value:7200 },{ label:"Custom", value:0 },
];
const CLASSIF_OPTIONS = ["L","10","12","14","16","18"];
const CC = { L:"#0f0","10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#111" };
const EMOJI_LIST = ["📺","🎭","🎬","🌍","🎵","🎮","📡","🎨","🏆","💡","🔬","📚","🎤","🎸","⚽","🎯","🌟","🔥","💎","🎪","🎻","🎹","📻","🖥️","🎥","🎞️","ℹ️","❤️","💙","💚"];
const COLOR_LIST = ["#2196F3","#E91E63","#4CAF50","#FF9800","#9C27B0","#f44336","#00bcd4","#ff5722","#607d8b","#78909C","#3f51b5","#8bc34a","#ffc107","#795548"];

function fmtSec(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
function getDayLabel(d){const x=new Date(d+"T00:00:00");const ds=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];return`${ds[x.getDay()]} ${x.getDate()}/${x.getMonth()+1}`}
function secTo(s){return{h:Math.floor(s/3600),m:Math.floor((s%3600)/60)}}
function parseDur(h,m){return(parseInt(h)||0)*3600+(parseInt(m)||0)*60}
function getToday(){ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; }
function getNow(){ const n=new Date(); return n.getHours()*3600+n.getMinutes()*60+n.getSeconds() }
function genDates(n){const ds=[]; let d=new Date(getToday()+"T00:00:00"); for(let i=0;i<n;i++){ const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0"); ds.push(`${y}-${m}-${da}`); d.setDate(d.getDate()+1); } return ds}

// Timeline absoluta (7 dias contínuos)
const QUEUE_DAYS=7; // Mudar para 15, 30, etc conforme necessário - escalável!
const BASE_DATE=new Date("2026-01-01T00:00:00Z");
// ===== Maratona / blocos virtuais (mesma regra da TV) =====
const BLOCO_PADRAO=10800;      // 3h
const AUTO_MARATONA_MIN=21600; // 6h → vira Maratona automático
// Formata segundos que podem passar de 24h: 90000 → "01:00 (+1d)"
function fmtSecX(s){s=Number(s);if(s<86400)return fmtSec(s);const d=Math.floor(s/86400);return `${fmtSec(s%86400)} (+${d}d)`}
// Duração legível com suporte a >24h: 90000 → "1d 1h"
function fDur(s){s=Number(s);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);if(h>=24){const d=Math.floor(h/24),hr=h%24;return `${d}d${hr>0?` ${hr}h`:""}`}return `${h>0?h+"h":""}${m>0?m+"min":""}`||"0min"}
// Calcula os blocos virtuais de um programa (para preview no painel)
function computeBlocos(horarioInicio,duracao,blocoDuracao){
  const start=Number(horarioInicio),total=Number(duracao);
  const bloco=Math.max(1800,Number(blocoDuracao)||BLOCO_PADRAO);
  if(total<=bloco)return [{i:1,total:1,start,end:start+total}];
  let n=Math.ceil(total/bloco);
  const lastLen=total-(n-1)*bloco;
  if(n>1&&lastLen<900)n-=1;
  const out=[];
  for(let k=0;k<n;k++){
    const bS=start+k*bloco;
    const bE=(k===n-1)?start+total:start+(k+1)*bloco;
    out.push({i:k+1,total:n,start:bS,end:bE});
  }
  return out;
}
// ===== GRADE VISUAL (arrastar para corrigir) — matemática =====
const SNAP=300; // encaixe de 5 minutos
function snap5(s){return Math.round(s/SNAP)*SNAP}
// Espaços livres do dia, dados os demais programas (último gap é aberto)
function buildGaps(others){
  const sorted=[...others].map(p=>({s:Number(p.horarioInicio),e:Number(p.horarioFim)})).sort((a,b)=>a.s-b.s);
  const gaps=[];let cur=0;
  for(const p of sorted){ if(p.s>cur)gaps.push([cur,p.s]); cur=Math.max(cur,p.e); }
  gaps.push([cur,Infinity]);
  return gaps;
}
// MOVE: retorna o início válido mais próximo do desejado (snap + sem sobrepor), ou null se nada comporta
function resolvePosition(desiredStart,dur,others){
  desiredStart=Math.max(0,Math.min(86400-SNAP,snap5(desiredStart)));
  const gaps=buildGaps(others);
  let best=null,bestDist=Infinity;
  for(const [gs,ge] of gaps){
    const maxStart=(ge===Infinity?86400-SNAP:ge-dur);
    if(maxStart<gs)continue; // gap menor que o programa
    const s=Math.max(gs,Math.min(desiredStart,maxStart));
    const d=Math.abs(s-desiredStart);
    if(d<bestDist){bestDist=d;best=s}
  }
  return best;
}
// RESIZE: limita a nova duração ao início do próximo programa (mín 5min; pode passar de 24h se livre)
function resolveResize(start,desiredDur,others){
  desiredDur=Math.max(SNAP,snap5(desiredDur));
  const next=others.map(p=>Number(p.horarioInicio)).filter(s=>s>start).sort((a,b)=>a-b)[0];
  if(next!==undefined&&start+desiredDur>next)desiredDur=next-start;
  return Math.max(SNAP,desiredDur);
}
function dateSecondsToAbsolute(dateStr,secondsInDay){
  const targetDate=new Date(dateStr+"T00:00:00Z");
  const daysDiff=Math.floor((targetDate-BASE_DATE)/(1000*60*60*24));
  return daysDiff*86400+secondsInDay;
}

// buildScheduleAdmin: projeta a grade para a data selecionada no painel.
// Com eternity: projeta os programas do ciclo na data selecionada.
// Sem eternity: retorna os programas reais daquele dia normalmente.
// _isProjected=true indica projeção virtual (editar abre o dia original no banco).
function buildScheduleAdmin(programs, channelId, channel, selDate) {
  const dayAbs = dateSecondsToAbsolute(selDate, 0);
  const real = programs
    .filter(p => p.canalId === channelId && p.data)
    .map(p => ({...p, _absStart: dateSecondsToAbsolute(p.data, Number(p.horarioInicio))}))
    .sort((a, b) => a._absStart - b._absStart);
  if (!channel?.eternity || real.length === 0) {
    return programs
      .filter(p => p.canalId === channelId && p.data === selDate)
      .sort((a, b) => Number(a.horarioInicio) - Number(b.horarioInicio));
  }
  const days = Math.max(1, Number(channel.eternityDays) || 1);
  const cycle = days * 86400;
  const anchor = Math.floor(real[0]._absStart / 86400) * 86400;
  const baseN = Math.floor((dayAbs - anchor) / cycle);
  const projected = [];
  for (const p of real) {
    for (const n of [baseN - 1, baseN, baseN + 1]) {
      const shiftedStart = p._absStart + n * cycle;
      const shiftedEnd = shiftedStart + Number(p.duracao);
      if (shiftedEnd > dayAbs && shiftedStart < dayAbs + 86400) {
        const startInDay = Math.max(0, shiftedStart - dayAbs);
        const endInDay = Math.min(86400, shiftedEnd - dayAbs);
        projected.push({
          ...p,
          _isProjected: true,
          _srcDate: p.data,
          _srcHorarioInicio: p.horarioInicio,
          horarioInicio: startInDay,
          horarioFim: endInDay,
          duracao: endInDay - startInDay,
        });
      }
    }
  }
  return projected.sort((a, b) => a.horarioInicio - b.horarioInicio);
}
function getAbsoluteNow(){
  const now=new Date();
  const local=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  return dateSecondsToAbsolute(today,local);
}

// YouTube metadata extraction
function extractYouTubeId(url){
  if(!url)return null;
  const patterns=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/];
  for(const p of patterns){const m=url.match(p);if(m)return m[1]}return null;
}
// Extrai um playlist ID de uma URL (list=... funciona em qualquer contexto)
function extractPlaylistId(url){
  if(!url)return null;
  const m=url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m?m[1]:null;
}
// Reconhece MUITAS URLs/IDs colados de uma vez.
// Aceita: uma por linha, separadas por espaço, vírgula, ponto-e-vírgula ou tab.
// Extrai IDs válidos de qualquer texto misturado (títulos, numeração, etc).
function parseYouTubeBulk(text){
  if(!text)return [];
  const seen=new Set(), out=[];
  const parts=text.split(/[\s,;|]+/).map(s=>s.trim()).filter(Boolean);
  for(const p of parts){
    const id=extractYouTubeId(p);
    if(id&&!seen.has(id)){seen.add(id);out.push({youtubeUrl:p,titulo:""})}
  }
  // fallback: varre o texto inteiro atrás de IDs (para colagens sem separadores claros)
  if(out.length===0){
    const re=/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/g;
    let m; while((m=re.exec(text))){ if(!seen.has(m[1])){seen.add(m[1]);out.push({youtubeUrl:`https://youtu.be/${m[1]}`,titulo:""})} }
  }
  return out;
}
// Consulta os vídeos de uma playlist do YouTube (até 200) via Data API v3
// Retorna lista de {youtubeUrl, titulo}. NÃO baixa vídeo nenhum — só busca metadados.
// Retorna [] e define window.__ytLastError com detalhe do erro em caso de falha.
// Converte duration ISO 8601 (PT4M33S) → segundos
function parseDurationISO(d){if(!d)return 0;const m=d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);return(parseInt(m?.[1]||0))*3600+(parseInt(m?.[2]||0))*60+(parseInt(m?.[3]||0))}

async function fetchYouTubePlaylistItems(playlistId){
  window.__ytLastError=null;
  if(!playlistId){window.__ytLastError="ID de playlist vazio";return []}
  const API_KEY="AIzaSyCt0t7IvYYPMXTfXB1zZ6AB4Na9JpL50EQ";
  const rawItems=[];let pageToken="";
  try{
    // ETAPA 1: Busca todos os vídeos da playlist (IDs + títulos)
    for(let i=0;i<4;i++){
      const url=`https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${playlistId}&key=${API_KEY}&part=snippet&maxResults=50${pageToken?`&pageToken=${pageToken}`:""}`;
      const res=await fetch(url);
      if(!res.ok){
        const errData=await res.json().catch(()=>({}));
        const reason=errData?.error?.errors?.[0]?.reason||`HTTP ${res.status}`;
        const msg=errData?.error?.message||"";
        window.__ytLastError=`API: ${reason}${msg?" — "+msg:""}`;
        console.error("YouTube API error:",errData);
        break;
      }
      const data=await res.json();
      for(const it of (data.items||[])){
        const vid=it.snippet?.resourceId?.videoId;
        if(vid)rawItems.push({videoId:vid,youtubeUrl:`https://youtu.be/${vid}`,titulo:it.snippet.title||"",duration:0});
      }
      if(!data.nextPageToken)break;
      pageToken=data.nextPageToken;
    }
    // ETAPA 2: Busca durações em batch (até 50 IDs por chamada)
    for(let b=0;b<rawItems.length;b+=50){
      const batch=rawItems.slice(b,b+50);
      const ids=batch.map(v=>v.videoId).join(",");
      try{
        const url=`https://www.googleapis.com/youtube/v3/videos?id=${ids}&key=${API_KEY}&part=contentDetails,status&maxResults=50`;
        const res=await fetch(url);
        if(res.ok){
          const data=await res.json();
          const infoMap={};
          for(const it of (data.items||[])){
            infoMap[it.id]={
              duration:parseDurationISO(it.contentDetails?.duration),
              embeddable:it.status?.embeddable!==false,
              uploadStatus:it.status?.uploadStatus||"processed",
            };
          }
          for(const v of batch){
            const info=infoMap[v.videoId];
            if(info){
              v.duration=info.duration||0;
              // blocked=true → avisa no painel, mas não remove automaticamente
              v.blocked=!info.embeddable||info.uploadStatus==="deleted"||info.uploadStatus==="rejected";
            }
          }
        }
      }catch(err){console.error("Duration batch err:",err)}
    }
  }catch(err){
    window.__ytLastError=`Rede: ${err.message}`;
    console.error("Playlist fetch err:",err);
  }
  // Remove o videoId auxiliar do objeto final
  return rawItems.map(({videoId,...rest})=>rest);
}
async function fetchYouTubeMetadata(videoId){
  if(!videoId)return null;
  try{
    const API_KEY="AIzaSyCt0t7IvYYPMXTfXB1zZ6AB4Na9JpL50EQ";
    // part=status traz embeddable e uploadStatus — essencial para detectar bloqueio ANTES de ir ao ar
    const url=`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${API_KEY}&part=snippet,contentDetails,status`;
    const res=await fetch(url);
    if(!res.ok)return null;
    const data=await res.json();
    if(!data.items||data.items.length===0)return null;
    const item=data.items[0];
    const snippet=item.snippet;
    const duration=item.contentDetails.duration;
    const match=duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours=parseInt(match?.[1]||0);
    const minutes=parseInt(match?.[2]||0);
    const seconds=parseInt(match?.[3]||0);
    const totalSeconds=hours*3600+minutes*60+seconds;
    // status.embeddable=false → não pode ser embarcado (bloqueio por direitos, configuração do canal, etc.)
    const embeddable=item.status?.embeddable!==false; // default true se campo ausente
    const uploadStatus=item.status?.uploadStatus||"processed";
    return{
      duration:totalSeconds,
      description:snippet.description,
      title:snippet.title,
      thumbnail:snippet.thumbnails?.default?.url||null,
      embeddable,          // false = vai dar tela em branco/erro no player
      uploadStatus,        // "deleted"|"failed"|"processed"|"rejected"|"uploading"
      blocked:!embeddable||uploadStatus==="deleted"||uploadStatus==="rejected",
    };
  }catch(err){
    console.error("Erro ao buscar metadados YouTube:",err);
    return null;
  }
}
function extractYTId(s){if(!s)return null;const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/];for(const r of p){const m=s.match(r);if(m)return m[1]}return null}
function ytThumb(id){const x=extractYTId(id);return x?`https://img.youtube.com/vi/${x}/mqdefault.jpg`:null}

const iS = {background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:4,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"};
const lS = {fontSize:11,color:"#888",fontWeight:600,marginBottom:4,display:"block",letterSpacing:0.5};

const DEFAULT_CHANNELS = [
  {id:0,numero:0,nome:"Sobre",logo:"ℹ️",logoType:"emoji",logoUrl:null,cor:"#78909C"},
  {id:1,numero:1,nome:"Canal 1",logo:"🎭",logoType:"emoji",logoUrl:null,cor:"#2196F3"},
  {id:2,numero:2,nome:"Canal 2",logo:"🎬",logoType:"emoji",logoUrl:null,cor:"#E91E63"},
  {id:3,numero:3,nome:"Canal 3",logo:"🌍",logoType:"emoji",logoUrl:null,cor:"#4CAF50"},
  {id:4,numero:4,nome:"Canal 4",logo:"🎵",logoType:"emoji",logoUrl:null,cor:"#FF9800"},
  {id:5,numero:5,nome:"Canal 5",logo:"🎮",logoType:"emoji",logoUrl:null,cor:"#9C27B0"},
];

function ChLogo({ch,size=28}){
  if(ch.logoType==="custom"&&ch.logoUrl) return <img src={ch.logoUrl} alt="" style={{width:size,height:size,borderRadius:4,objectFit:"cover"}}/>;
  return <span style={{fontSize:size*0.85}}>{ch.logo}</span>;
}

function ImgUploader({currentImage,imageType,onImageChange,label,shape="square"}){
  const ref=useRef(null);
  const [drag,setDrag]=useState(false);
  const handle=(f)=>{
    if(!f)return;
    const ok=["image/jpeg","image/png","image/gif","image/webp","image/svg+xml"];
    if(!ok.includes(f.type)){alert("Use JPG, PNG, GIF, WebP ou SVG.");return}
    if(f.size>5*1024*1024){alert("Máximo 5MB.");return}
    const r=new FileReader();
    r.onload=e=>onImageChange({type:"custom",url:e.target.result});
    r.readAsDataURL(f);
  };
  const w=shape==="square"?80:160,h=shape==="square"?80:90;
  return <div>
    {label&&<label style={lS}>{label}</label>}
    <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
      <div style={{width:w,height:h,borderRadius:6,overflow:"hidden",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {imageType==="custom"&&currentImage?<img src={currentImage} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:24,opacity:0.3}}>🖼️</span>}
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
        <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0])}}
          onClick={()=>ref.current?.click()} style={{padding:"14px 12px",borderRadius:6,cursor:"pointer",textAlign:"center",border:drag?"2px dashed #1a73e8":"2px dashed rgba(255,255,255,0.12)",background:drag?"rgba(26,115,232,0.1)":"rgba(255,255,255,0.02)"}}>
          <div style={{fontSize:12,color:"#aaa"}}>{drag?"Solte aqui!":"📁 Clique ou arraste"}</div>
          <div style={{fontSize:10,color:"#555"}}>JPG, PNG, GIF, WebP, SVG · Máx 5MB</div>
        </div>
        <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handle(e.target.files[0])}/>
        {imageType==="custom"&&currentImage&&<button onClick={()=>onImageChange({type:"none",url:null})} style={{padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.2)",color:"#f44336",alignSelf:"flex-start"}}>✕ Remover</button>}
      </div>
    </div>
  </div>;
}

// ============================================
// TIMELINE WITH DRAG
// ============================================
// ============================================
// GRADE VISUAL — edição por arrastar (estilo guia de TV)
// • Arrastar o bloco = mudar horário de início (encaixe de 5min)
// • Puxar a borda direita = mudar duração
// • Solta em cima de outro programa → encaixa no espaço livre mais próximo
// • Duplo clique = abrir edição completa
// ============================================
function GradeVisual({programs,channels,selectedChannel,selDate,onEdit,notify}){
  // programs já vem filtrado por data+canal via dayProgs (inclui projeções do eternity)
  const filtered=programs.filter(p=>p.canalId===selectedChannel).sort((a,b)=>Number(a.horarioInicio)-Number(b.horarioInicio));
  const ch=channels.find(c=>c.id===selectedChannel);
  const PXH=80, pxPerSec=PXH/3600, totalW=PXH*24, ROWH=92;
  const [drag,setDrag]=useState(null); // {id,mode,start,dur,origStart,origDur,x0}
  const scrollRef=useRef(null);
  const isToday=selDate===getToday();
  const nowSec=(()=>{const n=new Date();return n.getHours()*3600+n.getMinutes()*60+n.getSeconds()})();

  useEffect(()=>{
    const el=scrollRef.current;if(!el)return;
    const first=filtered[0]?Number(filtered[0].horarioInicio):8*3600;
    el.scrollLeft=Math.max(0,(isToday?nowSec:first)*pxPerSec-180);
  },[selectedChannel,selDate]);

  const startDrag=(e,p,mode)=>{
    e.preventDefault();e.stopPropagation();
    try{e.currentTarget.setPointerCapture?.(e.pointerId)}catch{}
    setDrag({id:p.id,mode,start:Number(p.horarioInicio),dur:Number(p.duracao),origStart:Number(p.horarioInicio),origDur:Number(p.duracao),x0:e.clientX});
  };
  const moveDrag=(e)=>{
    if(!drag)return;
    const dSec=(e.clientX-drag.x0)/pxPerSec;
    if(drag.mode==="move"){
      const ns=Math.max(0,Math.min(86400-SNAP,snap5(drag.origStart+dSec)));
      if(ns!==drag.start)setDrag(d=>({...d,start:ns}));
    }else{
      const nd=Math.max(SNAP,snap5(drag.origDur+dSec));
      if(nd!==drag.dur)setDrag(d=>({...d,dur:nd}));
    }
  };
  const endDrag=async()=>{
    if(!drag)return;
    const d={...drag};setDrag(null);
    const p=filtered.find(x=>x.id===d.id);if(!p)return;
    const others=filtered.filter(x=>x.id!==d.id);
    try{
      if(d.mode==="move"){
        if(d.start===d.origStart)return;
        const pos=resolvePosition(d.start,d.origDur,others);
        if(pos===null){notify("❌ Não cabe: dia lotado neste canal");return}
        await updateDoc(doc(db,"programs",String(p.id)),{horarioInicio:pos,horarioFim:pos+d.origDur});
        notify(`✅ ${p.nome} → ${fmtSec(pos)}${pos!==d.start?" (encaixado)":""}`);
      }else{
        if(d.dur===d.origDur)return;
        const nd=resolveResize(d.origStart,d.dur,others);
        await updateDoc(doc(db,"programs",String(p.id)),{duracao:nd,horarioFim:d.origStart+nd});
        notify(`✅ ${p.nome}: ${fDur(nd)}${nd!==d.dur?" (limitado ao próximo)":""}`);
      }
    }catch(err){console.error("Grade drag err:",err);notify("❌ Erro ao salvar no Firebase")}
  };

  return <div>
    <div ref={scrollRef} className="grade-scroll" style={{overflowX:"auto",overflowY:"hidden",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8}}>
      <div style={{width:totalW,position:"relative",height:ROWH+30,userSelect:"none"}}>
        {/* Régua de horas */}
        <div style={{position:"relative",height:26,borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
          {Array.from({length:25}).map((_,h)=><div key={h} style={{position:"absolute",left:h*PXH,top:0,bottom:0,borderLeft:"1px solid rgba(255,255,255,0.08)"}}>
            <span style={{fontSize:10,color:"#888",fontWeight:600,paddingLeft:6,lineHeight:"26px"}}>{String(h).padStart(2,"0")}:00</span>
          </div>)}
        </div>
        {/* Linhas de hora na área dos blocos */}
        {Array.from({length:25}).map((_,h)=><div key={`l${h}`} style={{position:"absolute",left:h*PXH,top:26,bottom:0,borderLeft:"1px solid rgba(255,255,255,0.04)",pointerEvents:"none"}}/>)}
        {/* Linha do agora */}
        {isToday&&<div style={{position:"absolute",left:nowSec*pxPerSec,top:0,bottom:0,width:2,background:"#ff3b3b",boxShadow:"0 0 8px #ff3b3b",zIndex:6,pointerEvents:"none"}}/>}
        {/* Blocos */}
        {filtered.map(p=>{
          const isD=drag?.id===p.id;
          const s=isD?drag.start:Number(p.horarioInicio);
          const du=isD&&drag.mode==="resize"?drag.dur:Number(p.duracao);
          const left=s*pxPerSec, w=Math.max(du*pxPerSec,40);
          const isMar=p.maratona===true||Number(p.duracao)>AUTO_MARATONA_MIN;
          const isProj=!!p._isProjected;
          const editProg=isProj?{...p,horarioInicio:p._srcHorarioInicio,horarioFim:Number(p._srcHorarioInicio)+Number(p.duracao),data:p._srcDate,_isProjected:false}:p;
          return <div key={p.id+"-"+s}
            onPointerDown={isProj?undefined:e=>{if(e.target.dataset&&e.target.dataset.handle)startDrag(e,p,"resize");else startDrag(e,p,"move")}}
            onPointerMove={isProj?undefined:moveDrag} onPointerUp={isProj?undefined:endDrag} onPointerCancel={isProj?undefined:endDrag}
            onDoubleClick={()=>onEdit(editProg)}
            title={isProj?`Projeção do ciclo ∞ — original em ${p._srcDate} · duplo clique para editar`:"Arraste para mover · borda direita = duração · duplo clique = editar"}
            style={{position:"absolute",left,width:w,top:32,height:ROWH-40,
              cursor:isProj?"pointer":isD?(drag.mode==="move"?"grabbing":"ew-resize"):"grab",
              background:isProj?`${ch?.cor||"#1a73e8"}18`:isD?`${ch?.cor||"#1a73e8"}55`:`${ch?.cor||"#1a73e8"}28`,
              border:`1px solid ${ch?.cor||"#1a73e8"}${isProj?"44":"88"}`,borderLeft:`4px solid ${isProj?"#4dd0e1":ch?.cor||"#1a73e8"}`,
              borderRadius:6,boxSizing:"border-box",touchAction:"none",zIndex:isD?5:1,
              boxShadow:isD?"0 6px 18px rgba(0,0,0,0.55)":"none",transition:isD?"none":"box-shadow 0.15s"}}>
            <div style={{padding:"7px 12px 0 10px",overflow:"hidden",height:"100%",boxSizing:"border-box",pointerEvents:"none"}}>
              <div style={{fontSize:12,fontWeight:700,color:isProj?"#4dd0e1":"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{isProj?"∞ ":isMar?"🏃 ":""}{p.nome}</div>
              <div style={{fontSize:10,color:s+du>86400?"#ffca28":"#aaa",marginTop:3,whiteSpace:"nowrap"}}>{fmtSec(s)} – {fmtSecX(s+du)} · {fDur(du)}{p.gcAlways?" · ♪":""}</div>
            </div>
            {!isProj&&<div data-handle="1" style={{position:"absolute",right:0,top:0,bottom:0,width:12,cursor:"ew-resize",borderRadius:"0 6px 6px 0",background:isD&&drag.mode==="resize"?`${ch?.cor||"#1a73e8"}aa`:"rgba(255,255,255,0.06)"}}/>}
            {isD&&<div style={{position:"absolute",top:-26,left:0,background:"#000",border:`1px solid ${ch?.cor||"#1a73e8"}`,color:"#fff",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:4,whiteSpace:"nowrap",zIndex:10,pointerEvents:"none"}}>{fmtSec(s)} – {fmtSecX(s+du)} · {fDur(du)}</div>}
          </div>;
        })}
        {filtered.length===0&&<div style={{position:"absolute",inset:"26px 0 0 0",display:"flex",alignItems:"center",justifyContent:"center",color:"#555",fontSize:13}}>Nenhum programa neste dia — adicione pelo botão abaixo</div>}
      </div>
    </div>
  </div>;
}

function TimelineView({programs,channels,selectedChannel,onEdit,onDelete,onReorder,onToggleSelect,selectedProgs}){
  // programs já vem filtrado por data+canal via dayProgs (inclui projeções do eternity)
  const filtered=programs.filter(p=>p.canalId===selectedChannel).sort((a,b)=>Number(a.horarioInicio)-Number(b.horarioInicio));
  const hasProjected = filtered.some(p=>p._isProjected);
  const [dragIdx,setDragIdx]=useState(null);
  const [overIdx,setOverIdx]=useState(null);

  const handleDragStart=(e,i)=>{setDragIdx(i);e.dataTransfer.effectAllowed="move"};
  const handleDragOver=(e,i)=>{e.preventDefault();setOverIdx(i)};
  const handleDrop=(e,i)=>{
    e.preventDefault();
    if(dragIdx!==null&&dragIdx!==i){
      const items=[...filtered];
      const [moved]=items.splice(dragIdx,1);
      items.splice(i,0,moved);
      // Recalculate start times
      let cur=0;
      const updated=items.map(p=>{ const np={...p,horarioInicio:cur,horarioFim:cur+p.duracao}; cur+=p.duracao; return np; });
      onReorder(updated);
    }
    setDragIdx(null);setOverIdx(null);
  };

  if(!filtered.length) return <div style={{padding:40,textAlign:"center",color:"#555",fontSize:14}}><div style={{fontSize:40,marginBottom:12}}>📭</div>Nenhum programa agendado.</div>;

  // Gaps
  const gaps=[];
  if(Number(filtered[0].horarioInicio)>0) gaps.push({start:0,end:Number(filtered[0].horarioInicio)});
  for(let i=0;i<filtered.length-1;i++) if(Number(filtered[i].horarioFim)<Number(filtered[i+1].horarioInicio)) gaps.push({start:Number(filtered[i].horarioFim),end:Number(filtered[i+1].horarioInicio)});
  if(Number(filtered[filtered.length-1].horarioFim)<86400) gaps.push({start:Number(filtered[filtered.length-1].horarioFim),end:86400});

  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {hasProjected&&<div style={{padding:"10px 14px",marginBottom:8,background:"rgba(0,188,212,0.08)",border:"1px solid rgba(0,188,212,0.25)",borderRadius:8,fontSize:12,color:"#4dd0e1",display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:16}}>∞</span>
      <span><b>Modo Eternity ativo:</b> programas exibidos são projetados do ciclo original. Clique em ✏️ para editar o programa na data em que foi cadastrado. Para adicionar programas neste dia, desative o Eternity primeiro.</span>
    </div>}
    {filtered.map((prog,i)=>{
      const ch=channels.find(c=>c.id===prog.canalId);
      const isMulti=prog.videos&&prog.videos.length>1;
      const thumb=prog.thumbnailType==="custom"&&prog.thumbnailUrl?prog.thumbnailUrl:ytThumb(prog.youtubeId||prog.videos?.[0]?.youtubeUrl);
      const isDragOver=overIdx===i&&dragIdx!==i;
      const dur=Number(prog.duracao);
      const isMaratona=prog.maratona===true||dur>AUTO_MARATONA_MIN;
      const blocos=isMaratona&&dur>Math.max(1800,Number(prog.blocoDuracao)||BLOCO_PADRAO)?computeBlocos(prog.horarioInicio,dur,prog.blocoDuracao):null;
      const isProj=!!prog._isProjected; // projeção do eternity — não permite drag
      return <div key={prog.id+"-"+i} style={{display:"flex",flexDirection:"column",gap:0}}>
      <div draggable={!isProj} onDragStart={isProj?undefined:e=>handleDragStart(e,i)} onDragOver={isProj?undefined:e=>handleDragOver(e,i)} onDrop={isProj?undefined:e=>handleDrop(e,i)} onDragEnd={isProj?undefined:()=>{setDragIdx(null);setOverIdx(null)}}
        style={{
          display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
          background:isProj?"rgba(0,188,212,0.05)":isDragOver?"rgba(26,115,232,0.15)":"rgba(255,255,255,0.03)",borderRadius:blocos?"6px 6px 0 0":6,
          border:isProj?"1px solid rgba(0,188,212,0.2)":isDragOver?"2px dashed #1a73e8":"1px solid rgba(255,255,255,0.06)",
          cursor:isProj?"default":"grab",transition:"all 0.15s",opacity:dragIdx===i?0.4:1,
        }}>
        {/* Checkbox - desabilitado para projeções */}
        <input type="checkbox" disabled={isProj} checked={!isProj&&selectedProgs.has(prog.id)} onChange={()=>!isProj&&onToggleSelect(prog.id)} style={{width:18,height:18,cursor:isProj?"not-allowed":"pointer",accentColor:"#4caf50",flexShrink:0,opacity:isProj?0.3:1}}/>
        {/* Drag handle ou badge eternity */}
        {isProj
          ? <span title={`Projeção do ciclo — original em ${prog._srcDate}`} style={{fontSize:12,color:"#4dd0e1",padding:"0 4px",flexShrink:0}}>∞</span>
          : <div style={{fontSize:16,color:"#555",cursor:"grab",padding:"0 4px"}}>⠿</div>}
        {/* Thumb */}
        {thumb?<img src={thumb} alt="" style={{width:64,height:40,borderRadius:4,objectFit:"cover",flexShrink:0}}/>:
          <div style={{width:64,height:40,borderRadius:4,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:18,opacity:0.3}}>🎬</span></div>}
        {/* Time */}
        <div style={{minWidth:85,textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{fmtSec(Number(prog.horarioInicio))}</div>
          {isMaratona?<div style={{fontSize:10,color:"#ffca28",fontWeight:700}}>até {fmtSecX(Number(prog.horarioFim))}</div>
           :<div style={{fontSize:10,color:Number(prog.horarioFim)>86400?"#ffca28":"#555",fontWeight:Number(prog.horarioFim)>86400?700:400}}>até {fmtSecX(Number(prog.horarioFim))}</div>}
        </div>
        <div style={{width:3,height:40,borderRadius:2,background:ch?.cor||"#555"}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
            <span style={{fontSize:14,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{prog.nome}</span>
            <span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:CC[prog.classificacao]||"#555",color:prog.classificacao==="L"?"#fff":"#000",fontWeight:700}}>{prog.classificacao}</span>
            {isProj&&<span title={`Projeção do ciclo — cadastrado em ${prog._srcDate}`} style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"rgba(0,188,212,0.2)",border:"1px solid rgba(0,188,212,0.35)",color:"#4dd0e1",fontWeight:700}}>∞ de {getDayLabel(prog._srcDate)}</span>}
            {isMaratona&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"rgba(255,202,40,0.2)",border:"1px solid rgba(255,202,40,0.4)",color:"#ffca28",fontWeight:800}}>🏃 MARATONA</span>}
            {prog.gcAlways&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"rgba(156,39,176,0.25)",color:"#ce93d8",fontWeight:700}}>♪ GC</span>}
            {prog.tags?.map(t=><span key={t} style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"rgba(255,255,255,0.08)",color:"#aaa",fontWeight:600}}>{t}</span>)}
          </div>
          <div style={{fontSize:11,color:"#888"}}>{fDur(dur)}</div>
        </div>
        <button
          title={isProj?`Editar programa original (cadastrado em ${prog._srcDate} às ${fmtSec(Number(prog._srcHorarioInicio))})`:"Editar programa"}
          onClick={()=>onEdit(isProj?{...prog,horarioInicio:prog._srcHorarioInicio,horarioFim:Number(prog._srcHorarioInicio)+Number(prog.duracao),data:prog._srcDate,_isProjected:false}:prog)}
          style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>✏️{isProj?" orig":""}</button>
        {!isProj&&<button onClick={()=>onDelete(prog.id)} style={{background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.3)",color:"#f44336",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>🗑️</button>}
      </div>
      {/* Blocos virtuais da Maratona (gerados automaticamente, aparecem assim no guia) */}
      {blocos&&<div style={{padding:"8px 14px 10px 60px",background:"rgba(255,202,40,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderTop:"none",borderRadius:"0 0 6px 6px"}}>
        <div style={{fontSize:10,fontWeight:700,color:"#ffca28",marginBottom:4}}>📋 NO GUIA (blocos automáticos — virtuais, não editáveis):</div>
        {blocos.map(b=><div key={b.i} style={{fontSize:11,color:"#999",padding:"2px 0",display:"flex",justifyContent:"space-between",maxWidth:480}}>
          <span>↳ 🏃 Maratona {prog.nome} ({b.i}/{b.total})</span>
          <span style={{color:"#666"}}>{fmtSecX(b.start)} → {fmtSecX(b.end)}</span>
        </div>)}
      </div>}
      </div>;
    })}

    {/* Gaps info */}
    {gaps.length>0&&<div style={{marginTop:8}}>
      <div style={{fontSize:11,color:"#ff9800",fontWeight:600,marginBottom:6}}>⚠️ Intervalos vazios:</div>
      {gaps.map((g,i)=><div key={i} style={{padding:"8px 12px",marginBottom:4,background:"rgba(255,152,0,0.06)",borderRadius:4,border:"1px solid rgba(255,152,0,0.15)",fontSize:12,color:"#ff9800",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>{fmtSec(g.start)} → {fmtSec(g.end)} ({secTo(g.end-g.start).h>0?`${secTo(g.end-g.start).h}h`:""}{ secTo(g.end-g.start).m>0?`${secTo(g.end-g.start).m}min`:""})</span>
        <span style={{fontSize:10,color:"#888"}}>Será preenchido com repetições</span>
      </div>)}
    </div>}
  </div>;
}

// ============================================
// PROGRAM MODAL
// ============================================
function ProgramModal({mode,program,channels,selectedChannel,selectedDate,existingPrograms,onSave,onClose}){
  const isEdit=mode==="edit";
  const [nome,setNome]=useState(program?.nome||"");
  const [canalId,setCanalId]=useState(program?.canalId??selectedChannel);
  const [classificacao,setClassificacao]=useState(program?.classificacao||"L");
  const [tags,setTags]=useState(program?.tags||["HD"]);
  const [sinopse,setSinopse]=useState(program?.sinopse||"");
  const [durationPreset,setDP]=useState(0);
  const [customH,setCH]=useState(program?Math.floor(program.duracao/3600):1);
  const [customM,setCM]=useState(program?Math.floor((program.duracao%3600)/60):0);
  const [videos,setVideos]=useState(program?.videos||[{youtubeUrl:program?.youtubeId||"",titulo:""}]);
  const [selectedVideos,setSelectedVideos]=useState(new Set());
  const [showBulkPaste,setShowBulkPaste]=useState(false);
  const [bulkText,setBulkText]=useState("");
  const [bulkStatus,setBulkStatus]=useState("");
  const [thumbnailType,setTT]=useState(program?.thumbnailType||"youtube");
  const [thumbnailUrl,setTU]=useState(program?.thumbnailUrl||null);
  const [gcAlways,setGcAlways]=useState(program?.gcAlways||false);
  const [maratona,setMaratona]=useState(program?.maratona||false);
  const [blocoDuracao,setBlocoDuracao]=useState(program?.blocoDuracao||BLOCO_PADRAO);
  const [isTemplate,setIsTemplate]=useState(program?.isTemplate||false);
  const [jingleType,setJingleType]=useState(program?.jingleType||"");  // ""=programa normal, "open"|"close"|"break"=vinheta
  const [isJingle,setIsJingle]=useState(program?.isJingle||false);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  // Start time
  const [startMode,setSM]=useState(isEdit?"custom":"auto");
  const [startH,setSH]=useState(isEdit?Math.floor(program.horarioInicio/3600):0);
  const [startM,setStartM]=useState(isEdit?Math.floor((program.horarioInicio%3600)/60):0);

  // Templates disponíveis (programas com isTemplate=true do mesmo canal ou sem canal)
  const templates=existingPrograms.filter(p=>p.isTemplate&&!p.isJingle).sort((a,b)=>a.nome.localeCompare(b.nome));
  const applyTemplate=(t)=>{
    setNome(t.nome);
    setClassificacao(t.classificacao||"L");
    setTags(t.tags||["HD"]);
    setSinopse(t.sinopse||"");
    setCH(Math.floor((t.duracao||3600)/3600));
    setCM(Math.floor(((t.duracao||3600)%3600)/60));
    setDP(0);
    setGcAlways(t.gcAlways||false);
    setMaratona(t.maratona||false);
    setBlocoDuracao(t.blocoDuracao||BLOCO_PADRAO);
    setTT(t.thumbnailType||"youtube");
    setTU(t.thumbnailUrl||null);
    // Não copia vídeos — só a estrutura do programa
  };

  const dur=durationPreset>0?durationPreset:parseDur(customH,customM);
  const channelProgs=existingPrograms.filter(p=>p.canalId===canalId&&p.data===selectedDate&&(!isEdit||p.id!==program?.id)).sort((a,b)=>a.horarioInicio-b.horarioInicio);

  const autoStart=(()=>{if(!channelProgs.length)return 0;return channelProgs[channelProgs.length-1].horarioFim})();
  const horIn=startMode==="custom"?startH*3600+startM*60:isEdit?program.horarioInicio:autoStart;
  const horFim=horIn+dur;
  const hasOverlap=channelProgs.some(p=>horIn<p.horarioFim&&horFim>p.horarioInicio);
  const yt=ytThumb(videos[0]?.youtubeUrl);
  const dispThumb=thumbnailType==="custom"&&thumbnailUrl?thumbnailUrl:yt;

  const save=async()=>{
    if(!nome.trim()){setError("Digite o nome");return}
    if(dur<300){setError("Mínimo 5 min");return}
    if(hasOverlap){setError("Conflito de horário!");return}
    if(!videos[0].youtubeUrl.trim()){setError("Adicione um vídeo");return}
    
    // Validação: ultrapassa 24h? (permitido: continua no dia seguinte)
    const totalSeconds=Number(horIn)+dur;
    if(totalSeconds>86400){
      const nextDayTime=fmtSecX(totalSeconds);
      const nBlocos=(maratona||dur>AUTO_MARATONA_MIN)?computeBlocos(horIn,dur,blocoDuracao).length:0;
      const msg=`⚠️ Este programa vai até ${nextDayTime}!\n\n`+
        (nBlocos>1?`Será exibido como MARATONA em ${nBlocos} blocos.\nO guia será preenchido automaticamente.\n\n`:``)+
        `✓ OK = Manter contínuo (atravessa a meia-noite)\n✕ Cancelar`;
      const continua=confirm(msg);
      if(!continua){setError("Operação cancelada");return}
    }
    
    setSaving(true);
    try {
      onSave({id:isEdit?program.id:`prog_${Date.now()}`,nome,canalId,classificacao,tags,sinopse,data:selectedDate,duracao:dur,horarioInicio:horIn,horarioFim:horFim,youtubeId:videos[0].youtubeUrl,videos:videos.filter(v=>v.youtubeUrl.trim()),thumbnailType,thumbnailUrl,gcAlways,maratona,blocoDuracao:Number(blocoDuracao)||BLOCO_PADRAO,isTemplate,isJingle,jingleType:isJingle?jingleType:""});
      setSaving(false);
    } catch(err) {
      console.error("Erro ao salvar:",err);
      setSaving(false);
      setError("Erro ao salvar programa");
    }
  };

  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,maxWidth:640,width:"100%",border:"1px solid rgba(255,255,255,0.1)",maxHeight:"92vh",overflowY:"auto"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:16,fontWeight:700,color:"#fff"}}>{isEdit?"✏️ Editar":"➕ Novo"} Programa</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>

        {/* Usar padrão existente */}
        {!isEdit&&templates.length>0&&<div style={{padding:"10px 14px",background:"rgba(255,202,40,0.06)",border:"1px solid rgba(255,202,40,0.2)",borderRadius:8}}>
          <div style={{fontSize:11,fontWeight:700,color:"#ffca28",marginBottom:8}}>📋 USAR PADRÃO DE PROGRAMA</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {templates.map(t=><button key={t.id} onClick={()=>applyTemplate(t)} style={{padding:"5px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,background:"rgba(255,202,40,0.1)",border:"1px solid rgba(255,202,40,0.3)",color:"#ffca28"}}>{t.nome}</button>)}
          </div>
          <div style={{fontSize:10,color:"#888",marginTop:6}}>Preenche o formulário com o padrão. Você ainda altera o horário e os vídeos.</div>
        </div>}

        {/* Canal */}
        <div><label style={lS}>CANAL</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {channels.filter(c=>!c.isInfo).map(c=><button key={c.id} onClick={()=>setCanalId(c.id)} style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:12,background:canalId===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:canalId===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:canalId===c.id?"#fff":"#888",display:"flex",alignItems:"center",gap:4}}><ChLogo ch={c} size={16}/> {c.nome}</button>)}
          </div>
        </div>

        {/* Nome */}
        <div><label style={lS}>NOME DO PROGRAMA</label>
          <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Ex: Documentário" style={{...iS,width:"100%"}}/></div>

        {/* Videos */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
            <label style={{...lS,marginBottom:0}}>VÍDEOS / PLAYLIST</label>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:10,color:"#555"}}>{videos.length} vídeo(s)</span>
              <input type="checkbox" checked={videos.length>0&&selectedVideos.size===videos.length} onChange={e=>{if(e.target.checked){const newSel=new Set();for(let i=0;i<videos.length;i++)newSel.add(i);setSelectedVideos(newSel)}else{setSelectedVideos(new Set())}}} title="Marcar/desmarcar todos" style={{width:14,height:14,cursor:"pointer",accentColor:"#4caf50"}}/>
              <button onClick={()=>{setBulkText("");setBulkStatus("");setShowBulkPaste(true)}} style={{fontSize:11,color:"#ffca28",background:"rgba(255,202,40,0.1)",border:"1px solid rgba(255,202,40,0.35)",padding:"4px 10px",borderRadius:3,cursor:"pointer",fontWeight:700}}>📋 Colar Playlist</button>
              <button onClick={async()=>{
                setError("🔍 Verificando vídeos (duração + disponibilidade)...");
                const videoCopy=[...videos];let totalDur=0,count=0,blocked=[];
                for(let i=0;i<videoCopy.length;i++){
                  const vId=extractYouTubeId(videoCopy[i].youtubeUrl);
                  if(vId){
                    const meta=await fetchYouTubeMetadata(vId);
                    if(meta){
                      const nv=[...videoCopy];
                      nv[i]={...nv[i],youtubeUrl:videoCopy[i].youtubeUrl,titulo:meta.title,duration:meta.duration,blocked:meta.blocked||false};
                      setVideos(nv);videoCopy[i]=nv[i];
                      totalDur+=meta.duration;count++;
                      if(meta.blocked)blocked.push(meta.title||vId);
                      if(i===0)setSinopse(meta.description);
                    }
                  }
                }
                if(totalDur>0){setCH(Math.floor(totalDur/3600));setCM(Math.floor((totalDur%3600)/60));setDP(0)}
                if(blocked.length>0){
                  setError(`⚠️ ${count} vídeo(s) verificados — ${blocked.length} BLOQUEADO(S) para embed: ${blocked.join(", ")}. Esses vídeos NÃO podem ser exibidos no iframe — remova-os ou substitua.`);
                } else {
                  setError(count>0?`✅ ${count} vídeo(s) verificados — todos disponíveis para exibição — duração total: ${fDur(totalDur)}`:"");
                }
              }} style={{fontSize:10,color:"#4caf50",background:"rgba(76,175,80,0.1)",border:"1px solid rgba(76,175,80,0.3)",padding:"2px 8px",borderRadius:3,cursor:"pointer",fontWeight:600}}>🔍 Buscar Todos</button>
            </div>
          </div>
          <div style={{fontSize:10,color:"#666",marginBottom:8,fontStyle:"italic"}}>💡 Cole a URL do YouTube num campo (uma por linha). Se colar um link de playlist (com <code>list=</code>), aparece o botão <b>🎵 Importar Playlist</b>. Para colar várias URLs de uma vez, use <b>📋 Colar Playlist</b>.</div>
          {/* Prévia da thumb que representa o programa no guia */}
          {videos[0]?.youtubeUrl&&ytThumb(videos[0].youtubeUrl)&&<div style={{marginBottom:10,display:"flex",alignItems:"center",gap:14,padding:"10px 14px",background:"rgba(255,255,255,0.03)",borderRadius:6,border:"1px solid rgba(255,255,255,0.06)"}}>
            <img src={thumbnailType==="custom"&&thumbnailUrl?thumbnailUrl:ytThumb(videos[0].youtubeUrl)} alt="Thumb do programa" style={{width:160,height:90,borderRadius:6,objectFit:"cover",border:"2px solid rgba(255,255,255,0.12)"}}/>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:4}}>📸 Imagem do programa no guia</div>
              <div style={{fontSize:11,color:"#888",lineHeight:1.4}}>Vem automaticamente do 1º vídeo da lista.<br/>Para usar outra, mude na seção THUMBNAIL abaixo<br/>ou reordene os vídeos (o 1º define a thumb).</div>
            </div>
          </div>}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {videos.map((v,i)=><div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:4,border:"1px solid rgba(255,255,255,0.06)"}}>
              <input type="checkbox" checked={selectedVideos.has(i)} onChange={()=>{const newSel=new Set(selectedVideos);if(newSel.has(i))newSel.delete(i);else newSel.add(i);setSelectedVideos(newSel)}} style={{width:16,height:16,cursor:"pointer",accentColor:"#4caf50",flexShrink:0}}/>
              <span style={{fontSize:11,color:"#555",fontWeight:700,minWidth:20}}>#{i+1}</span>
              {(()=>{const t=ytThumb(v.youtubeUrl);return t?<div style={{position:"relative",flexShrink:0}}><img src={t} alt="" style={{width:40,height:26,borderRadius:3,objectFit:"cover",opacity:v.blocked?0.4:1}}/>{v.blocked&&<span title="Bloqueado para embed — não pode ser exibido" style={{position:"absolute",top:-4,right:-4,background:"#f44336",color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800}}>!</span>}</div>:null})()}
              <input value={v.youtubeUrl}
                onChange={e=>{const nv=[...videos];nv[i]={...v,youtubeUrl:e.target.value};setVideos(nv)}}
                placeholder="Cole a URL do YouTube" style={{...iS,flex:1}}/>
              <input value={v.titulo||""} onChange={e=>{const nv=[...videos];nv[i]={...v,titulo:e.target.value};setVideos(nv)}} placeholder="Título" style={{...iS,width:120}}/>
              {extractPlaylistId(v.youtubeUrl)&&<button title="Detectada URL de playlist — buscar títulos dos vídeos" onClick={async()=>{
                const plId=extractPlaylistId(v.youtubeUrl);
                setError("🌐 Consultando o YouTube...");
                const items=await fetchYouTubePlaylistItems(plId);
                if(items.length===0){
                  const detail=window.__ytLastError||"resposta vazia";
                  setError(`❌ ${detail}. ${detail.includes("forbidden")||detail.includes("blocked")?"HABILITE a YouTube Data API v3 no Google Cloud (Biblioteca → YouTube Data API v3 → ATIVAR) — os vídeos continuam sendo servidos pelo YouTube normalmente, a API só busca os títulos.":"Verifique se a playlist é pública."}`);
                  return;
                }
                const before=videos.slice(0,i).filter(x=>x.youtubeUrl.trim()&&!extractPlaylistId(x.youtubeUrl));
                const after=videos.slice(i+1).filter(x=>x.youtubeUrl.trim());
                setVideos([...before,...items,...after]);
                setError("");
              }} style={{background:"rgba(255,202,40,0.15)",border:"1px solid rgba(255,202,40,0.4)",color:"#ffca28",padding:"6px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>🎵 Importar Playlist</button>}
              <button onClick={async()=>{const vId=extractYouTubeId(v.youtubeUrl);if(!vId){setError("URL YouTube inválida");return}const meta=await fetchYouTubeMetadata(vId);if(meta){const nv=[...videos];nv[i]={...nv[i],youtubeUrl:v.youtubeUrl,titulo:meta.title};setVideos(nv);setCH(Math.floor(meta.duration/3600));setCM(Math.floor((meta.duration%3600)/60));setSinopse(meta.description);setError("")}else setError("Erro ao buscar vídeo")}} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"6px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>🔍 Buscar</button>
              {videos.length>1&&<button onClick={()=>setVideos(videos.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#f44336",cursor:"pointer",fontSize:14}}>✕</button>}
            </div>)}
          </div>
          <button onClick={()=>setVideos([...videos,{youtubeUrl:"",titulo:""}])} style={{marginTop:8,padding:"8px 14px",borderRadius:4,cursor:"pointer",background:"rgba(76,175,80,0.1)",border:"1px solid rgba(76,175,80,0.3)",color:"#4caf50",fontSize:12,fontWeight:600,width:"100%"}}>+ Adicionar vídeo</button>
          {/* Ferramentas da playlist */}
          {videos.length>1&&<div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>{
              const clean=videos.map(v=>({...v,titulo:(v.titulo||"").replace(/\s*[\(\[](Official\s*(Music\s*)?Video|Lyric\s*Video|Audio|Clipe Oficial|Videoclipe|Vídeo Oficial|Official Audio|HD|HQ|4K|Remastered|ft\.?[^)\]]*|feat\.?[^)\]]*|prod\.?[^)\]]*)[\)\]]/gi,"").replace(/\s*(Official\s*(Music\s*)?Video|Lyric\s*Video|Official Audio|Clipe Oficial|Videoclipe|Vídeo Oficial)/gi,"").replace(/\s{2,}/g," ").trim()}));
              setVideos(clean);
            }} title="Remove 'Official Video', 'Clipe Oficial', etc. dos títulos" style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa"}}>🧹 Limpar nomes</button>
            <button onClick={()=>{
              const valid=videos.filter(v=>{
                const t=(v.titulo||"").toLowerCase();
                const titleBad=t.includes("deleted video")||t.includes("private video")||t.includes("vídeo removido")||t.includes("video privado");
                return v.youtubeUrl.trim()&&!titleBad&&!v.blocked;
              });
              if(valid.length<videos.length){setVideos(valid);setError(`🗑️ ${videos.length-valid.length} vídeo(s) deletado(s)/privado(s) removido(s)`)}else setError("✅ Nenhum vídeo deletado ou privado encontrado");
            }} title="Remove vídeos com título 'Deleted video', 'Private video' ou marcados como bloqueados pelo 🔍 Buscar Todos" style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa"}}>🗑️ Remover deletados/bloqueados</button>
            <button onClick={()=>{
              const shuffled=[...videos];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]}setVideos(shuffled);
            }} title="Embaralha a ordem dos vídeos" style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa"}}>🔀 Aleatorizar</button>
          </div>}
        </div>

        {/* Bulk paste modal */}
        {showBulkPaste&&<div onClick={()=>setShowBulkPaste(false)} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,maxWidth:640,width:"100%",border:"1px solid rgba(255,202,40,0.35)",padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <span style={{fontSize:16,fontWeight:700,color:"#ffca28"}}>📋 Colar Playlist</span>
              <button onClick={()=>setShowBulkPaste(false)} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            <div style={{fontSize:12,color:"#aaa",marginBottom:12,lineHeight:1.5}}>
              Cole aqui várias URLs do YouTube (uma por linha, ou separadas por espaço/vírgula).<br/>
              Também aceita uma URL de <b>playlist</b> tipo <code style={{background:"rgba(255,255,255,0.06)",padding:"1px 5px",borderRadius:3,fontSize:11}}>youtube.com/playlist?list=PL...</code> — os títulos são consultados via YouTube Data API. <span style={{color:"#777"}}>(Os vídeos continuam sendo servidos direto pelo YouTube em iframe, não são copiados.)</span>
            </div>
            <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)}
              placeholder={"https://youtu.be/dQw4w9WgXcQ\nhttps://youtu.be/9bZkp7q19f0\nhttps://youtube.com/watch?v=..."}
              style={{...iS,width:"100%",minHeight:180,fontFamily:"monospace",fontSize:12,resize:"vertical"}}/>
            {bulkStatus&&<div style={{marginTop:10,padding:"8px 12px",background:"rgba(76,175,80,0.1)",border:"1px solid rgba(76,175,80,0.3)",borderRadius:4,fontSize:12,color:"#69f0ae"}}>{bulkStatus}</div>}
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={()=>setShowBulkPaste(false)} style={{flex:1,padding:10,borderRadius:4,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:12}}>Cancelar</button>
              <button onClick={async()=>{
                setBulkStatus("Processando...");
                const plId=extractPlaylistId(bulkText);
                let items=[];
                if(plId){
                  setBulkStatus("🌐 Consultando playlist do YouTube...");
                  items=await fetchYouTubePlaylistItems(plId);
                  if(items.length===0){
                    const detail=window.__ytLastError||"resposta vazia";
                    setBulkStatus(`❌ ${detail}. ${detail.includes("forbidden")||detail.includes("blocked")?"HABILITE a YouTube Data API v3 no Google Cloud Console (Biblioteca → YouTube Data API v3 → ATIVAR).":"Verifique se a playlist é pública."} Você pode colar as URLs manualmente abaixo (uma por linha).`);
                    return;
                  }
                }
                if(items.length===0)items=parseYouTubeBulk(bulkText);
                if(items.length===0){setBulkStatus("❌ Nenhuma URL válida encontrada no texto colado");return}
                const existing=videos.filter(x=>x.youtubeUrl.trim()&&!extractPlaylistId(x.youtubeUrl));
                setVideos([...existing,...items]);
                setBulkStatus(`✅ ${items.length} vídeo(s) adicionado(s)`);
                setTimeout(()=>{setShowBulkPaste(false);setBulkText("");setBulkStatus("")},900);
              }} style={{flex:2,padding:10,borderRadius:4,cursor:"pointer",background:"linear-gradient(135deg,#ffca28,#ffa000)",border:"none",color:"#000",fontSize:12,fontWeight:700}}>📥 Importar</button>
            </div>
          </div>
        </div>}

        {/* Start time */}
        <div><label style={lS}>HORÁRIO DE INÍCIO</label>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <button onClick={()=>setSM("auto")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:startMode==="auto"?"#1a73e822":"rgba(255,255,255,0.04)",border:startMode==="auto"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:startMode==="auto"?"#4fc3f7":"#888"}}>⏩ Automático ({fmtSec(autoStart)})</button>
            <button onClick={()=>setSM("custom")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:startMode==="custom"?"#1a73e822":"rgba(255,255,255,0.04)",border:startMode==="custom"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:startMode==="custom"?"#4fc3f7":"#888"}}>🕐 Escolher horário</button>
          </div>
          {startMode==="custom"&&<div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="number" min="0" max="23" value={startH} onChange={e=>setSH(parseInt(e.target.value)||0)} style={{...iS,width:55,textAlign:"center"}}/><span style={{color:"#888"}}>h</span>
            <input type="number" min="0" max="59" value={startM} onChange={e=>setStartM(parseInt(e.target.value)||0)} style={{...iS,width:55,textAlign:"center"}}/><span style={{color:"#888"}}>min</span>
          </div>}
        </div>

        {/* Duration */}
        <div><label style={lS}>DURAÇÃO</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
            {DURATION_PRESETS.map(p=><button key={p.label} onClick={()=>{setDP(p.value);if(p.value>0){setCH(Math.floor(p.value/3600));setCM(Math.floor((p.value%3600)/60))}}} style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:12,background:(durationPreset===p.value||(p.value===0&&durationPreset===0))?"#1a73e8":"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:(durationPreset===p.value||(p.value===0&&durationPreset===0))?"#fff":"#888"}}>{p.label}</button>)}
          </div>
          {durationPreset===0&&<div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="number" min="0" max="99" value={customH} onChange={e=>setCH(e.target.value)} style={{...iS,width:55,textAlign:"center"}}/><span style={{color:"#888"}}>h</span>
            <input type="number" min="0" max="59" value={customM} onChange={e=>setCM(e.target.value)} style={{...iS,width:55,textAlign:"center"}}/><span style={{color:"#888"}}>min</span>
            {dur>86400&&<span style={{fontSize:11,color:"#ffca28",fontWeight:600}}>⚠️ +24h: atravessa {Math.floor(dur/86400)} dia(s)</span>}
          </div>}
        </div>

        {/* Exibição: GC + Maratona */}
        <div><label style={lS}>EXIBIÇÃO</label>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {/* Tipo: Vinheta/Intervalo */}
            <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:isJingle?"rgba(156,39,176,0.12)":"rgba(255,255,255,0.02)",border:isJingle?"1px solid rgba(156,39,176,0.35)":"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"}}>
              <input type="checkbox" checked={isJingle} onChange={e=>{setIsJingle(e.target.checked);if(e.target.checked&&!jingleType)setJingleType("break")}} style={{width:16,height:16,accentColor:"#9c27b0",cursor:"pointer"}}/>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:isJingle?"#ce93d8":"#ccc"}}>🎬 Vinheta / Intervalo</div>
              <div style={{fontSize:11,color:"#777"}}>Toca sem mostrar informações de programa na tela. Ideal para vinhetas de abertura, encerramento e intervalos comerciais.</div></div>
              {isJingle&&<select value={jingleType} onChange={e=>setJingleType(e.target.value)} onClick={e=>e.preventDefault()} style={{...iS,width:130,cursor:"pointer",flexShrink:0}}>
                <option value="open">🎬 Abertura</option>
                <option value="break">📢 Intervalo</option>
                <option value="close">🏁 Encerramento</option>
              </select>}
            </label>
            <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:gcAlways?"rgba(156,39,176,0.12)":"rgba(255,255,255,0.02)",border:gcAlways?"1px solid rgba(156,39,176,0.4)":"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"}}>
              <input type="checkbox" checked={gcAlways} onChange={e=>setGcAlways(e.target.checked)} style={{width:16,height:16,accentColor:"#9c27b0",cursor:"pointer"}}/>
              <div><div style={{fontSize:13,fontWeight:600,color:gcAlways?"#ce93d8":"#ccc"}}>♪ GC durante todo o programa</div>
              <div style={{fontSize:11,color:"#777"}}>Escolha manual: o GC fica fixo na tela enquanto este programa estiver no ar (em canais comuns o GC não entra sozinho; em canais 🎵 ele já entra no início/fim dos clipes)</div></div>
            </label>
            <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:maratona?"rgba(255,202,40,0.10)":"rgba(255,255,255,0.02)",border:maratona?"1px solid rgba(255,202,40,0.4)":"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"}}>
              <input type="checkbox" checked={maratona} onChange={e=>setMaratona(e.target.checked)} style={{width:16,height:16,accentColor:"#ffca28",cursor:"pointer"}}/>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:maratona?"#ffca28":"#ccc"}}>🏃 Modo Maratona</div>
              <div style={{fontSize:11,color:"#777"}}>Divide no guia em blocos "Maratona {nome||"..."} (1/N)". Playlists acima de 6h viram Maratona automaticamente.</div></div>
              {maratona&&<select value={blocoDuracao} onChange={e=>setBlocoDuracao(Number(e.target.value))} onClick={e=>e.preventDefault()} style={{...iS,width:110,cursor:"pointer"}}>
                <option value={7200}>Blocos 2h</option><option value={10800}>Blocos 3h</option><option value={14400}>Blocos 4h</option>
              </select>}
            </label>
            {(maratona||dur>AUTO_MARATONA_MIN)&&dur>Number(blocoDuracao||BLOCO_PADRAO)&&(()=>{const bls=computeBlocos(horIn,dur,blocoDuracao);return <div style={{padding:"10px 12px",background:"rgba(255,202,40,0.05)",border:"1px dashed rgba(255,202,40,0.3)",borderRadius:6}}>
              <div style={{fontSize:11,fontWeight:700,color:"#ffca28",marginBottom:6}}>📋 GRADE AUTOMÁTICA — {bls.length} blocos no guia:</div>
              {bls.map(b=><div key={b.i} style={{fontSize:11,color:"#bbb",padding:"3px 0",display:"flex",justifyContent:"space-between"}}>
                <span>🏃 Maratona {nome||"Programa"} ({b.i}/{b.total})</span>
                <span style={{color:"#888"}}>{fmtSecX(b.start)} → {fmtSecX(b.end)}</span>
              </div>)}
            </div>})()}
          </div>
        </div>


        {/* Thumbnail */}
        <div><label style={lS}>THUMBNAIL</label>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            <button onClick={()=>setTT("youtube")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:thumbnailType==="youtube"?"#f4433622":"rgba(255,255,255,0.04)",border:thumbnailType==="youtube"?"1px solid #f44336":"1px solid rgba(255,255,255,0.08)",color:thumbnailType==="youtube"?"#f44336":"#888"}}>▶ YouTube</button>
            <button onClick={()=>setTT("custom")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:thumbnailType==="custom"?"#1a73e822":"rgba(255,255,255,0.04)",border:thumbnailType==="custom"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:thumbnailType==="custom"?"#4fc3f7":"#888"}}>🖼️ Personalizada</button>
          </div>
          {thumbnailType==="youtube"&&yt&&<div style={{display:"flex",alignItems:"center",gap:10}}><img src={yt} alt="" style={{width:120,height:68,borderRadius:4,objectFit:"cover"}}/><span style={{fontSize:11,color:"#888"}}>Auto do YouTube</span></div>}
          {thumbnailType==="custom"&&<ImgUploader currentImage={thumbnailUrl} imageType={thumbnailUrl?"custom":"none"} onImageChange={({url})=>setTU(url)} label="" shape="wide"/>}
        </div>

        {/* Classification */}
        <div><label style={lS}>CLASSIFICAÇÃO</label>
          <div style={{display:"flex",gap:4}}>
            {CLASSIF_OPTIONS.map(c=><button key={c} onClick={()=>setClassificacao(c)} style={{width:36,height:36,borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:800,background:classificacao===c?CC[c]:"rgba(255,255,255,0.04)",border:classificacao===c?"2px solid #fff":"1px solid rgba(255,255,255,0.08)",color:classificacao===c?(c==="L"||c==="18"?"#fff":"#000"):"#888"}}>{c}</button>)}
          </div>
        </div>

        {/* Tags / Quality */}
        <div><label style={lS}>QUALIDADE E ÁUDIO</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[
              {id:"HD",label:"HD",cor:"#1a73e8"},
              {id:"SD",label:"SD",cor:"#607d8b"},
              {id:"4K",label:"4K",cor:"#e91e63"},
              {id:"DUB",label:"Dublado",cor:"#4caf50"},
              {id:"LEG",label:"Legendado",cor:"#ff9800"},
              {id:"5.1",label:"5.1 Surround",cor:"#9c27b0"},
              {id:"ORIG",label:"Áudio Original",cor:"#00bcd4"},
              {id:"INÉDITO",label:"Inédito",cor:"#f44336"},
              {id:"REPRISE",label:"Reprise",cor:"#795548"},
            ].map(tag=>{
              const active=tags.includes(tag.id);
              return <button key={tag.id} onClick={()=>{if(active)setTags(tags.filter(t=>t!==tag.id));else setTags([...tags,tag.id])}} style={{
                padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600,
                background:active?`${tag.cor}22`:"rgba(255,255,255,0.04)",
                border:active?`1px solid ${tag.cor}`:"1px solid rgba(255,255,255,0.08)",
                color:active?tag.cor:"#888",transition:"all 0.2s",
              }}>{tag.label}</button>;
            })}
          </div>
          {tags.length>0&&<div style={{marginTop:8,display:"flex",gap:4,flexWrap:"wrap"}}>
            {tags.map(t=><span key={t} style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:3,background:"rgba(255,255,255,0.08)",color:"#ccc"}}>{t}</span>)}
          </div>}
        </div>

        {/* Synopsis */}
        <div><label style={lS}>SINOPSE</label>
          <textarea value={sinopse} onChange={e=>setSinopse(e.target.value)} placeholder="Descrição..." style={{...iS,width:"100%",height:70,resize:"vertical",fontFamily:"inherit"}}/></div>

        {/* Preview */}
        <div style={{padding:14,background:"rgba(26,115,232,0.08)",borderRadius:8,border:"1px solid rgba(26,115,232,0.2)"}}>
          <div style={{fontSize:11,color:"#4fc3f7",fontWeight:700,marginBottom:8}}>👁️ PREVIEW</div>
          <div style={{display:"flex",gap:12,alignItems:"center"}}>
            {dispThumb?<img src={dispThumb} alt="" style={{width:80,height:50,borderRadius:4,objectFit:"cover"}}/>:
              <div style={{width:80,height:50,borderRadius:4,background:`linear-gradient(135deg,${channels.find(c=>c.id===canalId)?.cor||"#333"}44,#14161e)`,display:"flex",alignItems:"center",justifyContent:"center"}}><ChLogo ch={channels.find(c=>c.id===canalId)||channels[0]} size={24}/></div>}
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{nome||"Sem nome"}</div>
              <div style={{fontSize:12,color:"#888",marginTop:2}}>{fmtSec(horIn)} - {fmtSec(horFim)} · {channels.find(c=>c.id===canalId)?.nome}</div>
            </div>
          </div>
        </div>

        {hasOverlap&&<div style={{padding:10,background:"rgba(244,67,54,0.1)",borderRadius:6,border:"1px solid rgba(244,67,54,0.3)",fontSize:12,color:"#f44336"}}>❌ Conflito de horário!</div>}
        {error&&<div style={{padding:10,background:"rgba(244,67,54,0.1)",borderRadius:6,border:"1px solid rgba(244,67,54,0.3)",fontSize:12,color:"#f44336"}}>⚠️ {error}</div>}

        {/* Salvar como padrão */}
        <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:isTemplate?"rgba(255,202,40,0.08)":"rgba(255,255,255,0.02)",border:isTemplate?"1px solid rgba(255,202,40,0.35)":"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"}}>
          <input type="checkbox" checked={isTemplate} onChange={e=>setIsTemplate(e.target.checked)} style={{width:15,height:15,accentColor:"#ffca28",cursor:"pointer"}}/>
          <div><div style={{fontSize:12,fontWeight:600,color:isTemplate?"#ffca28":"#aaa"}}>📋 Salvar como padrão reutilizável</div>
          <div style={{fontSize:10,color:"#666"}}>O padrão aparece para uso rápido ao criar novos programas (só a estrutura — você altera os vídeos a cada vez)</div></div>
        </label>

        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:12,borderRadius:6,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:13,fontWeight:600}}>Cancelar</button>
          <button onClick={save} disabled={hasOverlap||saving} style={{flex:2,padding:12,borderRadius:6,cursor:hasOverlap||saving?"not-allowed":"pointer",background:hasOverlap||saving?"#333":"#1a73e8",border:"none",color:"#fff",fontSize:13,fontWeight:700,opacity:hasOverlap||saving?0.5:1}}>{saving?"⏳ Salvando...":isEdit?"💾 Salvar":"✅ Agendar"}</button>
        </div>
      </div>
    </div>
  </div>;
}

// ============================================
// CHANNEL EDITOR
// ============================================
function ChannelEditor({channels,onUpdate,onAdd,onDelete}){
  const [editing,setEditing]=useState(null);
  const [nome,setNome]=useState("");
  const [numero,setNumber]=useState(0);
  const [logo,setLogo]=useState("");
  const [logoType,setLT]=useState("emoji");
  const [logoUrl,setLU]=useState(null);
  const [cor,setCor]=useState("");
  const [gcAlways,setGcAlways]=useState(false);
  const [isMusic,setIsMusic]=useState(false);
  const [eternity,setEternity]=useState(false);
  const [eternityDays,setEternityDays]=useState(1);
  const [saving,setSaving]=useState(false);

  const startEdit=(ch)=>{setEditing(ch.id);setNome(ch.nome);setLogo(ch.logo);setLT(ch.logoType||"emoji");setLU(ch.logoUrl||null);setCor(ch.cor);setNumber(ch.numero||0);setGcAlways(ch.gcAlways||false);setIsMusic(ch.isMusic||false);setEternity(ch.eternity||false);setEternityDays(ch.eternityDays||1)};
  const save=async()=>{
    setSaving(true);
    try {
      const updated = {nome,numero,logo,logoType,logoUrl,cor,gcAlways,isMusic,eternity,eternityDays:Number(eternityDays)||1};
      await updateDoc(doc(db,"channels",editing), updated);
      setEditing(null);
    } catch(err) {
      console.error("Erro ao salvar canal:", err);
      alert("Erro ao salvar canal");
    }
    setSaving(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:8}}>
    {channels.map(ch=><div key={ch.id} style={{padding:16,borderRadius:8,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
      {editing===ch.id?<div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",gap:12}}>
          <div style={{flex:1}}><label style={lS}>NOME</label><input value={nome} onChange={e=>setNome(e.target.value)} style={{...iS,width:"100%"}}/></div>
          <div style={{width:80}}><label style={lS}>NÚMERO</label><input type="number" value={numero} onChange={e=>setNumber(parseInt(e.target.value)||0)} min="1" max="999" style={{...iS,width:"100%"}}/></div>
        </div>
        <div><label style={lS}>TIPO DE LOGO</label>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            <button onClick={()=>setLT("emoji")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:logoType==="emoji"?"#1a73e822":"rgba(255,255,255,0.04)",border:logoType==="emoji"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:logoType==="emoji"?"#4fc3f7":"#888"}}>😀 Emoji</button>
            <button onClick={()=>setLT("custom")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:logoType==="custom"?"#1a73e822":"rgba(255,255,255,0.04)",border:logoType==="custom"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:logoType==="custom"?"#4fc3f7":"#888"}}>🖼️ Imagem</button>
          </div>
          {logoType==="emoji"&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{EMOJI_LIST.map(e=><button key={e} onClick={()=>setLogo(e)} style={{width:36,height:36,borderRadius:4,cursor:"pointer",fontSize:18,background:logo===e?"rgba(26,115,232,0.3)":"rgba(255,255,255,0.04)",border:logo===e?"2px solid #1a73e8":"1px solid rgba(255,255,255,0.06)"}}>{e}</button>)}</div>}
          {logoType==="custom"&&<ImgUploader currentImage={logoUrl} imageType={logoUrl?"custom":"none"} onImageChange={({url})=>setLU(url)} label="" shape="square"/>}
        </div>
        <div><label style={lS}>COR</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{COLOR_LIST.map(c=><button key={c} onClick={()=>setCor(c)} style={{width:36,height:36,borderRadius:4,cursor:"pointer",background:c,border:cor===c?"3px solid #fff":"2px solid transparent"}}/>)}</div>
        </div>
        {/* GC + Eternity */}
        <div><label style={lS}>MODOS DO CANAL</label>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:isMusic?"rgba(0,255,127,0.08)":"rgba(255,255,255,0.02)",border:isMusic?"1px solid rgba(0,255,127,0.35)":"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"}}>
              <input type="checkbox" checked={isMusic} onChange={e=>setIsMusic(e.target.checked)} style={{width:16,height:16,accentColor:"#00e676",cursor:"pointer"}}/>
              <div><div style={{fontSize:13,fontWeight:600,color:isMusic?"#69f0ae":"#ccc"}}>🎵 Canal de Música (GC automático de clipes)</div>
              <div style={{fontSize:11,color:"#777"}}>O GC entra sozinho no início e no fim de cada clipe, mostrando a música que está tocando + a próxima (estilo canal de clipes)</div></div>
            </label>
            <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:gcAlways?"rgba(156,39,176,0.12)":"rgba(255,255,255,0.02)",border:gcAlways?"1px solid rgba(156,39,176,0.4)":"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"}}>
              <input type="checkbox" checked={gcAlways} onChange={e=>setGcAlways(e.target.checked)} style={{width:16,height:16,accentColor:"#9c27b0",cursor:"pointer"}}/>
              <div><div style={{fontSize:13,fontWeight:600,color:gcAlways?"#ce93d8":"#ccc"}}>♪ GC sempre ativo neste canal</div>
              <div style={{fontSize:11,color:"#777"}}>Escolha manual: o GC fica fixo na tela em todos os programas (canais comuns não têm GC automático)</div></div>
            </label>
            <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:eternity?"rgba(0,188,212,0.10)":"rgba(255,255,255,0.02)",border:eternity?"1px solid rgba(0,188,212,0.4)":"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"}}>
              <input type="checkbox" checked={eternity} onChange={e=>setEternity(e.target.checked)} style={{width:16,height:16,accentColor:"#00bcd4",cursor:"pointer"}}/>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:eternity?"#4dd0e1":"#ccc"}}>∞ Modo Eternity</div>
              <div style={{fontSize:11,color:"#777"}}>A grade deste canal se repete para sempre até você desligar</div></div>
              {eternity&&<select value={eternityDays} onChange={e=>setEternityDays(Number(e.target.value))} onClick={e=>e.preventDefault()} style={{...iS,width:130,cursor:"pointer"}}>
                {[1,2,3,4,5,6,7].map(d=><option key={d} value={d}>Ciclo: {d} dia{d>1?"s":""}</option>)}
              </select>}
            </label>
          </div>
        </div>
        {/* Preview */}
        <div style={{padding:12,background:"rgba(26,115,232,0.08)",borderRadius:8,border:"1px solid rgba(26,115,232,0.2)"}}>
          <div style={{fontSize:11,color:"#4fc3f7",fontWeight:700,marginBottom:8}}>👁️ PREVIEW</div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:48,height:48,borderRadius:6,background:`${cor}22`,border:`2px solid ${cor}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
              {logoType==="custom"&&logoUrl?<img src={logoUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:28}}>{logo}</span>}
            </div>
            <div><div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{nome||"Sem nome"}</div><div style={{fontSize:12,color:"#888"}}>Canal {ch.numero}</div></div>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setEditing(null)} style={{flex:1,padding:10,borderRadius:4,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:12}}>Cancelar</button>
          <button onClick={save} style={{flex:1,padding:10,borderRadius:4,cursor:"pointer",background:"#1a73e8",border:"none",color:"#fff",fontSize:12,fontWeight:700,opacity:saving?0.5:1}}>{saving?"Salvando...":"💾 Salvar"}</button>
        </div>
      </div>
      :<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:44,height:44,borderRadius:6,background:`${ch.cor}22`,border:`1px solid ${ch.cor}44`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}><ChLogo ch={ch} size={ch.logoType==="custom"?44:28}/></div>
          <div><div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{ch.nome}</div><div style={{fontSize:11,color:"#888"}}>Canal {ch.numero}</div></div>
          <div style={{width:16,height:16,borderRadius:4,background:ch.cor,marginLeft:8}}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>startEdit(ch)} style={{padding:"8px 16px",borderRadius:4,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:12}}>✏️ Editar</button>
          <button onClick={()=>onDelete(ch)} style={{padding:"8px 16px",borderRadius:4,cursor:"pointer",background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.2)",color:"#f44336",fontSize:12}}>🗑️ Deletar</button>
        </div>
      </div>}
    </div>)}

    {/* Add channel */}
    <button onClick={onAdd} style={{padding:14,borderRadius:8,cursor:"pointer",background:"rgba(76,175,80,0.08)",border:"2px dashed rgba(76,175,80,0.3)",color:"#4caf50",fontSize:13,fontWeight:600}}>+ Adicionar Novo Canal</button>
  </div>;
}

// ============================================
// DUP MODAL
// ============================================
function DupModal({dates,onDup,onClose}){
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,padding:24,maxWidth:400,width:"90%",border:"1px solid rgba(255,255,255,0.1)"}}>
      <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:16}}>📋 Duplicar Programação</div>
      <div style={{marginBottom:12}}><label style={lS}>DE</label><select value={from} onChange={e=>setFrom(e.target.value)} style={{...iS,width:"100%",cursor:"pointer"}}><option value="">Selecione...</option>{dates.map(d=><option key={d} value={d}>{getDayLabel(d)}</option>)}</select></div>
      <div style={{marginBottom:16}}><label style={lS}>PARA</label><select value={to} onChange={e=>setTo(e.target.value)} style={{...iS,width:"100%",cursor:"pointer"}}><option value="">Selecione...</option>{dates.map(d=><option key={d} value={d}>{getDayLabel(d)}</option>)}</select></div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,borderRadius:6,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",cursor:"pointer",fontSize:13}}>Cancelar</button>
        <button onClick={()=>{if(from&&to){onDup(from,to);onClose()}}} disabled={!from||!to||from===to} style={{flex:1,padding:10,borderRadius:6,background:(!from||!to||from===to)?"#333":"#1a73e8",border:"none",color:"#fff",cursor:(!from||!to||from===to)?"not-allowed":"pointer",fontSize:13,fontWeight:700}}>Duplicar</button>
      </div>
    </div>
  </div>;
}

// ============================================
// MAIN
// ============================================
// ============================================
// JINGLES TAB — Vinhetas de abertura/encerramento e intervalos comerciais
// Vinheta = programa do tipo "vinheta" (isJingle:true, jingleType:"open"|"close"|"break")
// Intervalo = programa com tipo "break" inserido entre blocos de programas normais
// O TV.jsx detecta esses tipos e os toca sem nenhum visual de programa (tela limpa)
// ============================================
function JinglesTab({programs,channels,selCh,setSelCh,dates,selDate,setSelDate,notify}){
  const [showModal,setShowModal]=useState(false);
  const [editJingle,setEditJingle]=useState(null);
  const [saving,setSaving]=useState(false);
  const [form,setForm]=useState({nome:"",canalId:selCh||"",jingleType:"open",youtubeUrl:"",duracao:30,horarioInicio:0,data:selDate||""});

  const iS={background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:4,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none",width:"100%"};
  const lS={fontSize:11,color:"#888",fontWeight:700,letterSpacing:0.5,marginBottom:6,display:"block"};

  const jingles=programs.filter(p=>p.isJingle&&(!selCh||p.canalId===selCh)&&(!selDate||p.data===selDate))
    .sort((a,b)=>Number(a.horarioInicio)-Number(b.horarioInicio));

  const openAdd=()=>{
    setForm({nome:"",canalId:selCh||channels[0]?.id||"",jingleType:"open",youtubeUrl:"",duracao:30,horarioInicio:0,data:selDate||dates[0]||""});
    setEditJingle(null);setShowModal(true);
  };
  const openEdit=(j)=>{
    setForm({nome:j.nome,canalId:j.canalId,jingleType:j.jingleType||"open",youtubeUrl:j.youtubeId||"",duracao:Number(j.duracao),horarioInicio:Number(j.horarioInicio),data:j.data});
    setEditJingle(j);setShowModal(true);
  };
  const handleSave=async()=>{
    if(!form.youtubeUrl.trim()){notify("❌ URL do YouTube é obrigatória");return}
    setSaving(true);
    const vidId=extractYouTubeId(form.youtubeUrl.trim());
    const dur=Number(form.duracao)||30;
    const start=Number(form.horarioInicio)||0;
    const payload={
      nome:form.nome||({open:"Vinheta de Abertura",close:"Vinheta de Encerramento",break:"Intervalo Comercial"}[form.jingleType]),
      canalId:form.canalId,
      isJingle:true,
      jingleType:form.jingleType,
      youtubeId:vidId||form.youtubeUrl.trim(),
      videos:[{youtubeUrl:form.youtubeUrl.trim(),titulo:form.nome||"",duration:dur}],
      duracao:dur,
      horarioInicio:start,
      horarioFim:start+dur,
      data:form.data,
      classificacao:"L",tags:["HD"],
    };
    try{
      if(editJingle){await updateDoc(doc(db,"programs",String(editJingle.id)),payload);notify("✅ Vinheta atualizada");}
      else{await addDoc(collection(db,"programs"),payload);notify("✅ Vinheta adicionada");}
      setShowModal(false);
    }catch(err){console.error(err);notify("❌ Erro ao salvar");}
    setSaving(false);
  };
  const handleDelete=async(j)=>{
    if(!confirm(`Remover "${j.nome}"?`))return;
    try{await deleteDoc(doc(db,"programs",String(j.id)));notify("🗑️ Removido");}catch(err){notify("❌ Erro ao remover")}
  };
  const TYPE_LABELS={open:"🎬 Abertura",close:"🏁 Encerramento",break:"📢 Intervalo"};
  const TYPE_COLORS={open:"rgba(76,175,80,0.2)",close:"rgba(244,67,54,0.15)",break:"rgba(255,152,0,0.15)"};
  const TYPE_BORDER={open:"rgba(76,175,80,0.4)",close:"rgba(244,67,54,0.35)",break:"rgba(255,152,0,0.35)"};

  return <div>
    {/* Filtros */}
    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <select value={selCh||""} onChange={e=>setSelCh(e.target.value)} style={{...iS,width:180}}>
        <option value="">Todos os canais</option>
        {channels.filter(c=>!c.isInfo).map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
      </select>
      <select value={selDate||""} onChange={e=>setSelDate(e.target.value)} style={{...iS,width:160}}>
        {dates.map(d=><option key={d} value={d}>{d}</option>)}
      </select>
      <div style={{flex:1}}/>
      <button onClick={openAdd} style={{padding:"10px 18px",borderRadius:6,cursor:"pointer",background:"linear-gradient(135deg,#9c27b0,#ba68c8)",border:"none",color:"#fff",fontSize:13,fontWeight:700}}>+ Adicionar Vinheta</button>
    </div>

    {/* Explicação */}
    <div style={{marginBottom:16,padding:"12px 16px",background:"rgba(156,39,176,0.08)",border:"1px solid rgba(156,39,176,0.2)",borderRadius:8,fontSize:12,color:"#bbb",lineHeight:1.6}}>
      <b style={{color:"#ce93d8"}}>🎬 Abertura:</b> toca no início do canal (antes do primeiro programa do dia).<br/>
      <b style={{color:"#ef9a9a"}}>🏁 Encerramento:</b> toca ao fim do dia ou ao término de um bloco.<br/>
      <b style={{color:"#ffcc80"}}>📢 Intervalo:</b> inserido entre programas. O player detecta e executa sem mostrar informações de programa.<br/>
      <span style={{color:"#777"}}>Configure o horário de início exato e a duração do clipe. A grade se mantém sincronizada.</span>
    </div>

    {/* Lista */}
    {jingles.length===0&&<div style={{padding:40,textAlign:"center",color:"#555"}}>Nenhuma vinheta cadastrada para esta seleção.</div>}
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {jingles.map(j=>{
        const ch=channels.find(c=>c.id===j.canalId);
        const thumb=j.youtubeId?`https://img.youtube.com/vi/${j.youtubeId}/mqdefault.jpg`:null;
        return <div key={j.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:8,background:TYPE_COLORS[j.jingleType]||"rgba(255,255,255,0.03)",border:`1px solid ${TYPE_BORDER[j.jingleType]||"rgba(255,255,255,0.06)"}`}}>
          {thumb&&<img src={thumb} alt="" style={{width:64,height:40,borderRadius:4,objectFit:"cover",flexShrink:0}}/>}
          <div style={{minWidth:120,flexShrink:0}}>
            <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:2}}>{fmtSec(j.horarioInicio)}</div>
            <div style={{fontSize:10,color:"#666"}}>até {fmtSec(Number(j.horarioInicio)+Number(j.duracao))}</div>
          </div>
          <div style={{width:3,height:40,borderRadius:2,background:ch?.cor||"#555",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
              <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{j.nome}</span>
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:TYPE_COLORS[j.jingleType],border:`1px solid ${TYPE_BORDER[j.jingleType]}`,color:"#fff",fontWeight:700}}>{TYPE_LABELS[j.jingleType]||j.jingleType}</span>
            </div>
            <div style={{fontSize:11,color:"#888"}}>{ch?.nome||j.canalId} · {fDur(Number(j.duracao))}</div>
          </div>
          <button onClick={()=>openEdit(j)} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>✏️</button>
          <button onClick={()=>handleDelete(j)} style={{background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.3)",color:"#f44336",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>🗑️</button>
        </div>;
      })}
    </div>

    {/* Modal de edição */}
    {showModal&&<div onClick={()=>setShowModal(false)} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,maxWidth:500,width:"100%",border:"1px solid rgba(255,255,255,0.1)",padding:24,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:20}}>{editJingle?"Editar":"Nova"} Vinheta / Intervalo</div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div><label style={lS}>TIPO</label>
            <div style={{display:"flex",gap:8}}>
              {[{v:"open",l:"🎬 Abertura"},{v:"close",l:"🏁 Encerramento"},{v:"break",l:"📢 Intervalo"}].map(o=>
                <button key={o.v} onClick={()=>setForm(f=>({...f,jingleType:o.v}))} style={{flex:1,padding:"8px 0",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,background:form.jingleType===o.v?"#9c27b0":"rgba(255,255,255,0.06)",border:form.jingleType===o.v?"1px solid #ba68c8":"1px solid rgba(255,255,255,0.1)",color:form.jingleType===o.v?"#fff":"#aaa"}}>{o.l}</button>)}
            </div>
          </div>
          <div><label style={lS}>CANAL</label>
            <select value={form.canalId} onChange={e=>setForm(f=>({...f,canalId:e.target.value}))} style={iS}>
              {channels.filter(c=>!c.isInfo).map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><label style={lS}>DATA</label>
            <select value={form.data} onChange={e=>setForm(f=>({...f,data:e.target.value}))} style={iS}>
              {dates.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div><label style={lS}>NOME (opcional)</label>
            <input value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} placeholder="Ex: Vinheta de Abertura TREND TV" style={iS}/>
          </div>
          <div><label style={lS}>URL DO YOUTUBE (vídeo da vinheta)</label>
            <input value={form.youtubeUrl} onChange={e=>setForm(f=>({...f,youtubeUrl:e.target.value}))} placeholder="https://youtu.be/..." style={iS}/>
          </div>
          <div style={{display:"flex",gap:10}}>
            <div style={{flex:1}}><label style={lS}>HORÁRIO DE INÍCIO</label>
              <input type="time" value={fmtSec(form.horarioInicio)} onChange={e=>{const[h,m]=e.target.value.split(":");setForm(f=>({...f,horarioInicio:(parseInt(h)||0)*3600+(parseInt(m)||0)*60}))}} style={iS}/>
              <div style={{fontSize:10,color:"#666",marginTop:4}}>{fmtSec(form.horarioInicio)}</div>
            </div>
            <div style={{flex:1}}><label style={lS}>DURAÇÃO (segundos)</label>
              <input type="number" min="5" max="600" value={form.duracao} onChange={e=>setForm(f=>({...f,duracao:Number(e.target.value)}))} style={iS}/>
              <div style={{fontSize:10,color:"#666",marginTop:4}}>{fDur(form.duracao)}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={()=>setShowModal(false)} style={{flex:1,padding:12,borderRadius:6,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:13}}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{flex:2,padding:12,borderRadius:6,cursor:"pointer",background:"linear-gradient(135deg,#9c27b0,#ba68c8)",border:"none",color:"#fff",fontSize:13,fontWeight:700}}>{saving?"Salvando...":"✓ Salvar"}</button>
          </div>
        </div>
      </div>
    </div>}
  </div>;
}

export default function AdminPanel(){
  // Gera 7 dias passados + 30 dias futuros para ver programas base do eternity
  // Recalcula a janela de datas sempre que o componente re-renderiza
  // (não pode usar useMemo com [] pois congela as datas no momento do mount)
  const dates = (()=>{
    const ds=[], d=new Date(getToday()+"T00:00:00");
    for(let i=0;i<30;i++){
      const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0");
      ds.push(`${y}-${m}-${da}`);
      d.setDate(d.getDate()+1);
    }
    return ds;
  })();
  const [tab,setTab]=useState("schedule");
  const [selDate,setSelDate]=useState(getToday());
  // Garante que selDate nunca fica em um dia que não existe mais nas datas disponíveis
  const effectiveSelDate = dates.includes(selDate) ? selDate : getToday();
  const [selCh,setSelCh]=useState(null);
  const [viewMode,setViewMode]=useState("lista"); // "lista" | "grade"
  const [channels,setCh]=useState(DEFAULT_CHANNELS);
  const [programs,setProgs]=useState([]);
  const [showModal,setSM]=useState(false);
  const [editProg,setEP]=useState(null);
  const [showCloneModal,setShowCloneModal]=useState(false);
  const [cloneMenuProgs,setCloneMenuProgs]=useState([]);
  const [selectedProgs,setSelectedProgs]=useState(new Set());
  const [cloneData,setCloneData]=useState({channel:"",date:null,time:""});
  const [showDup,setSD]=useState(false);
  const [toast,setToast]=useState("");

  const notify=(m)=>{setToast(m);setTimeout(()=>setToast(""),3000)};

  // Firebase listeners
  useEffect(() => {
    console.log("📱 Firebase listeners iniciando...");
    
    // Load channels
    const unsubCh = onSnapshot(collection(db, "channels"), (snap) => {
      const list = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      console.log("✅ Canais carregados:", list.length, list);
      if (list.length > 0) {
        const sorted = list.sort((a,b) => (a.numero||0) - (b.numero||0));
        setCh(sorted);
        setSelCh(prev => prev || sorted[0].id);
      }
    }, (err) => {
      console.error("❌ Erro ao carregar canais:", err);
    });

    // Load programs
    const unsubPr = onSnapshot(collection(db, "programs"), (snap) => {
      console.log("📊 Snapshot recebido:", snap.size, "docs");
      const list = snap.docs.map(doc => {
        const data = doc.data();
        console.log("  📄 Doc:", doc.id, "→", data.nome || "(sem nome)");
        return { ...data, id: doc.id };
      });
      console.log("✅ Programas carregados:", list.length);
      if (list.length > 0) {
        console.log("   🎬 Amostra:", {
          nome: list[0].nome,
          data: list[0].data,
          canalId: list[0].canalId,
          horarioInicio: list[0].horarioInicio
        });
      }
      setProgs(list);
    }, (err) => {
      console.error("❌ Erro Firebase programs:", err.code, err.message);
    });

    return () => {
      console.log("🔌 Desconectando listeners");
      unsubCh();
      unsubPr();
    };
  }, []);

  const handleSave = async (p) => {
    try {
      // Validação de overlap
      const conflicts = programs.filter(x => 
        x.data === p.data && 
        x.canalId === p.canalId && 
        x.id !== p.id && 
        !(x.horarioFim <= p.horarioInicio || x.horarioInicio >= p.horarioFim)
      );
      
      if (conflicts.length > 0) {
        notify("⚠️ Conflito de horário com outro programa!");
        return;
      }

      // Persistir no Firestore FIRST
      if (editProg) {
        // Update existing
        await updateDoc(doc(db, "programs", p.id), p);
      } else {
        // Add new
        const ref = await addDoc(collection(db, "programs"), p);
        p.id = ref.id; // Update ID with Firebase ID
      }

      // THEN update local state (only if Firebase save succeeded)
      if (editProg) setProgs(programs.map(x => x.id === p.id ? p : x));
      else setProgs([...programs, p]);

      notify(editProg ? "✅ Atualizado!" : "✅ Agendado!");
      setSM(false);
      setEP(null);
    } catch (err) {
      console.error("Erro ao salvar:", err);
      notify("❌ Erro ao salvar");
    }
  };
  const handleDel = async (id) => {
    try {
      setProgs(programs.filter(p => p.id !== id));
      await deleteDoc(doc(db, "programs", id));
      notify("🗑️ Removido");
    } catch (err) {
      console.error("Erro ao deletar:", err);
      notify("❌ Erro ao deletar");
      // Reverter estado se falhar
      setProgs(programs);
    }
  };
  const handleDup=(from,to)=>{
    const fp=programs.filter(p=>p.data===from);
    const np=fp.map(p=>({...p,id:`prog_${Date.now()}_${Math.random().toString(36).slice(2)}`,data:to}));
    setProgs([...programs.filter(p=>p.data!==to),...np]);
    notify(`📋 ${np.length} copiados!`);
  };
  const handleReorder=(updated)=>{
    setProgs([...programs.filter(p=>!(p.canalId===selCh&&p.data===selDate)),...updated]);
    notify("🔄 Reordenado!");
  };
  const addChannel=async()=>{
    try {
      const maxNum=channels.length>0?Math.max(...channels.map(c=>c.numero||0)):0;
      const newCh={numero:maxNum+1,nome:`Canal ${maxNum+1}`,logo:"📺",logoType:"emoji",logoUrl:null,cor:COLOR_LIST[channels.length%COLOR_LIST.length]};
      await addDoc(collection(db,"channels"),newCh);
      notify("📺 Canal adicionado!");
    } catch(err) {
      console.error("Erro ao adicionar canal:", err);
      notify("❌ Erro ao adicionar canal");
    }
  };

  const delChannel=async(ch)=>{
    if(!confirm(`Deletar canal "${ch.nome}"? Isso não deletará os programas agendados.`)) return;
    try {
      await deleteDoc(doc(db,"channels",ch.id));
      notify("🗑️ Canal deletado");
    } catch(err) {
      console.error("Erro ao deletar canal:", err);
      notify("❌ Erro ao deletar canal");
    }
  };

  // Task 3: Create Sky channel if it doesn't exist
  const createSkyChannel=async()=>{
    try {
      const skyCh={numero:32,nome:"Sky",logo:"📡",logoType:"emoji",logoUrl:null,cor:"#1a73e8"};
      await addDoc(collection(db,"channels"),skyCh);
      notify("📺 Canal Sky criado!");
    } catch(err) {
      console.error("Erro ao criar canal Sky:", err);
      notify("❌ Erro ao criar canal Sky");
    }
  };

  // Task 5: Clone program - QUICK clone (auto after last program on current channel)
  const handleQuickClone=async()=>{
    if(cloneMenuProgs.length===0)return;
    try {
      // Use selected date, not always today
      const targetDate=selDate;
      const channelProgsOnDate=programs.filter(p=>p.canalId===selCh&&p.data===targetDate).sort((a,b)=>Number(b.horarioFim)-Number(a.horarioFim));
      let startTime=channelProgsOnDate.length>0?Number(channelProgsOnDate[0].horarioFim):0;
      
      for(const sourceProgram of cloneMenuProgs){
        const endTime=startTime+Number(sourceProgram.duracao);
        const newProg={
          nome:sourceProgram.nome,
          canalId:selCh,
          data:targetDate,
          horarioInicio:startTime,
          horarioFim:endTime,
          duracao:sourceProgram.duracao,
          youtubeId:sourceProgram.youtubeId,
          videos:sourceProgram.videos,
          sinopse:sourceProgram.sinopse,
          classificacao:sourceProgram.classificacao,
          tags:sourceProgram.tags||[],
          thumbnailType:sourceProgram.thumbnailType,
          thumbnailUrl:sourceProgram.thumbnailUrl
        };
        await addDoc(collection(db,"programs"),newProg);
        startTime=endTime;
      }
      setCloneMenuProgs([]);
      setSelectedProgs(new Set());
      notify(`✅ ${cloneMenuProgs.length} programa(s) clonado(s)!`);
    } catch(err) {
      console.error("Erro ao clonar programa:",err);
      notify("❌ Erro ao clonar programa");
    }
  };

  // Task 5: Clone program - ADVANCED clone (to another channel/date)
  const handleAdvancedClone=async()=>{
    if(!cloneData.channel||cloneData.channel===""||cloneMenuProgs.length===0){setError("Selecione um canal");return}
    try {
      let startTime=Number(cloneData.time)||0;
      const targetDate=cloneData.date||getToday();
      
      for(const sourceProgram of cloneMenuProgs){
        const endTime=startTime+Number(sourceProgram.duracao);
        const newProg={
          nome:sourceProgram.nome,
          canalId:cloneData.channel,
          data:targetDate,
          horarioInicio:startTime,
          horarioFim:endTime,
          duracao:sourceProgram.duracao,
          youtubeId:sourceProgram.youtubeId,
          videos:sourceProgram.videos,
          sinopse:sourceProgram.sinopse,
          classificacao:sourceProgram.classificacao,
          tags:sourceProgram.tags||[],
          thumbnailType:sourceProgram.thumbnailType,
          thumbnailUrl:sourceProgram.thumbnailUrl
        };
        await addDoc(collection(db,"programs"),newProg);
        startTime=endTime;
      }
      setShowCloneModal(false);
      setCloneMenuProgs([]);
      setSelectedProgs(new Set());
      setCloneData({channel:"",date:null,time:""});
      notify(`✅ ${cloneMenuProgs.length} programa(s) clonado(s) em outro canal!`);
    } catch(err) {
      console.error("Erro ao clonar programa:",err);
      notify("❌ Erro ao clonar programa");
    }
  };

  const toggleProgSelect=(progId)=>{
    const newSel=new Set(selectedProgs);
    if(newSel.has(progId))newSel.delete(progId);
    else newSel.add(progId);
    setSelectedProgs(newSel);
  };

  // Clear selected programs when channel or date changes
  useEffect(()=>{setSelectedProgs(new Set())},[selCh,selDate]);

  // Task 4: FILA CONTÍNUA - 7 dias (últimas 24h + próximos 7 dias)
  const queuedPrograms=programs.filter(p=>{
    const pDate=new Date(p.data+"T00:00:00Z");
    const today=new Date(getToday()+"T00:00:00Z");
    const daysDiff=(pDate-today)/(1000*60*60*24);
    // Mostra: últimas 24h + próximos 7 dias
    return daysDiff>=-1 && daysDiff<=QUEUE_DAYS;
  }).sort((a,b)=>{
    const aAbs=dateSecondsToAbsolute(a.data,Number(a.horarioInicio));
    const bAbs=dateSecondsToAbsolute(b.data,Number(b.horarioInicio));
    return aAbs-bAbs;
  });

  // Para compatibilidade, manter dayProgs (filtra só o dia selecionado)
  // Com eternity: usa buildScheduleAdmin que projeta os programas do ciclo
  const selChObj = channels.find(c => c.id === selCh);
  const dayProgs = selCh && selDate
    ? buildScheduleAdmin(queuedPrograms, selCh, selChObj, effectiveSelDate)
    : queuedPrograms.filter(p => p.data === effectiveSelDate);
  const totalSch=dayProgs.filter(p=>p.canalId===selCh).reduce((s,p)=>s+(Number(p.duracao)||0),0);

  return <div style={{width:"100%",minHeight:"100vh",background:"#0a0c12",fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",color:"#fff"}}>
    {/* Header */}
    <div style={{padding:"16px 24px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(255,255,255,0.02)",flexWrap:"wrap",gap:10}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:24}}>📺</span>
        <div><div style={{fontSize:18,fontWeight:700,color:"#fff"}}>TVWEB Admin</div><div style={{fontSize:11,color:"#888"}}>Painel de Programação</div></div>
      </div>
      <button onClick={()=>setSD(true)} style={{padding:"8px 16px",borderRadius:6,cursor:"pointer",background:"rgba(156,39,176,0.15)",border:"1px solid rgba(156,39,176,0.3)",color:"#ce93d8",fontSize:12,fontWeight:600}}>📋 Duplicar dia</button>
    </div>

    <div style={{maxWidth:900,margin:"0 auto",padding:20}}>
      {/* Tabs */}
      <div style={{display:"flex",gap:2,borderBottom:"2px solid #1e2030",marginBottom:20}}>
        {[{id:"schedule",label:"📅 Programação"},{id:"channels",label:"📺 Canais"}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 20px",fontSize:13,fontWeight:600,cursor:"pointer",background:tab===t.id?"#1a73e8":"transparent",color:tab===t.id?"#fff":"#888",border:"none",borderRadius:"6px 6px 0 0"}}>{t.label}</button>)}
      </div>

      {tab==="schedule"&&<>
        {/* Date */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:12,color:"#888",marginBottom:8,fontWeight:600}}>📅 DATA</div>
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8}}>
            {dates.map(d=>{const isT=d===getToday(),isS=d===selDate,isPast=d<getToday();
              const chObj=channels.find(c=>c.id===selCh);
              const hasReal=selCh&&programs.some(p=>p.canalId===selCh&&p.data===d&&!p.isJingle);
              const isEternityProj=chObj?.eternity&&!hasReal&&!isPast;
              return <button key={d} onClick={()=>setSelDate(d)} style={{minWidth:64,padding:"8px 8px",borderRadius:6,cursor:"pointer",textAlign:"center",background:isS?"#1a73e8":isPast?"rgba(255,255,255,0.02)":"rgba(255,255,255,0.04)",border:isS?"1px solid #1a73e8":isT?"1px solid #4fc3f7":"1px solid rgba(255,255,255,0.08)",color:isS?"#fff":isPast?"#555":"#ccc",fontSize:11,fontWeight:600,flexShrink:0}}>
                <div style={{fontSize:9}}>{getDayLabel(d).split(" ")[0]}</div>
                <div style={{fontSize:14,marginTop:1}}>{new Date(d+"T00:00:00").getDate()}</div>
                {isT&&<div style={{fontSize:8,color:isS?"#fff":"#4fc3f7",marginTop:1}}>HOJE</div>}
                {hasReal&&<div title="Tem programas cadastrados" style={{width:4,height:4,borderRadius:"50%",background:isS?"#fff":"#4caf50",margin:"2px auto 0"}}/>}
                {isEternityProj&&<div title="Projeção eternity" style={{width:4,height:4,borderRadius:"50%",background:isS?"#fff":"#4dd0e1",margin:"2px auto 0"}}/>}
              </button>})}
          </div>
        </div>

        {/* Channel selector */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
          {channels.filter(c=>!c.isInfo).map(c=><button key={c.id} onClick={()=>setSelCh(c.id)} style={{padding:"8px 14px",borderRadius:6,cursor:"pointer",background:selCh===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:selCh===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:selCh===c.id?"#fff":"#aaa",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:6}}><ChLogo ch={c} size={20}/> {c.nome}{c.isMusic&&<span title="Canal de Música — GC automático" style={{fontSize:11}}>🎵</span>}{c.eternity&&<span title="Eternity ativo" style={{color:"#4dd0e1",fontWeight:800}}>∞</span>}</button>)}
        </div>

        {/* ETERNITY quick toggle for selected channel */}
        {(()=>{const c=channels.find(x=>x.id===selCh);if(!c)return null;const on=!!c.eternity;
          return <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",marginBottom:16,background:on?"rgba(0,188,212,0.08)":"rgba(255,255,255,0.02)",border:on?"1px solid rgba(0,188,212,0.35)":"1px solid rgba(255,255,255,0.06)",borderRadius:8,flexWrap:"wrap"}}>
            <button onClick={async()=>{try{await updateDoc(doc(db,"channels",String(selCh)),{eternity:!on,eternityDays:Number(c.eternityDays)||1});notify(!on?"∞ Eternity LIGADO — a grade deste canal repete até você desligar":"Eternity desligado")}catch(err){console.error(err);notify("❌ Erro ao alternar Eternity")}}}
              style={{padding:"8px 18px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:800,letterSpacing:0.5,background:on?"linear-gradient(135deg,#00bcd4,#4dd0e1)":"rgba(255,255,255,0.06)",border:on?"none":"1px solid rgba(255,255,255,0.15)",color:on?"#00323a":"#aaa"}}>
              ∞ ETERNITY: {on?"LIGADO":"DESLIGADO"}
            </button>
            {on&&<>
              <span style={{fontSize:12,color:"#4dd0e1"}}>Repetindo ciclo de</span>
              <select value={Number(c.eternityDays)||1} onChange={async e=>{try{await updateDoc(doc(db,"channels",String(selCh)),{eternityDays:Number(e.target.value)});notify(`∞ Ciclo alterado para ${e.target.value} dia(s)`)}catch(err){notify("❌ Erro")}}} style={{...iS,width:100,cursor:"pointer"}}>
                {[1,2,3,4,5,6,7].map(d=><option key={d} value={d}>{d} dia{d>1?"s":""}</option>)}
              </select>
              <span style={{fontSize:11,color:"#777"}}>A programação (a partir do 1º dia com programa) repete em loop na TV e no guia.</span>
            </>}
            {!on&&<span style={{fontSize:11,color:"#777"}}>Ligue para a programação deste canal se repetir para sempre até você interromper.</span>}
          </div>})()}

        {/* Stats */}
        <div style={{display:"flex",gap:16,padding:"12px 16px",marginBottom:16,background:"rgba(255,255,255,0.03)",borderRadius:8,fontSize:12,color:"#888",flexWrap:"wrap",alignItems:"center"}}>
          <span>📊 <strong style={{color:"#fff"}}>{dayProgs.filter(p=>p.canalId===selCh).length}</strong> programas</span>
          <span>⏱ <strong style={{color:"#fff"}}>{secTo(totalSch).h}h{secTo(totalSch).m>0?`${secTo(totalSch).m}min`:""}</strong> agendado</span>
          <span>📭 <strong style={{color:totalSch>=86400?"#4caf50":"#ff9800"}}>{secTo(Math.max(0,86400-totalSch)).h}h{secTo(Math.max(0,86400-totalSch)).m>0?`${secTo(Math.max(0,86400-totalSch)).m}min`:""}</strong> livre</span>
          <div style={{flex:1}}/>
          <button onClick={async()=>{
            if(!selCh){notify("Selecione um canal");return}
            const confirmed=confirm("🔧 CORRIGIR PROGRAMAÇÃO\n\nIsso vai:\n✓ Apagar programas de dias passados (que já foram exibidos)\n✓ Resolver sobreposições (encurta o anterior)\n✓ Fechar buracos (programas se encostam)\n✓ Se o dia não cobrir 24h, estica o último programa\n\nCanal: "+channels.find(c=>c.id===selCh)?.nome+"\nDeseja continuar?");
            if(!confirmed)return;
            notify("🔧 Corrigindo...");
            const today=getToday();
            let cleaned=0,fixed=0,filled=0;

            // === ETAPA 1: Limpar programas de dias que já passaram ===
            const pastProgs=programs.filter(p=>{
              if(!p.data||!p.canalId)return false;
              // Só do canal selecionado, dias ANTERIORES a hoje
              if(p.canalId!==selCh)return false;
              const progEnd=new Date(p.data+"T00:00:00");
              progEnd.setSeconds(Number(p.horarioFim)||86400);
              return progEnd<new Date(today+"T00:00:00");
            });
            for(const p of pastProgs){
              try{await deleteDoc(doc(db,"programs",String(p.id)));cleaned++}catch(err){console.error("Limpar err:",err)}
            }

            // === ETAPA 2: Corrigir grade do dia selecionado neste canal ===
            const todayProgs=programs
              .filter(p=>p.canalId===selCh&&p.data===effectiveSelDate)
              .map(p=>({...p,horarioInicio:Number(p.horarioInicio),horarioFim:Number(p.horarioFim),duracao:Number(p.duracao)}))
              .sort((a,b)=>a.horarioInicio-b.horarioInicio);

            if(todayProgs.length>0){
              let prev=null;
              for(const p of todayProgs){
                let newStart=p.horarioInicio, newDur=p.duracao, changed=false;
                // Resolver sobreposição: se começa antes do fim do anterior, ajusta o anterior
                if(prev&&newStart<prev.horarioFim){
                  const prevNewDur=Math.max(SNAP,newStart-prev.horarioInicio);
                  if(prevNewDur!==prev.duracao){
                    try{await updateDoc(doc(db,"programs",String(prev.id)),{duracao:prevNewDur,horarioFim:prev.horarioInicio+prevNewDur});fixed++}catch{}
                    prev.duracao=prevNewDur;prev.horarioFim=prev.horarioInicio+prevNewDur;
                  }
                }
                // Fechar buraco: se há espaço entre o anterior e este, puxa para encostar
                if(prev&&newStart>prev.horarioFim){
                  newStart=prev.horarioFim;
                  changed=true;
                }
                if(changed){
                  try{await updateDoc(doc(db,"programs",String(p.id)),{horarioInicio:newStart,horarioFim:newStart+newDur});fixed++}catch{}
                  p.horarioInicio=newStart;p.horarioFim=newStart+newDur;p.duracao=newDur;
                }
                prev=p;
              }
              // Se o 1º não começa em 0, puxa para 0
              if(todayProgs[0].horarioInicio>0){
                const shift=todayProgs[0].horarioInicio;
                for(const p of todayProgs){
                  const ns=p.horarioInicio-shift;
                  try{await updateDoc(doc(db,"programs",String(p.id)),{horarioInicio:ns,horarioFim:ns+p.duracao});fixed++}catch{}
                  p.horarioInicio=ns;p.horarioFim=ns+p.duracao;
                }
              }
              // Se o último não cobre 24h, estica
              const last=todayProgs[todayProgs.length-1];
              if(last.horarioFim<86400){
                const newDur=86400-last.horarioInicio;
                try{await updateDoc(doc(db,"programs",String(last.id)),{duracao:newDur,horarioFim:86400});filled++}catch{}
              }
            }
            notify(`✅ Corrigido! ${cleaned} antigo(s) removido(s), ${fixed} ajuste(s) na grade${filled>0?", último esticado até 24h":""}`);
          }} style={{padding:"8px 16px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700,background:"rgba(255,152,0,0.12)",border:"1px solid rgba(255,152,0,0.35)",color:"#ff9800",whiteSpace:"nowrap"}}>🔧 Corrigir Programação</button>
        </div>

        <div style={{marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:"#555"}}>{viewMode==="lista"?"⠿ Arraste para reordenar programas":"🖱️ Arraste os blocos para corrigir o horário (encaixe de 5min) · puxe a borda direita para mudar a duração · duplo clique para editar"}</div>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>setViewMode("lista")} style={{padding:"6px 14px",borderRadius:"6px 0 0 6px",cursor:"pointer",fontSize:12,fontWeight:700,background:viewMode==="lista"?"rgba(26,115,232,0.25)":"rgba(255,255,255,0.04)",border:viewMode==="lista"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.1)",color:viewMode==="lista"?"#4fc3f7":"#888"}}>📋 Lista</button>
            <button onClick={()=>setViewMode("grade")} style={{padding:"6px 14px",borderRadius:"0 6px 6px 0",cursor:"pointer",fontSize:12,fontWeight:700,background:viewMode==="grade"?"rgba(26,115,232,0.25)":"rgba(255,255,255,0.04)",border:viewMode==="grade"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.1)",color:viewMode==="grade"?"#4fc3f7":"#888"}}>📺 Grade Visual</button>
          </div>
        </div>

        {viewMode==="lista"
          ? <TimelineView programs={dayProgs} channels={channels} selectedChannel={selCh}
              onEdit={p=>{setEP(p);setSM(true)}} onDelete={handleDel} onReorder={handleReorder} onToggleSelect={toggleProgSelect} selectedProgs={selectedProgs}/>
          : <GradeVisual programs={dayProgs} channels={channels} selectedChannel={selCh} selDate={effectiveSelDate}
              onEdit={p=>{setEP(p);setSM(true)}} notify={notify}/>}

        <button onClick={()=>{setEP(null);setSM(true)}} style={{marginTop:16,width:"100%",padding:14,borderRadius:8,cursor:"pointer",background:"linear-gradient(135deg,#1a73e8,#4fc3f7)",border:"none",color:"#fff",fontSize:14,fontWeight:700}}>+ Adicionar Programa</button>
      </>}

      {/* FLOATING CLONE BUTTON - RIGHT SIDE */}
      {selectedProgs.size>0&&<button onClick={()=>{const selected=dayProgs.filter(p=>selectedProgs.has(p.id));setCloneMenuProgs(selected)}} style={{position:"fixed",bottom:40,right:40,width:180,padding:14,borderRadius:8,cursor:"pointer",background:"linear-gradient(135deg,#4caf50,#81c784)",border:"none",color:"#fff",fontSize:14,fontWeight:700,boxShadow:"0 4px 20px rgba(76,175,80,0.4)",zIndex:50,transition:"all 0.3s"}}>📋 Clonar {selectedProgs.size}</button>}

      {tab==="channels"&&<>
        <button onClick={createSkyChannel} style={{marginBottom:16,padding:"10px 16px",borderRadius:6,cursor:"pointer",background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",fontSize:13,fontWeight:600}}>📡 Recriar Canal Sky</button>
        <ChannelEditor channels={channels} onUpdate={setCh} onAdd={addChannel} onDelete={delChannel}/>
      </>}

    </div>

    {showModal&&<ProgramModal mode={editProg?"edit":"add"} program={editProg} channels={channels} selectedChannel={selCh} selectedDate={effectiveSelDate} existingPrograms={programs} onSave={handleSave} onClose={()=>{setSM(false);setEP(null)}}/>}

    {/* Clone menu - appears near clone button */}
    {cloneMenuProgs.length>0&&<div onClick={()=>setCloneMenuProgs([])} style={{position:"fixed",inset:0,zIndex:100}}>
      <div style={{position:"fixed",bottom:200,right:40,background:"#1a1c24",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,0.6)",zIndex:101,minWidth:200}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"8px 0"}}>
          <button onClick={()=>{handleQuickClone();setCloneMenuProgs([])}} style={{width:"100%",padding:"12px 16px",textAlign:"left",background:"transparent",border:"none",color:"#4caf50",cursor:"pointer",fontSize:13,fontWeight:600,borderBottom:"0.5px solid rgba(255,255,255,0.1)",transition:"background 0.2s"}} onMouseEnter={e=>e.target.style.background="rgba(76,175,80,0.1)"} onMouseLeave={e=>e.target.style.background="transparent"}>
            ✓ Clonar aqui
          </button>
          <button onClick={()=>{setCloneData({channel:"",date:null,time:""});setShowCloneModal(true)}} style={{width:"100%",padding:"12px 16px",textAlign:"left",background:"transparent",border:"none",color:"#4fc3f7",cursor:"pointer",fontSize:13,fontWeight:600,transition:"background 0.2s"}} onMouseEnter={e=>e.target.style.background="rgba(79,195,247,0.1)"} onMouseLeave={e=>e.target.style.background="transparent"}>
            → Clonar em outro...
          </button>
        </div>
      </div>
    </div>}

    {/* Clone in another channel/date modal */}
    {showCloneModal&&cloneMenuProgs.length>0&&<div onClick={()=>setShowCloneModal(false)} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#1a1c24",borderRadius:8,maxWidth:600,width:"100%",border:"1px solid rgba(255,255,255,0.1)",padding:24,maxHeight:"80vh",overflowY:"auto"}}>
        <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:4}}>📋 Clonar em outro...</div>
        <div style={{fontSize:13,color:"#888",marginBottom:16}}>{cloneMenuProgs.length} programa(s) selecionado(s)</div>
        
        {/* Preview dos programas */}
        <div style={{marginBottom:16,padding:12,background:"rgba(76,175,80,0.08)",borderRadius:6,border:"1px solid rgba(76,175,80,0.2)"}}>
          <div style={{fontSize:11,color:"#4caf50",fontWeight:700,marginBottom:8}}>📺 PROGRAMAS A CLONAR:</div>
          {cloneMenuProgs.map((prog,i)=><div key={i} style={{fontSize:11,color:"#aaa",marginBottom:6,paddingBottom:6,borderBottom:i<cloneMenuProgs.length-1?"1px solid rgba(255,255,255,0.05)":"none"}}>
            <div style={{fontWeight:600,color:"#fff",marginBottom:2}}>{prog.nome}</div>
            <div style={{fontSize:10}}>📹 {prog.videos?.length||1} vídeo(s) • ⏱️ {fmtSec(Number(prog.duracao))}</div>
          </div>)}
        </div>
        
        {/* Canal selector */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:"#888",fontWeight:600,marginBottom:6,display:"block"}}>Canal</label>
          <select value={cloneData.channel||""} onChange={e=>setCloneData({...cloneData,channel:e.target.value})} style={{width:"100%",padding:"8px 12px",borderRadius:4,background:"#14161e",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",fontSize:13,cursor:"pointer"}}>
            <option value="">--- Selecione um canal ---</option>
            {channels.filter(c=>!c.isInfo&&c.id!==selCh).map(c=><option key={c.id} value={c.id}>{c.nome} ({c.numero})</option>)}
          </select>
        </div>

        {/* Data selector */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:"#888",fontWeight:600,marginBottom:6,display:"block"}}>Data</label>
          <select value={cloneData.date||""} onChange={e=>setCloneData({...cloneData,date:e.target.value})} style={{width:"100%",padding:"8px 12px",borderRadius:4,background:"#14161e",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",fontSize:13,cursor:"pointer"}}>
            <option value="">Auto (após último programa)</option>
            {dates.map(d=><option key={d} value={d}>{getDayLabel(d)}</option>)}
          </select>
        </div>

        {/* Hora - opcional, se não escolher data fica auto */}
        {cloneData.date&&<div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:"#888",fontWeight:600,marginBottom:6,display:"block"}}>Hora (opcional)</label>
          <input type="number" value={cloneData.time} onChange={e=>setCloneData({...cloneData,time:e.target.value})} min="0" max="86399" style={{width:"100%",padding:"8px 12px",borderRadius:4,background:"#14161e",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",fontSize:13}} placeholder="deixe em branco para auto"/>
        </div>}

        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>handleAdvancedClone()} style={{flex:1,padding:12,background:"linear-gradient(135deg,#4caf50,#81c784)",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>✓ Clonar com vídeos</button>
          <button onClick={()=>setShowCloneModal(false)} style={{flex:1,padding:12,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,color:"#ccc",cursor:"pointer",fontSize:13,fontWeight:600}}>Cancelar</button>
        </div>
      </div>
    </div>}

    {showDup&&<DupModal dates={dates} onDup={handleDup} onClose={()=>setSD(false)}/>}

    {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",padding:"12px 24px",borderRadius:8,background:toast.includes("✅")||toast.includes("✓")?"#4caf50":toast.includes("❌")||toast.includes("⚠️")?"#f44336":"#1a73e8",color:"#fff",fontSize:13,fontWeight:600,zIndex:200,animation:"fadeIn 0.3s ease",boxShadow:"0 4px 20px rgba(0,0,0,0.4)"}}>{toast}</div>}

    <style>{`
      @keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
      *{box-sizing:border-box;margin:0;padding:0}
      select option{background:#14161e;color:#fff}
    `}</style>
  </div>;
}

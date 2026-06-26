import { useState, useEffect, useCallback, useRef } from "react";
import { db, collection, addDoc, updateDoc, deleteDoc, onSnapshot, doc, query, where } from "./firebase";

const DURATION_PRESETS = [
  { label:"15min", value:900 },{ label:"30min", value:1800 },{ label:"40min", value:2400 },
  { label:"45min", value:2700 },{ label:"1h", value:3600 },{ label:"1h30", value:5400 },
  { label:"2h", value:7200 },{ label:"Custom", value:0 },
];
const CLASSIF_OPTIONS = ["L","10","12","14","16","18"];
const CC = { L:"#0f0","10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#111" };
const EMOJI_LIST = ["📺","🎭","🎬","🌍","🎵","🎮","📡","🎨","🏆","💡","🔬","📚","🎤","🎸","⚽","🎯","🌟","🔥","💎","🎪","🎻","🎹","📻","🖥️","🎥","🎞️","ℹ️","❤️","💙","💚"];
const COLOR_LIST = ["#2196F3","#E91E63","#4CAF50","#FF9800","#9C27B0","#f44336","#00bcd4","#ff5722","#607d8b","#78909C","#3f51b5","#8bc34a","#ffc107","#795548"];

// ============================================
// HELPERS
// ============================================
function fmtSec(s){
  const norm=((Number(s)%86400)+86400)%86400;
  const h=Math.floor(norm/3600),m=Math.floor((norm%3600)/60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function getDayLabel(d){ const x=new Date(d+"T00:00:00"); const ds=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"]; return`${ds[x.getDay()]} ${x.getDate()}/${x.getMonth()+1}` }
function secTo(s){ return{h:Math.floor(s/3600),m:Math.floor((s%3600)/60)} }
function parseDur(h,m){ return(parseInt(h)||0)*3600+(parseInt(m)||0)*60 }
function getToday(){ const n=new Date(); return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}` }
function genDates(n){ const ds=[]; let d=new Date(getToday()+"T00:00:00"); for(let i=0;i<n;i++){ const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0"); ds.push(`${y}-${m}-${da}`); d.setDate(d.getDate()+1); } return ds }

// ============================================================
// ✅ FIX 1: BASE_DATE DINÂMICA — nunca expira
// ============================================================
const QUEUE_DAYS = 7;

function getBaseDate() {
  const now = new Date();
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
  return Math.floor((new Date() - BASE_DATE) / 1000);
}

// ============================================================
// ✅ FIX 2: YouTube API key via variável de ambiente
// ============================================================
function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/, /^([a-zA-Z0-9_-]{11})$/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

async function fetchYouTubeMetadata(videoId) {
  if (!videoId) return null;
  try {
    const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY;
    if (!API_KEY) {
      console.warn("VITE_YOUTUBE_API_KEY não configurada");
      return null;
    }
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${API_KEY}&part=snippet,contentDetails`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;
    const { snippet, contentDetails } = data.items[0];
    const match = contentDetails.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const totalSeconds = (parseInt(match?.[1]||0))*3600 + (parseInt(match?.[2]||0))*60 + (parseInt(match?.[3]||0));
    return { duration: totalSeconds, description: snippet.description, title: snippet.title, thumbnail: snippet.thumbnails?.default?.url };
  } catch (err) {
    console.error("Erro ao buscar metadados YouTube:", err);
    return null;
  }
}

function extractYTId(s){ if(!s)return null; const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/]; for(const r of p){const m=s.match(r);if(m)return m[1]} return null }

// ─── Extrai playlistId de qualquer URL do YouTube ──────────────
function extractPlaylistId(url) {
  if (!url) return null;
  const m = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// ─── Busca TODOS os vídeos de uma playlist (paginado) ──────────
// Retorna: [{ youtubeUrl, titulo, duracao }]
async function fetchPlaylistVideos(playlistId, onProgress) {
  const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY;
  if (!API_KEY) { console.warn("VITE_YOUTUBE_API_KEY não configurada"); return []; }

  const videos = [];
  let pageToken = "";
  let page = 0;

  // 1. Coleta todos os videoIds da playlist (máx 500 vídeos, 10 páginas de 50)
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&pageToken=${pageToken}&key=${API_KEY}`;
    const res  = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (!data.items) break;

    for (const item of data.items) {
      const vid = item.snippet?.resourceId?.videoId;
      const tit = item.snippet?.title;
      if (vid && tit && tit !== "Deleted video" && tit !== "Private video") {
        videos.push({ videoId: vid, titulo: tit });
      }
    }

    pageToken = data.nextPageToken || "";
    page++;
    if (onProgress) onProgress(`Buscando página ${page}… (${videos.length} vídeos)`);
  } while (pageToken && page < 10);

  if (videos.length === 0) return [];

  // 2. Busca duração de todos em lotes de 50
  const result = [];
  for (let i = 0; i < videos.length; i += 50) {
    const batch  = videos.slice(i, i + 50);
    const ids    = batch.map(v => v.videoId).join(",");
    const url    = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${API_KEY}`;
    const res    = await fetch(url);
    const data   = res.ok ? await res.json() : { items: [] };

    // Monta mapa de id → duração
    const durMap = {};
    for (const item of (data.items || [])) {
      const m = (item.contentDetails?.duration || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      durMap[item.id] = m ? (parseInt(m[1]||0)*3600 + parseInt(m[2]||0)*60 + parseInt(m[3]||0)) : 0;
    }

    for (const v of batch) {
      result.push({
        youtubeUrl: v.videoId,
        titulo:     v.titulo,
        duracao:    durMap[v.videoId] || 0,
      });
    }
    if (onProgress) onProgress(`Duração: ${Math.min(i+50, videos.length)}/${videos.length} vídeos…`);
  }

  return result;
}
function ytThumb(id){ const x=extractYTId(id); return x?`https://img.youtube.com/vi/${x}/mqdefault.jpg`:null }

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

// ============================================
// IMAGE UPLOADER
// ============================================
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
  const w=shape==="square"?80:160, h=shape==="square"?80:90;
  return <div>
    {label&&<label style={lS}>{label}</label>}
    <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
      <div style={{width:w,height:h,borderRadius:6,overflow:"hidden",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {imageType==="custom"&&currentImage?<img src={currentImage} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:24,opacity:0.3}}>🖼️</span>}
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
        <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0])}}
          onClick={()=>ref.current?.click()}
          style={{padding:"14px 12px",borderRadius:6,cursor:"pointer",textAlign:"center",border:drag?"2px dashed #1a73e8":"2px dashed rgba(255,255,255,0.12)",background:drag?"rgba(26,115,232,0.1)":"rgba(255,255,255,0.02)"}}>
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
// TIMELINE VIEW WITH DRAG
// ============================================
function TimelineView({programs,channels,selectedChannel,onEdit,onDelete,onReorder,onToggleSelect,selectedProgs}){
  const filtered=programs.filter(p=>p.canalId===selectedChannel).sort((a,b)=>Number(a.horarioInicio)-Number(b.horarioInicio));
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
      let cur=0;
      const updated=items.map(p=>{ const np={...p,horarioInicio:cur,horarioFim:cur+p.duracao}; cur+=p.duracao; return np; });
      onReorder(updated);
    }
    setDragIdx(null);setOverIdx(null);
  };

  if(!filtered.length) return <div style={{padding:40,textAlign:"center",color:"#555",fontSize:14}}><div style={{fontSize:40,marginBottom:12}}>📭</div>Nenhum programa agendado.</div>;

  const gaps=[];
  if(Number(filtered[0].horarioInicio)>0) gaps.push({start:0,end:Number(filtered[0].horarioInicio)});
  for(let i=0;i<filtered.length-1;i++) if(Number(filtered[i].horarioFim)<Number(filtered[i+1].horarioInicio)) gaps.push({start:Number(filtered[i].horarioFim),end:Number(filtered[i+1].horarioInicio)});
  if(Number(filtered[filtered.length-1].horarioFim)<86400) gaps.push({start:Number(filtered[filtered.length-1].horarioFim),end:86400});

  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {filtered.map((prog,i)=>{
      const ch=channels.find(c=>c.id===prog.canalId);
      const isMulti=prog.videos&&prog.videos.length>1;
      const thumb=prog.thumbnailType==="custom"&&prog.thumbnailUrl?prog.thumbnailUrl:ytThumb(prog.youtubeId||prog.videos?.[0]?.youtubeUrl);
      const isDragOver=overIdx===i&&dragIdx!==i;
      return <div key={prog.id} draggable onDragStart={e=>handleDragStart(e,i)} onDragOver={e=>handleDragOver(e,i)} onDrop={e=>handleDrop(e,i)} onDragEnd={()=>{setDragIdx(null);setOverIdx(null)}}
        style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:isDragOver?"rgba(26,115,232,0.15)":"rgba(255,255,255,0.03)",borderRadius:6,border:isDragOver?"2px dashed #1a73e8":"1px solid rgba(255,255,255,0.06)",cursor:"grab",transition:"all 0.15s",opacity:dragIdx===i?0.4:1}}>
        <input type="checkbox" checked={selectedProgs.has(prog.id)} onChange={()=>onToggleSelect(prog.id)} style={{width:18,height:18,cursor:"pointer",accentColor:"#4caf50",flexShrink:0}}/>
        <div style={{fontSize:16,color:"#555",cursor:"grab",padding:"0 4px"}}>⠿</div>
        {thumb?<img src={thumb} alt="" style={{width:64,height:40,borderRadius:4,objectFit:"cover",flexShrink:0}}/>:
          <div style={{width:64,height:40,borderRadius:4,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:18,opacity:0.3}}>🎬</span></div>}
        <div style={{minWidth:85,textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{fmtSec(Number(prog.horarioInicio))}</div>
          <div style={{fontSize:10,color:"#555"}}>até {fmtSec(Number(prog.horarioFim))}</div>
        </div>
        <div style={{width:3,height:40,borderRadius:2,background:ch?.cor||"#555"}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
            <span style={{fontSize:14,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{prog.nome}</span>
            <span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:CC[prog.classificacao]||"#555",color:prog.classificacao==="L"?"#fff":"#000",fontWeight:700}}>{prog.classificacao}</span>
            {isMulti&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"#9c27b0",color:"#fff",fontWeight:700}}>{prog.videos.length}v</span>}
            {prog.tags?.map(t=><span key={t} style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"rgba(255,255,255,0.08)",color:"#aaa",fontWeight:600}}>{t}</span>)}
          </div>
          <div style={{fontSize:11,color:"#888"}}>{secTo(Number(prog.duracao)).h>0?`${secTo(Number(prog.duracao)).h}h`:""}{ secTo(Number(prog.duracao)).m>0?`${secTo(Number(prog.duracao)).m}min`:""}</div>
        </div>
        <button onClick={()=>onEdit(prog)} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>✏️</button>
        <button onClick={()=>onDelete(prog.id)} style={{background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.3)",color:"#f44336",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>🗑️</button>
      </div>;
    })}

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
// PLAYLIST IMPORTER (dentro do ProgramModal)
// ============================================
function PlaylistImporter({ onImport }) {
  const [url,      setUrl]      = useState("");
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState("");
  const [preview,  setPreview]  = useState(null); // { videos, totalDur, name }
  const [shuffle,  setShuffle]  = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error,    setError]    = useState("");

  const handleFetch = async () => {
    const plId = extractPlaylistId(url.trim());
    if (!plId) { setError("URL inválida — cole uma URL de playlist do YouTube"); return; }
    setError(""); setLoading(true); setPreview(null); setStatus("Conectando à API do YouTube…");
    try {
      const vids = await fetchPlaylistVideos(plId, setStatus);
      if (vids.length === 0) { setError("Nenhum vídeo encontrado (playlist vazia ou privada)"); setLoading(false); return; }
      const totalDur = vids.reduce((s,v) => s + (v.duracao||0), 0);
      // Tenta usar o título do primeiro vídeo como base do nome
      const suggestedName = vids[0]?.titulo?.replace(/(?:#\d+|ep\.?\s*\d+|\s*-\s*parte\s*\d+)/gi,"").trim() || "";
      setPreview({ videos: vids, totalDur, suggestedName });
      setStatus("");
    } catch(e) {
      setError("Erro ao buscar playlist: " + e.message);
    }
    setLoading(false);
  };

  const handleConfirm = () => {
    if (!preview) return;
    let vids = [...preview.videos];
    if (shuffle) {
      // Fisher-Yates shuffle
      for (let i = vids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [vids[i], vids[j]] = [vids[j], vids[i]];
      }
    }
    onImport(vids, preview.totalDur, preview.suggestedName);
    setPreview(null); setUrl(""); setStatus(""); setExpanded(false); setShuffle(false);
  };

  const fmtDurMin = (s) => {
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
    return h>0 ? `${h}h${m>0?`${m}min`:""}` : `${m}min`;
  };

  return (
    <div style={{background:"rgba(156,39,176,0.06)",border:"1px solid rgba(156,39,176,0.2)",
      borderRadius:8,padding:"12px 14px"}}>

      {/* Header da seção */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>🎵</span>
          <span style={{fontSize:12,fontWeight:700,color:"#ce93d8",letterSpacing:0.5}}>
            IMPORTAR PLAYLIST DO YOUTUBE
          </span>
        </div>
        <span style={{fontSize:10,color:"#666"}}>opcional</span>
      </div>

      {/* Input */}
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input
          value={url} onChange={e=>{setUrl(e.target.value);setError("");setPreview(null);}}
          placeholder="https://youtube.com/playlist?list=PLxxxxxx"
          style={{...iS, flex:1, fontSize:12}}
          onKeyDown={e=>e.key==="Enter"&&handleFetch()}
        />
        <button onClick={handleFetch} disabled={loading||!url.trim()}
          style={{padding:"8px 14px",borderRadius:4,border:"none",cursor:loading||!url.trim()?"not-allowed":"pointer",
            background:loading||!url.trim()?"#333":"rgba(156,39,176,0.6)",
            color:"#fff",fontSize:12,fontWeight:700,whiteSpace:"nowrap",
            opacity:loading||!url.trim()?0.5:1,minWidth:80}}>
          {loading ? "⏳" : "🔍 Buscar"}
        </button>
      </div>

      {/* Status de progresso */}
      {status && (
        <div style={{fontSize:11,color:"#9c27b0",marginBottom:8,
          display:"flex",alignItems:"center",gap:6}}>
          <span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⏳</span>
          {status}
        </div>
      )}

      {/* Erro */}
      {error && (
        <div style={{fontSize:11,color:"#f44336",padding:"6px 10px",
          background:"rgba(244,67,54,0.08)",borderRadius:4,marginBottom:8}}>
          ⚠️ {error}
        </div>
      )}

      {/* Preview da playlist */}
      {preview && (
        <div style={{background:"rgba(156,39,176,0.1)",borderRadius:6,
          padding:"10px 12px",border:"1px solid rgba(156,39,176,0.25)"}}>

          {/* Resumo */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:2}}>
                ✅ {preview.videos.length} vídeos encontrados
              </div>
              <div style={{fontSize:11,color:"#9c27b0"}}>
                Duração total: <strong style={{color:"#ce93d8"}}>{fmtDurMin(preview.totalDur)}</strong>
                <span style={{color:"#555",marginLeft:8}}>
                  • Será agendado como 1 programa contínuo
                </span>
              </div>
              {/* Toggle shuffle */}
              <label style={{display:"flex",alignItems:"center",gap:6,marginTop:8,cursor:"pointer",fontSize:11,color:"#aaa"}}>
                <input type="checkbox" checked={shuffle} onChange={e=>setShuffle(e.target.checked)}
                  style={{accentColor:"#9c27b0",width:14,height:14}}/>
                <span>🔀 Embaralhar ordem dos vídeos</span>
              </label>
            </div>
            <button onClick={()=>setExpanded(x=>!x)}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
                color:"#aaa",padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11}}>
              {expanded?"▲ Ocultar":"▼ Ver episódios"}
            </button>
          </div>

          {/* Lista de episódios expansível */}
          {expanded && (
            <div style={{maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",
              gap:3,marginBottom:10}}>
              {preview.videos.map((v,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,
                  padding:"4px 6px",background:"rgba(255,255,255,0.03)",
                  borderRadius:3,fontSize:11}}>
                  <span style={{color:"#6a1b9a",fontWeight:700,minWidth:26,
                    textAlign:"right",flexShrink:0}}>
                    {i+1}
                  </span>
                  <img src={`https://img.youtube.com/vi/${v.youtubeUrl}/default.jpg`}
                    alt="" style={{width:32,height:22,objectFit:"cover",borderRadius:2,flexShrink:0}}/>
                  <span style={{color:"#ddd",flex:1,overflow:"hidden",
                    textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {v.titulo}
                  </span>
                  <span style={{color:"#555",flexShrink:0,minWidth:36,textAlign:"right"}}>
                    {fmtDurMin(v.duracao)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Botão de confirmação */}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setPreview(null);setUrl("");}}
              style={{flex:1,padding:"8px 0",borderRadius:4,cursor:"pointer",
                background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
                color:"#888",fontSize:12}}>
              Cancelar
            </button>
            <button onClick={handleConfirm}
              style={{flex:2,padding:"8px 0",borderRadius:4,border:"none",cursor:"pointer",
                background:"linear-gradient(135deg,#7b1fa2,#9c27b0)",
                color:"#fff",fontSize:12,fontWeight:700}}>
              🎬 Usar esta playlist como programa
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ============================================
// PROGRAM MODAL
// ============================================
function ProgramModal({mode,program,channels,selectedChannel,selectedDate,existingPrograms,onSave,onClose}){
  const isDirtyRef = useRef(false);
  const safeClose  = useCallback(()=>{
    if(isDirtyRef.current&&!window.confirm("Há alterações não salvas. Fechar assim mesmo?")) return;
    onClose();
  },[onClose]);
  const isEdit=mode==="edit";
  const [nome,setNome]=useState(program?.nome||"");
  const [canalId,setCanalId]=useState(program?.canalId??selectedChannel);
  const [classificacao,setClassificacao]=useState(program?.classificacao||"L");
  const [tags,setTags]=useState(program?.tags||["HD"]);
  const [sinopse,setSinopse]=useState(program?.sinopse||"");
  const [gcMensagem,setGcMsg]=useState(program?.gcMensagem||"");
  const [gcPosicao,setGcPos]=useState(program?.gcPosicao||"ambos");
  const [gcMinuto,setGcMinuto]=useState(program?.gcMinuto||0);
  const [gcDuracao,setGcDurSeg]=useState(program?.gcDuracao||20);
  const [gcFonte,setGcFonte]=useState(program?.gcFonte||"normal");
  const [gcEstilo,setGcEstilo]=useState(program?.gcEstilo||"borda");
  const [durationPreset,setDP]=useState(0);
  const [customH,setCH]=useState(program?Math.floor(program.duracao/3600):1);
  const [customM,setCM]=useState(program?Math.floor((program.duracao%3600)/60):0);
  const [videos,setVideos]=useState(program?.videos||[{youtubeUrl:program?.youtubeId||"",titulo:""}]);
  const [selectedVideos,setSelectedVideos]=useState(new Set());
  const [thumbnailType,setTT]=useState(program?.thumbnailType||"youtube");
  const [thumbnailUrl,setTU]=useState(program?.thumbnailUrl||null);
  const [error,setError]=useState("");
  const [tipo,setTipo]=useState("geral");
  const [gcLayout,setGcLayout]=useState("inf-dir");
  const [streamUrl,setStreamUrl]=useState("");
  const [showIPTV,setShowIPTV]=useState(false);
  const [saving,setSaving]=useState(false);
  const [startMode,setSM]=useState(isEdit?"custom":"auto");
  const [startH,setSH]=useState(isEdit?Math.floor(program.horarioInicio/3600):0);
  const [startM,setStartM]=useState(isEdit?Math.floor((program.horarioInicio%3600)/60):0);

  const dur=durationPreset>0?durationPreset:parseDur(customH,customM);
  const channelProgs=existingPrograms.filter(p=>p.canalId===canalId&&p.data===selectedDate&&(!isEdit||p.id!==program?.id)).sort((a,b)=>a.horarioInicio-b.horarioInicio);
  const autoStart=(()=>{ if(!channelProgs.length)return 0; return channelProgs[channelProgs.length-1].horarioFim })();
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
    const totalSeconds=Number(horIn)+dur;
    if(totalSeconds>86400){
      const overflowMinutes=Math.floor((totalSeconds-86400)/60);
      const oh=Math.floor(overflowMinutes/60), om=overflowMinutes%60;
      const nextDayTime=`${String(oh).padStart(2,"0")}:${String(om).padStart(2,"0")}`;
      const continua=confirm(`⚠️ Este programa vai até ${nextDayTime} do DIA SEGUINTE!\n\n✓ Manter contínuo (vai pro próximo dia)?\n✕ Cancelar`);
      if(!continua){setError("Operação cancelada");return}
    }
    setSaving(true);
    try {
      // Para edição: passa o id real. Para novo: sem id (Firestore gera)
      const payload = {
        nome, canalId, classificacao, tags, sinopse,
        data: selectedDate, duracao: dur,
        horarioInicio: horIn, horarioFim: horFim,
        youtubeId: videos[0].youtubeUrl,
        videos: videos.filter(v => v.youtubeUrl.trim()),
        thumbnailType, thumbnailUrl,
        gcMensagem: gcMensagem.trim() || null,
        gcPosicao:  gcMensagem.trim() ? gcPosicao  : null,
        gcMinuto:   gcMensagem.trim() && gcPosicao==="minuto" ? gcMinuto : null,
        gcDuracao:  gcMensagem.trim() && gcPosicao==="minuto" ? gcDuracao : null,
        gcFonte:    gcMensagem.trim() ? gcFonte : null,
        gcEstilo:   gcMensagem.trim() ? gcEstilo : null,
      };
      if (isEdit) payload.id = program.id;
      // await garante que o Firestore confirmou antes de fechar o modal
      await onSave(payload);
      setSaving(false);
    } catch(err) {
      console.error("Erro ao salvar:", err);
      setSaving(false);
      setError("Erro ao salvar programa");
    }
  };

  return <div onClick={safeClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,maxWidth:640,width:"100%",border:"1px solid rgba(255,255,255,0.1)",maxHeight:"92vh",overflowY:"auto"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:16,fontWeight:700,color:"#fff"}}>{isEdit?"✏️ Editar":"➕ Novo"} Programa</span>
        <button onClick={safeClose} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
        {/* Canal */}
        <div><label style={lS}>CANAL</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {channels.filter(c=>!c.isInfo).map(c=><button key={c.id} onClick={()=>setCanalId(c.id)} style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:12,background:canalId===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:canalId===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:canalId===c.id?"#fff":"#888",display:"flex",alignItems:"center",gap:4}}><ChLogo ch={c} size={16}/> {c.nome}</button>)}
          </div>
        </div>

        {/* Nome */}
        <div><label style={lS}>NOME DO PROGRAMA</label>
          <input value={nome} onChange={e=>{setNome(e.target.value);isDirtyRef.current=true;}} placeholder="Ex: Documentário" style={{...iS,width:"100%"}}/></div>

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
            <input type="number" min="0" max="23" value={customH} onChange={e=>setCH(e.target.value)} style={{...iS,width:55,textAlign:"center"}}/><span style={{color:"#888"}}>h</span>
            <input type="number" min="0" max="59" value={customM} onChange={e=>setCM(e.target.value)} style={{...iS,width:55,textAlign:"center"}}/><span style={{color:"#888"}}>min</span>
          </div>}
        </div>

        {/* ── PLAYLIST DO YOUTUBE ── */}
        <PlaylistImporter onImport={(vids, totalDur, suggestedName) => {
          setVideos(vids);
          // Atualiza duração com soma total da playlist
          const h = Math.floor(totalDur/3600);
          const m = Math.floor((totalDur%3600)/60);
          setCH(h); setCM(m); setDP(0);
          // Sugere nome se o campo estiver vazio
          if (!nome.trim() && suggestedName) setNome(suggestedName);
        }}/>

        {/* Videos */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <label style={{...lS,marginBottom:0}}>VÍDEOS</label>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:10,color:"#555"}}>{videos.length} vídeo(s)</span>
              <input type="checkbox" checked={videos.length>0&&selectedVideos.size===videos.length}
                onChange={e=>{if(e.target.checked){const s=new Set();for(let i=0;i<videos.length;i++)s.add(i);setSelectedVideos(s)}else setSelectedVideos(new Set())}}
                title="Marcar/desmarcar todos" style={{width:14,height:14,cursor:"pointer",accentColor:"#4caf50"}}/>
              <button onClick={async()=>{
                const copy=[...videos];
                for(let i=0;i<copy.length;i++){
                  const vId=extractYouTubeId(copy[i].youtubeUrl);
                  if(vId){
                    const meta=await fetchYouTubeMetadata(vId);
                    if(meta){
                      const nv=[...copy];
                      nv[i]={...nv[i],titulo:meta.title};
                      setVideos(nv);
                      copy[i]=nv[i];
                      if(i===0){setCH(Math.floor(meta.duration/3600));setCM(Math.floor((meta.duration%3600)/60));setSinopse(meta.description)}
                    }
                  }
                }
              }} style={{fontSize:10,color:"#4caf50",background:"rgba(76,175,80,0.1)",border:"1px solid rgba(76,175,80,0.3)",padding:"2px 8px",borderRadius:3,cursor:"pointer",fontWeight:600}}>🔍 Buscar Todos</button>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {videos.map((v,i)=><div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:4,border:"1px solid rgba(255,255,255,0.06)"}}>
              <input type="checkbox" checked={selectedVideos.has(i)} onChange={()=>{const s=new Set(selectedVideos);s.has(i)?s.delete(i):s.add(i);setSelectedVideos(s)}} style={{width:16,height:16,cursor:"pointer",accentColor:"#4caf50",flexShrink:0}}/>
              <span style={{fontSize:11,color:"#555",fontWeight:700,minWidth:20}}>#{i+1}</span>
              {(()=>{const t=ytThumb(v.youtubeUrl);return t?<img src={t} alt="" style={{width:40,height:26,borderRadius:3,objectFit:"cover"}}/>:null})()}
              <input value={v.youtubeUrl} onChange={e=>{const nv=[...videos];nv[i]={...v,youtubeUrl:e.target.value};setVideos(nv)}} placeholder="YouTube URL ou ID" style={{...iS,flex:1}}/>
              <input value={v.titulo||""} onChange={e=>{const nv=[...videos];nv[i]={...v,titulo:e.target.value};setVideos(nv)}} placeholder="Título" style={{...iS,width:120}}/>
              <button onClick={async()=>{
                const vId=extractYouTubeId(v.youtubeUrl);
                if(!vId){setError("URL YouTube inválida");return}
                const meta=await fetchYouTubeMetadata(vId);
                if(meta){const nv=[...videos];nv[i]={...nv[i],titulo:meta.title};setVideos(nv);setCH(Math.floor(meta.duration/3600));setCM(Math.floor((meta.duration%3600)/60));setSinopse(meta.description);setError("")}
                else setError("Erro ao buscar vídeo");
              }} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"6px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>🔍 Buscar</button>
              {videos.length>1&&<button onClick={()=>setVideos(videos.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#f44336",cursor:"pointer",fontSize:14}}>✕</button>}
            </div>)}
          </div>
          <button onClick={()=>setVideos([...videos,{youtubeUrl:"",titulo:""}])} style={{marginTop:8,padding:"8px 14px",borderRadius:4,cursor:"pointer",background:"rgba(76,175,80,0.1)",border:"1px solid rgba(76,175,80,0.3)",color:"#4caf50",fontSize:12,fontWeight:600,width:"100%"}}>+ Adicionar vídeo</button>
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

        {/* Tags */}
        <div><label style={lS}>QUALIDADE E ÁUDIO</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[{id:"HD",cor:"#1a73e8"},{id:"SD",cor:"#607d8b"},{id:"4K",cor:"#e91e63"},{id:"DUB",label:"Dublado",cor:"#4caf50"},{id:"LEG",label:"Legendado",cor:"#ff9800"},{id:"5.1",label:"5.1 Surround",cor:"#9c27b0"},{id:"ORIG",label:"Áudio Original",cor:"#00bcd4"},{id:"INÉDITO",cor:"#f44336"},{id:"REPRISE",cor:"#795548"}].map(tag=>{
              const active=tags.includes(tag.id);
              return <button key={tag.id} onClick={()=>active?setTags(tags.filter(t=>t!==tag.id)):setTags([...tags,tag.id])} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600,background:active?`${tag.cor}22`:"rgba(255,255,255,0.04)",border:active?`1px solid ${tag.cor}`:"1px solid rgba(255,255,255,0.08)",color:active?tag.cor:"#888",transition:"all 0.2s"}}>{tag.label||tag.id}</button>;
            })}
          </div>
        </div>

        {/* Synopsis */}
        <div><label style={lS}>SINOPSE</label>
          <textarea value={sinopse} onChange={e=>setSinopse(e.target.value)} placeholder="Descrição..." style={{...iS,width:"100%",height:70,resize:"vertical",fontFamily:"inherit"}}/></div>

        {/* GC Mensagem */}
        <div style={{background:"rgba(255,152,0,0.06)",border:"1px solid rgba(255,152,0,0.15)",borderRadius:6,padding:"12px 14px"}}>
          <label style={{...lS,color:"#ffb74d",marginBottom:8}}>📺 MENSAGEM GC (opcional)</label>
          <input value={gcMensagem} onChange={e=>setGcMsg(e.target.value)} placeholder='Ex: "Veja a seguir" ou "Não recomendado para < 14 anos"'
            style={{...iS,width:"100%",marginBottom:8}}/>
          {gcMensagem&&<>
            {/* Posição */}
            <div style={{marginBottom:8}}>
              <div style={{fontSize:10,color:"#aaa",fontWeight:600,marginBottom:4,letterSpacing:0.5}}>QUANDO EXIBIR</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {[["inicio","Início (seg 2-25)"],["final","Final (últ. 20s)"],["ambos","Início e final"],["minuto","Minuto específico"]].map(([val,label])=>
                  <button key={val} onClick={()=>setGcPos(val)} style={{padding:"5px 10px",borderRadius:4,cursor:"pointer",fontSize:11,background:gcPosicao===val?"#ff980022":"rgba(255,255,255,0.04)",border:gcPosicao===val?"1px solid #ff9800":"1px solid rgba(255,255,255,0.08)",color:gcPosicao===val?"#ff9800":"#888",fontWeight:600}}>{label}</button>
                )}
              </div>
              {gcPosicao==="minuto"&&<div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
                <span style={{fontSize:11,color:"#888"}}>Exibir no minuto</span>
                <input type="number" min="0" max="999" value={gcMinuto||0} onChange={e=>setGcMinuto(parseInt(e.target.value)||0)}
                  style={{...iS,width:60,textAlign:"center"}}/>
                <span style={{fontSize:11,color:"#888"}}>por</span>
                <input type="number" min="5" max="120" value={gcDuracao||20} onChange={e=>setGcDurSeg(parseInt(e.target.value)||20)}
                  style={{...iS,width:60,textAlign:"center"}}/>
                <span style={{fontSize:11,color:"#888"}}>segundos</span>
              </div>}
            </div>
            {/* Fonte */}
            <div style={{marginBottom:8}}>
              <div style={{fontSize:10,color:"#aaa",fontWeight:600,marginBottom:4,letterSpacing:0.5}}>TAMANHO DA FONTE</div>
              <div style={{display:"flex",gap:5}}>
                {[["pequena","Pequena"],["normal","Normal"],["grande","Grande"],["destaque","Destaque"]].map(([val,label])=>
                  <button key={val} onClick={()=>setGcFonte(val)} style={{padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,background:gcFonte===val?"rgba(255,152,0,0.2)":"rgba(255,255,255,0.04)",border:gcFonte===val?"1px solid #ff9800":"1px solid rgba(255,255,255,0.08)",color:gcFonte===val?"#ff9800":"#888",fontWeight:gcFonte===val?700:400}}>{label}</button>
                )}
              </div>
            </div>
            {/* Estilo */}
            <div style={{marginBottom:8}}>
              <div style={{fontSize:10,color:"#aaa",fontWeight:600,marginBottom:4,letterSpacing:0.5}}>ESTILO</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {[["escuro","Fundo escuro"],["canal","Cor do canal"],["borda","Borda colorida"],["simples","Só texto"]].map(([val,label])=>
                  <button key={val} onClick={()=>setGcEstilo(val)} style={{padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,background:gcEstilo===val?"rgba(255,152,0,0.2)":"rgba(255,255,255,0.04)",border:gcEstilo===val?"1px solid #ff9800":"1px solid rgba(255,255,255,0.08)",color:gcEstilo===val?"#ff9800":"#888"}}>{label}</button>
                )}
              </div>
            </div>
            {/* Preview do GC */}
            <GCPreview mensagem={gcMensagem} fonte={gcFonte} estilo={gcEstilo} cor={channels.find(c=>c.id===canalId)?.cor||"#1a73e8"}/>
          </>}
        </div>

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

        <div style={{display:"flex",gap:8}}>
          <button onClick={safeClose} style={{flex:1,padding:12,borderRadius:6,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:13,fontWeight:600}}>Cancelar</button>
          <button onClick={save} disabled={hasOverlap||saving} style={{flex:2,padding:12,borderRadius:6,cursor:hasOverlap||saving?"not-allowed":"pointer",background:hasOverlap||saving?"#333":"#1a73e8",border:"none",color:"#fff",fontSize:13,fontWeight:700,opacity:hasOverlap||saving?0.5:1}}>{saving?"⏳ Salvando...":isEdit?"💾 Salvar":"✅ Agendar"}</button>
        </div>
      </div>
    </div>
  </div>;
}

// ============================================
// IPTV SEARCH MODAL
// Busca canais na API do iptv-org e preenche o formulário
// ============================================
function IPTVSearchModal({ onSelect, onClose }) {
  const [query,    setQuery]    = useState("");
  const [country,  setCountry]  = useState("BR");
  const [results,  setResults]  = useState([]);
  const [streams,  setStreams]   = useState({});   // channel_id → url
  const [loading,  setLoading]  = useState(false);
  const [loaded,   setLoaded]   = useState(false);
  const [allChs,   setAllChs]   = useState([]);
  const [error,    setError]    = useState(null);

  const [logos, setLogos] = useState({});  // channel_id → url

  // Carrega channels.json + streams.json + logos.json de uma vez
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("https://iptv-org.github.io/api/channels.json").then(r=>r.json()),
      fetch("https://iptv-org.github.io/api/streams.json").then(r=>r.json()),
      fetch("https://iptv-org.github.io/api/logos.json").then(r=>r.json()),
    ]).then(([chs, strs, lgos]) => {
      setAllChs(chs);
      // Mapeia channel_id → primeira url de stream sem geo-bloqueio
      const streamMap = {};
      strs.forEach(s => {
        if (s.channel && !streamMap[s.channel] && s.label !== "Geo-blocked") {
          streamMap[s.channel] = s.url;
        }
      });
      setStreams(streamMap);
      // Mapeia channel_id → primeira logo disponível
      const logoMap = {};
      lgos.forEach(l => {
        if (l.channel && l.url && !logoMap[l.channel]) {
          logoMap[l.channel] = l.url;
        }
      });
      setLogos(logoMap);
      setLoaded(true);
      setLoading(false);
    }).catch(e => {
      setError("Erro ao carregar dados: " + e.message);
      setLoading(false);
    });
  }, []);

  // Filtra resultados
  useEffect(() => {
    if (!loaded || query.trim().length < 2) { setResults([]); return; }
    const q = query.toLowerCase();
    const filtered = allChs
      .filter(ch => {
        const matchName    = ch.name.toLowerCase().includes(q) ||
                             (ch.alt_names||[]).some(n=>n.toLowerCase().includes(q));
        const matchCountry = !country || ch.country === country;
        return matchName && matchCountry && !ch.closed;
      })
      .slice(0, 30);
    setResults(filtered);
  }, [query, country, loaded, allChs]);

  const COUNTRIES = [
    ["","Todos os países"],["BR","🇧🇷 Brasil"],["US","🇺🇸 EUA"],
    ["PT","🇵🇹 Portugal"],["GB","🇬🇧 Reino Unido"],["AR","🇦🇷 Argentina"],
    ["ES","🇪🇸 Espanha"],["MX","🇲🇽 México"],["FR","🇫🇷 França"],
    ["DE","🇩🇪 Alemanha"],["IT","🇮🇹 Itália"],["JP","🇯🇵 Japão"],
  ];

  // Mapeia categoria iptv-org → tipo do canal TREND TV
  const catToTipo = (cats=[]) => {
    if (cats.includes("music"))         return "musica";
    if (cats.includes("news"))          return "noticias";
    if (cats.includes("movies"))        return "filmes";
    if (cats.includes("sports"))        return "esportes";
    if (cats.includes("kids") || cats.includes("animation")) return "infantil";
    return "geral";
  };

  const handleSelect = (ch) => {
    const streamUrl = streams[ch.id] || null;
    const logoUrl   = logos[ch.id]   || null;
    onSelect({
      nome:      ch.name,
      logoUrl,
      streamUrl: streamUrl || "",
      tipo:      catToTipo(ch.categories),
      iptvId:    ch.id,
      pais:      ch.country,
      aviso:     !streamUrl,
    });
    onClose();
  };

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:300,
      background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#14161e",borderRadius:12,width:"100%",maxWidth:560,
        maxHeight:"80vh",display:"flex",flexDirection:"column",
        border:"1px solid rgba(255,255,255,0.08)",overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.07)",
          display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>🔍 Buscar Canal IPTV</div>
            <div style={{fontSize:11,color:"#555",marginTop:2}}>Fonte: iptv-org · {allChs.length>0?`${allChs.length.toLocaleString()} canais`:"carregando..."}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#666",cursor:"pointer",fontSize:20}}>✕</button>
        </div>

        {/* Filtros */}
        <div style={{padding:"12px 20px",borderBottom:"1px solid rgba(255,255,255,0.05)",flexShrink:0}}>
          <div style={{display:"flex",gap:8}}>
            <input
              autoFocus
              value={query}
              onChange={e=>setQuery(e.target.value)}
              placeholder="Nome do canal (ex: CNN, Globo, ESPN...)"
              style={{...iS,flex:1,fontSize:13}}
            />
            <select value={country} onChange={e=>setCountry(e.target.value)}
              style={{...iS,width:160,fontSize:12}}>
              {COUNTRIES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* Resultados */}
        <div style={{flex:1,overflowY:"auto",padding:"8px 0"}}>
          {loading && (
            <div style={{padding:40,textAlign:"center",color:"#555",fontSize:13}}>
              ⏳ Carregando banco de dados...
            </div>
          )}
          {error && (
            <div style={{padding:20,textAlign:"center",color:"#f44336",fontSize:12}}>{error}</div>
          )}
          {!loading && query.trim().length < 2 && (
            <div style={{padding:32,textAlign:"center",color:"#444",fontSize:12}}>
              Digite ao menos 2 letras para buscar
            </div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div style={{padding:32,textAlign:"center",color:"#444",fontSize:12}}>
              Nenhum canal encontrado para "{query}"
              {country && <div style={{marginTop:6,color:"#555"}}>Tente sem filtro de país</div>}
            </div>
          )}
          {results.map(ch => {
            const hasStream = !!streams[ch.id];
            return (
              <div key={ch.id} onClick={()=>handleSelect(ch)}
                style={{display:"flex",alignItems:"center",gap:12,padding:"10px 20px",
                  cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)",
                  transition:"background 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {/* Logo do canal */}
                <div style={{width:40,height:40,borderRadius:5,background:"rgba(255,255,255,0.06)",
                  display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden"}}>
                  {logos[ch.id]
                    ? <img src={logos[ch.id]} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}
                        onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="flex";}}/>
                    : null}
                  <span style={{fontSize:18,display:logos[ch.id]?"none":"flex"}}>📺</span>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#fff",
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {ch.name}
                  </div>
                  <div style={{fontSize:10,color:"#555",marginTop:2,display:"flex",gap:8}}>
                    <span>{ch.country}</span>
                    {ch.categories?.length > 0 && <span>{ch.categories[0]}</span>}
                  </div>
                </div>
                <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                  {hasStream
                    ? <span style={{fontSize:9,fontWeight:800,color:"#4caf50",
                        background:"rgba(76,175,80,0.12)",border:"1px solid rgba(76,175,80,0.25)",
                        padding:"2px 6px",borderRadius:3}}>📡 STREAM</span>
                    : <span style={{fontSize:9,color:"#555",
                        background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",
                        padding:"2px 6px",borderRadius:3}}>sem stream</span>
                  }
                  {logos[ch.id] && <span style={{fontSize:9,color:"#1a73e8",
                    background:"rgba(26,115,232,0.1)",border:"1px solid rgba(26,115,232,0.2)",
                    padding:"2px 6px",borderRadius:3}}>🖼️ logo</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{padding:"10px 20px",borderTop:"1px solid rgba(255,255,255,0.05)",
          fontSize:10,color:"#444",flexShrink:0}}>
          ⚠️ Streams podem ter restrição geográfica. Logos e metadados importados automaticamente.
          Fonte: <a href="https://github.com/iptv-org/database" target="_blank"
            rel="noopener noreferrer" style={{color:"#1a73e8",textDecoration:"none"}}>iptv-org/database</a>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CHANNEL EDITOR
// ============================================
function ChannelEditor({channels,onAdd,onDelete}){
  const [editing,setEditing]=useState(null);
  const [nome,setNome]=useState("");
  const [numero,setNumber]=useState(0);
  const [logo,setLogo]=useState("");
  const [logoType,setLT]=useState("emoji");
  const [logoUrl,setLU]=useState(null);
  const [cor,setCor]=useState("");
  const [tipo,setTipo]=useState("geral");
  const [gcLayout,setGcLayout]=useState("inf-dir");
  const [streamUrl,setStreamUrl]=useState("");
  const [showIPTV,setShowIPTV]=useState(false);
  const [saving,setSaving]=useState(false);

  const handleIPTVSelect = ({ nome:n, streamUrl:su, logoUrl:lu, tipo:tp, aviso }) => {
    setNome(n);
    setStreamUrl(su || "");
    // Aplica logo se disponível
    if (lu) { setLT("custom"); setLU(lu); }
    else    { setLT("emoji");  setLogo("📺"); }
    // Aplica tipo de canal automaticamente
    if (tp) setTipo(tp);
    // Cor aleatória se não tiver
    if (!cor) setCor(COLOR_LIST[Math.floor(Math.random()*COLOR_LIST.length)]);
    if (aviso) notify(`"${n}" importado sem stream disponível — cole a URL m3u8 manualmente.`,"info");
    else       notify(`✅ "${n}" importado com stream e logo!`,"success");
  };

  const startEdit=(ch)=>{setEditing(ch.id);setNome(ch.nome);setLogo(ch.logo);setLT(ch.logoType||"emoji");setLU(ch.logoUrl||null);setCor(ch.cor);setNumber(ch.numero||0);setTipo(ch.tipo||"geral");setGcLayout(ch.gcLayout||"inf-dir");setStreamUrl(ch.streamUrl||"")};
  const save=async()=>{
    if(!nome.trim()){ alert("Digite um nome para o canal"); return; }
    if(!cor){ alert("Selecione uma cor"); return; }
    setSaving(true);
    try {
      // Remove campos undefined — Firestore rejeita undefined
      const data = {
        nome:     nome.trim(),
        numero:   Number(numero) || 0,
        logo:     logo || "📺",
        logoType: logoType || "emoji",
        logoUrl:  logoUrl || null,
        cor:      cor,
        tipo:     tipo || "geral",
        gcLayout: gcLayout || "inf-dir",
        streamUrl: streamUrl.trim() || null,
      };
      await updateDoc(doc(db,"channels",editing), data);
      setEditing(null);
    }
    catch(err){
      console.error("Erro ao salvar canal:",err);
      alert("Erro ao salvar canal: " + err.message);
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
        {/* Stream m3u8 */}
        <div style={{background:"rgba(76,175,80,0.05)",border:"1px solid rgba(76,175,80,0.15)",borderRadius:6,padding:"12px 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
            <label style={{...lS,color:"#81c784",marginBottom:0}}>📡 STREAM AO VIVO (m3u8 — opcional)</label>
            <button onClick={()=>setShowIPTV(true)}
              style={{padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:10,fontWeight:700,
                background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7"}}>
              🔍 Buscar IPTV
            </button>
          </div>
          <input
            value={streamUrl}
            onChange={e=>setStreamUrl(e.target.value)}
            placeholder="https://exemplo.com/stream/live.m3u8 — ou use Buscar IPTV"
            style={{...iS,width:"100%",fontFamily:"monospace",fontSize:11}}
          />
          {streamUrl.trim() && (
            <div style={{marginTop:6,fontSize:10,color:"#4caf50",display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:"#4caf50",display:"inline-block",boxShadow:"0 0 5px #4caf50"}}/>
              Stream ativo — este canal irá ao vivo ignorando a programação YouTube
            </div>
          )}
          {!streamUrl.trim() && (
            <div style={{marginTop:5,fontSize:10,color:"#555"}}>
              Deixe vazio para usar programação YouTube. Formatos: m3u8, HLS direto.
            </div>
          )}
        </div>
        <div><label style={lS}>COR</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{COLOR_LIST.map(c=><button key={c} onClick={()=>setCor(c)} style={{width:36,height:36,borderRadius:4,cursor:"pointer",background:c,border:cor===c?"3px solid #fff":"2px solid transparent"}}/>)}</div>
        </div>
        <div><label style={lS}>TIPO DE CANAL</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {[["geral","📺 Geral"],["musica","🎵 Música"],["noticias","📰 Notícias"],["filmes","🎬 Filmes"],["esportes","⚽ Esportes"],["infantil","👶 Infantil"]].map(([val,label])=>
              <button key={val} onClick={()=>setTipo(val)} style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,background:tipo===val?"#1a73e822":"rgba(255,255,255,0.04)",border:tipo===val?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:tipo===val?"#4fc3f7":"#888",fontWeight:600}}>{label}</button>
            )}
          </div>
          {tipo==="musica"&&<div style={{marginTop:6,fontSize:10,color:"#9c27b0",padding:"4px 8px",background:"rgba(156,39,176,0.08)",borderRadius:4,border:"1px solid rgba(156,39,176,0.2)"}}>🎵 GC "Você está ouvindo" será exibido automaticamente neste canal</div>}
        </div>
        <div><label style={lS}>POSIÇÃO DO GC NA TELA</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:4}}>
            {[
              ["sup-esq","↖ Sup. Esquerdo"],
              ["sup-dir","↗ Sup. Direito"],
              ["inf-esq","↙ Inf. Esquerdo"],
              ["inf-dir","↘ Inf. Direito"],
            ].map(([val,label])=>(
              <button key={val} onClick={()=>setGcLayout(val)}
                style={{padding:"8px 6px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,textAlign:"center",
                  background:gcLayout===val?"rgba(26,115,232,0.2)":"rgba(255,255,255,0.04)",
                  border:gcLayout===val?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",
                  color:gcLayout===val?"#4fc3f7":"#888"}}>
                {label}
              </button>
            ))}
          </div>
          <div style={{marginTop:6,fontSize:10,color:"#555"}}>Define onde o GC aparece na tela para este canal.</div>
        </div>

        <div style={{padding:12,background:"rgba(26,115,232,0.08)",borderRadius:8,border:"1px solid rgba(26,115,232,0.2)"}}>
          <div style={{fontSize:11,color:"#4fc3f7",fontWeight:700,marginBottom:8}}>👁️ PREVIEW</div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:48,height:48,borderRadius:6,background:`${cor}22`,border:`2px solid ${cor}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
              {logoType==="custom"&&logoUrl?<img src={logoUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:28}}>{logo}</span>}
            </div>
            <div><div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{nome||"Sem nome"}</div><div style={{fontSize:12,color:"#888"}}>Canal {numero}</div></div>
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
          <div>
            <div style={{fontSize:14,fontWeight:600,color:"#fff",display:"flex",alignItems:"center",gap:6}}>
              {ch.nome}
              {ch.streamUrl&&<span style={{fontSize:9,fontWeight:800,color:"#4caf50",background:"rgba(76,175,80,0.15)",border:"1px solid rgba(76,175,80,0.3)",padding:"2px 5px",borderRadius:3,letterSpacing:0.5}}>📡 LIVE</span>}
              {ch.offline&&<span style={{fontSize:9,fontWeight:800,color:"#ff9800",background:"rgba(255,152,0,0.1)",border:"1px solid rgba(255,152,0,0.25)",padding:"2px 5px",borderRadius:3}}>📴 OFF</span>}
            </div>
            <div style={{fontSize:11,color:"#888"}}>Canal {ch.numero}</div>
          </div>
          <div style={{width:16,height:16,borderRadius:4,background:ch.cor,marginLeft:8}}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>startEdit(ch)} style={{padding:"8px 16px",borderRadius:4,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:12}}>✏️ Editar</button>
          <button onClick={async()=>{
            try{ await updateDoc(doc(db,"channels",ch.id),{offline:!ch.offline});
              notify(ch.offline?"✅ Canal no ar!":"📴 Canal fora do ar!","success");
            }catch(e){notify("Erro: "+e.message,"error");}
          }} style={{padding:"8px 16px",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600,
            background:ch.offline?"rgba(76,175,80,0.1)":"rgba(255,152,0,0.1)",
            border:ch.offline?"1px solid rgba(76,175,80,0.25)":"1px solid rgba(255,152,0,0.25)",
            color:ch.offline?"#4caf50":"#ff9800"}}>
            {ch.offline?"📡 No ar":"📴 Fora do ar"}
          </button>
          <button onClick={()=>onDelete(ch)} style={{padding:"8px 16px",borderRadius:4,cursor:"pointer",background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.2)",color:"#f44336",fontSize:12}}>🗑️ Deletar</button>
        </div>
      </div>}
    </div>)}
    <button onClick={async()=>{
      const anyOn=channels.some(c=>!c.offline);
      await Promise.allSettled(channels.map(c=>updateDoc(doc(db,"channels",c.id),{offline:anyOn})));
      notify(anyOn?"📴 Todos fora do ar!":"✅ Todos no ar!","success");
    }} style={{padding:10,borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,marginBottom:6,
      background:"rgba(255,152,0,0.08)",border:"1px solid rgba(255,152,0,0.2)",color:"#ff9800"}}>
      {channels.some(c=>!c.offline)?"📴 Tirar todos do ar":"📡 Colocar todos no ar"}
    </button>
    <div style={{display:"flex",gap:8}}>
      <button onClick={()=>setShowIPTV(true)}
        style={{flex:1,padding:12,borderRadius:8,cursor:"pointer",
          background:"rgba(26,115,232,0.08)",border:"2px dashed rgba(26,115,232,0.2)",
          color:"#4fc3f7",fontSize:13,fontWeight:600}}>
        🔍 Buscar canal IPTV
      </button>
      <button onClick={onAdd}
        style={{flex:1,padding:12,borderRadius:8,cursor:"pointer",
          background:"rgba(76,175,80,0.08)",border:"2px dashed rgba(76,175,80,0.3)",
          color:"#4caf50",fontSize:13,fontWeight:600}}>
        + Novo canal manual
      </button>
    </div>
    {showIPTV&&<IPTVSearchModal onSelect={e=>{onAdd();setTimeout(()=>handleIPTVSelect(e),100);}} onClose={()=>setShowIPTV(false)}/>}
  </div>;
}

// ============================================
// IMPORT MODAL
// ============================================
/*
  FORMATOS ACEITOS NO TXT:
  ─────────────────────────────────────────────
  Formato 1 — bloco por data (recomendado):
    CANAL: NomeDoCanal
    DATA: 2026-06-25
    00:00 | Nome do Programa | https://youtu.be/xxx
    01:30 | Outro Programa   | dQw4w9WgXcQ
    ...

  Formato 2 — uma linha com tudo:
    2026-06-25 | NomeDoCanal | 00:00 | Nome do Programa | https://youtu.be/xxx

  Regras:
  - Separador: | (pipe) ou TAB
  - Horário: HH:MM ou H:MM
  - YouTube: URL completa ou só o ID (11 chars)
  - Classificação opcional no fim: L, 10, 12, 14, 16, 18
  - Tags opcionais: HD, DUB, LEG, 4K, 5.1
  ─────────────────────────────────────────────
*/
function parseImportTxt(txt, channels) {
  const lines  = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items  = [];
  const errors = [];

  let curCanal = null;
  let curData  = null;

  const hmToSec = (hm) => {
    const [h, m] = hm.split(":").map(Number);
    return (h || 0) * 3600 + (m || 0) * 60;
  };

  const extractId = (s) => {
    if (!s) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) { const m = s.match(p); if (m) return m[1]; }
    return null;
  };

  const resolveChannel = (name) => {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    return channels.find(c =>
      c.nome.toLowerCase() === n ||
      c.nome.toLowerCase().includes(n) ||
      n.includes(c.nome.toLowerCase())
    ) || null;
  };

  const CLASSIFS = ["L","10","12","14","16","18"];
  const TAGS_OK  = ["HD","SD","4K","DUB","LEG","5.1","ORIG","INÉDITO","REPRISE"];

  const parseLine = (line, lineNum) => {
    // Tenta formato 2: DATA | CANAL | HH:MM | NOME | URL [| CLASSIF] [| TAGS]
    const sep  = line.includes("|") ? "|" : "\t";
    const cols = line.split(sep).map(c => c.trim()).filter(Boolean);

    // Detecta se primeira coluna é uma data
    if (cols.length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(cols[0])) {
      const [data, canalNome, horario, nome, url, ...rest] = cols;
      const ch    = resolveChannel(canalNome);
      const ytId  = extractId(url);
      const sec   = hmToSec(horario);
      const classif = rest.find(r => CLASSIFS.includes(r)) || "L";
      const tags    = rest.filter(r => TAGS_OK.includes(r));
      if (!ch)   { errors.push(`Linha ${lineNum}: canal "${canalNome}" não encontrado`); return; }
      if (!ytId) { errors.push(`Linha ${lineNum}: URL/ID YouTube inválido — "${url}"`); return; }
      if (!nome) { errors.push(`Linha ${lineNum}: nome do programa vazio`); return; }
      items.push({ data, canalId:ch.id, canalNome:ch.nome, horario, nome, ytId, sec, classif, tags });
      return;
    }

    // Formato 1: HH:MM | NOME | URL [| CLASSIF] [| TAGS]
    if (cols.length >= 3 && /^\d{1,2}:\d{2}$/.test(cols[0])) {
      if (!curCanal) { errors.push(`Linha ${lineNum}: horário sem CANAL: definido antes`); return; }
      if (!curData)  { errors.push(`Linha ${lineNum}: horário sem DATA: definida antes`);  return; }
      const [horario, nome, url, ...rest] = cols;
      const ytId    = extractId(url);
      const sec     = hmToSec(horario);
      const classif = rest.find(r => CLASSIFS.includes(r)) || "L";
      const tags    = rest.filter(r => TAGS_OK.includes(r));
      if (!ytId) { errors.push(`Linha ${lineNum}: URL/ID YouTube inválido — "${url}"`); return; }
      if (!nome) { errors.push(`Linha ${lineNum}: nome vazio`); return; }
      items.push({ data:curData, canalId:curCanal.id, canalNome:curCanal.nome, horario, nome, ytId, sec, classif, tags });
      return;
    }

    // Diretiva CANAL:
    if (/^canal:/i.test(line)) {
      const nome = line.replace(/^canal:/i, "").trim();
      curCanal = resolveChannel(nome);
      if (!curCanal) errors.push(`Linha ${lineNum}: canal "${nome}" não existe no sistema`);
      return;
    }

    // Diretiva DATA:
    if (/^data:/i.test(line)) {
      curData = line.replace(/^data:/i, "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(curData))
        errors.push(`Linha ${lineNum}: data inválida "${curData}" (use AAAA-MM-DD)`);
      return;
    }

    // Comentário (#) — ignora silenciosamente
    if (line.startsWith("#")) return;

    errors.push(`Linha ${lineNum}: não reconhecida — "${line.slice(0, 60)}"`);
  };

  lines.forEach((line, i) => parseLine(line, i + 1));

  // Calcula horários fim baseado no próximo item (ou +1h como fallback)
  // Agrupa por canal+data para calcular sequência
  const groups = {};
  items.forEach(it => {
    const k = `${it.canalId}__${it.data}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(it);
  });

  const result = [];
  Object.values(groups).forEach(grp => {
    grp.sort((a,b) => a.sec - b.sec);
    grp.forEach((it, i) => {
      const nextSec = i < grp.length - 1 ? grp[i+1].sec : it.sec + 3600;
      const dur     = Math.max(nextSec - it.sec, 300);
      result.push({
        id:           `import_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        nome:         it.nome,
        canalId:      it.canalId,
        data:         it.data,
        duracao:      dur,
        horarioInicio: it.sec,
        horarioFim:   it.sec + dur,
        youtubeId:    it.ytId,
        videos:       [{ youtubeUrl: it.ytId, titulo: it.nome }],
        classificacao: it.classif,
        tags:         it.tags.length ? it.tags : ["HD"],
        sinopse:      "",
        thumbnailType:"youtube",
        thumbnailUrl: null,
        _preview:     { canalNome: it.canalNome, horario: it.horario },
      });
    });
  });

  return { items: result, errors };
}

function ImportModal({ channels, dates, existingPrograms, onClose, onImport }) {
  const [txt, setTxt]         = useState("");
  const [parsed, setParsed]   = useState(null);   // { items, errors }
  const [importing, setImp]   = useState(false);
  const [overwrite, setOvr]   = useState(false);
  const fileRef               = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = e => setTxt(e.target.result);
    r.readAsText(f, "UTF-8");
  };

  const handleParse = () => {
    if (!txt.trim()) return;
    setParsed(parseImportTxt(txt, channels));
  };

  const handleImport = async () => {
    if (!parsed || parsed.items.length === 0) return;
    setImp(true);
    try {
      let finalItems = [...parsed.items];
      if (!overwrite) {
        // Remove itens que colidem com programas existentes
        finalItems = finalItems.filter(item =>
          !existingPrograms.some(ex =>
            ex.data === item.data &&
            ex.canalId === item.canalId &&
            !(ex.horarioFim <= item.horarioInicio || ex.horarioInicio >= item.horarioFim)
          )
        );
      } else {
        // Apaga programas existentes nos canais+datas afetados
        const pairs = new Set(parsed.items.map(it => `${it.canalId}__${it.data}`));
        const toDelete = existingPrograms.filter(ex => pairs.has(`${ex.canalId}__${ex.data}`));
        await Promise.all(toDelete.map(p => deleteDoc(doc(db,"programs",p.id))));
      }
      await onImport(finalItems);
    } finally {
      setImp(false);
    }
  };

  const EXAMPLE = `# Exemplo de arquivo de importação
# Linhas com # são comentários e são ignoradas

CANAL: AgoraTV
DATA: 2026-06-25
00:00 | Jornal da Manhã        | https://youtu.be/dQw4w9WgXcQ
01:00 | Documentário Natureza  | dQw4w9WgXcQ | HD | DUB
03:00 | Filme de Ação          | dQw4w9WgXcQ | 14

CANAL: SoundTV
DATA: 2026-06-25
00:00 | Rock Clássicos         | dQw4w9WgXcQ
02:00 | Pop Brasil             | dQw4w9WgXcQ | HD`;

  const conflictCount = parsed?.items.filter(item =>
    existingPrograms.some(ex =>
      ex.data === item.data && ex.canalId === item.canalId &&
      !(ex.horarioFim <= item.horarioInicio || ex.horarioInicio >= item.horarioFim)
    )
  ).length || 0;

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.8)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,
        maxWidth:740,width:"100%",border:"1px solid rgba(255,255,255,0.1)",
        maxHeight:"90vh",overflowY:"auto",display:"flex",flexDirection:"column"}}>

        {/* ── HEADER ── */}
        <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",
          display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:"#fff"}}>📥 Importar Programação via TXT</div>
            <div style={{fontSize:11,color:"#666",marginTop:2}}>
              Cole o texto, arraste um arquivo .txt ou .csv
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#666",
            cursor:"pointer",fontSize:20,lineHeight:1}}>✕</button>
        </div>

        <div style={{padding:20,display:"flex",flexDirection:"column",gap:16,flex:1}}>

          {/* ── FORMATO ── */}
          <details style={{background:"rgba(255,152,0,0.06)",border:"1px solid rgba(255,152,0,0.2)",
            borderRadius:6,padding:"10px 14px"}}>
            <summary style={{cursor:"pointer",fontSize:12,fontWeight:700,color:"#ffb74d",
              userSelect:"none"}}>📋 Ver formato do arquivo</summary>
            <pre style={{marginTop:10,fontSize:11,color:"#888",lineHeight:1.7,
              whiteSpace:"pre-wrap",fontFamily:"monospace"}}>{EXAMPLE}</pre>
            <div style={{marginTop:10,fontSize:11,color:"#666",lineHeight:1.8}}>
              <strong style={{color:"#aaa"}}>Colunas separadas por |</strong><br/>
              • <code style={{color:"#ffb74d"}}>CANAL: NomeExato</code> — nome do canal cadastrado<br/>
              • <code style={{color:"#ffb74d"}}>DATA: AAAA-MM-DD</code> — data no formato ISO<br/>
              • <code style={{color:"#4fc3f7"}}>HH:MM | Nome | URL/ID</code> — um programa por linha<br/>
              • Classificação opcional: <code>L, 10, 12, 14, 16, 18</code><br/>
              • Tags opcionais: <code>HD, DUB, LEG, 4K, 5.1</code><br/>
              • A duração é calculada automaticamente até o próximo programa
            </div>
          </details>

          {/* ── ÁREA DE TEXTO + UPLOAD ── */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <label style={{fontSize:11,color:"#888",fontWeight:600,letterSpacing:0.5}}>
                CONTEÚDO DO ARQUIVO
              </label>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setTxt(EXAMPLE)}
                  style={{fontSize:10,color:"#888",background:"rgba(255,255,255,0.05)",
                    border:"1px solid rgba(255,255,255,0.08)",padding:"3px 8px",
                    borderRadius:3,cursor:"pointer"}}>
                  Carregar exemplo
                </button>
                <button onClick={()=>fileRef.current?.click()}
                  style={{fontSize:10,color:"#ffb74d",background:"rgba(255,152,0,0.1)",
                    border:"1px solid rgba(255,152,0,0.25)",padding:"3px 8px",
                    borderRadius:3,cursor:"pointer"}}>
                  📁 Abrir arquivo
                </button>
                <input ref={fileRef} type="file" accept=".txt,.csv,.tsv"
                  style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
              </div>
            </div>
            <textarea
              value={txt}
              onChange={e=>{setTxt(e.target.value);setParsed(null)}}
              onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])}}
              onDragOver={e=>e.preventDefault()}
              placeholder={"Cole aqui ou arraste um arquivo .txt\n\nCANAL: AgoraTV\nDATA: 2026-06-25\n00:00 | Programa | https://youtu.be/xxx"}
              style={{width:"100%",height:160,background:"rgba(255,255,255,0.04)",
                border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,
                padding:"10px 12px",color:"#fff",fontSize:12,
                fontFamily:"monospace",resize:"vertical",outline:"none",
                lineHeight:1.6,boxSizing:"border-box"}}
            />
          </div>

          {/* ── BOTÃO PARSE ── */}
          {!parsed && (
            <button onClick={handleParse} disabled={!txt.trim()}
              style={{padding:"11px 0",borderRadius:6,border:"none",cursor:txt.trim()?"pointer":"not-allowed",
                background:txt.trim()?"linear-gradient(135deg,#ff9800,#f57c00)":"#333",
                color:"#fff",fontSize:13,fontWeight:700,opacity:txt.trim()?1:0.5}}>
              🔍 Analisar arquivo
            </button>
          )}

          {/* ── RESULTADO DO PARSE ── */}
          {parsed && (<>
            {/* Erros */}
            {parsed.errors.length > 0 && (
              <div style={{background:"rgba(244,67,54,0.08)",border:"1px solid rgba(244,67,54,0.25)",
                borderRadius:6,padding:"10px 14px"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#f44336",marginBottom:6}}>
                  ⚠️ {parsed.errors.length} aviso(s) encontrado(s):
                </div>
                {parsed.errors.map((e,i)=>(
                  <div key={i} style={{fontSize:11,color:"#ef9a9a",marginBottom:3,
                    fontFamily:"monospace"}}>• {e}</div>
                ))}
              </div>
            )}

            {/* Preview dos programas */}
            {parsed.items.length > 0 ? (
              <div style={{background:"rgba(76,175,80,0.06)",border:"1px solid rgba(76,175,80,0.2)",
                borderRadius:6,padding:"10px 14px"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#4caf50",marginBottom:10}}>
                  ✅ {parsed.items.length} programa(s) prontos para importar:
                </div>
                <div style={{maxHeight:200,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                  {parsed.items.map((it,i)=>(
                    <div key={i} style={{display:"flex",gap:10,alignItems:"center",
                      padding:"6px 8px",background:"rgba(255,255,255,0.03)",borderRadius:4,
                      fontSize:11}}>
                      <span style={{color:"#4fc3f7",fontWeight:700,minWidth:40,fontFamily:"monospace"}}>
                        {it._preview.horario}
                      </span>
                      <span style={{color:"#fff",fontWeight:600,flex:1,
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {it.nome}
                      </span>
                      <span style={{color:"#888",minWidth:70,textAlign:"right"}}>{it._preview.canalNome}</span>
                      <span style={{color:"#666",minWidth:55,textAlign:"right",fontFamily:"monospace"}}>
                        {it.data}
                      </span>
                      <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,
                        background:"rgba(255,255,255,0.08)",color:"#aaa"}}>
                        {Math.floor(it.duracao/3600)}h{Math.floor((it.duracao%3600)/60).toString().padStart(2,"0")}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Conflitos */}
                {conflictCount > 0 && (
                  <div style={{marginTop:12,padding:"10px 12px",
                    background:"rgba(255,152,0,0.08)",border:"1px solid rgba(255,152,0,0.25)",
                    borderRadius:6}}>
                    <div style={{fontSize:12,color:"#ff9800",fontWeight:700,marginBottom:8}}>
                      ⚡ {conflictCount} conflito(s) com programação existente:
                    </div>
                    <div style={{display:"flex",gap:12,alignItems:"center"}}>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:"#aaa"}}>
                        <input type="radio" name="conflict" checked={!overwrite}
                          onChange={()=>setOvr(false)}
                          style={{accentColor:"#4fc3f7"}}/>
                        Pular conflitantes ({conflictCount} ignorados)
                      </label>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:"#aaa"}}>
                        <input type="radio" name="conflict" checked={overwrite}
                          onChange={()=>setOvr(true)}
                          style={{accentColor:"#f44336"}}/>
                        <span style={{color:"#f44336"}}>Substituir</span> (apaga programação existente nos dias/canais afetados)
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{padding:"14px",background:"rgba(244,67,54,0.08)",
                border:"1px solid rgba(244,67,54,0.2)",borderRadius:6,
                fontSize:13,color:"#f44336",textAlign:"center"}}>
                Nenhum programa válido encontrado. Verifique o formato.
              </div>
            )}

            {/* Botões de ação */}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setParsed(null);setOvr(false)}}
                style={{flex:1,padding:11,borderRadius:6,cursor:"pointer",
                  background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
                  color:"#aaa",fontSize:13,fontWeight:600}}>
                ← Editar
              </button>
              <button onClick={handleImport}
                disabled={importing || parsed.items.length === 0}
                style={{flex:2,padding:11,borderRadius:6,border:"none",
                  cursor:importing||parsed.items.length===0?"not-allowed":"pointer",
                  background:importing||parsed.items.length===0?"#333"
                    :"linear-gradient(135deg,#4caf50,#388e3c)",
                  color:"#fff",fontSize:13,fontWeight:700,
                  opacity:importing||parsed.items.length===0?0.5:1}}>
                {importing?"⏳ Importando...":
                  overwrite&&conflictCount>0
                    ?`⚠️ Substituir e importar ${parsed.items.length}`
                    :`✅ Importar ${overwrite?parsed.items.length:parsed.items.length-conflictCount} programa(s)`}
              </button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GCPreview — mini-preview visual do GC no Admin
// ─────────────────────────────────────────────────────────────
function GCPreview({ mensagem, fonte, estilo, cor }) {
  const sizes = { pequena:10, normal:13, grande:16, destaque:20 };
  const fs    = sizes[fonte] || 13;
  const bold  = fonte === "destaque";

  const boxStyle = {
    display:"inline-block", marginTop:8, maxWidth:"100%",
    fontSize:fs, fontWeight:bold?700:500,
    ...(estilo==="escuro"   && { background:"rgba(0,0,0,0.75)", color:"#fff", padding:"6px 12px", borderRadius:4 }),
    ...(estilo==="canal"    && { background:`${cor}cc`, color:"#fff", padding:"6px 12px", borderRadius:4 }),
    ...(estilo==="borda"    && { background:"rgba(0,0,0,0.72)", color:"#fff", padding:"6px 12px 6px 10px", borderLeft:`4px solid ${cor}`, borderRadius:"0 4px 4px 0" }),
    ...(estilo==="simples"  && { color:"#fff", textShadow:"0 1px 4px rgba(0,0,0,0.9)", padding:"4px 0" }),
  };
  return (
    <div style={{background:"#000",borderRadius:4,padding:"12px 14px",marginTop:6,position:"relative",minHeight:60,display:"flex",alignItems:"flex-end"}}>
      <div style={{fontSize:9,color:"#444",position:"absolute",top:6,left:8}}>PREVIEW</div>
      <div style={boxStyle}>{mensagem}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GC DO CANAL — configuração de GCs por horário do dia
// Salvo em channel.gcFaixas: [{ id, mensagem, tipo, horario,
//   duracao, fonte, estilo, canalIds }]
// tipo: "manha"|"tarde"|"noite"|"absoluto"
// ─────────────────────────────────────────────────────────────
function ChannelGCEditor({ channel, channels, onSave }) {
  const [faixas, setFaixas] = useState(channel.gcFaixas || []);
  const [saving, setSaving] = useState(false);

  const TIPOS = [
    { val:"manha",    label:"🌅 Manhã",    hint:"06:00 – 12:00" },
    { val:"tarde",    label:"☀️ Tarde",    hint:"12:00 – 18:00" },
    { val:"noite",    label:"🌙 Noite",    hint:"18:00 – 00:00" },
    { val:"absoluto", label:"🕐 Horário fixo", hint:"Hora específica" },
  ];

  const addFaixa = () => setFaixas(f => [...f, {
    id: Date.now().toString(),
    mensagem:"", tipo:"manha", horario:"", duracao:20,
    fonte:"normal", estilo:"borda",
  }]);

  const updFaixa = (id, key, val) =>
    setFaixas(f => f.map(x => x.id===id ? {...x,[key]:val} : x));

  const delFaixa = (id) => setFaixas(f => f.filter(x => x.id!==id));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db,"channels",channel.id), { gcFaixas: faixas });
      onSave();
    } catch(e) { alert("Erro ao salvar GC do canal: " + e.message); }
    setSaving(false);
  };

  return (
    <div style={{marginTop:16,background:"rgba(255,152,0,0.04)",border:"1px solid rgba(255,152,0,0.15)",borderRadius:8,padding:"14px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:700,color:"#ffb74d"}}>📺 GCs do Canal</div>
        <button onClick={addFaixa} style={{padding:"4px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,background:"rgba(255,152,0,0.15)",border:"1px solid rgba(255,152,0,0.3)",color:"#ffb74d"}}>+ Adicionar</button>
      </div>

      {faixas.length===0 && <div style={{fontSize:11,color:"#555",textAlign:"center",padding:"12px 0"}}>Nenhum GC configurado. Clique em "+ Adicionar".</div>}

      {faixas.map((f, fi) => (
        <div key={f.id} style={{marginBottom:12,background:"rgba(255,255,255,0.02)",borderRadius:6,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{display:"flex",gap:6,alignItems:"flex-start",marginBottom:8}}>
            <textarea value={f.mensagem} onChange={e=>updFaixa(f.id,"mensagem",e.target.value)}
              placeholder='Mensagem do GC...'
              rows={2} style={{...iS,flex:1,resize:"none",fontFamily:"inherit",fontSize:12}}/>
            <button onClick={()=>delFaixa(f.id)} style={{background:"none",border:"none",color:"#f44336",cursor:"pointer",fontSize:16,padding:"4px",flexShrink:0}}>✕</button>
          </div>
          {/* Tipo de horário */}
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
            {TIPOS.map(t=>(
              <button key={t.val} onClick={()=>updFaixa(f.id,"tipo",t.val)}
                style={{padding:"4px 9px",borderRadius:3,cursor:"pointer",fontSize:10,
                  background:f.tipo===t.val?"rgba(255,152,0,0.2)":"rgba(255,255,255,0.04)",
                  border:f.tipo===t.val?"1px solid #ff9800":"1px solid rgba(255,255,255,0.08)",
                  color:f.tipo===t.val?"#ff9800":"#888",fontWeight:f.tipo===t.val?700:400}}>
                {t.label} <span style={{opacity:0.5,fontSize:9}}>{t.hint}</span>
              </button>
            ))}
          </div>
          {/* Horário absoluto */}
          {f.tipo==="absoluto"&&(
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:11,color:"#888"}}>Às</span>
              <input type="time" value={f.horario} onChange={e=>updFaixa(f.id,"horario",e.target.value)}
                style={{...iS,width:90}}/>
              <span style={{fontSize:11,color:"#888"}}>por</span>
              <input type="number" min={5} max={120} value={f.duracao} onChange={e=>updFaixa(f.id,"duracao",parseInt(e.target.value)||20)}
                style={{...iS,width:55,textAlign:"center"}}/>
              <span style={{fontSize:11,color:"#888"}}>segundos</span>
            </div>
          )}
          {/* Fonte + Estilo */}
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:9,color:"#666",marginBottom:3,fontWeight:600}}>FONTE</div>
              <div style={{display:"flex",gap:3}}>
                {[["pequena","P"],["normal","N"],["grande","G"],["destaque","D"]].map(([v,l])=>(
                  <button key={v} onClick={()=>updFaixa(f.id,"fonte",v)}
                    style={{width:26,height:26,borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700,
                      background:f.fonte===v?"rgba(255,152,0,0.2)":"rgba(255,255,255,0.04)",
                      border:f.fonte===v?"1px solid #ff9800":"1px solid rgba(255,255,255,0.08)",
                      color:f.fonte===v?"#ff9800":"#888"}}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize:9,color:"#666",marginBottom:3,fontWeight:600}}>ESTILO</div>
              <div style={{display:"flex",gap:3}}>
                {[["borda","Borda"],["escuro","Escuro"],["canal","Canal"],["simples","Simples"]].map(([v,l])=>(
                  <button key={v} onClick={()=>updFaixa(f.id,"estilo",v)}
                    style={{padding:"3px 7px",borderRadius:3,cursor:"pointer",fontSize:10,
                      background:f.estilo===v?"rgba(255,152,0,0.2)":"rgba(255,255,255,0.04)",
                      border:f.estilo===v?"1px solid #ff9800":"1px solid rgba(255,255,255,0.08)",
                      color:f.estilo===v?"#ff9800":"#888"}}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          {f.mensagem && <GCPreview mensagem={f.mensagem} fonte={f.fonte} estilo={f.estilo} cor={channel.cor}/>}
        </div>
      ))}

      {faixas.length>0&&(
        <button onClick={handleSave} disabled={saving}
          style={{width:"100%",padding:"9px 0",borderRadius:5,border:"none",cursor:"pointer",
            background:"linear-gradient(135deg,#ff9800,#f57c00)",color:"#fff",
            fontSize:12,fontWeight:700,opacity:saving?0.6:1}}>
          {saving?"⏳ Salvando...":"💾 Salvar GCs do Canal"}
        </button>
      )}
    </div>
  );
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
// MAIN ADMIN
// ============================================
export default function AdminPanel({ onLogout }){
  const dates = genDates(30);
  const [tab,setTab]         = useState("schedule");
  const [selDate,setSelDate] = useState(dates[0]);
  const [selCh,setSelCh]     = useState(null);
  const [channels,setCh]     = useState([]);  // começa vazio, Firebase preenche
  const [programs,setProgs]  = useState([]);
  const [showModal,setSM]    = useState(false);
  const [editProg,setEP]     = useState(null);
  const [showCloneModal,setShowCloneModal] = useState(false);
  const [cloneMenuProgs,setCloneMenuProgs] = useState([]);
  const [selectedProgs,setSelectedProgs]  = useState(new Set());
  const [cloneData,setCloneData]           = useState({channel:"",date:null,time:""});
  const [cloneError,setCloneError]         = useState("");
  const [showDup,setSD]      = useState(false);
  const [toast,setToast]     = useState({msg:"",type:"info"});
  const [showImport,setShowImport] = useState(false);

  const notify = (msg, type="info") => {
    setToast({msg,type});
    setTimeout(() => setToast({msg:"",type:"info"}), 3000);
  };

  // ============================================================
  // FIREBASE — sem filtro de data (índice composto não obrigatório)
  // A query filtrada com where("data",...) exige índice composto
  // no Firestore — sem ele retorna silenciosamente vazio para datas
  // futuras. Como a coleção é pequena (7-30 dias × canais), carregar
  // tudo é correto e sem custo relevante.
  // ============================================================
  useEffect(() => {
    const unsubCh = onSnapshot(collection(db, "channels"), (snap) => {
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      if (list.length > 0) {
        const sorted = list.sort((a,b) => (a.numero||0) - (b.numero||0));
        setCh(sorted);
        setSelCh(prev => prev || sorted[0].id);
      }
    }, err => console.error("Firebase channels:", err));

    // Carrega TODOS os programas sem filtro — funciona sem índice
    const unsubPr = onSnapshot(collection(db, "programs"), (snap) => {
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setProgs(list);
    }, err => console.error("Firebase programs:", err));

    return () => { unsubCh(); unsubPr(); };
  }, []);

  // ============================================
  // SAVE / DELETE
  // ============================================
  const handleSave = async (p) => {
    try {
      const conflicts = programs.filter(x =>
        x.data === p.data && x.canalId === p.canalId && x.id !== p.id &&
        !(x.horarioFim <= p.horarioInicio || x.horarioInicio >= p.horarioFim)
      );
      if (conflicts.length > 0) { notify("⚠️ Conflito de horário com outro programa!", "error"); return; }

      if (editProg) {
        // Edição: atualiza doc existente — onSnapshot atualiza o estado
        const { id, ...data } = p;
        await updateDoc(doc(db, "programs", id), data);
      } else {
        // Novo: remove o id gerado localmente, Firestore gera o real
        const { id: _localId, ...data } = p;
        await addDoc(collection(db, "programs"), data);
        // NÃO atualiza estado manualmente — onSnapshot faz isso
      }

      notify(editProg ? "✅ Atualizado!" : "✅ Agendado!", "success");
      setSM(false); setEP(null);
    } catch(err) { console.error("Erro ao salvar:", err); notify("❌ Erro ao salvar", "error"); }
  };

  const handleDel = async (id) => {
    const prev = [...programs];
    try {
      setProgs(programs.filter(p => p.id !== id));
      await deleteDoc(doc(db,"programs",id));
      notify("🗑️ Removido","info");
    } catch(err) { console.error("Erro ao deletar:",err); notify("❌ Erro ao deletar","error"); setProgs(prev); }
  };

  const handleDup = async (from, to) => {
    const fp = programs.filter(p => p.data === from);
    if (fp.length === 0) { notify("⚠️ Nenhum programa no dia de origem", "error"); return; }
    try {
      // Apaga programas existentes no dia destino antes de copiar
      const existing = programs.filter(p => p.data === to);
      await Promise.all(existing.map(p => deleteDoc(doc(db, "programs", p.id))));
      // Cria novos no Firestore (sem id — Firestore gera)
      const results = await Promise.allSettled(fp.map(p => {
        const { id: _id, ...data } = p;
        return addDoc(collection(db, "programs"), { ...data, data: to });
      }));
      const failed = results.filter(r => r.status === "rejected").length;
      notify(failed === 0
        ? `📋 ${fp.length} programa(s) duplicado(s)!`
        : `⚠️ ${fp.length - failed} copiados, ${failed} falharam`, failed > 0 ? "error" : "success");
    } catch(err) { console.error("Erro ao duplicar:", err); notify("❌ Erro ao duplicar", "error"); }
  };

  // ── Preencher 24h com reprises ────────────────────────────────
  const handleFill24h = async () => {
    const progs = dayProgs.filter(p => p.canalId === selCh)
      .sort((a,b) => Number(a.horarioInicio) - Number(b.horarioInicio));
    if (progs.length === 0) { notify("Adicione ao menos 1 programa antes de preencher","error"); return; }

    // Descobre os gaps e calcula quantas reprises serão criadas
    const toCreate = [];
    let cursor = 0;

    // Varre todos os slots do dia e preenche gaps com reprises em sequência
    let progIdx = 0;
    const existing = [...progs];

    // Mapeia horários já ocupados
    const occupied = new Set();
    existing.forEach(p => {
      for(let s=Number(p.horarioInicio);s<Number(p.horarioFim);s++) occupied.add(s);
    });

    // Avança cursor pelos gaps e insere reprises
    cursor = 0;
    let repIdx = 0; // qual programa repetir (cicla em sequência)
    let safety = 0;
    while (cursor < 86400 && safety < 500) {
      safety++;
      // Se cursor está num horário ocupado, avança até o próximo gap
      if (occupied.has(cursor)) { cursor++; continue; }
      // Encontra fim do gap atual
      let gapEnd = cursor;
      while (gapEnd < 86400 && !occupied.has(gapEnd)) gapEnd++;

      const gapDur = gapEnd - cursor;
      if (gapDur < 60) { cursor = gapEnd; continue; } // gap < 1min, ignora

      // Preenche o gap com reprises do programa atual
      let fill = cursor;
      while (fill < gapEnd) {
        const src   = progs[repIdx % progs.length];
        const dur   = Number(src.duracao);
        const end   = Math.min(fill + dur, gapEnd);
        const acDur = end - fill;
        if (acDur < 60) break;
        toCreate.push({ ...src, horarioInicio:fill, horarioFim:end, duracao:acDur,
          tags:[...(src.tags||[]).filter(t=>t!=="INÉDITO"),"REPRISE"] });
        fill = end;
        repIdx++;
      }
      cursor = gapEnd;
    }

    if (toCreate.length === 0) { notify("A grade já está completa (24h preenchidas)!","info"); return; }

    const totalMin = Math.round(toCreate.reduce((s,p)=>s+p.duracao,0)/60);
    if (!confirm(`Criar ${toCreate.length} reprise(s) totalizando ${Math.floor(totalMin/60)}h${totalMin%60}min?\nIsso preencherá os gaps do dia até completar 24h.`)) return;

    try {
      await Promise.allSettled(toCreate.map(p => {
        const { id:_id, ...data } = p;
        return addDoc(collection(db,"programs"), { ...data, data:selDate });
      }));
      notify(`✅ ${toCreate.length} reprise(s) criadas!`, "success");
    } catch(e) { notify("❌ Erro ao criar reprises","error"); }
  };

  // ── Embaralhar grade do dia ──────────────────────────────────
  const handleShuffleDay = async () => {
    const progs = dayProgs.filter(p => p.canalId === selCh);
    if (progs.length < 2) { notify("Adicione ao menos 2 programas para embaralhar","error"); return; }
    if (!confirm(`Embaralhar ${progs.length} programas de ${getDayLabel(selDate)}?\nOs horários serão recalculados.`)) return;
    // Fisher-Yates
    const arr = [...progs];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    let cur = 0;
    const updated = arr.map(p => {
      const np = { ...p, horarioInicio: cur, horarioFim: cur + p.duracao };
      cur += p.duracao;
      return np;
    });
    await handleReorder(updated);
    notify("🔀 Grade embaralhada!", "success");
  };

  // ── Excluir selecionados ──────────────────────────────────────
  const handleDeleteSelected = async () => {
    if (selectedProgs.size === 0) return;
    if (!confirm(`Excluir ${selectedProgs.size} programa(s) selecionado(s)?\nEsta ação não pode ser desfeita.`)) return;
    const ids = [...selectedProgs];
    try {
      const results = await Promise.allSettled(ids.map(id => deleteDoc(doc(db,"programs",id))));
      const failed = results.filter(r => r.status === "rejected").length;
      setSelectedProgs(new Set());
      notify(failed === 0
        ? `🗑️ ${ids.length} programa(s) excluído(s)!`
        : `⚠️ ${ids.length - failed} excluídos, ${failed} falharam`, failed > 0 ? "error" : "success");
    } catch(err) { notify("❌ Erro ao excluir","error"); }
  };

  const handleReorder = async (updated) => {
    // Atualiza estado local imediatamente (UX responsiva)
    setProgs([...programs.filter(p => !(p.canalId===selCh && p.data===selDate)), ...updated]);
    try {
      // Persiste novos horários no Firestore
      await Promise.all(updated.map(p => {
        const { id, ...data } = p;
        return updateDoc(doc(db, "programs", id), {
          horarioInicio: data.horarioInicio,
          horarioFim:    data.horarioFim,
        });
      }));
      notify("🔄 Ordem salva!", "success");
    } catch(err) { console.error("Erro ao reordenar:", err); notify("❌ Erro ao salvar ordem", "error"); }
  };

  const addChannel = async () => {
    try {
      const maxNum = channels.length > 0 ? Math.max(...channels.map(c => c.numero||0)) : 0;
      const newCh = {
        numero:   maxNum + 1,
        nome:     `Canal ${maxNum + 1}`,
        logo:     "📺",
        logoType: "emoji",
        logoUrl:  null,
        cor:      COLOR_LIST[channels.length % COLOR_LIST.length] || "#2196F3",
        isInfo:   false,
        tipo:     "geral",
        streamUrl: null,
      };
      await addDoc(collection(db,"channels"), newCh);
      notify("📺 Canal adicionado!","success");
    } catch(err) { console.error(err); notify("❌ Erro ao adicionar canal: " + err.message,"error"); }
  };

  const delChannel = async (ch) => {
    if (!confirm(`Deletar canal "${ch.nome}"? Os programas agendados NÃO serão deletados.`)) return;
    try { await deleteDoc(doc(db,"channels",ch.id)); notify("🗑️ Canal deletado","info"); }
    catch(err) { console.error(err); notify("❌ Erro ao deletar canal","error"); }
  };

  // ============================================
  // CLONE QUICK (mesmo canal, mesma data)
  // ============================================
  const handleQuickClone = async () => {
    if (cloneMenuProgs.length === 0) return;
    try {
      const channelProgsOnDate = programs.filter(p=>p.canalId===selCh&&p.data===selDate).sort((a,b)=>Number(b.horarioFim)-Number(a.horarioFim));
      let startTime = channelProgsOnDate.length > 0 ? Number(channelProgsOnDate[0].horarioFim) : 0;
      for (const src of cloneMenuProgs) {
        const endTime = startTime + Number(src.duracao);
        await addDoc(collection(db,"programs"), {
          nome:src.nome, canalId:selCh, data:selDate,
          horarioInicio:startTime, horarioFim:endTime, duracao:src.duracao,
          youtubeId:src.youtubeId, videos:src.videos,
          sinopse:src.sinopse, classificacao:src.classificacao,
          tags:src.tags||[], thumbnailType:src.thumbnailType, thumbnailUrl:src.thumbnailUrl
        });
        startTime = endTime;
      }
      setCloneMenuProgs([]); setSelectedProgs(new Set());
      notify(`✅ ${cloneMenuProgs.length} programa(s) clonado(s)!`,"success");
    } catch(err) { console.error(err); notify("❌ Erro ao clonar","error"); }
  };

  // ============================================
  // CLONE ADVANCED (outro canal/data)
  // ============================================
  const handleAdvancedClone = async () => {
    if (!cloneData.channel) { setCloneError("Selecione um canal de destino"); return; }
    if (cloneMenuProgs.length === 0) return;
    try {
      setCloneError("");
      let startTime = Number(cloneData.time) || 0;
      const targetDate = cloneData.date || getToday();
      for (const src of cloneMenuProgs) {
        const endTime = startTime + Number(src.duracao);
        await addDoc(collection(db,"programs"), {
          nome:src.nome, canalId:cloneData.channel, data:targetDate,
          horarioInicio:startTime, horarioFim:endTime, duracao:src.duracao,
          youtubeId:src.youtubeId, videos:src.videos,
          sinopse:src.sinopse, classificacao:src.classificacao,
          tags:src.tags||[], thumbnailType:src.thumbnailType, thumbnailUrl:src.thumbnailUrl
        });
        startTime = endTime;
      }
      setShowCloneModal(false); setCloneMenuProgs([]); setSelectedProgs(new Set());
      setCloneData({channel:"",date:null,time:""});
      notify(`✅ ${cloneMenuProgs.length} programa(s) clonado(s)!`,"success");
    } catch(err) { console.error(err); notify("❌ Erro ao clonar","error"); }
  };

  const toggleProgSelect = (progId) => {
    const s = new Set(selectedProgs);
    s.has(progId) ? s.delete(progId) : s.add(progId);
    setSelectedProgs(s);
  };

  useEffect(() => { setSelectedProgs(new Set()); }, [selCh, selDate]);

  const dayProgs = programs.filter(p => p.data === selDate);
  const totalSch = dayProgs.filter(p=>p.canalId===selCh).reduce((s,p)=>s+(Number(p.duracao)||0),0);

  // Toast color
  const toastBg = toast.type === "success" ? "#4caf50" : toast.type === "error" ? "#f44336" : "#1a73e8";

  // ============================================
  // RENDER
  // ============================================
  return <div style={{width:"100%",minHeight:"100vh",background:"#0a0c12",fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",color:"#fff"}}>
    {/* Header */}
    <div style={{padding:"16px 24px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(255,255,255,0.02)",flexWrap:"wrap",gap:10}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:24}}>📺</span>
        <div><div style={{fontSize:18,fontWeight:700,color:"#fff"}}>TVWEB Admin</div><div style={{fontSize:11,color:"#888"}}>Painel de Programação</div></div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <a href="/" style={{padding:"8px 16px",borderRadius:6,textDecoration:"none",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#888",fontSize:12,fontWeight:600}}>🏠 Home</a>
        <a href="/tv" style={{padding:"8px 16px",borderRadius:6,textDecoration:"none",background:"rgba(76,175,80,0.1)",border:"1px solid rgba(76,175,80,0.25)",color:"#4caf50",fontSize:12,fontWeight:600}}>📺 Ver TV</a>
        <button onClick={()=>setShowImport(true)} style={{padding:"8px 16px",borderRadius:6,cursor:"pointer",background:"rgba(255,152,0,0.12)",border:"1px solid rgba(255,152,0,0.3)",color:"#ffb74d",fontSize:12,fontWeight:600}}>📥 Importar TXT</button>
        <button onClick={()=>setSD(true)} style={{padding:"8px 16px",borderRadius:6,cursor:"pointer",background:"rgba(156,39,176,0.15)",border:"1px solid rgba(156,39,176,0.3)",color:"#ce93d8",fontSize:12,fontWeight:600}}>📋 Duplicar dia</button>
        {onLogout&&<button onClick={onLogout} style={{padding:"8px 14px",borderRadius:6,cursor:"pointer",background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.2)",color:"#f44336",fontSize:12,fontWeight:600}}>🔓 Sair</button>}
      </div>
    </div>

    <div style={{maxWidth:900,margin:"0 auto",padding:20}}>
      {/* Tabs */}
      <div style={{display:"flex",gap:2,borderBottom:"2px solid #1e2030",marginBottom:20}}>
        {[{id:"schedule",label:"📅 Programação"},{id:"channels",label:"📺 Canais"}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 20px",fontSize:13,fontWeight:600,cursor:"pointer",background:tab===t.id?"#1a73e8":"transparent",color:tab===t.id?"#fff":"#888",border:"none",borderRadius:"6px 6px 0 0"}}>{t.label}</button>)}
      </div>

      {tab==="schedule"&&<>
        {/* Date picker */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:12,color:"#888",marginBottom:8,fontWeight:600}}>📅 DATA</div>
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8}}>
            {dates.map(d=>{const isT=d===getToday(),isS=d===selDate;
              return <button key={d} onClick={()=>setSelDate(d)} style={{minWidth:72,padding:"8px 10px",borderRadius:6,cursor:"pointer",textAlign:"center",background:isS?"#1a73e8":"rgba(255,255,255,0.04)",border:isS?"1px solid #1a73e8":isT?"1px solid #4fc3f7":"1px solid rgba(255,255,255,0.08)",color:isS?"#fff":"#ccc",fontSize:11,fontWeight:600,flexShrink:0}}>
                <div>{getDayLabel(d).split(" ")[0]}</div><div style={{fontSize:14,marginTop:2}}>{new Date(d+"T00:00:00").getDate()}</div>
                {isT&&<div style={{fontSize:8,color:isS?"#fff":"#4fc3f7",marginTop:2}}>HOJE</div>}
              </button>})}
          </div>
        </div>

        {/* Channel selector */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
          {channels.filter(c=>!c.isInfo).map(c=><button key={c.id} onClick={()=>setSelCh(c.id)} style={{padding:"8px 14px",borderRadius:6,cursor:"pointer",background:selCh===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:selCh===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:selCh===c.id?"#fff":"#aaa",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:6}}><ChLogo ch={c} size={20}/> {c.nome}</button>)}
        </div>

        {/* Stats */}
        <div style={{display:"flex",gap:16,padding:"12px 16px",marginBottom:16,background:"rgba(255,255,255,0.03)",borderRadius:8,fontSize:12,color:"#888",flexWrap:"wrap"}}>
          <span>📊 <strong style={{color:"#fff"}}>{dayProgs.filter(p=>p.canalId===selCh).length}</strong> programas</span>
          <span>⏱ <strong style={{color:"#fff"}}>{secTo(totalSch).h}h{secTo(totalSch).m>0?`${secTo(totalSch).m}min`:""}</strong> agendado</span>
          <span>📭 <strong style={{color:totalSch>=86400?"#4caf50":"#ff9800"}}>{secTo(86400-Math.min(totalSch,86400)).h}h{secTo(86400-Math.min(totalSch,86400)).m>0?`${secTo(86400-Math.min(totalSch,86400)).m}min`:""}</strong> livre</span>
        </div>

        {/* Barra de ações em lote */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:"#888"}}>
              <input type="checkbox"
                checked={dayProgs.filter(p=>p.canalId===selCh).length>0&&selectedProgs.size===dayProgs.filter(p=>p.canalId===selCh).length}
                onChange={e=>{
                  if(e.target.checked) setSelectedProgs(new Set(dayProgs.filter(p=>p.canalId===selCh).map(p=>p.id)));
                  else setSelectedProgs(new Set());
                }}
                style={{width:16,height:16,cursor:"pointer",accentColor:"#4caf50"}}/>
              Selecionar todos
            </label>
            <span style={{fontSize:11,color:"#555"}}>⠿ Arraste para reordenar</span>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={handleFill24h}
              style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,background:"rgba(76,175,80,0.1)",border:"1px solid rgba(76,175,80,0.25)",color:"#4caf50"}}>
              📅 Preencher 24h
            </button>
            <button onClick={handleShuffleDay}
              style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,background:"rgba(156,39,176,0.1)",border:"1px solid rgba(156,39,176,0.25)",color:"#ce93d8"}}>
              🔀 Embaralhar dia
            </button>
            {selectedProgs.size>0&&<button onClick={handleDeleteSelected}
              style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.25)",color:"#f44336"}}>
              🗑️ Excluir {selectedProgs.size}
            </button>}
          </div>
        </div>

        <TimelineView programs={dayProgs} channels={channels} selectedChannel={selCh}
          onEdit={p=>{setEP(p);setSM(true)}} onDelete={handleDel} onReorder={handleReorder}
          onToggleSelect={toggleProgSelect} selectedProgs={selectedProgs}/>

        <button onClick={()=>{setEP(null);setSM(true)}} style={{marginTop:16,width:"100%",padding:14,borderRadius:8,cursor:"pointer",background:"linear-gradient(135deg,#1a73e8,#4fc3f7)",border:"none",color:"#fff",fontSize:14,fontWeight:700}}>+ Adicionar Programa</button>
      </>}

      {tab==="channels"&&<ChannelEditor channels={channels} onAdd={addChannel} onDelete={delChannel}/>}
    </div>

    {/* FLOATING CLONE BUTTON */}
    {selectedProgs.size>0&&<button onClick={()=>setCloneMenuProgs(dayProgs.filter(p=>selectedProgs.has(p.id)))} style={{position:"fixed",bottom:40,right:40,width:180,padding:14,borderRadius:8,cursor:"pointer",background:"linear-gradient(135deg,#4caf50,#81c784)",border:"none",color:"#fff",fontSize:14,fontWeight:700,boxShadow:"0 4px 20px rgba(76,175,80,0.4)",zIndex:50}}>
      📋 Clonar {selectedProgs.size}
    </button>}

    {/* MODALS */}
    {showModal&&<ProgramModal mode={editProg?"edit":"add"} program={editProg} channels={channels}
      selectedChannel={selCh} selectedDate={selDate} existingPrograms={programs}
      onSave={handleSave} onClose={()=>{setSM(false);setEP(null)}}/>}

    {cloneMenuProgs.length>0&&!showCloneModal&&<div onClick={()=>setCloneMenuProgs([])} style={{position:"fixed",inset:0,zIndex:100}}>
      <div style={{position:"fixed",bottom:200,right:40,background:"#1a1c24",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,0.6)",zIndex:101,minWidth:200}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"8px 0"}}>
          <button onClick={()=>{handleQuickClone();setCloneMenuProgs([])}} style={{width:"100%",padding:"12px 16px",textAlign:"left",background:"transparent",border:"none",color:"#4caf50",cursor:"pointer",fontSize:13,fontWeight:600}} onMouseEnter={e=>e.target.style.background="rgba(76,175,80,0.1)"} onMouseLeave={e=>e.target.style.background="transparent"}>✓ Clonar aqui</button>
          <button onClick={()=>{setCloneData({channel:"",date:null,time:""});setCloneError("");setShowCloneModal(true)}} style={{width:"100%",padding:"12px 16px",textAlign:"left",background:"transparent",border:"none",color:"#4fc3f7",cursor:"pointer",fontSize:13,fontWeight:600}} onMouseEnter={e=>e.target.style.background="rgba(79,195,247,0.1)"} onMouseLeave={e=>e.target.style.background="transparent"}>→ Clonar em outro...</button>
        </div>
      </div>
    </div>}

    {showCloneModal&&cloneMenuProgs.length>0&&<div onClick={()=>setShowCloneModal(false)} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#1a1c24",borderRadius:8,maxWidth:600,width:"100%",border:"1px solid rgba(255,255,255,0.1)",padding:24,maxHeight:"80vh",overflowY:"auto"}}>
        <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:4}}>📋 Clonar em outro...</div>
        <div style={{fontSize:13,color:"#888",marginBottom:16}}>{cloneMenuProgs.length} programa(s) selecionado(s)</div>
        <div style={{marginBottom:16,padding:12,background:"rgba(76,175,80,0.08)",borderRadius:6,border:"1px solid rgba(76,175,80,0.2)"}}>
          <div style={{fontSize:11,color:"#4caf50",fontWeight:700,marginBottom:8}}>📺 PROGRAMAS A CLONAR:</div>
          {cloneMenuProgs.map((prog,i)=><div key={i} style={{fontSize:11,color:"#aaa",marginBottom:6}}>
            <div style={{fontWeight:600,color:"#fff"}}>{prog.nome}</div>
            <div style={{fontSize:10}}>📹 {prog.videos?.length||1} vídeo(s) · ⏱️ {fmtSec(Number(prog.duracao))}</div>
          </div>)}
        </div>
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:"#888",fontWeight:600,marginBottom:6,display:"block"}}>Canal</label>
          <select value={cloneData.channel||""} onChange={e=>setCloneData({...cloneData,channel:e.target.value})} style={{width:"100%",padding:"8px 12px",borderRadius:4,background:"#14161e",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",fontSize:13,cursor:"pointer"}}>
            <option value="">--- Selecione um canal ---</option>
            {channels.filter(c=>!c.isInfo).map(c=><option key={c.id} value={c.id}>{c.nome} ({c.numero})</option>)}
          </select>
        </div>
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:"#888",fontWeight:600,marginBottom:6,display:"block"}}>Data</label>
          <select value={cloneData.date||""} onChange={e=>setCloneData({...cloneData,date:e.target.value})} style={{width:"100%",padding:"8px 12px",borderRadius:4,background:"#14161e",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",fontSize:13,cursor:"pointer"}}>
            <option value="">Auto (após último programa)</option>
            {dates.map(d=><option key={d} value={d}>{getDayLabel(d)}</option>)}
          </select>
        </div>
        {cloneData.date&&<div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:"#888",fontWeight:600,marginBottom:6,display:"block"}}>Hora de início (opcional, em segundos)</label>
          <input type="number" value={cloneData.time} onChange={e=>setCloneData({...cloneData,time:e.target.value})} min="0" max="86399" style={{width:"100%",padding:"8px 12px",borderRadius:4,background:"#14161e",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",fontSize:13}} placeholder="0 = meia-noite"/>
        </div>}
        {cloneError&&<div style={{padding:10,background:"rgba(244,67,54,0.1)",borderRadius:6,border:"1px solid rgba(244,67,54,0.3)",fontSize:12,color:"#f44336",marginBottom:12}}>⚠️ {cloneError}</div>}
        <div style={{display:"flex",gap:10}}>
          <button onClick={handleAdvancedClone} style={{flex:1,padding:12,background:"linear-gradient(135deg,#4caf50,#81c784)",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>✓ Clonar com vídeos</button>
          <button onClick={()=>setShowCloneModal(false)} style={{flex:1,padding:12,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,color:"#ccc",cursor:"pointer",fontSize:13}}>Cancelar</button>
        </div>
      </div>
    </div>}

    {showDup&&<DupModal dates={dates} onDup={handleDup} onClose={()=>setSD(false)}/>}
    {showImport&&<ImportModal channels={channels} dates={dates} existingPrograms={programs} onClose={()=>setShowImport(false)} onImport={async(items)=>{
      let ok=0,err=0;
      for(const item of items){
        try{ const {id:_,...data}=item; await addDoc(collection(db,"programs"),data); ok++; }
        catch(e){ console.error(e); err++; }
      }
      setShowImport(false);
      notify(err===0?`✅ ${ok} programa(s) importado(s)!`:`✅ ${ok} importados, ❌ ${err} erros`,"success");
    }}/>}

    {toast.msg&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",padding:"12px 24px",borderRadius:8,background:toastBg,color:"#fff",fontSize:13,fontWeight:600,zIndex:200,animation:"fadeIn 0.3s ease",boxShadow:"0 4px 20px rgba(0,0,0,0.4)"}}>{toast.msg}</div>}

    <style>{`
      @keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
      *{box-sizing:border-box;margin:0;padding:0}
      select option{background:#14161e;color:#fff}
    `}</style>
  </div>;
}

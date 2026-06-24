import { useState, useEffect, useCallback, useRef } from "react";
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

// YouTube metadata extraction
function extractYouTubeId(url){
  if(!url)return null;
  const patterns=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,/^([a-zA-Z0-9_-]{11})$/];
  for(const p of patterns){const m=url.match(p);if(m)return m[1]}return null;
}
async function fetchYouTubeMetadata(videoId){
  if(!videoId)return null;
  try{
    const API_KEY="AIzaSyCt0t7IvYYPMXTfXB1zZ6AB4Na9JpL50EQ";
    const url=`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${API_KEY}&part=snippet,contentDetails`;
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
    return{duration:totalSeconds,description:snippet.description,title:snippet.title,thumbnail:snippet.thumbnails.default.url};
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
    {filtered.map((prog,i)=>{
      const ch=channels.find(c=>c.id===prog.canalId);
      const isMulti=prog.videos&&prog.videos.length>1;
      const thumb=prog.thumbnailType==="custom"&&prog.thumbnailUrl?prog.thumbnailUrl:ytThumb(prog.youtubeId||prog.videos?.[0]?.youtubeUrl);
      const isDragOver=overIdx===i&&dragIdx!==i;
      return <div key={prog.id} draggable onDragStart={e=>handleDragStart(e,i)} onDragOver={e=>handleDragOver(e,i)} onDrop={e=>handleDrop(e,i)} onDragEnd={()=>{setDragIdx(null);setOverIdx(null)}}
        style={{
          display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
          background:isDragOver?"rgba(26,115,232,0.15)":"rgba(255,255,255,0.03)",borderRadius:6,
          border:isDragOver?"2px dashed #1a73e8":"1px solid rgba(255,255,255,0.06)",
          cursor:"grab",transition:"all 0.15s",opacity:dragIdx===i?0.4:1,
        }}>
        {/* Checkbox - LEFT */}
        <input type="checkbox" checked={selectedProgs.has(prog.id)} onChange={()=>onToggleSelect(prog.id)} style={{width:18,height:18,cursor:"pointer",accentColor:"#4caf50",flexShrink:0}}/>
        {/* Drag handle */}
        <div style={{fontSize:16,color:"#555",cursor:"grab",padding:"0 4px"}}>⠿</div>
        {/* Thumb */}
        {thumb?<img src={thumb} alt="" style={{width:64,height:40,borderRadius:4,objectFit:"cover",flexShrink:0}}/>:
          <div style={{width:64,height:40,borderRadius:4,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:18,opacity:0.3}}>🎬</span></div>}
        {/* Time */}
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
  const [thumbnailType,setTT]=useState(program?.thumbnailType||"youtube");
  const [thumbnailUrl,setTU]=useState(program?.thumbnailUrl||null);
  const [error,setError]=useState("");
  // Start time
  const [startMode,setSM]=useState(isEdit?"custom":"auto");
  const [startH,setSH]=useState(isEdit?Math.floor(program.horarioInicio/3600):0);
  const [startM,setStartM]=useState(isEdit?Math.floor((program.horarioInicio%3600)/60):0);

  const dur=durationPreset>0?durationPreset:parseDur(customH,customM);
  const channelProgs=existingPrograms.filter(p=>p.canalId===canalId&&p.data===selectedDate&&(!isEdit||p.id!==program?.id)).sort((a,b)=>a.horarioInicio-b.horarioInicio);

  const autoStart=(()=>{if(!channelProgs.length)return 0;return channelProgs[channelProgs.length-1].horarioFim})();
  const horIn=startMode==="custom"?startH*3600+startM*60:isEdit?program.horarioInicio:autoStart;
  const horFim=horIn+dur;
  const hasOverlap=channelProgs.some(p=>horIn<p.horarioFim&&horFim>p.horarioInicio);
  const yt=ytThumb(videos[0]?.youtubeUrl);
  const dispThumb=thumbnailType==="custom"&&thumbnailUrl?thumbnailUrl:yt;

  const save=()=>{
    if(!nome.trim()){setError("Digite o nome");return}
    if(dur<300){setError("Mínimo 5 min");return}
    if(horFim>86400){setError("Ultrapassa 24h");return}
    if(hasOverlap){setError("Conflito de horário!");return}
    if(!videos[0].youtubeUrl.trim()){setError("Adicione um vídeo");return}
    onSave({id:isEdit?program.id:`prog_${Date.now()}`,nome,canalId,classificacao,tags,sinopse,data:selectedDate,duracao:dur,horarioInicio:horIn,horarioFim:horFim,youtubeId:videos[0].youtubeUrl,videos:videos.filter(v=>v.youtubeUrl.trim()),thumbnailType,thumbnailUrl});
  };

  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,maxWidth:640,width:"100%",border:"1px solid rgba(255,255,255,0.1)",maxHeight:"92vh",overflowY:"auto"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:16,fontWeight:700,color:"#fff"}}>{isEdit?"✏️ Editar":"➕ Novo"} Programa</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:18}}>✕</button>
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
          <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Ex: Documentário" style={{...iS,width:"100%"}}/></div>

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

        {/* Videos */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <label style={{...lS,marginBottom:0}}>VÍDEOS</label><span style={{fontSize:10,color:"#555"}}>{videos.length} vídeo(s)</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {videos.map((v,i)=><div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:4,border:"1px solid rgba(255,255,255,0.06)"}}>
              <span style={{fontSize:11,color:"#555",fontWeight:700,minWidth:20}}>#{i+1}</span>
              {(()=>{const t=ytThumb(v.youtubeUrl);return t?<img src={t} alt="" style={{width:40,height:26,borderRadius:3,objectFit:"cover"}}/>:null})()}
              <input value={v.youtubeUrl} onChange={e=>{const nv=[...videos];nv[i]={...v,youtubeUrl:e.target.value};setVideos(nv)}} placeholder="YouTube URL ou ID" style={{...iS,flex:1}}/>
              <input value={v.titulo||""} onChange={e=>{const nv=[...videos];nv[i]={...v,titulo:e.target.value};setVideos(nv)}} placeholder="Título" style={{...iS,width:120}}/>
              <button onClick={async()=>{const vId=extractYouTubeId(v.youtubeUrl);if(!vId){setError("URL YouTube inválida");return}const meta=await fetchYouTubeMetadata(vId);if(meta){const nv=[...videos];nv[i]={...nv[i],youtubeUrl:v.youtubeUrl,titulo:meta.title};setVideos(nv);setCH(Math.floor(meta.duration/3600));setCM(Math.floor((meta.duration%3600)/60));setSinopse(meta.description);setError("")}else setError("Erro ao buscar vídeo")}} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"6px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>🔍 Buscar</button>
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

        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:12,borderRadius:6,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:13,fontWeight:600}}>Cancelar</button>
          <button onClick={save} disabled={hasOverlap} style={{flex:2,padding:12,borderRadius:6,cursor:hasOverlap?"not-allowed":"pointer",background:hasOverlap?"#333":"#1a73e8",border:"none",color:"#fff",fontSize:13,fontWeight:700,opacity:hasOverlap?0.5:1}}>{isEdit?"💾 Salvar":"✅ Agendar"}</button>
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
  const [logo,setLogo]=useState("");
  const [logoType,setLT]=useState("emoji");
  const [logoUrl,setLU]=useState(null);
  const [cor,setCor]=useState("");
  const [saving,setSaving]=useState(false);

  const startEdit=(ch)=>{setEditing(ch.id);setNome(ch.nome);setLogo(ch.logo);setLT(ch.logoType||"emoji");setLU(ch.logoUrl||null);setCor(ch.cor)};
  const save=async()=>{
    setSaving(true);
    try {
      const updated = {nome,logo,logoType,logoUrl,cor};
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
        <div><label style={lS}>NOME</label><input value={nome} onChange={e=>setNome(e.target.value)} style={{...iS,width:"100%"}}/></div>
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
export default function AdminPanel(){
  const dates=genDates(30);
  const [tab,setTab]=useState("schedule");
  const [selDate,setSelDate]=useState(dates[0]);
  const [selCh,setSelCh]=useState(null);
  const [channels,setCh]=useState(DEFAULT_CHANNELS);
  const [programs,setProgs]=useState([]);
  const [showModal,setSM]=useState(false);
  const [editProg,setEP]=useState(null);
  const [showCloneModal,setShowCloneModal]=useState(false);
  const [cloneMenuProgs,setCloneMenuProgs]=useState([]);
  const [selectedProgs,setSelectedProgs]=useState(new Set());
  const [cloneData,setCloneData]=useState({channel:selCh,date:null,time:""});
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

      // Atualizar estado local
      if (editProg) setProgs(programs.map(x => x.id === p.id ? p : x));
      else setProgs([...programs, p]);

      // Persistir no Firestore
      if (editProg) {
        // Update existing
        await updateDoc(doc(db, "programs", p.id), p);
      } else {
        // Add new
        const ref = await addDoc(collection(db, "programs"), p);
        // Atualizar ID local com ID do Firebase
        setProgs(progs => progs.map(x => x === p ? { ...x, id: ref.id } : x));
      }

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
    if(!cloneData.channel||cloneMenuProgs.length===0)return;
    try {
      let startTime=Number(cloneData.time)||0;
      
      for(const sourceProgram of cloneMenuProgs){
        const endTime=startTime+Number(sourceProgram.duracao);
        const newProg={
          nome:sourceProgram.nome,
          canalId:cloneData.channel,
          data:cloneData.date||getToday(),
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
      setCloneData({channel:selCh,date:null,time:""});
      notify(`✅ ${cloneMenuProgs.length} programa(s) clonado(s)!`);
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

  // Task 4: Improved date filter - show only last hour + now + next programs

  const dayProgs=programs.filter(p=>{
    // Task 4: Filter - show last hour + now + next programs for selected date
    if(p.data!==selDate) return false;
    // If viewing today, apply smart filter
    if(selDate===getToday()){
      const now=getNow();
      const progStart=Number(p.horarioInicio);
      const progEnd=Number(p.horarioFim);
      const oneHourAgo=now-3600;
      // Keep only programs from last 1h until end of day
      return progEnd>oneHourAgo;
    }
    // For other dates, show all programs
    return true;
  });
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
          <span>📭 <strong style={{color:totalSch>=86400?"#4caf50":"#ff9800"}}>{secTo(86400-totalSch).h}h{secTo(86400-totalSch).m>0?`${secTo(86400-totalSch).m}min`:""}</strong> livre</span>
        </div>

        <div style={{marginBottom:8,fontSize:11,color:"#555",display:"flex",alignItems:"center",gap:6}}>⠿ Arraste para reordenar programas</div>

        <TimelineView programs={dayProgs} channels={channels} selectedChannel={selCh}
          onEdit={p=>{setEP(p);setSM(true)}} onDelete={handleDel} onReorder={handleReorder} onToggleSelect={toggleProgSelect} selectedProgs={selectedProgs}/>

        <button onClick={()=>{setEP(null);setSM(true)}} style={{marginTop:16,width:"100%",padding:14,borderRadius:8,cursor:"pointer",background:"linear-gradient(135deg,#1a73e8,#4fc3f7)",border:"none",color:"#fff",fontSize:14,fontWeight:700}}>+ Adicionar Programa</button>
      </>}

      {/* FLOATING CLONE BUTTON - RIGHT SIDE */}
      {selectedProgs.size>0&&<button onClick={()=>{const selected=dayProgs.filter(p=>selectedProgs.has(p.id));setCloneMenuProgs(selected)}} style={{position:"fixed",bottom:40,right:40,width:180,padding:14,borderRadius:8,cursor:"pointer",background:"linear-gradient(135deg,#4caf50,#81c784)",border:"none",color:"#fff",fontSize:14,fontWeight:700,boxShadow:"0 4px 20px rgba(76,175,80,0.4)",zIndex:50,transition:"all 0.3s"}}>📋 Clonar {selectedProgs.size}</button>}

      {tab==="channels"&&<>
        <button onClick={createSkyChannel} style={{marginBottom:16,padding:"10px 16px",borderRadius:6,cursor:"pointer",background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",fontSize:13,fontWeight:600}}>📡 Recriar Canal Sky</button>
        <ChannelEditor channels={channels} onUpdate={setCh} onAdd={addChannel} onDelete={delChannel}/>
      </>}
    </div>

    {showModal&&<ProgramModal mode={editProg?"edit":"add"} program={editProg} channels={channels} selectedChannel={selCh} selectedDate={selDate} existingPrograms={programs} onSave={handleSave} onClose={()=>{setSM(false);setEP(null)}}/>}

    {/* Clone menu - appears near clone button */}
    {cloneMenuProgs.length>0&&<div onClick={()=>setCloneMenuProgs([])} style={{position:"fixed",inset:0,zIndex:100}}>
      <div style={{position:"fixed",bottom:200,right:40,background:"#1a1c24",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,0.6)",zIndex:101,minWidth:200}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"8px 0"}}>
          <button onClick={()=>{handleQuickClone();setCloneMenuProgs([])}} style={{width:"100%",padding:"12px 16px",textAlign:"left",background:"transparent",border:"none",color:"#4caf50",cursor:"pointer",fontSize:13,fontWeight:600,borderBottom:"0.5px solid rgba(255,255,255,0.1)",transition:"background 0.2s"}} onMouseEnter={e=>e.target.style.background="rgba(76,175,80,0.1)"} onMouseLeave={e=>e.target.style.background="transparent"}>
            ✓ Clonar aqui
          </button>
          <button onClick={()=>{setCloneData({...cloneData,channel:selCh});setShowCloneModal(true);setCloneMenuProgs([])}} style={{width:"100%",padding:"12px 16px",textAlign:"left",background:"transparent",border:"none",color:"#4fc3f7",cursor:"pointer",fontSize:13,fontWeight:600,transition:"background 0.2s"}} onMouseEnter={e=>e.target.style.background="rgba(79,195,247,0.1)"} onMouseLeave={e=>e.target.style.background="transparent"}>
            → Clonar em outro...
          </button>
        </div>
      </div>
    </div>}

    {/* Clone in another channel/date modal */}
    {showCloneModal&&cloneMenuProgs.length>0&&<div onClick={()=>setShowCloneModal(false)} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#1a1c24",borderRadius:8,maxWidth:500,width:"100%",border:"1px solid rgba(255,255,255,0.1)",padding:24}}>
        <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:4}}>📋 Clonar em outro...</div>
        <div style={{fontSize:13,color:"#888",marginBottom:20}}>{cloneMenuProgs.length} programa(s) selecionado(s)</div>
        
        {/* Canal selector */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:"#888",fontWeight:600,marginBottom:6,display:"block"}}>Canal</label>
          <select value={cloneData.channel||selCh} onChange={e=>setCloneData({...cloneData,channel:e.target.value})} style={{width:"100%",padding:"8px 12px",borderRadius:4,background:"#14161e",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",fontSize:13,cursor:"pointer"}}>
            {channels.filter(c=>!c.isInfo).map(c=><option key={c.id} value={c.id}>{c.nome} ({c.numero})</option>)}
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
          <button onClick={()=>handleAdvancedClone()} style={{flex:1,padding:12,background:"linear-gradient(135deg,#4caf50,#81c784)",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>✓ Clonar</button>
          <button onClick={()=>setShowCloneModal(false)} style={{flex:1,padding:12,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,color:"#ccc",cursor:"pointer",fontSize:13,fontWeight:600}}>Cancelar</button>
        </div>
      </div>
    </div>}

    {showDup&&<DupModal dates={dates} onDup={handleDup} onClose={()=>setSD(false)}/>}

    {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",padding:"12px 24px",borderRadius:8,background:"#1a73e8",color:"#fff",fontSize:13,fontWeight:600,zIndex:200,animation:"fadeIn 0.3s ease",boxShadow:"0 4px 20px rgba(0,0,0,0.4)"}}>{toast}</div>}

    <style>{`
      @keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
      *{box-sizing:border-box;margin:0;padding:0}
      select option{background:#14161e;color:#fff}
    `}</style>
  </div>;
}

import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase";
import { 
  collection, 
  onSnapshot, 
  doc, 
  addDoc, 
  setDoc, 
  deleteDoc, 
  writeBatch 
} from "firebase/firestore";

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
function secTo(s){return{h:Math.floor(s/3600),m:Math.floor((s%3600)/60)}}
function parseDur(h,m){return(parseInt(h)||0)*3600+(parseInt(m)||0)*60}
function getDayLabel(d){const x=new Date(d + "T00:00:00");const ds=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];return`${ds[x.getDay()]} ${x.getDate()}/${x.getMonth()+1}`}
function genDates(n){const ds=[];const now=new Date();for(let i=0;i<n;i++){const d=new Date(now);d.setDate(now.getDate()+i);ds.push(d.toISOString().split("T")[0])}return ds}
function extractYTId(s){if(!s)return null;const p=[/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/];for(const r of p){const m=s.match(r);if(m)return m[1]}return null}
function ytThumb(id){const x=extractYTId(id);return x?`https://img.youtube.com/vi/${x}/mqdefault.jpg`:null}

const iS = {background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:4,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"};
const lS = {fontSize:11,color:"#888",fontWeight:600,marginBottom:4,display:"block",letterSpacing:0.5};

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
// TIMELINE WITH DRAG & DROP
// ============================================
function TimelineView({programs,channels,selectedChannel,selectedDate,onEdit,onDelete,onReorder}){
  const filtered=programs.filter(p=>p.canalId===selectedChannel && p.data===selectedDate).sort((a,b)=>a.horarioInicio-b.horarioInicio);
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
      const updated=items.map(p=>{ 
        const np={...p,horarioInicio:cur,horarioFim:cur+p.duracao}; 
        cur+=p.duracao; 
        return np; 
      });
      onReorder(updated);
    }
    setDragIdx(null);setOverIdx(null);
  };

  if(!filtered.length) return <div style={{padding:40,textAlign:"center",color:"#555",fontSize:14}}><div style={{fontSize:40,marginBottom:12}}>📭</div>Nenhum programa agendado para este dia.</div>;

  const gaps=[];
  if(filtered[0].horarioInicio>0) gaps.push({start:0,end:filtered[0].horarioInicio});
  for(let i=0;i<filtered.length-1;i++) if(filtered[i].horarioFim<filtered[i+1].horarioInicio) gaps.push({start:filtered[i].horarioFim,end:filtered[i+1].horarioInicio});
  if(filtered[filtered.length-1].horarioFim<86400) gaps.push({start:filtered[filtered.length-1].horarioFim,end:86400});

  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {filtered.map((prog,i)=>{
      const ch=channels.find(c=>c.id===prog.canalId);
      const isMulti=prog.videos&&prog.videos.length>1;
      const thumb=prog.thumbnailType==="custom"&&prog.thumbnailUrl?prog.thumbnailUrl:ytThumb(prog.youtubeId||prog.videos?.[0]?.youtubeUrl);
      const isDragOver=overIdx===i&&dragIdx!==i;
      return <div key={prog.id} draggable onDragStart={e=>handleDragStart(e,i)} onDragOver={e=>handleDragOver(e,i)} onDrop={e=>handleDrop(e,i)} onDragEnd={()=>{setDragIdx(null);setOverIdx(null)}}
        style={{
          display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
          background:isDragOver?"#1a73e824":"rgba(255,255,255,0.03)",borderRadius:6,
          border:isDragOver?"2px dashed #1a73e8":"1px solid rgba(255,255,255,0.06)",
          cursor:"grab",transition:"all 0.15s",opacity:dragIdx===i?0.4:1,
        }}>
        <div style={{fontSize:16,color:"#555",cursor:"grab",padding:"0 4px"}}>⠿</div>
        {thumb?<img src={thumb} alt="" style={{width:64,height:40,borderRadius:4,objectFit:"cover",flexShrink:0}}/>:
          <div style={{width:64,height:40,borderRadius:4,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:18,opacity:0.3}}>🎬</span></div>}
        <div style={{minWidth:85,textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{fmtSec(prog.horarioInicio)}</div>
          <div style={{fontSize:10,color:"#555"}}>até {fmtSec(prog.horarioFim)}</div>
        </div>
        <div style={{width:3,height:40,borderRadius:2,background:ch?.cor||"#555"}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
            <span style={{fontSize:14,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{prog.nome}</span>
            <span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:CC[prog.classificacao]||"#555",color:prog.classificacao==="L"?"#fff":"#000",fontWeight:700}}>{prog.classificacao}</span>
            {isMulti&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"#9c27b0",color:"#fff",fontWeight:700}}>{prog.videos.length}v</span>}
            {prog.tags?.map(t=><span key={t} style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:"rgba(255,255,255,0.08)",color:"#aaa",fontWeight:600}}>{t}</span>)}
          </div>
          <div style={{fontSize:11,color:"#888"}}>{secTo(prog.duracao).h>0?`${secTo(prog.duracao).h}h`:""}{ secTo(prog.duracao).m>0?`${secTo(prog.duracao).m}min`:""}</div>
        </div>
        <button onClick={()=>onEdit(prog)} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>✏️</button>
        <button onClick={()=>onDelete(prog.id)} style={{background:"rgba(244,67,54,0.1)",border:"1px solid rgba(244,67,54,0.3)",color:"#f44336",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>🗑️</button>
      </div>;
    })}

    {gaps.length>0&&<div style={{marginTop:8}}>
      <div style={{fontSize:11,color:"#ff9800",fontWeight:600,marginBottom:6}}>⚠️ Intervalos vazios:</div>
      {gaps.map((g,i)=><div key={i} style={{padding:"8px 12px",marginBottom:4,background:"rgba(255,152,0,0.06)",borderRadius:4,border:"1px solid rgba(255,152,0,0.15)",fontSize:12,color:"#ff9800",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>{fmtSec(g.start)} → {fmtSec(g.end)} ({secTo(g.end-g.start).h>0?`${secTo(g.end-g.start).h}h`:""}{ secTo(g.end-g.start).m>0?`${secTo(g.end-g.start).m}min`:""})</span>
        <span style={{fontSize:10,color:"#888"}}>Preenchimento Automático ativo na TV</span>
      </div>)}
    </div>}
  </div>;
}

// ============================================
// PROGRAM MODAL (ADD / EDIT)
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

  const handleVideoChange=(idx,field,val)=>{
    const n=[...videos];
    n[idx][field]=val;
    setVideos(n);
  };

  const save=()=>{
    if(!nome.trim()){setError("Digite o nome");return}
    if(dur<300){setError("Mínimo 5 min");return}
    if(horFim>86400){setError("Ultrapassa 24h");return}
    if(hasOverlap){setError("Conflito de horário!");return}
    if(!videos[0].youtubeUrl.trim()){setError("Adicione um vídeo válido");return}
    
    onSave({
      id:isEdit?program.id:`prog_${Date.now()}`,
      nome,
      canalId,
      classificacao,
      tags,
      sinopse,
      data:selectedDate,
      duracao:dur,
      horarioInicio:horIn,
      horarioFim:horFim,
      youtubeId:extractYTId(videos[0].youtubeUrl) || videos[0].youtubeUrl,
      videos:videos.filter(v=>v.youtubeUrl.trim()).map(v=>({
        ...v,
        youtubeUrl: extractYTId(v.youtubeUrl) || v.youtubeUrl
      })),
      thumbnailType,
      thumbnailUrl: thumbnailType === "custom" ? thumbnailUrl : null
    });
  };

  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,maxWidth:640,width:"100%",border:"1px solid rgba(255,255,255,0.1)",maxHeight:"92vh",overflowY:"auto"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:16,fontWeight:700,color:"#fff"}}>{isEdit?"✏️ Editar":"➕ Novo"} Programa</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
        
        <div><label style={lS}>CANAL</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {channels.map(c=><button key={c.id} onClick={()=>setCanalId(c.id)} style={{padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:12,background:canalId===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:canalId===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:canalId===c.id?"#fff":"#888",display:"flex",alignItems:"center",gap:4}}><ChLogo ch={c} size={16}/> {c.nome}</button>)}
          </div>
        </div>

        <div><label style={lS}>NOME DO PROGRAMA</label>
          <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Ex: Sessão de Cinema" style={{...iS,width:"100%"}}/></div>

        <div><label style={lS}>HORÁRIO DE INÍCIO</label>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <button onClick={()=>setSM("auto")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:startMode==="auto"?"#1a73e822":"rgba(255,255,255,0.04)",border:startMode==="auto"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:startMode==="auto"?"#4fc3f7":"#888"}}>⏩ Automático ({fmtSec(autoStart)})</button>
            <button onClick={()=>setSM("custom")} style={{padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:12,background:startMode==="custom"?"#1a73e822":"rgba(255,255,255,0.04)",border:startMode==="custom"?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.08)",color:startMode==="custom"?"#4fc3f7":"#888"}}>⚙️ Customizado</button>
          </div>
          {startMode==="custom"&&<div style={{display:"flex",alignItems:"center",gap:4}}><input type="number" min={0} max={23} value={startH} onChange={e=>setSH(parseInt(e.target.value)||0)} style={{...iS,width:60,textAlign:"center"}}/> : <input type="number" min={0} max={59} value={startM} onChange={e=>setStartM(parseInt(e.target.value)||0)} style={{...iS,width:60,textAlign:"center"}}/></div>}
        </div>

        <div><label style={lS}>DURAÇÃO</label>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
            {DURATION_PRESETS.map(p=><button key={p.label} onClick={()=>{setDP(p.value);if(p.value>0){setCH(0);setCM(0)}}} style={{padding:"6px 10px",borderRadius:4,cursor:"pointer",fontSize:11,background:durationPreset===p.value?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",color:"#fff"}}>{p.label}</button>)}
          </div>
          {durationPreset===0&&<div style={{display:"flex",alignItems:"center",gap:6}}><input type="number" min={0} value={customH} onChange={e=>setCH(parseInt(e.target.value)||0)} style={{...iS,width:65}}/><span style={{fontSize:12,color:"#666"}}>h</span><input type="number" min={0} max={59} value={customM} onChange={e=>setCM(parseInt(e.target.value)||0)} style={{...iS,width:65}}/><span style={{fontSize:12,color:"#666"}}>min</span></div>}
        </div>

        <div><label style={lS}>VÍDEO PRINCIPAL (LINK OU ID DO YOUTUBE)</label>
          <input value={videos[0].youtubeUrl} onChange={e=>handleVideoChange(0,"youtubeUrl",e.target.value)} placeholder="https://www.youtube.com/watch?v=..." style={{...iS,width:"100%"}}/>
        </div>

        <div><label style={lS}>CLASSIFICAÇÃO ETÁRIA</label>
          <div style={{display:"flex",gap:6}}>
            {CLASSIF_OPTIONS.map(o=><button key={o} onClick={()=>setClassificacao(o)} style={{width:32,height:32,borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:700,background:classificacao===o?CC[o]:"rgba(255,255,255,0.04)",border:"none",color:classificacao===o?(o==="L"?"#fff":"#000"):"#aaa"}}>{o}</button>)}
          </div>
        </div>

        <ImgUploader label="Capa do Programa" currentImage={dispThumb} imageType={thumbnailType} onImageChange={(img)=>{setTT(img.type); setTU(img.url)}} shape="landscape" />

        <div><label style={lS}>SINOPSE</label>
          <textarea value={sinopse} onChange={e=>setSinopse(e.target.value)} placeholder="Descrição curta do programa..." style={{...iS,width:"100%",height:60,resize:"none"}}/>
        </div>

        <div style={{padding:"10px 14px",borderRadius:6,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",fontSize:12}}>
          <div>⏱️ Horário final previsto: <b style={{color:"#fff"}}>{fmtSec(horFim)}</b></div>
        </div>

        {error&&<div style={{color:"#f44336",fontSize:12,fontWeight:600}}>❌ {error}</div>}

        <div style={{display:"flex",gap:8,marginTop:10}}>
          <button onClick={save} style={{flex:1,padding:12,borderRadius:6,cursor:"pointer",border:"none",fontWeight:700,fontSize:13,background:"#1a73e8",color:"#fff"}}>Salvar Programa</button>
          <button onClick={onClose} style={{padding:12,borderRadius:6,cursor:"pointer",border:"1px solid rgba(255,255,255,0.1)",background:"none",color:"#aaa",fontSize:13}}>Cancelar</button>
        </div>
      </div>
    </div>
  </div>;
}

// ============================================
// CHANNEL EDITOR TAB
// ============================================
function ChannelEditor({channels, onUpdate, onAdd}){
  const [nome,setNome]=useState("");
  const [numero,setNumero]=useState("");
  const [cor,setCor]=useState(COLOR_LIST[0]);
  const [logo,setLogo]=useState(EMOJI_LIST[0]);
  const [logoType,setLT]=useState("emoji");
  const [logoUrl,setLU]=useState(null);

  const add=()=>{
    if(!nome.trim() || !numero) return;
    onAdd({
      nome,
      numero: parseInt(numero),
      cor,
      logo,
      logoType,
      logoUrl,
      ativo: true
    });
    setNome(""); setNumero("");
  };

  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",padding:16,borderRadius:8,display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{fontSize:14,color:"#fff",fontWeight:600}}>📺 Adicionar Novo Canal</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 80px",gap:10}}>
        <div><label style={lS}>NOME</label><input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Ex: HBO Max" style={{...iS,width:"100%"}}/></div>
        <div><label style={lS}>NÚMERO</label><input type="number" value={numero} onChange={e=>setNumero(e.target.value)} placeholder="6" style={{...iS,width:"100%"}}/></div>
      </div>
      <div><label style={lS}>COR DO CANAL</label>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {COLOR_LIST.map(c=><div key={c} onClick={()=>setCor(c)} style={{width:24,height:24,borderRadius:4,background:c,cursor:"pointer",border:cor===c?"2px solid #fff":"2px solid transparent"}}/>)}
        </div>
      </div>
      <div><label style={lS}>EMOJI DO LOGO</label>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",maxHeight:70,overflowY:"auto",padding:4,background:"rgba(0,0,0,0.2)",borderRadius:4}}>
          {EMOJI_LIST.map(e=><span key={e} onClick={()=>{setLT("emoji");setLogo(e)}} style={{fontSize:18,cursor:"pointer",padding:4,background:logo===e&&logoType==="emoji"?"rgba(255,255,255,0.1)":"none",borderRadius:4}}>{e}</span>)}
        </div>
      </div>
      <ImgUploader label="Ou use um Logo Customizado" currentImage={logoUrl} imageType={logoType} onImageChange={(img)=>{setLT(img.type); setLU(img.url)}} shape="square"/>
      <button onClick={add} style={{padding:10,background:"#4fc3f7",border:"none",borderRadius:6,color:"#000",fontWeight:700,cursor:"pointer",fontSize:13,marginTop:6}}>Criar Canal</button>
    </div>

    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <label style={lS}>CANAIS EXISTENTES</label>
      {channels.map(c=><div key={c.id} style={{display:"flex",alignItems:"center",gap:12,padding:12,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:6}}>
        <div style={{width:36,height:36,borderRadius:4,background:c.cor,display:"flex",alignItems:"center",justifyContent:"center"}}><ChLogo ch={c} size={20}/></div>
        <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{c.nome}</div><div style={{fontSize:11,color:"#555"}}>Canal {c.numero}</div></div>
      </div>)}
    </div>
  </div>;
}

// ============================================
// DUP MODAL
// ============================================
function DupModal({dates,onDup,onClose}){
  const [target,setTarget]=useState(dates[1]);
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#14161e",borderRadius:12,maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)",padding:20}}>
      <h3 style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:12}}>Copiar Programação</h3>
      <label style={lS}>COPIAR ESTE DIA PARA:</label>
      <select value={target} onChange={e=>setTarget(e.target.value)} style={{...iS,width:"100%",background:"#222",marginBottom:20}}>
        {dates.slice(1).map(d=><option key={d} value={d}>{getDayLabel(d)}</option>)}
      </select>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>onDup(target)} style={{flex:1,padding:10,background:"#1a73e8",border:"none",color:"#fff",borderRadius:6,fontWeight:600,cursor:"pointer"}}>Confirmar</button>
        <button onClick={onClose} style={{padding:10,background:"none",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",borderRadius:6,cursor:"pointer"}}>Sair</button>
      </div>
    </div>
  </div>;
}

// ============================================
// MAIN ADMIN PANEL COMPONENT
// ============================================
export default function AdminPanel(){
  const dates = genDates(14);
  const [selDate,setSelDate]=useState(dates[0]);
  const [selCh,setSelCh]=useState(null);
  
  const [channels,setChannels]=useState([]);
  const [programs,setPrograms]=useState([]);
  
  const [tab,setTab]=useState("programs");
  const [showModal,setSM]=useState(false);
  const [editProg,setEP]=useState(null);
  const [showDup,setSD]=useState(false);
  const [toast,setToast]=useState("");

  const showToast=(m)=>{setToast(m);setTimeout(()=>setToast(""),3000)};

  // 1. Carregar Canais do Firestore em Tempo Real
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "channels"), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = list.sort((a, b) => a.numero - b.numero);
      setChannels(sorted);
      if (sorted.length > 0 && !selCh) {
        setSelCh(sorted[0].id);
      }
    });
    return () => unsub();
  }, [selCh]);

  // 2. Carregar Programas do Firestore em Tempo Real
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "programs"), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPrograms(list);
    });
    return () => unsub();
  }, []);

  // 3. Adicionar/Editar Programa no Firestore
  const handleSave = async (progData) => {
    try {
      if (editProg) {
        await setDoc(doc(db, "programs", progData.id), progData);
        showToast("✓ Programa atualizado com sucesso!");
      } else {
        await addDoc(collection(db, "programs"), progData);
        showToast("✓ Programa adicionado com sucesso!");
      }
      setSM(false);
      setEP(null);
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar programa.");
    }
  };

  // 4. Deletar Programa no Firestore
  const handleDelete = async (id) => {
    if(window.confirm("Remover este programa do guia?")){
      try {
        await deleteDoc(doc(db, "programs", id));
        showToast("✓ Programa removido.");
      } catch (err) {
        console.error(err);
      }
    }
  };

  // 5. Reordenar via Drag & Drop e atualizar em Lote (Batch)
  const handleReorder = async (updatedList) => {
    try {
      const batch = writeBatch(db);
      updatedList.forEach(prog => {
        const ref = doc(db, "programs", prog.id);
        batch.set(ref, prog);
      });
      await batch.commit();
      showToast("↕ Ordem redefinida!");
    } catch (err) {
      console.error(err);
    }
  };

  // 6. Criar Novo Canal no Firestore
  const handleAddChannel = async (chData) => {
    try {
      await addDoc(collection(db, "channels"), chData);
      showToast("✓ Canal criado com sucesso!");
    } catch (err) {
      console.error(err);
    }
  };

  // 7. Replicar programação do dia selecionado para outra data
  const handleDup = async (targetDate) => {
    const active = programs.filter(p => p.canalId === selCh && p.data === selDate);
    if (!active.length) { alert("Nada para copiar neste dia."); return; }
    
    if (window.confirm(`Substituir a grade de ${getDayLabel(targetDate)} pela grade atual?`)) {
      try {
        const batch = writeBatch(db);
        
        // Limpar programas existentes no destino
        const targets = programs.filter(p => p.canalId === selCh && p.data === targetDate);
        targets.forEach(p => {
          batch.delete(doc(db, "programs", p.id));
        });

        // Inserir os novos clonados
        active.forEach(p => {
          const newRef = doc(collection(db, "programs"));
          const { id, ...cleanData } = p;
          batch.set(newRef, { ...cleanData, data: targetDate });
        });

        await batch.commit();
        setSD(false);
        showToast(`📋 Grade clonada para ${getDayLabel(targetDate)}!`);
      } catch (err) {
        console.error(err);
      }
    }
  };

  return (
    <div style={{background:"#0a0b10",minHeight:"100vh",color:"#aaa",fontFamily:"system-ui,sans-serif",padding:16}}>
      <div style={{maxWidth:1024,margin:"0 auto"}}>
        
        {/* TOP BAR */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,background:"rgba(255,255,255,0.02)",padding:16,borderRadius:10,border:"1px solid rgba(255,255,255,0.05)"}}>
          <div>
            <h1 style={{fontSize:18,fontWeight:700,color:"#fff",margin:0,display:"flex",alignItems:"center",gap:8}}>⚙️ PAINEL TVWEB <span style={{fontSize:11,background:"#1a73e8",color:"#fff",padding:"2px 6px",borderRadius:4}}>LIVE</span></h1>
            <p style={{fontSize:11,color:"#555",marginTop:2}}>Gerenciamento em Tempo Real via Firestore</p>
          </div>
          <div style={{display:"flex",background:"rgba(0,0,0,0.2)",padding:4,borderRadius:6,gap:2}}>
            <button onClick={()=>setTab("programs")} style={{padding:"6px 12px",borderRadius:4,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:tab==="programs"?"#1a73e8":"none",color:tab==="programs"?"#fff":"#888"}}>🗓️ Programação</button>
            <button onClick={()=>setTab("channels")} style={{padding:"6px 12px",borderRadius:4,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:tab==="channels"?"#1a73e8":"none",color:tab==="channels"?"#fff":"#888"}}>📺 Canais</button>
          </div>
        </div>

        {tab==="programs" && <>
          {/* HORIZONTAL CALENDAR */}
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:10,marginBottom:20,scrollbarWidth:"none"}}>
            {dates.map(d=><button key={d} onClick={()=>setSelDate(d)} style={{padding:"10px 14px",borderRadius:8,border:selDate===d?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.05)",background:selDate===d?"#1a73e81a":"rgba(255,255,255,0.02)",cursor:"pointer",textAlign:"center",minWidth:90,flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:700,color:selDate===d?"#4fc3f7":"#fff"}}>{getDayLabel(d).split(" ")[1]}</div>
              <div style={{fontSize:10,color:selDate===d?"#1a73e8":"#555",fontWeight:600,marginTop:2}}>{getDayLabel(d).split(" ")[0].toUpperCase()}</div>
            </button>)}
          </div>

          {/* CHANNELS GRID HEADER */}
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:10,marginBottom:16}}>
            {channels.map(c=><button key={c.id} onClick={()=>setSelCh(c.id)} style={{padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,background:selCh===c.id?`${c.cor}22`:"rgba(255,255,255,0.02)",border:selCh===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.05)",color:selCh===c.id?"#fff":"#777",display:"flex",alignItems:"center",gap:6,flexShrink:0}}><ChLogo ch={c} size={16}/> {c.nome}</button>)}
          </div>

          {/* TIMELINE ACTION BAR */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:11,fontWeight:700,letterSpacing:0.5}}>GRADE DE PROGRAMAÇÃO</span>
            <button onClick={()=>setSD(true)} style={{background:"none",border:"1px solid rgba(255,255,255,0.1)",padding:"4px 10px",borderRadius:4,color:"#aaa",fontSize:11,cursor:"pointer"}}>📋 Clonar Dia</button>
          </div>

          {/* TIMELINE VIEW */}
          <TimelineView 
            programs={programs} 
            channels={channels} 
            selectedChannel={selCh} 
            selectedDate={selDate}
            onEdit={(p)=>{setEP(p); setSM(true)}} 
            onDelete={handleDelete}
            onReorder={handleReorder}
          />

          <button onClick={()=>{setEP(null);setSM(true)}} style={{marginTop:16,width:"100%",padding:14,borderRadius:8,cursor:"pointer",background:"linear-gradient(135deg,#1a73e8,#4fc3f7)",border:"none",color:"#fff",fontSize:14,fontWeight:700}}>+ Adicionar Programa</button>
        </>}

        {tab==="channels" && <ChannelEditor channels={channels} onUpdate={setChannels} onAdd={handleAddChannel}/>}
      </div>

      {showModal && <ProgramModal mode={editProg?"edit":"add"} program={editProg} channels={channels} selectedChannel={selCh} selectedDate={selDate} existingPrograms={programs} onSave={handleSave} onClose={()=>{setSM(false);setEP(null)}}/>}
      {showDup && <DupModal dates={dates} onDup={handleDup} onClose={()=>setSD(false)}/>}
      {toast && <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",padding:"12px 24px",borderRadius:8,background:"#1a73e8",color:"#fff",fontSize:13,fontWeight:600,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,0.4)"}}>{toast}</div>}
    </div>
  );
}

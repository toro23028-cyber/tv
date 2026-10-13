import Icon from './Icons';
import {useSearchParams,useNavigate} from 'react-router-dom';
import {useCatalog} from './Catalog';
import {useFavorites,readPreference,writePreference,shareChannel} from './preferences';
import YoutubePlayer from './YoutubePlayer';
import NewsOverlay from './NewsOverlay';
import {fetchActiveChannelLive} from './youtube-live-client.js';
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getNow, getToday, fmtHM, getAbsoluteNow, broadcastTime, broadcastDate } from './clock.js';
import { buildGuideSchedule, guideTime, buildSchedule, getCurProg, getElapsed, getVideoPlaybackInfo, thumbnailForProgram } from './schedule.js';
import { extractYouTubeId as extractYTId } from './youtube-id.js';
export { getTodayPrograms, getThumbnailForChannel } from './schedule.js';

// A grade e a posição de vídeo usam o relógio de Brasília e a mesma projeção
// compartilhada com Home/Admin. Vinhetas retomam a mídia no horário absoluto.
const CC={L:"#0f0","10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#000"};
function fD(s){const h=Math.floor(Number(s)/3600),m=Math.floor(Number(s)%3600/60);return `${h?h+'h ':''}${m}min`;}
function ChLogo({ch, size=28}) {
  if (ch.logoType==="custom" && ch.logoUrl) return <img src={ch.logoUrl} alt="" style={{width:size,height:size,borderRadius:4,objectFit:"cover"}} />;
  return <span className="channel-logo-fallback" style={{width:size,height:size,fontSize:size*0.34}} aria-hidden="true">{ch.logo || "TV"}</span>;
}

// ============================================
// SMALL COMPONENTS
// ============================================
function LiveDot({big}){ const[v,setV]=useState(true); useEffect(()=>{const i=setInterval(()=>setV(x=>!x),800);return()=>clearInterval(i)},[]); return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:big?14:11,fontWeight:800,color:"#ff3b3b",opacity:v?1:0.3,transition:"opacity 0.3s"}}><span style={{width:big?10:8,height:big?10:8,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 8px #ff3b3b"}}/>AO VIVO</span> }

function Badge({c,big}){ return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:big?30:22,height:big?30:22,borderRadius:4,background:CC[c]||"#888",color:c==="L"||c==="18"?"#fff":"#000",fontSize:big?13:10,fontWeight:800}}>{c}</span> }
function Tag({t}){ const c={HD:"#1a73e8","4K":"#e91e63",DUB:"#4caf50",LEG:"#ff9800","5.1":"#9c27b0"}; return <span style={{fontSize:10,fontWeight:700,padding:"3px 7px",borderRadius:3,background:c[t]||"#555",color:"#fff"}}>{t}</span> }

async function shareProgram(prog,ch){const message=await shareChannel(ch,prog);if(message)alert(message);}

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

  return <div className="tv-gc" style={{
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
  return <div className="osd-header" style={{
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
          {broadcastTime(t)}
        </div>
        <div style={{fontSize:14,color:"#aaa",marginTop:4}}>
          {broadcastDate(t,{weekday:"short",day:"numeric",month:"numeric"})}
        </div>
        <div style={{fontSize:16,fontWeight:800,color:"rgba(255,255,255,0.5)",letterSpacing:3,marginTop:8}}>TREND TV</div>
      </div>
    </div>
  </div>;
}

// ============================================
// OSD FOOTER (TV-style bottom bar)
// ============================================
function OSDFooter({channel,muted,onMute,favorite,onFavorite,onShare,program,nextProgram,onOpenEPG,onOpenFull,onOpenSettings,onFullscreen,displayMode,onToggleDisplayMode,isLive,lowLatency,onToggleLowLatency,latencyStatus,visible}){
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
  const pct=Math.max(0,Math.min((el/Math.max(1,program.duracao))*100,100));
  const endText=program.fimRealTexto||program.horarioFimTexto;
  const spansDay=program.fimReal>86400;
  return <div className="osd-footer" style={{
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
      <div className="osd-actions" style={{display:"flex",gap:10}}>
        <button onClick={e=>{e.stopPropagation();window.location.href="/"}} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"#ccc",padding:"10px 16px",borderRadius:6,cursor:"pointer",fontSize:14}} title="Ir para Home" aria-label="Início"><Icon name="home"/></button>
        <button onClick={e=>{e.stopPropagation();onMute()}} aria-label={muted?'Ativar som':'Silenciar'} title="Som (M)"><Icon name={muted?"muted":"volume"}/></button>
        <button onClick={e=>{e.stopPropagation();onFavorite()}} aria-pressed={favorite} aria-label={favorite?'Remover favorito':'Favoritar canal'} title="Favorito"><Icon name="star" filled={favorite}/></button>
        <button onClick={e=>{e.stopPropagation();onShare()}} title="Compartilhar canal" aria-label="Compartilhar canal"><Icon name="share"/></button>
        <button onClick={e=>{e.stopPropagation();onToggleDisplayMode()}} aria-label={displayMode==="studio"?"Mudar para player normal":"Mudar para modo estúdio"} title="Alternar entre Estúdio e Player ampliado">{displayMode==="studio"?"▣ Estúdio":"▣ Player normal"}</button>
        {isLive&&<button onClick={e=>{e.stopPropagation();onToggleLowLatency()}} aria-pressed={lowLatency} title={latencyStatus==="unsupported"?"Esta live não oferece reprodução em 2×; ela continuará no modo normal.":"Acelera somente esta live até chegar perto do ao vivo. Playlists não usam esta opção."}>{!lowLatency?"🚀 Reduzir atraso":latencyStatus==="catching_up"?"⏩ Recuperando · 2×":latencyStatus==="unsupported"?"⚠️ 2× indisponível":latencyStatus==="synced"?"✓ Ao vivo":latencyStatus==="requesting"?"⏳ Testando 2×":"⏳ Verificando 2×"}</button>}
        <button onClick={e=>{e.stopPropagation();onOpenEPG()}} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",padding:"10px 22px",borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:600}}>▲ Guia Rápido</button>
        <button onClick={e=>{e.stopPropagation();onOpenSettings()}} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"#ccc",padding:"10px 16px",borderRadius:6,cursor:"pointer",fontSize:14}} aria-label="Configurações"><Icon name="settings"/></button>
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
  const [search,setSearch]=useState('');
  const horizon=now+43200;
  const matches=search.trim()?channels.flatMap(channel=>buildGuideSchedule(allPrograms,channel.id,channel).filter(p=>p.horarioFim>now&&p.horarioInicio<horizon).filter(p=>!p.isPlaceholder&&p.nome.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))).map(p=>({...p,channelName:channel.nome}))):[];
  const scrollRef=useRef(null);
  const ROW_H=92, PX=400, timelineStart=Math.floor(now/3600)*3600;
  const totalW=PX*13;
  const secToPx=(sec)=>((Number(sec)-timelineStart)/3600)*PX;
  const nowPx=secToPx(now);
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
    el.scrollLeft=Math.max(0,nowPx-40);
    updScrollState();
    const on=()=>updScrollState();
    el.addEventListener("scroll",on);
    return()=>el.removeEventListener("scroll",on);
  },[getToday()]);

  // Rola por passos de "meia tela" — comportamento igual ao Globoplay
  const scroll=(dir)=>{
    const el=scrollRef.current; if(!el)return;
    const step=Math.max(300,el.clientWidth*0.6);
    el.scrollTo({left:el.scrollLeft+dir*step,behavior:"smooth"});
  };

  return <div className="compact-guide" onClick={e=>e.stopPropagation()} style={{position:"absolute",bottom:0,left:0,right:0,zIndex:20,animation:"slideUp 0.3s ease",padding:"0 clamp(10px,2vw,28px) max(10px,env(safe-area-inset-bottom))"}}>
    <div style={{background:"linear-gradient(180deg,rgba(23,28,42,0.98),rgba(9,12,20,0.98))",border:"1px solid rgba(255,255,255,0.12)",borderBottom:"0",borderRadius:"14px 14px 0 0",boxShadow:"0 -18px 60px rgba(0,0,0,0.55)",overflow:"hidden"}}>
    <div style={{padding:"9px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:18,fontWeight:800,color:"#fff",letterSpacing:1}}>GUIA AO VIVO</span>
        <LiveDot/>
        <span style={{fontSize:20,fontWeight:700,color:"#4fc3f7",marginLeft:8}}>{broadcastTime(clock)}:{String(getNow(clock)%60).padStart(2,"0")}</span>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onOpenFull} style={{background:"rgba(26,115,232,0.15)",border:"1px solid rgba(26,115,232,0.3)",color:"#4fc3f7",padding:"8px 18px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600}}>📺 Ver Completa</button>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
      </div>
    </div>
    <div className="epg-search" style={{padding:"10px 16px"}}><input aria-label="Buscar no guia" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar programa no guia…"/>
      {search.trim()&&<div className="epg-search-results">{matches.length?matches.slice(0,80).map(p=><button key={`${p.canalId}:${p.id}`} onClick={()=>onSelectProgram(p)}>{p.horarioTexto} · {p.nome}<small>{p.channelName}</small></button>):<p>Nenhum programa encontrado.</p>}</div>}
    </div>
    {/* GRADE: UM único container de scroll (X e Y) — coluna de canais e grade
        se movem SEMPRE juntas. Canais = sticky à esquerda; horas = sticky no topo.
        Rolar para baixo revela a programação de TODOS os canais.
        Botões laterais (‹ ›) fazem navegação horizontal — sem scrollbar visível. */}
    <div style={{position:"relative"}}>
      <div ref={scrollRef} className="epg-scroll" style={{background:"rgba(7,10,16,0.94)",overflow:"auto",maxHeight:220,minHeight:220,scrollbarWidth:"thin"}}>
        <div style={{width:140+totalW,position:"relative"}}>
        {/* Linha vermelha do AGORA (atravessa todas as linhas) */}
        <div style={{position:"absolute",left:140+nowPx,top:35,bottom:0,width:3,background:"#ff3b3b",zIndex:6,boxShadow:"0 0 12px #ff3b3b",pointerEvents:"none"}}/>
        {/* HEADER de horas — sticky no topo */}
        <div style={{display:"flex",position:"sticky",top:0,zIndex:8}}>
          <div style={{width:140,flexShrink:0,height:35,position:"sticky",left:0,zIndex:9,background:"rgb(12,14,20)",borderRight:"1px solid rgba(255,255,255,0.08)",borderBottom:"1px solid rgba(255,255,255,0.1)"}}/>
          <div style={{position:"relative",height:35,width:totalW,flexShrink:0,background:"rgb(12,14,20)",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
            {Array.from({length:14}).map((_,h)=>{
              const x=h*PX;
              return <div key={h} style={{position:"absolute",left:x,top:0,bottom:0,borderLeft:"1px solid rgba(255,255,255,0.1)"}}>
                <span style={{fontSize:13,color:"#ccc",fontWeight:600,padding:"8px 8px",whiteSpace:"nowrap",display:"inline-block"}}>{guideTime(timelineStart+h*3600)}</span>
              </div>;
            })}
            <div style={{position:"absolute",left:nowPx-3.5,bottom:-2,width:10,height:10,borderRadius:"50%",background:"#ff3b3b",boxShadow:"0 0 8px #ff3b3b",zIndex:7}}/>
          </div>
        </div>
        {/* LINHAS: canal (sticky esquerda) + programas — mesma linha, mesmo scroll */}
        {[...channels.filter(ch=>ch.id===currentChannelId),...channels.filter(ch=>ch.id!==currentChannelId)].map(ch=>{
          const sched=buildGuideSchedule(allPrograms,ch.id,ch);
          const upcoming=sched.filter(p=>p.horarioFim>now&&p.horarioInicio<horizon&&!p.isPlaceholder);
          const cur=getCurProg(sched);
          const isCurrent=ch.id===currentChannelId;
          return <div key={ch.id} style={{display:"flex"}}>
            <div onClick={()=>onSelectChannel(ch.id)} style={{width:140,flexShrink:0,height:ROW_H,position:"sticky",left:0,zIndex:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",background:isCurrent?"linear-gradient(135deg,rgba(26,115,232,0.35),rgba(18,24,36,0.98))":"rgb(12,14,20)",borderRight:"1px solid rgba(255,255,255,0.08)",borderBottom:"1px solid rgba(255,255,255,0.05)",borderLeft:isCurrent?"3px solid #4fc3f7":"3px solid transparent",boxSizing:"border-box"}}>
              <div style={{textAlign:"center"}}><ChLogo ch={ch} size={36}/><div style={{fontSize:12,fontWeight:600,color:isCurrent?"#fff":"#888",marginTop:4}}>{ch.nome}</div></div>
            </div>
            <div style={{position:"relative",height:ROW_H,width:totalW,flexShrink:0,borderBottom:"1px solid rgba(255,255,255,0.05)",background:isCurrent?"rgba(26,115,232,0.08)":"transparent",boxSizing:"border-box"}}>
              {upcoming.map(prog=>{
                const startSec=Number(prog.horarioInicio),endSec=Math.min(Number(prog.horarioFim),horizon),displayStart=Math.max(startSec,timelineStart);
                const left=secToPx(displayStart), w=Math.max(((endSec-displayStart)/3600)*PX,2);
                const isNow=cur?.id===prog.id;
                const needsRepeat=w>500;
                const needsTriple=w>900;
                return <div key={prog.id} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelectProgram(prog);}}} onClick={()=>onSelectProgram(prog)}
                  style={{position:"absolute",left,width:w,top:0,bottom:2,cursor:"pointer",overflow:"hidden",background:isNow?isCurrent?"rgba(60,70,90,0.95)":"rgba(40,44,60,0.95)":isCurrent?"rgba(35,40,55,0.7)":"rgba(30,32,44,0.6)",borderRight:"1px solid rgba(255,255,255,0.06)",borderLeft:"1px solid rgba(255,255,255,0.03)",boxSizing:"border-box",transition:"background 0.2s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background=isNow?isCurrent?"rgba(70,85,110,1)":"rgba(60,70,90,1)":isCurrent?"rgba(50,60,75,0.9)":"rgba(45,50,65,0.9)"}}
                  onMouseLeave={e=>{e.currentTarget.style.background=isNow?isCurrent?"rgba(60,70,90,0.95)":"rgba(40,44,60,0.95)":isCurrent?"rgba(35,40,55,0.7)":"rgba(30,32,44,0.6)"}}>
                  <div style={{position:"absolute",left:10,top:8,right:10}}>
                    <div style={{fontSize:11,color:"#aaa",marginBottom:4,fontWeight:500}}>{prog.horarioTexto}{isNow&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,background:"#f44336",color:"#fff"}}>AO VIVO</span>}</div>
                    <div style={{fontSize:14,fontWeight:700,color:isNow?"#fff":"#ddd",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{prog.nome}</div>
                  </div>
                  {needsRepeat&&<div style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
                    <div style={{fontSize:15,fontWeight:700,color:isNow?"rgba(255,255,255,0.7)":"rgba(221,221,221,0.6)",whiteSpace:"nowrap"}}>{prog.nome}</div>
                  </div>}
                  {needsTriple&&<div style={{position:"absolute",right:12,bottom:10}}>
                    <div style={{fontSize:14,fontWeight:600,color:isNow?"rgba(255,255,255,0.5)":"rgba(221,221,221,0.4)",whiteSpace:"nowrap",textAlign:"right"}}>{prog.nome}</div>
                  </div>}
                </div>;
              })}
              {upcoming.length===0&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#555",fontSize:13}}>Sem programação nas próximas 12 horas</div>}
            </div>
          </div>;
        })}
        </div>
      </div>
      {/* Botões laterais estilo Globoplay — só aparecem quando dá pra rolar */}
      <button onClick={()=>scroll(-1)} disabled={!canScrollL} title="Ver mais cedo (Shift+←)" style={{position:"absolute",left:6,top:"50%",transform:"translateY(-50%)",zIndex:20,width:44,height:70,borderRadius:6,background:"rgba(0,0,0,0.72)",border:"1px solid rgba(255,255,255,0.18)",color:canScrollL?"#fff":"#555",cursor:canScrollL?"pointer":"default",fontSize:26,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",transition:"opacity 0.2s",opacity:canScrollL?1:0.35,pointerEvents:canScrollL?"auto":"none",backdropFilter:"blur(6px)"}}>‹</button>
      <button onClick={()=>scroll(1)} disabled={!canScrollR} title="Ver mais tarde (Shift+→)" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",zIndex:20,width:44,height:70,borderRadius:6,background:"rgba(0,0,0,0.72)",border:"1px solid rgba(255,255,255,0.18)",color:canScrollR?"#fff":"#555",cursor:canScrollR?"pointer":"default",fontSize:26,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",transition:"opacity 0.2s",opacity:canScrollR?1:0.35,pointerEvents:canScrollR?"auto":"none",backdropFilter:"blur(6px)"}}>›</button>
    </div>
    <div style={{background:"rgba(8,11,18,0.98)",padding:"9px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"#7d8798"}}>
      <button onClick={()=>scroll(-1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 16px",borderRadius:4,cursor:"pointer",fontSize:13}}>← Anterior</button>
      <div style={{display:"flex",gap:24,flexWrap:"wrap"}}><span>‹ › = Navegar no tempo</span><span>↕ Rolar = Todos os canais</span><span>↑↓ = Canal</span><span>Shift+←→ = Tempo</span><span>ESC = Fechar</span></div>
      <button onClick={()=>scroll(1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 16px",borderRadius:4,cursor:"pointer",fontSize:13}}>Próximo →</button>
    </div>
    </div>
  </div>;
}

// ============================================
// FULL DAY SCHEDULE
// ============================================
function FullDay({channels,allPrograms,currentChannelId,onClose,onProgramClick}){
  const [search,setSearch]=useState('');
  const[viewCh,setVCh]=useState(currentChannelId);
  const [ns,setNs]=useState(getNow());
  const ch=channels.find(c=>c.id===viewCh)||channels[0];
  const sched=buildGuideSchedule(allPrograms,viewCh,ch).filter(p=>!p.isPlaceholder&&p.horarioFim>ns&&p.horarioInicio<ns+43200&&p.nome.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  useEffect(()=>{const timer=setInterval(()=>setNs(getNow()),1000);return()=>clearInterval(timer);},[]);
  return <div className="full-guide" onClick={e=>{e.stopPropagation();onClose()}} style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.92)",overflowY:"auto"}}>
    <div onClick={e=>e.stopPropagation()} style={{maxWidth:720,margin:"0 auto",padding:20,minHeight:"100vh"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,position:"sticky",top:0,background:"rgba(0,0,0,0.95)",padding:"16px 0",zIndex:5}}>
        <div><div style={{fontSize:20,fontWeight:700,color:"#fff"}}>Agora e próximas 12 horas</div><div style={{fontSize:12,color:"#888",marginTop:2}}>{broadcastDate(new Date(),{weekday:"long",day:"numeric",month:"long"})}</div></div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",width:40,height:40,borderRadius:"50%",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <input className="guide-search" type="search" aria-label="Buscar na programação" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar programa…"/>
      <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:8}}>
        {channels.map(c=><button key={c.id} onClick={()=>setVCh(c.id)} style={{padding:"10px 18px",borderRadius:6,cursor:"pointer",flexShrink:0,background:viewCh===c.id?`${c.cor}33`:"rgba(255,255,255,0.04)",border:viewCh===c.id?`1px solid ${c.cor}`:"1px solid rgba(255,255,255,0.08)",color:viewCh===c.id?"#fff":"#888",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}><ChLogo ch={c} size={18}/> {c.nome}</button>)}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {sched.length===0&&<div style={{padding:40,textAlign:"center",color:"#555"}}>Sem programação nas próximas 12 horas.</div>}
        {sched.map(prog=>{
          const isNow=ns>=prog.horarioInicio&&ns<prog.horarioFim;
          return <div key={prog.id} onClick={()=>onProgramClick(prog)} style={{display:"flex",gap:14,padding:"16px 18px",borderRadius:10,cursor:"pointer",background:isNow?"rgba(26,115,232,0.15)":"rgba(255,255,255,0.04)",border:isNow?"1px solid #1a73e8":"1px solid rgba(255,255,255,0.06)",transition:"all 0.2s"}}>
            <div style={{minWidth:75,textAlign:"center",paddingTop:2}}><div style={{fontSize:18,fontWeight:700,color:isNow?"#4fc3f7":"#fff"}}>{prog.horarioTexto}</div><div style={{fontSize:11,color:"#555",marginTop:2}}>{prog.horarioFimTexto}</div>{isNow&&<div style={{marginTop:6}}><LiveDot/></div>}</div>
            <div style={{width:3,borderRadius:2,background:isNow?ch.cor:"rgba(255,255,255,0.08)",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}><span style={{fontSize:16,fontWeight:600,color:isNow?"#fff":"#ccc"}}>{prog.nome}</span><Badge c={prog.classificacao}/>{prog.tags?.map(t=><Tag key={t} t={t}/>)}</div>
              <div style={{fontSize:13,color:"#999",lineHeight:1.6,marginBottom:6}}>{prog.sinopse}</div>
              <div style={{fontSize:11,color:"#666"}}>⏱ {fD(prog.duracao)}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,paddingTop:2}}>
              <button onClick={e=>{e.stopPropagation();shareProgram(prog,ch)}} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",padding:"8px 10px",borderRadius:6,cursor:"pointer",fontSize:12}}>📤</button>
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
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#1a1c24",borderRadius:10,maxWidth:500,width:"100%",border:"1px solid rgba(255,255,255,0.1)",overflowY:"auto",maxHeight:"90dvh"}}>
      <div style={{height:140,background:`linear-gradient(135deg,${channel?.cor||"#333"}33,#0a0c12)`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
        {thumbnailForProgram(program)?<img src={thumbnailForProgram(program)} alt={program.nome} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.currentTarget.style.visibility='hidden';}}/>:<ChLogo ch={channel||{logo:"TV"}} size={64}/>}
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
function PersistentClock({channel, clockMode="off", clockPosition="tr"}){
  const [t,setT]=useState(new Date());
  const [visible,setVisible]=useState(false);
  useEffect(()=>{const i=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(i)},[]);
  useEffect(()=>{
    if(clockMode==="always"){setVisible(true);return}
    if(clockMode==="off"){setVisible(false);return}
    const mins=clockMode==="15min"?15:30;
    // Aparece nos primeiros 10s de cada intervalo
    const check=()=>{
      const now=getNow(),m=Math.floor(now/60)%60,s=now%60;
      setVisible(m%mins===0&&s<10);
    };
    check();
    const i=setInterval(check,1000);
    return()=>clearInterval(i);
  },[clockMode]);
  if(!visible)return null;
  const pos={
    tr:{top:20,right:24},
    tl:{top:20,left:24},
    br:{bottom:20,right:24},
    bl:{bottom:20,left:24},
  }[clockPosition]||{top:20,right:24};
  const align=clockPosition.endsWith('l')?'left':'right';
  return <div className="tv-persistent-clock" style={{
    position:"absolute",...pos,zIndex:8,pointerEvents:"none",
    background:"rgba(0,0,0,0.55)",borderRadius:10,padding:"10px 18px",
    backdropFilter:"blur(4px)",border:`1px solid ${channel?.cor||"#1a73e8"}44`,
  }}>
    <div style={{fontSize:36,fontWeight:800,color:"#fff",letterSpacing:2,lineHeight:1,textAlign:align}}>
      {broadcastTime(t)}
    </div>
    <div style={{fontSize:12,color:"#aaa",textAlign:align,marginTop:3}}>
      {broadcastDate(t,{weekday:"short",day:"numeric",month:"numeric"})}
    </div>
  </div>;
}

// ============================================
// NEXT-UP OVERLAY ("Em X minutos: Nome do Programa")
// Aparece quando faltam ≤ nextUpMinutes para o próximo programa.
// Configurável: nextUpMode = "off"|"5min"|"10min"|"15min"
// ============================================
function NextUpOverlay({nextProgram, clockMode, clockPosition="tr", nextUpMode="off"}){
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
  const topOffset=clockMode!=="off"&&clockPosition==="tr"?110:20;
  return <div className="tv-next-up" style={{
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
  const [clockPosition,setClockPosition]=useState(settings.clockPosition||"tr");
  const [nextUpMode,setNextUpMode]=useState(settings.nextUpMode||"off");
  const [textSize,setTextSize]=useState(settings.textSize||"normal");
  const [displayMode,setDisplayMode]=useState(settings.displayMode||"studio");
  const [autoLayoutMinutes,setAutoLayoutMinutes]=useState(String(settings.autoLayoutMinutes||"off"));
  const save=()=>{onSave({...settings,clockMode,clockPosition,nextUpMode,textSize,displayMode,autoLayoutMinutes});onClose()};
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
      <BtnGrp label="📍 POSIÇÃO DO RELÓGIO" value={clockPosition} setValue={setClockPosition} options={[{v:"tr",l:"Superior direito"},{v:"tl",l:"Superior esquerdo"},{v:"br",l:"Inferior direito"},{v:"bl",l:"Inferior esquerdo"}]}/>
      <BtnGrp label="📺 AVISAR PRÓXIMO PROGRAMA" value={nextUpMode} setValue={setNextUpMode} options={[{v:"off",l:"Não avisar"},{v:"5min",l:"5 min antes"},{v:"10min",l:"10 min antes"},{v:"15min",l:"15 min antes"}]}/>
      <BtnGrp label="TAMANHO DOS TEXTOS" value={textSize} setValue={setTextSize} options={[{v:"normal",l:"Normal"},{v:"large",l:"Grande (118%)"},{v:"xlarge",l:"Extra grande (135%)"}]}/>
      <BtnGrp label="📺 MODO DE EXIBIÇÃO PADRÃO" value={displayMode} setValue={setDisplayMode} options={[{v:"studio",l:"Estúdio (player menor)"},{v:"cinema",l:"Player ampliado"}]}/>
      <div style={{display:"grid",gap:7,marginBottom:16}}><label htmlFor="auto-layout-minutes" style={{fontSize:12,fontWeight:700,color:"#aaa"}}>⏱ ALTERNAR MODO AUTOMATICAMENTE</label><select id="auto-layout-minutes" value={autoLayoutMinutes} onChange={e=>setAutoLayoutMinutes(e.target.value)}><option value="off">Desativado</option>{[5,10,15,20,30,60].map(n=><option key={n} value={n}>A cada {n} minutos</option>)}</select><small style={{color:"#8998ad",lineHeight:1.45}}>Alterna entre Estúdio e Player ampliado. Tela cheia do navegador continua no botão ⛶.</small></div>
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
function channelUrlKey(ch){
  if(!ch)return null;
  const n=Number(ch.numero);
  return (n&&n>0)?String(n):ch.id;
}

// ============================================
// LOGO OVERLAY — exibe a logo PNG do canal (ou do programa) na tela
// Posição configurável: "tl" "tr" "bl" "br" (canto) 
// Prioridade: programa.overlayLogo > canal.overlayLogo
// A logo some durante o OSD (para não conflitar) e volta suave
// ============================================
const CORNER_STYLES = {
  tr: {top:16, right:20, bottom:"auto", left:"auto"},
  tl: {top:16, left:20, bottom:"auto", right:"auto"},
  br: {bottom:80, right:20, top:"auto", left:"auto"},
  bl: {bottom:80, left:20, top:"auto", right:"auto"},
};
function ChannelLogoOverlay({channel, program, showOSD, fade}){
  // Resolve qual logo usar: programa sobrescreve canal
  const progLogo  = program?.overlayLogoUrl;
  const chanLogo  = channel?.overlayLogoUrl;
  const logoUrl   = progLogo || chanLogo;
  // Canto: programa sobrescreve canal, mas só se tiver valor não-vazio.
  // Fallback final: "tr" (superior direito)
  const corner    = (program?.overlayCorner && program.overlayCorner !== "")
    ? program.overlayCorner
    : (channel?.overlayCorner && channel.overlayCorner !== "")
      ? channel.overlayCorner
      : "tr";
  const size      = program?.overlaySize || channel?.overlaySize || 64;

  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0); // força re-animação a cada troca de programa

  useEffect(()=>{
    if(!logoUrl){ setVisible(false); return; }
    setVisible(true);
  },[logoUrl]);

  // Re-anima quando troca de programa
  useEffect(()=>{ setAnimKey(k=>k+1); },[program?.id]);

  if(!logoUrl || fade) return null;

  const pos = CORNER_STYLES[corner] || CORNER_STYLES.tr;
  const isBottom = corner.startsWith("b");

  return <div key={animKey} style={{
    position:"absolute", ...pos, zIndex:8,
    pointerEvents:"none",
    opacity: showOSD ? 0.35 : 1,
    transition:"opacity 0.6s ease",
    animation: isBottom
      ? "logoSlideUp 0.6s cubic-bezier(0.22,1,0.36,1)"
      : "logoSlideDown 0.6s cubic-bezier(0.22,1,0.36,1)",
  }}>
    <img src={logoUrl} alt="" style={{
      width:size, height:"auto", maxHeight:size*1.5,
      objectFit:"contain",
      filter:"drop-shadow(0 2px 8px rgba(0,0,0,0.7))",
      display:"block",
    }}/>
  </div>;
}

// ============================================
// TRANSITION OVERLAY — efeito in/out entre programas
// Pisca um fade preto suave quando cp.id muda (não no reload, não na troca de canal)
// ============================================
function ProgramTransition({programId, channelId}){
  const [show, setShow] = useState(false);
  const prevId = useRef(null);
  const prevCh = useRef(null);

  useEffect(()=>{
    // Só anima quando o PROGRAMA muda, não quando o canal muda
    if(!programId) return;
    if(prevCh.current !== channelId){
      setShow(false);
      prevCh.current = channelId;
      prevId.current = programId;
      return; // troca de canal: sem transição (já tem o fade do swCh)
    }
    if(prevId.current && prevId.current !== programId){
      setShow(true);
      const t = setTimeout(()=>setShow(false), 1200);
      prevId.current = programId;
      return ()=>clearTimeout(t);
    }
    prevId.current = programId;
  },[programId, channelId]);

  if(!show) return null;
  return <div style={{
    position:"absolute", inset:0, zIndex:6, pointerEvents:"none",
    background:"#000",
    animation:"progTransition 1.2s ease forwards",
  }}/>;
}

export default function TVWeb(){
  const {channels,programs:allPrograms,loading,error:catalogError}=useCatalog();
  const [params,setParams]=useSearchParams(),navigate=useNavigate();
  const [curCh,setCurCh]=useState(null);
  const [favorites,toggleFavorite]=useFavorites();
  const [playerIssue,setPlayerIssue]=useState('');
  const [notice,setNotice]=useState('');
  const noticeTimer=useRef(null);
  const showNotice=useCallback(message=>{clearTimeout(noticeTimer.current);setNotice(message);noticeTimer.current=setTimeout(()=>setNotice(''),5000);},[]);
  useEffect(()=>()=>clearTimeout(noticeTimer.current),[]);
  useEffect(()=>{
    if(!channels.length)return;
    const key=params.get('canal')||readPreference('trendtv_last_channel',null);
    const channel=channels.find(c=>c.id===key||String(c.numero)===key)||channels.find(c=>!c.isInfo)||channels[0];
    setCurCh(channel.id);writePreference('trendtv_last_channel',channel.id);
    const canonical=channelUrlKey(channel);
    if(canonical!==params.get('canal'))setParams(previous=>{const next=new URLSearchParams(previous);next.set('canal',canonical);return next;},{replace:true});
  },[channels,params,setParams]);
  const [showEPG, setEPG] = useState(false);
  const [showFull, setFull] = useState(false);
  const [showOSD, setOSD] = useState(true);
  const [selProg, setSP] = useState(null);
  const [fade, setFade] = useState(false);
  const [muted, setMuted] = useState(true);
  const [latencyStatus,setLatencyStatus]=useState('off');
  const [showSettings, setShowSettings] = useState(false);
  // Settings: persistido em localStorage (leve, sem precisar de Firestore)
  const [settings, setSettings] = useState(()=>{
    const value=readPreference("tvweb_settings",{});return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  });
  const [displayMode,setDisplayMode]=useState(()=>readPreference("tvweb_settings",{})?.displayMode||"studio");
  const saveSettings = (s) => {
    const next={...settings,...s};setSettings(next);setDisplayMode(next.displayMode||"studio");
    try{ localStorage.setItem("tvweb_settings", JSON.stringify(next)) }catch{}
  };
  useEffect(()=>{
    const minutes=Number(settings.autoLayoutMinutes);
    if(!Number.isFinite(minutes)||minutes<=0)return;
    const timer=setInterval(()=>setDisplayMode(mode=>mode==="studio"?"cinema":"studio"),minutes*60_000);
    return()=>clearInterval(timer);
  },[settings.autoLayoutMinutes]);
  // Tick: 1s para transições suaves de vídeo na playlist
  const [tick, setTick] = useState(0);
  useEffect(()=>{const i=setInterval(()=>setTick(t=>t+1),1000);return()=>clearInterval(i)},[]);



  const hideTimer=useRef(null),cRef=useRef(null),wRef=useRef(null),lastClickTimeRef=useRef(0),switchTimer=useRef(null);
  const [blockedVideos,setBlockedVideos]=useState(()=>{
    const data=readPreference('trendtv_blocked_v2',{});
    return Object.fromEntries(Object.entries(data&&typeof data==='object'?data:{}).filter(([,until])=>Number(until)>Date.now()));
  });
  const blockVideo=useCallback(id=>{
    if(!id)return;
    setBlockedVideos(prev=>({...prev,[id]:Date.now()+6*3600000}));
    const stored=readPreference('trendtv_blocked_v2',{});
    const data=Object.fromEntries(Object.entries(stored&&typeof stored==='object'?stored:{}).filter(([,until])=>Number(until)>Date.now()));
    data[id]=Date.now()+6*3600000;writePreference('trendtv_blocked_v2',data);
  },[]);
  useEffect(()=>()=>{clearTimeout(switchTimer.current);clearTimeout(wRef.current);},[]);
  // ========== DERIVED STATE (recalcs every tick) ==========
  const CHANNELS=channels;
  const ch=CHANNELS.find(c=>c.id===curCh)||CHANNELS[0];
  const today=getToday();
  const schedule=useMemo(()=>ch?buildGuideSchedule(allPrograms,ch.id,ch,today):[],[allPrograms,ch,today]);
  const cp=getCurProg(schedule);
  const ci=schedule.findIndex(p=>p.id===cp?.id);
  const np=ci>=0?schedule[ci+1]:null;
  const activeProgramKey=`${ch?.id||''}:${cp?.srcProgId||cp?.id||''}:${cp?.liveChannel||cp?.liveChannelId||''}:${cp?.liveUrl||''}`;
  const [liveLookup,setLiveLookup]=useState(null);
  useEffect(()=>{
    const liveChannel=cp?.liveChannel||cp?.liveChannelId;
    if(!cp?.isLive||!liveChannel){setLiveLookup(null);setLatencyStatus('off');return;}
    let stopped=false;
    const controller=new AbortController();
    setLiveLookup(prev=>prev?.programKey===activeProgramKey?{...prev,status:prev.videoId?'live':'checking'}:{programKey:activeProgramKey,status:'checking',videoId:null});
    const refresh=async()=>{
      try{
        const result=await fetchActiveChannelLive(liveChannel,{signal:controller.signal});
        if(!stopped)setLiveLookup({programKey:activeProgramKey,status:result.live?'live':'waiting',videoId:result.videoId,title:result.title});
      }catch(error){
        if(!stopped&&error.name!=='AbortError')setLiveLookup(prev=>prev?.programKey===activeProgramKey?{...prev,status:'error',errorMessage:error.message}:{programKey:activeProgramKey,status:'error',errorMessage:error.message,videoId:null});
      }
    };
    const first=setTimeout(refresh,cp?.liveUrl?2*60_000:0);const timer=setInterval(refresh,5*60_000);
    return()=>{stopped=true;controller.abort();clearTimeout(first);clearInterval(timer);};
  },[activeProgramKey,cp?.isLive,cp?.liveChannel,cp?.liveChannelId]);
  const directLiveId=extractYTId(cp?.liveUrl||cp?.youtubeId||cp?.videos?.[0]?.youtubeUrl||'');
  const activeLive=liveLookup?.programKey===activeProgramKey?liveLookup:null;

  const info=getVideoPlaybackInfo(cp);
  const blockedId=cp?.isLive?activeLive?.videoId||directLiveId:info?.videoId;
  const unavailable=!!((!cp?.isLive&&info?.blocked)||Number(blockedVideos[blockedId])>Date.now());
  const ytVideoId=cp?.isLive?(!unavailable?activeLive?.videoId||directLiveId||null:null):(!unavailable?info?.videoId:null);
  const playbackIdentity=cp?.isLive?`${activeProgramKey}:${activeLive?.videoId||directLiveId||'live-pending'}`:`${ch?.id}:${cp?.contKey||cp?.id}:${info?.videoIndex}:${info?.cycleIndex}`;
  useEffect(()=>{setPlayerIssue('');setLatencyStatus(cp?.isLive?'checking':'off');},[playbackIdentity,cp?.isLive]);
  const currentPosition=()=>getVideoPlaybackInfo(cp)?.position||0;
  const fullscreen=useCallback(async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(cRef.current?.requestFullscreen){setDisplayMode('cinema');await cRef.current.requestFullscreen();}else showNotice('Use a opção de tela cheia do seu navegador.');}
    catch{showNotice('Este navegador não permitiu abrir em tela cheia.');}
  },[showNotice]);
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
  const handleUnmute=useCallback(()=>setMuted(false),[]);
  // ========== CHANNEL SWITCHING ==========
  const swCh=useCallback(id=>{
    if(id===curCh)return;clearTimeout(switchTimer.current);setFade(true);
    switchTimer.current=setTimeout(()=>{
      const channel=channels.find(c=>c.id===id);if(!channel){setFade(false);return;}
      setCurCh(id);setFade(false);setParams(previous=>{const next=new URLSearchParams(previous);next.set('canal',channelUrlKey(channel));return next;},{replace:true});
    },150);showOSDNow();
  },[curCh,showOSDNow,channels,setParams]);

  const swDir=useCallback(dir=>{
    const i=CHANNELS.findIndex(c=>c.id===curCh);if(i<0)return;
    const n=dir>0?(i<CHANNELS.length-1?CHANNELS[i+1].id:CHANNELS[0].id):(i>0?CHANNELS[i-1].id:CHANNELS[CHANNELS.length-1].id);
    swCh(n);
  },[curCh,CHANNELS,swCh]);

  // Atalhos respeitam campos de texto, modificadores e controles focados.
  useEffect(()=>{
    const handler=e=>{
      if(e.altKey||e.ctrlKey||e.metaKey||e.repeat||/^(BUTTON|A)$/.test(e.target?.tagName||'')&&e.key.startsWith('Arrow')||e.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||''))return;
      const key=e.key.toLowerCase();
      if(key==='escape'){setEPG(false);setFull(false);setSP(null);setShowSettings(false);}
      else if(key==='h')navigate('/');
      else if(key==='m')setMuted(v=>!v);
      else if(key==='f')fullscreen();
      else if(key==='g'){setEPG(v=>!v);setFull(false);}
      else if(key==='s')setShowSettings(v=>!v);
      else if(!showFull&&!selProg&&!showSettings&&['arrowup','arrowdown'].includes(key)){swDir(key==='arrowup'?-1:1);}
      else if(showEPG&&e.shiftKey&&['arrowleft','arrowright'].includes(key)){
        const el=document.querySelector('.epg-scroll');el?.scrollBy({left:(key==='arrowright'?1:-1)*el.clientWidth*.6,behavior:'smooth'});
      }else return;
      e.preventDefault();showOSDNow();
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[swDir,showOSDNow,showEPG,showFull,selProg,showSettings,fullscreen,navigate]);

  // ========== MOUSE WHEEL ==========
  const handleWheel=useCallback(e=>{
    if(showEPG||showFull||showSettings||selProg)return;
    if(wRef.current)return;
    wRef.current=setTimeout(()=>{wRef.current=null},400);
    swDir(e.deltaY>0?1:-1);
  },[swDir,showEPG,showFull,showSettings,selProg]);

  // ========== CLICK HANDLER (on the video overlay only) ==========
  const handleVideoClick=useCallback(()=>{
    // Toque/clique na tela → fecha TUDO e apaga o OSD
    // (independente do estado — menus abertos, OSD visível, qualquer coisa)
    const now=Date.now();
    // Duplo clique → tela cheia (não esconde OSD)
    if(now-lastClickTimeRef.current<300){
      lastClickTimeRef.current=0;
      fullscreen();
      return;
    }
    lastClickTimeRef.current=now;
    // Primeiro toque com som mudo → ativa o som e mostra OSD
    if(muted){ handleUnmute(); showOSDNow(); return; }
    // Se OSD ou menus visíveis → fecha TUDO
    if(showOSD||showEPG||showFull||selProg||showSettings){
      clearTimeout(hideTimer.current);
      setOSD(false);
      setEPG(false);
      setFull(false);
      setSP(null);
      setShowSettings(false);
    } else {
      // OSD oculto e sem menus → mostra OSD
      showOSDNow();
    }
  },[muted,handleUnmute,showOSDNow,showOSD,showEPG,showFull,selProg,showSettings,fullscreen]);

  // ========== LOADING ==========
  if(loading) return <div style={{width:"100%",height:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontFamily:"system-ui",fontSize:16}}>
    <div style={{textAlign:"center"}}><div className="trend-mark" aria-hidden="true" style={{margin:"0 auto 16px",width:58,height:58,fontSize:34}}>T</div>Carregando TREND TV...</div>
  </div>;
  if(!ch)return <div className="page-message"><h1>Nenhum canal disponível</h1><p>{catalogError||"A programação aparecerá assim que um canal for cadastrado."}</p><a href="/">Voltar ao início</a></div>;

  // ========== RENDER ==========
  return <div className={`tv-screen tv-text-${settings.textSize||'normal'} tv-layout-${displayMode}`} ref={cRef} onWheel={handleWheel}
    style={{width:"100%",height:"100vh",background:"#000",position:"relative",fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif",overflow:"hidden",cursor:"default",userSelect:"none"}}>

    {/* ===== YOUTUBE PLAYER (completely isolated) ===== */}
    <div className="tv-video-stage" style={{position:"absolute",inset:0,zIndex:1,opacity:fade?0:1,transition:"opacity 0.5s"}}>
      {ytVideoId && !cp?.isPlaceholder ? (
        <YoutubePlayer videoId={ytVideoId} identity={playbackIdentity} position={currentPosition} muted={muted} isLive={!!cp?.isLive} lowLatency={!!(cp?.isLive&&settings.lowLatency)} onLowLatencyStatus={setLatencyStatus} onBlocked={blockVideo} onPlaybackIssue={setPlayerIssue}/>
      ) : (
        <div style={{width:"100%",height:"100%",background:`radial-gradient(ellipse at center,${ch.cor||"#1a73e8"}15,#0a0c12 70%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {cp?.isLive?(
            <div style={{textAlign:"center",maxWidth:600,padding:28}}><div style={{fontSize:64,marginBottom:20}}>{activeLive?.status==='checking'?'⏳':activeLive?.status==='error'?'⚠️':'📡'}</div><div style={{fontSize:30,fontWeight:700,color:"#fff",marginBottom:12}}>{unavailable?'Esta live não permite reprodução neste site':activeLive?.status==='error'?'Não foi possível consultar o YouTube':activeLive?.status==='waiting'?'Aguardando a próxima live':'Localizando transmissão ao vivo…'}</div><div style={{fontSize:15,color:"#aaa",lineHeight:1.5}}>{unavailable?'A transmissão está bloqueada para incorporação. Escolha outro canal.':activeLive?.status==='error'?`${activeLive.errorMessage||'A busca será tentada novamente automaticamente.'}`:`Canal ${cp.liveChannel||cp.liveChannelId} · consulta ao YouTube a cada 15 min`}</div></div>
          ):cp?.isPlaceholder||unavailable?(
            <div style={{textAlign:"center",maxWidth:600}}>
              <div className="trend-mark" aria-hidden="true" style={{margin:"0 auto 30px",width:128,height:128,fontSize:78,opacity:.8}}>T</div>
              <div style={{fontSize:48,fontWeight:700,color:"#fff",marginBottom:16}}>{unavailable?"Vídeo indisponível":"Voltamos já!"}</div>
              <div style={{fontSize:18,color:"#999"}}>{unavailable?"A programação continua no próximo horário. Você também pode trocar de canal.":"Programação em breve"}</div>
            </div>
          ):(
            <div style={{textAlign:"center",opacity:0.15}}><ChLogo ch={ch} size={100}/><div style={{fontSize:24,color:"#fff",marginTop:8,fontWeight:700}}>{ch.nome}</div></div>
          )}
        </div>
      )}
    </div>



    {/* ===== CLICK BARRIER (completely above iframe, below menus) ===== */}
    <div onClick={handleVideoClick} style={{position:"absolute",inset:0,zIndex:2}} />

    {/* ===== WATERMARK ===== */}
    <div className="tv-watermark" style={{position:"absolute",top:16,right:20,fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.12)",letterSpacing:2,zIndex:3,pointerEvents:"none"}}>TVWEB</div>

    {/* ===== LOGO OVERLAY (PNG do canal ou programa) ===== */}
    <ChannelLogoOverlay channel={ch} program={cp} showOSD={showOSD} fade={fade}/>

    {/* ===== TRANSIÇÃO ENTRE PROGRAMAS (fade preto suave) ===== */}
    <ProgramTransition programId={cp?.srcProgId||cp?.id} channelId={curCh}/>

    {/* ===== UNMUTE BUTTON ===== */}
    {muted&&<button onClick={e=>{e.stopPropagation();handleUnmute()}} style={{
      position:"absolute",bottom:"50%",left:"50%",transform:"translate(-50%,50%)",zIndex:15,
      background:"rgba(0,0,0,0.85)",border:"1px solid rgba(255,255,255,0.2)",
      color:"#fff",padding:"14px 32px",borderRadius:30,cursor:"pointer",
      fontSize:16,fontWeight:700,display:"flex",alignItems:"center",gap:10,
      animation:"pulseFull 2s ease infinite",
    }}>🔇 Clique para ativar o som</button>}

    {/* ===== GC (lower-third de música/programa) ===== */}
    {!showEPG&&!showFull&&!unavailable&&!cp?.isJingle&&!ch.newsEnabled&&<GCBar channel={ch} program={cp} nextProgram={np}/>}

    {/* ===== RELÓGIO PERSISTENTE (apenas quando OSD está oculto, pois OSDHeader já tem relógio) ===== */}
    {displayMode!=="studio"&&!showOSD&&!showEPG&&!showFull&&settings.clockMode&&settings.clockMode!=="off"&&<PersistentClock channel={ch} clockMode={settings.clockMode} clockPosition={settings.clockPosition||"tr"}/>}

    {/* ===== PRÓXIMO PROGRAMA ("Em X minutos...") — só quando OSD está oculto ===== */}
    {displayMode!=="studio"&&!showOSD&&!showEPG&&!showFull&&np&&settings.nextUpMode&&settings.nextUpMode!=="off"&&<NextUpOverlay nextProgram={np} clockPosition={settings.clockPosition||"tr"} clockMode={settings.clockMode||"off"} nextUpMode={settings.nextUpMode}/>}

    {!ch.newsEnabled&&displayMode==="studio"&&<aside className="studio-setup-card" aria-live="polite">
      <span>ESTÚDIO · PACOTE GRÁFICO</span><b className="studio-package-status">DESATIVADO</b>
      <h2>GC e mensagens ainda não estão no ar</h2>
      <p>Ative o pacote na área <strong>Redação</strong> do Admin para exibir manchetes, ticker inferior e tweets neste canal.</p>
      <small>{ch.nome} · {cp?.nome||"Programação"}{np&&` · A seguir: ${np.nome}`}</small>
    </aside>}
    <NewsOverlay channel={ch} program={cp} studio={displayMode==="studio"} hidden={showOSD||showEPG||showFull||!!selProg||showSettings||!!cp?.isJingle}/>
    {(notice||catalogError)&&<div role="status" className="tv-notice">{notice||catalogError}</div>}
    {playerIssue&&<div className="playback-issue" role="alert"><p>{playerIssue}</p><button onClick={()=>{setMuted(false);window.dispatchEvent(new Event('trendtv-play'));}}>Reproduzir</button></div>}
    {/* ===== MENU DE CONFIGURAÇÕES ===== */}
    {showSettings&&<SettingsMenu settings={settings} onSave={saveSettings} onClose={()=>setShowSettings(false)}/>}

    {/* ===== OSD HEADER (TV-style, 20s) ===== */}
    <OSDHeader channel={ch} program={cp} visible={showOSD&&!showEPG&&!showFull}/>

    {/* ===== OSD FOOTER (TV-style, 20s) ===== */}
    <OSDFooter channel={ch} muted={muted} onMute={()=>setMuted(v=>!v)} favorite={favorites.includes(ch.id)} onFavorite={()=>toggleFavorite(ch.id)} onShare={async()=>{const message=await shareChannel(ch,cp);if(message)showNotice(message);}} program={cp} nextProgram={np} visible={showOSD&&!showEPG&&!showFull}
      onOpenEPG={()=>setEPG(true)} onOpenFull={()=>setFull(true)} onOpenSettings={()=>setShowSettings(true)} onFullscreen={fullscreen}
      displayMode={displayMode} onToggleDisplayMode={()=>saveSettings({...settings,displayMode:displayMode==="studio"?"cinema":"studio"})}
      isLive={!!cp?.isLive} lowLatency={!!(cp?.isLive&&settings.lowLatency)} latencyStatus={latencyStatus} onToggleLowLatency={()=>saveSettings({...settings,lowLatency:!settings.lowLatency})}/>


    {/* ===== EPG / FULL / MODAL (above everything) ===== */}
    {showEPG&&<EPGCompact channels={CHANNELS} allPrograms={allPrograms} currentChannelId={curCh} onSelectChannel={id=>{swCh(id);setEPG(false)}} onSelectProgram={setSP} onOpenFull={()=>{setEPG(false);setFull(true)}} onClose={()=>setEPG(false)}/>}
    {showFull&&<FullDay channels={CHANNELS} allPrograms={allPrograms} currentChannelId={curCh} onClose={()=>setFull(false)} onProgramClick={setSP}/>}
    {selProg&&<ProgModal program={selProg} channel={CHANNELS.find(c=>c.id===(selProg.canalId||selProg.srcProgId&&allPrograms.find(p=>p.id===selProg.srcProgId)?.canalId))||ch} onClose={()=>setSP(null)} onWatch={(chId)=>{swCh(chId);setEPG(false);setFull(false)}}/>}

    <style>{`
      @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes slideDown{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes pulseFull{0%,100%{opacity:.6;transform:translate(-50%,50%) scale(1)}50%{opacity:1;transform:translate(-50%,50%) scale(1.05)}}
      @keyframes gcIn{from{transform:translateX(-40px);opacity:0}to{transform:translateX(0);opacity:1}}
      @keyframes logoSlideDown{from{transform:translateY(-12px);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes logoSlideUp{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes progTransition{0%{opacity:0.85}40%{opacity:0.85}100%{opacity:0}}
      .epg-scroll::-webkit-scrollbar{height:0;width:8px}
      .epg-scroll::-webkit-scrollbar-track{background:transparent}
      .epg-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}
      ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
      *{box-sizing:border-box;margin:0;padding:0}
    `}</style>
  </div>;
}

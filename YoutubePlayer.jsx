import {useEffect,useRef,useState} from 'react';
let apiPromise;
function loadAPI(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const previous=window.onYouTubeIframeAPIReady;
    const timer=setTimeout(()=>{apiPromise=null;reject(new Error('O YouTube demorou a responder.'));},20000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);previous?.();resolve(window.YT);};
    let script=document.querySelector('script[data-trendtv-youtube]');
    if(!script){script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.dataset.trendtvYoutube='true';document.head.appendChild(script);}
    script.onerror=()=>{clearTimeout(timer);script.remove();apiPromise=null;reject(new Error('Não foi possível conectar ao YouTube.'));};
  });return apiPromise;
}
export default function YoutubePlayer({videoId,identity,position,muted,isLive=false,lowLatency=false,onLowLatencyStatus,onBlocked,onPlaybackIssue}){
  const host=useRef(null),player=useRef(null),latest=useRef({position,muted,isLive,lowLatency,onLowLatencyStatus,onBlocked,onPlaybackIssue}),[retry,setRetry]=useState(0);
  latest.current={position,muted,isLive,lowLatency,onLowLatencyStatus,onBlocked,onPlaybackIssue};
  useEffect(()=>{
    let cancelled=false,lastSyncAt=0,lastFallbackSeekAt=0,rateRequestStartedAt=0;
    const update=(force=false)=>{
      if(!latest.current.lowLatency&&!force&&Date.now()-lastSyncAt<10000)return;
      lastSyncAt=Date.now();
      const p=player.current;if(!p?.getPlayerState)return;
      // Recupera atraso com 2x quando disponível; ao entrar na janela da grade, volta a 1x.
      try{
        const liveDuration=latest.current.isLive?Number(p.getDuration()):0;
        const target=latest.current.isLive?Math.max(0,liveDuration-3):latest.current.position(),actual=p.getCurrentTime();
        if(!Number.isFinite(target)||!Number.isFinite(actual))return;
        const drift=target-actual;
        if(latest.current.isLive&&latest.current.lowLatency&&drift>4){
          const rates=p.getAvailablePlaybackRates?.()||[1];
          if(rates.includes(2)){
            if(Number(p.getPlaybackRate?.())===2){rateRequestStartedAt=0;latest.current.onLowLatencyStatus?.('catching_up');}
            else if(rateRequestStartedAt&&Date.now()-rateRequestStartedAt>=8000)latest.current.onLowLatencyStatus?.('unsupported');
            else{if(!rateRequestStartedAt)rateRequestStartedAt=Date.now();p.setPlaybackRate(2);latest.current.onLowLatencyStatus?.('requesting');}
          }
          else{p.setPlaybackRate(1);latest.current.onLowLatencyStatus?.('unsupported');if(!latest.current.isLive&&drift>8&&Date.now()-lastFallbackSeekAt>10000){p.seekTo(target,true);lastFallbackSeekAt=Date.now();}}
        }else{
          rateRequestStartedAt=0;p.setPlaybackRate(1);
          latest.current.onLowLatencyStatus?.(latest.current.isLive&&latest.current.lowLatency?'synced':'off');
          if(!latest.current.isLive&&!latest.current.lowLatency&&Math.abs(drift)>4)p.seekTo(target,true);
        }
      }catch{}
    };
    loadAPI().then(YT=>{
      if(cancelled||!host.current)return;
      const target=document.createElement('div');host.current.replaceChildren(target);
      player.current=new YT.Player(target,{videoId,width:'100%',height:'100%',
        playerVars:{autoplay:1,mute:1,controls:0,disablekb:1,rel:0,playsinline:1,fs:0,start:latest.current.isLive?0:Math.floor(latest.current.position()),origin:window.location.origin},
        events:{
          onReady:event=>{if(cancelled)return;const p=event.target;if(!latest.current.isLive)p.seekTo(latest.current.position(),true);latest.current.muted?p.mute():p.unMute();p.playVideo();latest.current.onLowLatencyStatus?.(latest.current.lowLatency?'checking':'off');latest.current.onPlaybackIssue?.('');},
          onPlaybackRateChange:event=>{if(!cancelled&&latest.current.isLive&&latest.current.lowLatency)latest.current.onLowLatencyStatus?.(event.data===2?'catching_up':'synced');},
          onAutoplayBlocked:()=>latest.current.onPlaybackIssue?.('Toque em Reproduzir para iniciar o vídeo.'),
          onError:event=>{
            if(cancelled)return;
            if([100,101,150].includes(event.data))latest.current.onBlocked(videoId);
            else latest.current.onPlaybackIssue?.(event.data===153?'O YouTube recusou a identificação deste site. Verifique o domínio e a política de referência.':'Não foi possível reproduzir este vídeo agora. Tente novamente.');
          }
        }});
    }).catch(e=>{if(!cancelled)latest.current.onPlaybackIssue?.(e.message);});
    const timer=setInterval(update,1000);
    const visibility=()=>{if(!document.hidden)update(true);};
    const play=()=>{if(player.current?.playVideo){if(!latest.current.isLive)player.current.seekTo(latest.current.position(),true);player.current.playVideo();update(true);latest.current.onPlaybackIssue?.('');}else setRetry(x=>x+1);};
    document.addEventListener('visibilitychange',visibility);window.addEventListener('trendtv-play',play);
    return()=>{cancelled=true;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('trendtv-play',play);try{player.current?.destroy();}catch{}player.current=null;};
  },[videoId,identity,retry]);
  useEffect(()=>{try{if(muted)player.current?.mute?.();else{player.current?.unMute?.();player.current?.playVideo?.();}}catch{}},[muted]);
  useEffect(()=>{if(!lowLatency){try{player.current?.setPlaybackRate?.(1);}catch{}onLowLatencyStatus?.('off');}},[lowLatency,onLowLatencyStatus]);
  return <div ref={host} style={{width:'100%',height:'100%'}}/>;
}

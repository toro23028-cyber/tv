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
export default function YoutubePlayer({videoId,identity,position,muted,onBlocked,onPlaybackIssue}){
  const host=useRef(null),player=useRef(null),latest=useRef({position,muted,onBlocked,onPlaybackIssue}),[retry,setRetry]=useState(0);
  latest.current={position,muted,onBlocked,onPlaybackIssue};
  useEffect(()=>{
    let cancelled=false;
    const update=()=>{
      const p=player.current;if(!p?.getPlayerState)return;
      // Voltar de uma aba suspensa sempre ressincroniza com a transmissão.
      try{const target=latest.current.position(),actual=p.getCurrentTime();if(Number.isFinite(target)&&Math.abs(actual-target)>4)p.seekTo(target,true);}catch{}
    };
    loadAPI().then(YT=>{
      if(cancelled||!host.current)return;
      const target=document.createElement('div');host.current.replaceChildren(target);
      player.current=new YT.Player(target,{videoId,width:'100%',height:'100%',
        playerVars:{autoplay:1,mute:1,controls:0,disablekb:1,rel:0,playsinline:1,fs:0,start:Math.floor(latest.current.position()),origin:window.location.origin},
        events:{
          onReady:event=>{if(cancelled)return;const p=event.target;p.seekTo(latest.current.position(),true);latest.current.muted?p.mute():p.unMute();p.playVideo();latest.current.onPlaybackIssue?.('');},
          onAutoplayBlocked:()=>latest.current.onPlaybackIssue?.('Toque em Reproduzir para iniciar o vídeo.'),
          onError:event=>{
            if(cancelled)return;
            if([100,101,150].includes(event.data))latest.current.onBlocked(videoId);
            else latest.current.onPlaybackIssue?.(event.data===153?'O YouTube recusou a identificação deste site. Verifique o domínio e a política de referência.':'Não foi possível reproduzir este vídeo agora. Tente novamente.');
          }
        }});
    }).catch(e=>{if(!cancelled)latest.current.onPlaybackIssue?.(e.message);});
    const timer=setInterval(update,10000);
    const visibility=()=>{if(!document.hidden)update();};
    const play=()=>{if(player.current?.playVideo){player.current.seekTo(latest.current.position(),true);player.current.playVideo();latest.current.onPlaybackIssue?.('');}else setRetry(x=>x+1);};
    document.addEventListener('visibilitychange',visibility);window.addEventListener('trendtv-play',play);
    return()=>{cancelled=true;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('trendtv-play',play);try{player.current?.destroy();}catch{}player.current=null;};
  },[videoId,identity,retry]);
  useEffect(()=>{try{if(muted)player.current?.mute?.();else{player.current?.unMute?.();player.current?.playVideo?.();}}catch{}},[muted]);
  return <div ref={host} style={{width:'100%',height:'100%'}}/>;
}

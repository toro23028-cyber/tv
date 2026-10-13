import {useEffect,useRef,useState} from 'react';
import Hls from 'hls.js';
import {hlsURL} from './automatic-schedule';
export default function HlsPlayer({url,muted,onPlaybackIssue,onLiveState}){
 const video=useRef(null),callbacks=useRef({onPlaybackIssue,onLiveState}),[retry,setRetry]=useState(0);
 callbacks.current={onPlaybackIssue,onLiveState};
 useEffect(()=>{
  const element=video.current,source=hlsURL(url);if(!element||!source)return;
  let hls=null,active=true,recovered=false;
  const play=()=>element.play().catch(()=>{if(active)callbacks.current.onPlaybackIssue?.('Toque em Reproduzir para iniciar a transmissão HLS.')});
  const playing=()=>{if(active)callbacks.current.onPlaybackIssue?.('')};
  const ended=()=>{element.playbackRate=1;callbacks.current.onLiveState?.(false)};
  const nativeError=()=>callbacks.current.onPlaybackIssue?.('A transmissão HLS não respondeu. Verifique a URL, CORS e a disponibilidade da fonte.');
  const retryPlay=()=>setRetry(n=>n+1);
  element.playbackRate=1;element.addEventListener('playing',playing);element.addEventListener('ended',ended);window.addEventListener('trendtv-play',retryPlay);
  callbacks.current.onLiveState?.(false);
  if(element.canPlayType('application/vnd.apple.mpegurl')){
   element.src=source;element.addEventListener('error',nativeError);element.addEventListener('loadedmetadata',play);
   const nativeLive=()=>callbacks.current.onLiveState?.(!Number.isFinite(element.duration));element.addEventListener('durationchange',nativeLive);
   element._trendNativeLive=nativeLive;element.load();
  }else if(Hls.isSupported()){
   hls=new Hls({lowLatencyMode:true,maxLiveSyncPlaybackRate:1});hls.loadSource(source);hls.attachMedia(element);
   hls.on(Hls.Events.MANIFEST_PARSED,play);
   hls.on(Hls.Events.LEVEL_LOADED,(_,data)=>{if(active)callbacks.current.onLiveState?.(data.details.live===true)});
   hls.on(Hls.Events.ERROR,(_,data)=>{if(!active||!data.fatal)return;if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&!recovered){recovered=true;hls.recoverMediaError()}else callbacks.current.onPlaybackIssue?.('Transmissão HLS indisponível. Verifique a URL e se o servidor permite CORS.');});
  }else callbacks.current.onPlaybackIssue?.('Este navegador não oferece reprodução HLS.');
  return()=>{active=false;hls?.destroy();window.removeEventListener('trendtv-play',retryPlay);element.removeEventListener('playing',playing);element.removeEventListener('ended',ended);element.removeEventListener('error',nativeError);element.removeEventListener('loadedmetadata',play);if(element._trendNativeLive)element.removeEventListener('durationchange',element._trendNativeLive);element.pause();element.removeAttribute('src');element.load();};
 },[url,retry]);
 useEffect(()=>{if(video.current){video.current.muted=muted;video.current.playbackRate=1}},[muted]);
 return <video ref={video} autoPlay playsInline muted={muted} controls={false} style={{width:'100%',height:'100%',objectFit:'contain',background:'#000'}}/>;
}

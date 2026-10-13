import {createContext,useContext,useEffect,useState} from 'react';
import {fetchActiveChannelLive} from './youtube-live-client';
import {db,collection,onSnapshot} from './firebase';
const Context=createContext(null);
export function CatalogProvider({children}){
  const [catalog,setCatalog]=useState({channels:[],programs:[],loading:true,error:''});
  const [runtimeLives,setRuntimeLives]=useState({});
  const liveSources=JSON.stringify(catalog.channels.filter(c=>c.autoMode==='live'&&!c.autoHlsUrl).map(c=>({id:c.id,source:c.autoLiveChannel||c.defaultLiveChannel||'',checkedAt:c.autoLiveCheckedAt||0})));
  useEffect(()=>{
    let active=true;const controller=new AbortController(),sources=JSON.parse(liveSources);
    const refresh=()=>Promise.allSettled(sources.map(async c=>{if(!c.source||Date.now()-c.checkedAt<15*60000)return;try{const result=await fetchActiveChannelLive(c.source,{signal:controller.signal});if(active)setRuntimeLives(list=>({...list,[c.id]:{source:c.source,autoLiveCheckedAt:Date.now(),autoLiveStatus:result.live?'live':'waiting',autoLiveVideoId:result.videoId||'',autoLiveTitle:result.title}}))}catch{}}));
    refresh();const timer=setInterval(refresh,5*60000);return()=>{active=false;controller.abort();clearInterval(timer)};
  },[liveSources]);
  useEffect(()=>{
    const loaded={channels:false,programs:false},failed={channels:false,programs:false};
    const subscriptions=['channels','programs'].map(name=>onSnapshot(collection(db,name),snap=>{
      loaded[name]=true;failed[name]=false;
      const data=snap.docs.map(d=>({...d.data(),id:d.id}));
      if(name==='channels')data.sort((a,b)=>Number(a.numero||0)-Number(b.numero||0));
      setCatalog(prev=>({...prev,[name]:data,loading:!loaded.channels||!loaded.programs,error:Object.values(failed).some(Boolean)?prev.error:''}));
    },()=>{loaded[name]=true;failed[name]=true;setCatalog(prev=>({...prev,loading:!loaded.channels||!loaded.programs,error:'Não foi possível atualizar a programação. Verifique a conexão e tente novamente.'}));}));
    const timeout=setTimeout(()=>setCatalog(prev=>prev.loading?{...prev,loading:false,error:'A programação está demorando a responder. Os dados aparecerão assim que a conexão voltar.'}:prev),10000);
    return()=>{subscriptions.forEach(fn=>fn());clearTimeout(timeout);};
  },[]);
  return <Context.Provider value={{...catalog,channels:catalog.channels.map(c=>{const live=runtimeLives[c.id];return live&&live.source===(c.autoLiveChannel||c.defaultLiveChannel)&&live.autoLiveCheckedAt>Number(c.autoLiveCheckedAt||0)?{...c,...live}:c})}}>{children}</Context.Provider>;
}
export function useCatalog(){return useContext(Context);}

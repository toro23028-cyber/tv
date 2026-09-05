import {createContext,useContext,useEffect,useState} from 'react';
import {db,collection,onSnapshot} from './firebase';
const Context=createContext(null);
export function CatalogProvider({children}){
  const [catalog,setCatalog]=useState({channels:[],programs:[],loading:true,error:''});
  useEffect(()=>{
    const loaded={channels:false,programs:false};
    const subscriptions=['channels','programs'].map(name=>onSnapshot(collection(db,name),snap=>{
      loaded[name]=true;
      const data=snap.docs.map(d=>({...d.data(),id:d.id}));
      if(name==='channels')data.sort((a,b)=>Number(a.numero||0)-Number(b.numero||0));
      setCatalog(prev=>({...prev,[name]:data,loading:!loaded.channels||!loaded.programs}));
    },()=>{loaded[name]=true;setCatalog(prev=>({...prev,loading:!loaded.channels||!loaded.programs,error:'Não foi possível atualizar a programação. Verifique a conexão e tente novamente.'}));}));
    const timeout=setTimeout(()=>setCatalog(prev=>prev.loading?{...prev,loading:false,error:'A programação está demorando a responder. Os dados aparecerão assim que a conexão voltar.'}:prev),10000);
    return()=>{subscriptions.forEach(fn=>fn());clearTimeout(timeout);};
  },[]);
  return <Context.Provider value={catalog}>{children}</Context.Provider>;
}
export function useCatalog(){return useContext(Context);}

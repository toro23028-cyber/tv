import {BrowserRouter,Routes,Route,Navigate,useParams,useLocation} from 'react-router-dom';
import {useState,useEffect,lazy,Suspense} from 'react';
import {onAuthStateChanged,setPersistence,browserSessionPersistence,signInWithEmailAndPassword,signOut,getIdTokenResult} from 'firebase/auth';
import {auth,db,doc,getDoc} from './firebase';
import {CatalogProvider} from './Catalog';
import {readPreference,writePreference} from './preferences';
const TV=lazy(()=>import('./TV')),Admin=lazy(()=>import('./Admin')),Home=lazy(()=>import('./Home'));
const TTL=8*60*60*1000;
function Loading(){return <div className="page-message">Carregando TREND TV…</div>;}
function AdminLogin({message=''}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(message);
  const [now,setNow]=useState(Date.now());
  const lock=readPreference('trendtv_login_limit',{}),locked=Number(lock.until)>now;
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  async function login(e){
    e.preventDefault();if(busy||locked)return;setBusy(true);setError('');
    try{await setPersistence(auth,browserSessionPersistence);await signInWithEmailAndPassword(auth,email.trim(),password);writePreference('trendtv_login_limit',{});}
    catch(e){
      if(e.code==='auth/network-request-failed')setError('Sem conexão. Tente novamente.');
      else if(['auth/operation-not-allowed','auth/configuration-not-found'].includes(e.code))setError('O acesso por e-mail ainda precisa ser ativado pelo administrador. Consulte o guia de instalação.');
      else{const attempts=(Number(lock.attempts)||0)+1;writePreference('trendtv_login_limit',{attempts:attempts>=5?0:attempts,until:attempts>=5?Date.now()+60000:0});setError('Não foi possível entrar. Verifique o e-mail e a senha.');}
      setPassword('');
    }finally{setBusy(false);}
  }
  return <main className="login-page"><form className="login-card" onSubmit={login}>
    <a href="/" className="brand">TREND TV</a><h1>Acesso ao painel</h1>
    <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
    <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
    {(error||locked)&&<p role="alert">{locked?`Aguarde ${Math.ceil((lock.until-now)/1000)} segundos para tentar novamente.`:error}</p>}
    <button className="primary" disabled={busy||locked}>{busy?'Entrando…':'Entrar'}</button>
    <a href="/">Voltar para os canais</a>
  </form></main>;
}
function ProtectedAdmin(){
  const [state,setState]=useState({loading:true,allowed:false,user:null,message:''});
  useEffect(()=>{
    let generation=0,timer;
    const unsub=onAuthStateChanged(auth,async user=>{
      const current=++generation;clearTimeout(timer);
      if(!user){setState({loading:false,allowed:false,user:null});return;}
      setState({loading:true,allowed:false,user});
      try{
        const [token,admin]=await Promise.all([getIdTokenResult(user),getDoc(doc(db,'admins',user.uid))]);
        if(current!==generation)return;
        const remaining=Number(token.claims.auth_time)*1000+TTL-Date.now();
        if(remaining<=0){await signOut(auth);return;}
        const allowed=admin.exists()&&admin.data().enabled===true;
        setState({loading:false,allowed,user,message:allowed?'':'Esta conta não tem acesso ao painel.'});
        timer=setTimeout(()=>signOut(auth),remaining);
      }catch{if(current===generation)setState({loading:false,allowed:false,user,message:'Não foi possível verificar o acesso. Confira a conexão e as permissões do painel.'});}
    });return()=>{generation++;clearTimeout(timer);unsub();};
  },[]);
  if(state.loading)return <Loading/>;
  if(state.allowed)return <Admin onLogout={()=>signOut(auth)}/>;
  if(state.user)return <div className="page-message"><p role="alert">{state.message}</p><button onClick={()=>signOut(auth)}>Sair e trocar de conta</button></div>;
  return <AdminLogin message={state.message}/>;
}
let installEvent=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;window.dispatchEvent(new Event('trendtv-install-ready'));});
function PWAInstallBanner(){
  const location=useLocation();
  const [available,setAvailable]=useState(!!installEvent),[dismissed,setDismissed]=useState(()=>Number(readPreference('trendtv_install_dismissed',0))>Date.now());
  useEffect(()=>{const ready=()=>setAvailable(true),installed=()=>{installEvent=null;setAvailable(false);};window.addEventListener('trendtv-install-ready',ready);window.addEventListener('appinstalled',installed);return()=>{window.removeEventListener('trendtv-install-ready',ready);window.removeEventListener('appinstalled',installed);};},[]);
  if(!available||dismissed||location.pathname!=='/')return null;
  return <aside className="install-banner"><div><strong>Instalar TREND TV</strong><p>Seus canais a um toque.</p></div><button onClick={()=>{setDismissed(true);writePreference('trendtv_install_dismissed',Date.now()+7*86400000);}}>Depois</button><button className="primary" onClick={async()=>{if(!installEvent)return;await installEvent.prompt();await installEvent.userChoice;installEvent=null;setAvailable(false);}}>Instalar</button></aside>;
}
function CanalRedirect(){const {id}=useParams();return <Navigate to={`/tv?canal=${encodeURIComponent(id)}`} replace/>;}
export default function App(){return <BrowserRouter><CatalogProvider><Suspense fallback={<Loading/>}><Routes>
  <Route path="/" element={<Home/>}/><Route path="/tv" element={<TV/>}/><Route path="/canal/:id" element={<CanalRedirect/>}/><Route path="/admin" element={<ProtectedAdmin/>}/><Route path="*" element={<Navigate to="/" replace/>}/>
</Routes></Suspense><PWAInstallBanner/></CatalogProvider></BrowserRouter>;}

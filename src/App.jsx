import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import TV    from "./TV";
import Admin from "./Admin";
import Home  from "./Home";

// ============================================
// ADMIN AUTH
// ============================================
const ADMIN_KEY  = "tvweb_admin_auth";
const ADMIN_PWD  = import.meta.env.VITE_ADMIN_PASSWORD || "tvweb2026";
const SESSION_TTL = 8 * 60 * 60 * 1000;

function isSessionValid(){
  try{
    const { expires } = JSON.parse(sessionStorage.getItem(ADMIN_KEY)||"{}");
    return Date.now() < (expires||0);
  }catch{ return false; }
}
function setSession(){ sessionStorage.setItem(ADMIN_KEY, JSON.stringify({ expires: Date.now()+SESSION_TTL })); }
function clearSession(){ sessionStorage.removeItem(ADMIN_KEY); }

function AdminLogin({ onSuccess }){
  const [pwd,setPwd]     = useState("");
  const [error,setError] = useState("");
  const [attempts,setAt] = useState(0);
  const [locked,setLk]   = useState(false);

  const handle = (e) => {
    e.preventDefault();
    if(locked) return;
    if(pwd === ADMIN_PWD){ setSession(); onSuccess(); }
    else{
      const n = attempts+1; setAt(n); setError(`Senha incorreta. (${n}/5)`); setPwd("");
      if(n>=5){ setLk(true); setError("Bloqueado por 1 minuto.");
        setTimeout(()=>{ setLk(false);setAt(0);setError(""); },60000); }
    }
  };

  return (
    <div style={{width:"100%",height:"100vh",background:"#0a0c12",display:"flex",
      alignItems:"center",justifyContent:"center",
      fontFamily:"'Segoe UI','Roboto',-apple-system,sans-serif"}}>
      <div style={{background:"#14161e",borderRadius:12,padding:40,width:360,
        border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 20px 60px rgba(0,0,0,0.6)"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:48,marginBottom:12}}>📺</div>
          <div style={{fontSize:22,fontWeight:800,color:"#fff"}}>TVWEB Admin</div>
          <div style={{fontSize:13,color:"#666",marginTop:4}}>Área restrita</div>
        </div>
        <form onSubmit={handle} style={{display:"flex",flexDirection:"column",gap:16}}>
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:600,display:"block",
              marginBottom:6,letterSpacing:0.5}}>SENHA DE ACESSO</label>
            <input type="password" value={pwd}
              onChange={e=>{setPwd(e.target.value);setError("");}}
              placeholder="••••••••" disabled={locked} autoFocus
              style={{width:"100%",background:"rgba(255,255,255,0.06)",
                border:error?"1px solid rgba(244,67,54,0.6)":"1px solid rgba(255,255,255,0.1)",
                borderRadius:6,padding:"12px 14px",color:"#fff",fontSize:16,
                outline:"none",boxSizing:"border-box",letterSpacing:4}}/>
          </div>
          {error && <div style={{padding:"10px 14px",background:"rgba(244,67,54,0.1)",
            border:"1px solid rgba(244,67,54,0.25)",borderRadius:6,fontSize:12,color:"#f44336"}}>
            ⚠️ {error}</div>}
          <button type="submit" disabled={locked||!pwd}
            style={{padding:"13px 0",borderRadius:6,border:"none",
              background:locked||!pwd?"#333":"linear-gradient(135deg,#1a73e8,#4fc3f7)",
              color:"#fff",fontSize:14,fontWeight:700,
              cursor:locked||!pwd?"not-allowed":"pointer"}}>
            {locked?"🔒 Bloqueado":"Entrar →"}
          </button>
        </form>
        <div style={{marginTop:24,paddingTop:20,borderTop:"1px solid rgba(255,255,255,0.06)",
          textAlign:"center",fontSize:12,color:"#555"}}>
          Defina via <code style={{color:"#888"}}>VITE_ADMIN_PASSWORD</code>
        </div>
      </div>
    </div>
  );
}

function ProtectedAdmin(){
  const [auth,setAuth] = useState(isSessionValid());
  useEffect(()=>{
    const i=setInterval(()=>{ if(!isSessionValid()) setAuth(false); },60000);
    return()=>clearInterval(i);
  },[]);
  if(!auth) return <AdminLogin onSuccess={()=>setAuth(true)}/>;
  return <Admin onLogout={()=>{clearSession();setAuth(false);}}/>;
}

// ============================================
// BANNER DE INSTALAÇÃO PWA
// ============================================
function PWAInstallBanner(){
  const [show,setShow] = useState(false);

  useEffect(()=>{
    const onInstallable = () => setShow(true);
    const onInstalled   = () => setShow(false);
    window.addEventListener("pwa-installable", onInstallable);
    window.addEventListener("pwa-installed",   onInstalled);
    return ()=>{
      window.removeEventListener("pwa-installable", onInstallable);
      window.removeEventListener("pwa-installed",   onInstalled);
    };
  },[]);

  if(!show) return null;

  return (
    <div style={{position:"fixed",bottom:16,left:"50%",transform:"translateX(-50%)",
      zIndex:9999,background:"#1a1c2a",border:"1px solid rgba(26,115,232,0.4)",
      borderRadius:12,padding:"14px 20px",
      display:"flex",alignItems:"center",gap:14,
      boxShadow:"0 8px 32px rgba(0,0,0,0.6)",
      maxWidth:"calc(100vw - 32px)",width:420,
      animation:"slideUpBanner 0.35s ease"}}>
      <span style={{fontSize:28,flexShrink:0}}>📺</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:2}}>
          Instalar TREND TV
        </div>
        <div style={{fontSize:11,color:"#888"}}>
          Acesse como app — sem abrir o navegador
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexShrink:0}}>
        <button onClick={()=>setShow(false)}
          style={{padding:"7px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,0.1)",
            background:"transparent",color:"#888",cursor:"pointer",fontSize:12}}>
          Agora não
        </button>
        <button onClick={()=>{ window.installPWA?.(); setShow(false); }}
          style={{padding:"7px 14px",borderRadius:6,border:"none",
            background:"linear-gradient(135deg,#1a73e8,#4fc3f7)",
            color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700}}>
          Instalar
        </button>
      </div>
      <style>{`
        @keyframes slideUpBanner{from{opacity:0;transform:translateX(-50%) translateY(16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      `}</style>
    </div>
  );
}

// ============================================
// ROTA /canal/:id → redireciona para /tv?canal=N
// Cada canal tem URL compartilhável (ex: /canal/2)
// ============================================
function CanalRedirect(){ const {id}=useParams(); return <Navigate to={`/tv?canal=${id}`} replace/> }

// ============================================
// APP
// ============================================
export default function App(){
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Home />} />
        <Route path="/tv"        element={<TV />} />
        <Route path="/canal/:id" element={<CanalRedirect />} />
        <Route path="/admin"     element={<ProtectedAdmin />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
      <PWAInstallBanner />
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import TV from "./TV";
import Admin from "./Admin";

// ============================================
// ADMIN AUTH GUARD
// ============================================
const ADMIN_KEY = "tvweb_admin_auth";
const ADMIN_PWD = import.meta.env.VITE_ADMIN_PASSWORD || "tvweb2026";
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

function isSessionValid() {
  try {
    const raw = sessionStorage.getItem(ADMIN_KEY);
    if (!raw) return false;
    const { expires } = JSON.parse(raw);
    return Date.now() < expires;
  } catch {
    return false;
  }
}

function setSession() {
  sessionStorage.setItem(
    ADMIN_KEY,
    JSON.stringify({ expires: Date.now() + SESSION_TTL })
  );
}

function clearSession() {
  sessionStorage.removeItem(ADMIN_KEY);
}

// ============================================
// LOGIN SCREEN
// ============================================
function AdminLogin({ onSuccess }) {
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);

  const handle = (e) => {
    e.preventDefault();
    if (locked) return;

    if (pwd === ADMIN_PWD) {
      setSession();
      onSuccess();
    } else {
      const next = attempts + 1;
      setAttempts(next);
      setError(`Senha incorreta. (${next}/5)`);
      setPwd("");
      if (next >= 5) {
        setLocked(true);
        setError("Muitas tentativas. Tente novamente em 1 minuto.");
        setTimeout(() => {
          setLocked(false);
          setAttempts(0);
          setError("");
        }, 60000);
      }
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: "#0a0c12",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Segoe UI','Roboto',-apple-system,sans-serif",
      }}
    >
      <div
        style={{
          background: "#14161e",
          borderRadius: 12,
          padding: 40,
          width: 360,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📺</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>
            TVWEB Admin
          </div>
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            Área restrita
          </div>
        </div>

        <form onSubmit={handle} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label
              style={{
                fontSize: 11,
                color: "#888",
                fontWeight: 600,
                display: "block",
                marginBottom: 6,
                letterSpacing: 0.5,
              }}
            >
              SENHA DE ACESSO
            </label>
            <input
              type="password"
              value={pwd}
              onChange={(e) => { setPwd(e.target.value); setError(""); }}
              placeholder="••••••••"
              disabled={locked}
              autoFocus
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.06)",
                border: error
                  ? "1px solid rgba(244,67,54,0.6)"
                  : "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "12px 14px",
                color: "#fff",
                fontSize: 16,
                outline: "none",
                boxSizing: "border-box",
                letterSpacing: 4,
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(244,67,54,0.1)",
                border: "1px solid rgba(244,67,54,0.25)",
                borderRadius: 6,
                fontSize: 12,
                color: "#f44336",
              }}
            >
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={locked || !pwd}
            style={{
              padding: "13px 0",
              borderRadius: 6,
              border: "none",
              background:
                locked || !pwd
                  ? "#333"
                  : "linear-gradient(135deg,#1a73e8,#4fc3f7)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: locked || !pwd ? "not-allowed" : "pointer",
              transition: "all 0.2s",
            }}
          >
            {locked ? "🔒 Bloqueado" : "Entrar →"}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
            fontSize: 12,
            color: "#555",
          }}
        >
          A senha é definida via variável{" "}
          <code style={{ color: "#888" }}>VITE_ADMIN_PASSWORD</code>
        </div>
      </div>
    </div>
  );
}

// ============================================
// PROTECTED ROUTE
// ============================================
function ProtectedAdmin() {
  const [auth, setAuth] = useState(isSessionValid());

  // Checa sessão periodicamente
  useEffect(() => {
    const i = setInterval(() => {
      if (!isSessionValid()) setAuth(false);
    }, 60000);
    return () => clearInterval(i);
  }, []);

  if (!auth) {
    return <AdminLogin onSuccess={() => setAuth(true)} />;
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Botão de logout */}
      <button
        onClick={() => { clearSession(); setAuth(false); }}
        title="Sair do Admin"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 9999,
          background: "rgba(244,67,54,0.12)",
          border: "1px solid rgba(244,67,54,0.25)",
          color: "#f44336",
          padding: "6px 12px",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        🔓 Sair
      </button>
      <Admin />
    </div>
  );
}

// ============================================
// APP
// ============================================
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"      element={<TV />} />
        <Route path="/tv"    element={<TV />} />
        <Route path="/admin" element={<ProtectedAdmin />} />
        {/* Redireciona qualquer rota desconhecida para a TV */}
        <Route path="*"      element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";

const INITIAL_CHANNELS = [
  { id: 0, numero: 0, nome: "Sobre", logo: "ℹ️", logoType: "emoji", logoUrl: null, cor: "#78909C", isInfo: true },
  { id: 1, numero: 1, nome: "TV Cultura", logo: "🎭", logoType: "emoji", logoUrl: null, cor: "#2196F3" },
  { id: 2, numero: 2, nome: "CineMax", logo: "🎬", logoType: "emoji", logoUrl: null, cor: "#E91E63" },
  { id: 3, numero: 3, nome: "DocWorld", logo: "🌍", logoType: "emoji", logoUrl: null, cor: "#4CAF50" },
  { id: 4, numero: 4, nome: "MúsicaTV", logo: "🎵", logoType: "emoji", logoUrl: null, cor: "#FF9800" },
  { id: 5, numero: 5, nome: "RetroGames", logo: "🎮", logoType: "emoji", logoUrl: null, cor: "#9C27B0" },
];

const PROGRAMS = {
  0: [
    { id: "info1", nome: "Bem-vindo à TVWEB", sinopse: "Conheça a plataforma. Scroll troca canal. G abre o guia.", duracao: 1800, classificacao: "L", tags: ["HD"] },
    { id: "info2", nome: "Como Funciona", sinopse: "TV em tempo real via streaming. Entre e assista!", duracao: 1800, classificacao: "L", tags: ["HD"] },
    { id: "info3", nome: "Nossos Canais", sinopse: "5 canais temáticos 24h. Use scroll para navegar!", duracao: 1800, classificacao: "L", tags: ["HD"] },
    { id: "info4", nome: "Dicas", sinopse: "G = guia. ↑↓ = canal. ESC fecha. Clique em programas.", duracao: 1800, classificacao: "L", tags: ["HD"] },
  ],
  1: [
    { id: "p1a", nome: "Teatro em Cena", sinopse: "Grandes peças do teatro brasileiro contemporâneo com elenco premiado e direção inovadora.", duracao: 3600, classificacao: "L", tags: ["HD", "DUB"] },
    { id: "p1b", nome: "Arte & Expressão", sinopse: "Documentário sobre artistas plásticos e suas obras que marcaram gerações inteiras.", duracao: 3600, classificacao: "10", tags: ["HD"] },
  ],
  2: [
    { id: "p2a", nome: "Sessão da Tarde", sinopse: "Clássicos do cinema mundial em alta definição para toda a família reunida.", duracao: 3600, classificacao: "L", tags: ["HD", "LEG"] },
    { id: "p2b", nome: "Cinema Noir", sinopse: "O melhor do suspense e mistério dos anos dourados de Hollywood.", duracao: 3600, classificacao: "14", tags: ["HD", "LEG"] },
  ],
  3: [
    { id: "p3a", nome: "Planeta Selvagem", sinopse: "Expedições pelos ecossistemas mais remotos e fascinantes da Terra.", duracao: 3600, classificacao: "L", tags: ["HD", "4K"] },
    { id: "p3b", nome: "Grandes Civilizações", sinopse: "A história das civilizações que moldaram o mundo moderno.", duracao: 3600, classificacao: "L", tags: ["HD"] },
  ],
  4: [
    { id: "p4a", nome: "Palco Aberto", sinopse: "Shows ao vivo dos maiores nomes da música brasileira e internacional.", duracao: 3600, classificacao: "L", tags: ["HD", "5.1"] },
    { id: "p4b", nome: "Clássicos do Rock", sinopse: "Performances lendárias que definiram gerações do rock mundial.", duracao: 3600, classificacao: "L", tags: ["HD"] },
  ],
  5: [
    { id: "p5a", nome: "Arcade Classics", sinopse: "Gameplay e análises dos jogos mais icônicos da história dos videogames.", duracao: 3600, classificacao: "L", tags: ["HD"] },
    { id: "p5b", nome: "Speed Run Masters", sinopse: "Os melhores speedrunners do mundo quebrando recordes ao vivo.", duracao: 3600, classificacao: "10", tags: ["HD"] },
  ],
};

// HELPERS
function getSchedule(chId) {
  const p = PROGRAMS[chId] || [];
  if (!p.length) return [];
  const s = [];
  let c = 0, i = 0;
  while (c < 86400) {
    const x = p[i % p.length];
    const sH = Math.floor(c / 3600), sM = Math.floor((c % 3600) / 60);
    const e = c + x.duracao;
    const eH = Math.floor(e / 3600), eM = Math.floor((e % 3600) / 60);
    s.push({
      ...x,
      id: `${x.id}_${i}`,
      horarioInicio: c,
      horarioFim: e,
      horarioTexto: `${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}`,
      horarioFimTexto: `${String(eH % 24).padStart(2, "0")}:${String(eM).padStart(2, "0")}`
    });
    c = e;
    i++;
  }
  return s;
}

function getNow() {
  const n = new Date();
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
}

function getCurProg(chId) {
  const s = getNow();
  return getSchedule(chId).find(p => s >= p.horarioInicio && s < p.horarioFim);
}

function getElapsed(p) {
  return getNow() - p.horarioInicio;
}

function fT(s) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fD(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, "0") + "min" : ""}` : `${m}min`;
}

const CC = { L: "#0f0", "10": "#00bfff", "12": "#ff0", "14": "#f80", "16": "#f00", "18": "#000" };

function ChLogo({ ch, size = 28 }) {
  if (ch.logoType === "custom" && ch.logoUrl) return <img src={ch.logoUrl} alt="" style={{ width: size, height: size, borderRadius: 4, objectFit: "cover" }} />;
  return <span style={{ fontSize: size * 0.85 }}>{ch.logo}</span>;
}

// SMALL COMPONENTS
function LiveDot() {
  const [v, setV] = useState(true);
  useEffect(() => {
    const i = setInterval(() => setV(x => !x), 800);
    return () => clearInterval(i);
  }, []);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#ff3b3b", opacity: v ? 1 : 0.3, transition: "opacity 0.3s" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff3b3b", boxShadow: "0 0 6px #ff3b3b" }} />
      AO VIVO
    </span>
  );
}

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  const d = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  return (
    <div style={{ color: "#ccc", textAlign: "right", fontSize: 13, lineHeight: 1.3 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>
        {String(t.getHours()).padStart(2, "0")}:{String(t.getMinutes()).padStart(2, "0")}
      </div>
      <div>{d[t.getDay()]} {t.getDate()}/{t.getMonth() + 1}</div>
    </div>
  );
}

function PBar({ program }) {
  const [el, setEl] = useState(0);
  useEffect(() => {
    const u = () => setEl(getElapsed(program));
    u();
    const i = setInterval(u, 1000);
    return () => clearInterval(i);
  }, [program]);
  const pct = Math.min((el / program.duracao) * 100, 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", fontSize: 11, color: "#aaa" }}>
      <span style={{ minWidth: 40, textAlign: "right" }}>{fT(el)}</span>
      <div style={{ flex: 1, height: 4, background: "#333", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg,#1a73e8,#4fc3f7)", borderRadius: 2, transition: "width 1s linear" }} />
      </div>
      <span style={{ minWidth: 40 }}>{fT(program.duracao)}</span>
    </div>
  );
}

function Badge({ c }) {
  return <span style={{ display: "inline-flex", alignItems: "center", justifyCenter: "center", width: 22, height: 22, borderRadius: 4, background: CC[c] || "#888", color: c === "L" || c === "18" ? "#fff" : "#000", fontSize: 10, fontWeight: 800 }}>{c}</span>;
}

function Tag({ t }) {
  const c = { HD: "#1a73e8", "4K": "#e91e63", DUB: "#4caf50", LEG: "#ff9800", "5.1": "#9c27b0" };
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: c[t] || "#555", color: "#fff" }}>{t}</span>;
}

function shareProgram(prog, ch) {
  const text = `📺 ${prog.nome}\n🕐 ${prog.horarioTexto} - ${prog.horarioFimTexto}\n📡 ${ch?.nome || "TVWEB"}\n\n${prog.sinopse || ""}`;
  if (navigator.share) navigator.share({ title: prog.nome, text, url: window.location.href }).catch(() => { });
  else {
    navigator.clipboard?.writeText(text);
    alert("Copiado!");
  }
}

function scheduleNotif(prog, ch, min = 5) {
  const ns = getNow();
  const ts = prog.horarioInicio - min * 60;
  const delay = (ts - ns) * 1000;
  if (delay <= 0) {
    alert("Programa já começou!");
    return;
  }
  if (!("Notification" in window)) {
    alert("Navegador sem suporte.");
    return;
  }
  Notification.requestPermission().then(p => {
    if (p !== "granted") return;
    setTimeout(() => {
      new Notification(`📺 ${prog.nome} em ${min}min!`, { body: `${ch?.nome} · ${prog.horarioTexto}` });
    }, delay);
    alert(`✅ Lembrete: ${min}min antes de "${prog.nome}"`);
  });
}

function FsBtn({ cRef }) {
  const [fs, setFs] = useState(false);
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    const t = setTimeout(() => setPulse(false), 6000);
    return () => {
      document.removeEventListener("fullscreenchange", h);
      clearTimeout(t);
    };
  }, []);
  return <button onClick={() => { if (!document.fullscreenElement) cRef.current?.requestFullscreen?.(); else document.exitFullscreen?.(); }} style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 15, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", color: "#ccc", padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontSize: 11, fontWeight: 600, animation: pulse ? "pulseFull 2s ease infinite" : "none" }}>{fs ? "↙ Sair" : "↗ Tela Cheia"}</button>;
}

// ============================================
// INFO BAR (bottom overlay with channel info)
// ============================================
function InfoBar({ channel, program, nextProgram, onOpenEPG, onOpenFull }) {
  if (!program) return null;
  return (
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10, background: "linear-gradient(transparent, rgba(0,0,0,0.95))", padding: "40px 24px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <ChLogo ch={channel} size={20} /><span style={{ fontSize: 13, color: channel.cor, fontWeight: 700 }}>{channel.nome}</span>
            <Badge c={program.classificacao} />{program.tags?.map(t => <Tag key={t} t={t} />)}<LiveDot />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{program.nome}</div>
          <div style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>{program.horarioTexto} - {program.horarioFimTexto}</div>
          <PBar program={program} />
        </div>
        <Clock />
      </div>
      {nextProgram && <div style={{ marginTop: 8, fontSize: 11, color: "#666" }}>A seguir: <span style={{color: "#aaa"}}>{nextProgram.nome}</span> · {nextProgram.horarioTexto}</div>}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 12 }}>
        <button onClick={onOpenEPG} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "#ccc", padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          ▲ Guia Rápido
        </button>
        <button onClick={onOpenFull} style={{ background: "rgba(26,115,232,0.2)", border: "1px solid rgba(26,115,232,0.3)", color: "#4fc3f7", padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          📺 Programação Completa
        </button>
      </div>
    </div>
  );
}

// ============================================
// EPG COMPACTO (rodapé estilo Globoplay)
// ============================================
function EPGCompact({ channels, currentChannelId, onSelectChannel, onSelectProgram, onOpenFull, onClose }) {
  const now = getNow();
  const scrollRef = useRef(null);
  const ROW_H = 80;
  const PX_PER_HOUR = 320;
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (now / 3600) * PX_PER_HOUR - 300); }, []);

  // Generate time marks every 15 min
  const timeMarks = [];
  for (let i = 0; i < 96; i++) {
    const h = Math.floor(i / 4), m = (i % 4) * 15;
    timeMarks.push({ label: m === 0 ? `${String(h).padStart(2, "0")}:00` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, isFull: m === 0 });
  }

  return (
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20, animation: "slideUp 0.3s ease" }}>
      {/* Header bar */}
      <div style={{ background: "rgba(16,18,26,0.98)", borderTop: "1px solid rgba(255,255,255,0.1)", padding: "10px 20px", display:"flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>GUIA</span>
          <LiveDot />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onOpenFull} style={{ background: "rgba(26,115,232,0.15)", border: "1px solid rgba(26,115,232,0.3)", color: "#4fc3f7", padding: "7px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📺 Ver Completa</button>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#aaa", width: 34, height: 34, borderRadius: "50%", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      </div>

      {/* Grid area */}
      <div style={{ background: "rgba(16,18,26,0.98)", display: "flex", overflow: "hidden", maxHeight: ROW_H * 5 + 40 }}>
        {/* Channel logos column */}
        <div style={{ minWidth: 120, borderRight: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
          <div style={{ height: 30 }} />
          {channels.map(ch => (
            <div key={ch.id} onClick={() => onSelectChannel(ch.id)} style={{
              height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              background: ch.id === currentChannelId ? "rgba(26,115,232,0.1)" : "transparent", transition: "background 0.2s",
            }}>
              <div style={{ textAlign: "center" }}>
                <ChLogo ch={ch} size={32} />
                <div style={{ fontSize: 11, fontWeight: 600, color: ch.id === currentChannelId ? "#fff" : "#999", marginTop: 4 }}>{ch.nome}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Scrollable grid */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
          {/* Time ruler */}
          <div style={{ display: "flex", height: 30, borderBottom: "1px solid rgba(255,255,255,0.1)", position: "relative" }}>
            {timeMarks.map((t, i) => <div key={i} style={{ minWidth: PX_PER_HOUR / 4, fontSize: t.isFull ? 13 : 10, color: t.isFull ? "#bbb" : "#555", padding: "7px 8px", borderLeft: t.isFull ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(255,255,255,0.03)", fontWeight: t.isFull ? 600 : 400 }}>{t.isFull ? t.label : ""}</div>)}
            {/* Now line */}
            <div style={{ position: "absolute", top: 0, bottom: -ROW_H * channels.length, left: (now / 3600) * PX_PER_HOUR, width: 2, background: "#ff3b3b", zIndex: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff3b3b", position: "absolute", top: -2, left: -3 }} />
            </div>
          </div>

          {/* Channel rows */}
          {channels.map(ch => {
            const sched = getSchedule(ch.id);
            const cur = getCurProg(ch.id);
            return (
              <div key={ch.id} style={{ display: "flex", height: ROW_H, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                {sched.filter(p => p.horarioFim <= 86400).map(prog => {
                  const w = Math.max((prog.duracao / 3600) * PX_PER_HOUR, 70);
                  const isNow = cur?.id === prog.id;
                  return (
                    <div key={prog.id} onClick={() => { onSelectChannel(ch.id); onSelectProgram(prog); }}
                      style={{
                        minWidth: w, maxWidth: w, height: ROW_H - 2, padding: "12px 14px", cursor: "pointer", overflow: "hidden",
                        background: isNow ? "rgba(40,44,60,0.9)" : "rgba(30,32,44,0.6)",
                        borderRight: "1px solid rgba(255,255,255,0.06)",
                        display: "flex", flexDirection: "column", justifyCenter: "center", transition: "background 0.2s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = isNow ? "rgba(50,55,75,0.95)" : "rgba(40,44,60,0.8)"}
                      onMouseLeave={e => e.currentTarget.style.background = isNow ? "rgba(40,44,60,0.9)" : "rgba(30,32,44,0.6)"}
                    >
                      {/* Time */}
                      <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>
                        {prog.horarioTexto} - {prog.horarioFimTexto}
                        {isNow && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: "#f44336", color: "#fff" }}>AO VIVO</span>}
                      </div>
                      {/* Program name */}
                      <div style={{ fontSize: 16, fontWeight: 700, color: isNow ? "#fff" : "#ddd", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{prog.nome}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: "rgba(16,18,26,0.98)", padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "center", gap: 24, fontSize: 11, color: "#555" }}>
        <span>↑↓ ou Scroll = Canal</span><span>ESC = Fechar</span><span>G = Guia</span>
      </div>
    </div>
  );
}

// ============================================
// FULL DAY SCHEDULE (tela completa detalhada)
// ============================================
function FullDay({ channels, currentChannelId, onSelectChannel, onClose, onProgramClick }) {
  const [viewCh, setVCh] = useState(currentChannelId);
  const sched = getSchedule(viewCh);
  const ns = getNow();
  const ch = channels.find(c => c.id === viewCh);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.92)", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 720, margin: "0 auto", padding: 20, minHeight: "100vh" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, position: "sticky", top: 0, background: "rgba(0,0,0,0.95)", padding: "16px 0", zIndex: 5 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>📺 Programação Completa</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", width: 40, height: 40, borderRadius: "50%", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {/* Channel tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20, overflowX: "auto", paddingBottom: 8 }}>
          {channels.map(c => (
            <button key={c.id} onClick={() => setVCh(c.id)} style={{
              padding: "10px 18px", borderRadius: 6, cursor: "pointer", flexShrink: 0,
              background: viewCh === c.id ? `${c.cor}33` : "rgba(255,255,255,0.04)",
              border: viewCh === c.id ? `1px solid ${c.cor}` : "1px solid rgba(255,255,255,0.08)",
              color: viewCh === c.id ? "#fff" : "#888", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
            }}><ChLogo ch={c} size={18} /> {c.nome}</button>
          ))}
        </div>

        {/* Programs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sched.filter(p => p.horarioFim <= 86400).map(prog => {
            const isNow = ns >= prog.horarioInicio && ns < prog.horarioFim;
            const isPast = ns >= prog.horarioFim;
            return (
              <div key={prog.id} onClick={() => onProgramClick(prog)} style={{
                display: "flex", gap: 14, padding: "16px 18px", borderRadius: 10, cursor: "pointer",
                background: isNow ? "rgba(26,115,232,0.15)" : isPast ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.04)",
                border: isNow ? "1px solid #1a73e8" : "1px solid rgba(255,255,255,0.06)",
                opacity: isPast ? 0.45 : 1, transition: "all 0.2s",
              }}>
                <div style={{ minWidth: 75, textAlign: "center", paddingTop: 2 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: isNow ? "#4fc3f7" : "#fff" }}>{prog.horarioTexto}</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{prog.horarioFimTexto}</div>
                  {isNow && <div style={{ marginTop: 6 }}><LiveDot /></div>}
                </div>
                <div style={{ width: 3, borderRadius: 2, background: isNow ? ch.cor : "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 600, color: isNow ? "#fff" : "#ccc" }}>{prog.nome}</span>
                    <Badge c={prog.classificacao} />
                    {prog.tags?.map(t => <Tag key={t} t={t} />)}
                  </div>
                  <div style={{ fontSize: 13, color: "#999", lineHeight: 1.6, marginBottom: 6 }}>{prog.sinopse}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>⏱ {fD(prog.duracao)}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, paddingTop: 2 }}>
                  <button onClick={e => { e.stopPropagation(); shareProgram(prog, ch); }} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#aaa", padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }} title="Compartilhar">📤</button>
                  {!isNow && !isPast && <button onClick={e => { e.stopPropagation(); scheduleNotif(prog, ch); }} style={{ background: "rgba(255,152,0,0.1)", border: "1px solid rgba(255,152,0,0.2)", color: "#ff9800", padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }} title="Lembrete">🔔</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================
// PROGRAM DETAIL MODAL
// ============================================
function ProgModal({ program, channel, onClose }) {
  if (!program) return null;
  const isNow = getNow() >= program.horarioInicio && getNow() < program.horarioFim;
  const isFut = getNow() < program.horarioInicio;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1a1c24", borderRadius: 10, maxWidth: 500, width: "100%", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
        <div style={{ height: 140, background: `linear-gradient(135deg,${channel?.cor || "#333"}33,#0a0c12)`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <ChLogo ch={channel || INITIAL_CHANNELS[0]} size={64} />
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 4 }}><Badge c={program.classificacao} />{program.tags?.map(t => <Tag key={t} t={t} />)}</div>
          {isNow && <div style={{ position: "absolute", top: 12, left: 12 }}><LiveDot /></div>}
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: channel?.cor })}>{channel?.nome}</span><span style={{ fontSize: 12, color: "#555" }}>·</span><span style={{ fontSize: 12, color: "#888" }}>Canal {channel?.numero}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{program.nome}</div>
          <div style={{ fontSize: 13, color: "#999", lineHeight: 1.6, marginBottom: 16 }}>{program.sinopse}</div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#666", marginBottom: 16 }}>
            <span>⏰ {program.horarioTexto} - {program.horarioFimTexto}</span><span>⏱ {fD(program.duracao)}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => shareProgram(program, channel)} style={{ flex: 1, padding: 10, background: "rgba(76,175,80,0.15)", border: "1px solid rgba(76,175,80,0.3)", borderRadius: 6, color: "#4caf50", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📤 Compartilhar</button>
            {isFut && <button onClick={() => scheduleNotif(program, channel)} style={{ flex: 1, padding: 10, background: "rgba(255,152,0,0.15)", border: "1px solid rgba(255,152,0,0.3)", borderRadius: 6, color: "#ff9800", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🔔 Lembrete</button>}
            <button onClick={onClose} style={{ flex: 1, padding: 10, background: "rgba(26,115,232,0.2)", border: "1px solid rgba(26,115,232,0.3)", borderRadius: 6, color: "#4fc3f7", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN
// ============================================
export default function TVWeb() {
  const CHANNELS = INITIAL_CHANNELS;
  const [curCh, setCurCh] = useState(1);
  const [showEPG, setEPG] = useState(false);
  const [showFull, setFull] = useState(false);
  const [showInfo, setInfo] = useState(true);
  const [selProg, setSP] = useState(null);
  const [fade, setFade] = useState(false);
  const [tick, setTick] = useState(0);
  const hRef = useRef(null); const cRef = useRef(null); const wRef = useRef(null);

  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const ch = CHANNELS.find(c => c.id === curCh);
  const cp = getCurProg(curCh);
  const sc = getSchedule(curCh);
  const ci = sc.findIndex(p => p.id === cp?.id);
  const np = ci >= 0 ? sc[ci + 1] : null;

  const swCh = useCallback(id => {
    if (id === curCh) return;
    setFade(true);
    setTimeout(() => {
      setCurCh(id);
      setFade(false);
    }, 300);
    setInfo(true);
    rHide();
  }, [curCh]);

  const swDir = useCallback(dir => {
    const i = CHANNELS.findIndex(c => c.id === curCh);
    let n;
    if (dir > 0) n = i < CHANNELS.length - 1 ? CHANNELS[i + 1].id : CHANNELS[0].id;
    else n = i > 0 ? CHANNELS[i - 1].id : CHANNELS[CHANNELS.length - 1].id;
    swCh(n);
  }, [curCh, swCh]);

  const rHide = useCallback(() => {
    clearTimeout(hRef.current);
    setInfo(true);
    hRef.current = setTimeout(() => {
      if (!showEPG && !showFull) setInfo(false);
    }, 5000);
  }, [showEPG, showFull]);

  useEffect(() => {
    rHide();
    return () => clearTimeout(hRef.current);
  }, []);

  useEffect(() => {
    const h = e => {
      if (e.key === "ArrowUp") swDir(-1);
      else if (e.key === "ArrowDown") swDir(1);
      else if (e.key === "Escape") {
        setEPG(false);
        setFull(false);
        setSP(null);
      } else if (e.key === "g" || e.key === "G") {
        if (showFull) {
          setFull(false);
          setEPG(true);
        } else if (showEPG) {
          setEPG(false);
        } else {
          setEPG(true);
        }
      }
      rHide();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [swDir, rHide, showEPG, showFull]);

  const handleWheel = useCallback(e => {
    if (showEPG || showFull) return;
    if (wRef.current) return;
    wRef.current = setTimeout(() => { wRef.current = null; }, 400);
    swDir(e.deltaY > 0 ? 1 : -1);
  }, [swDir, showEPG, showFull]);

  const handleClick = useCallback(() => {
    if (showEPG) {
      setEPG(false);
      return;
    }
    rHide();
  }, [showEPG, rHide]);

  return (
    <div ref={cRef} onWheel={handleWheel} onMouseMove={rHide}
      style={{ width: "100%", height: "100vh", background: "#000", position: "relative", fontFamily: "'Segoe UI','Roboto',-apple-system,sans-serif", overflow: "hidden", cursor: "default", userSelect: "none" }}>

      {/* Screen */}
      <div onClick={handleClick} style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center,${ch?.cor || "#1a73e8"}15,#0a0c12 70%)`, transition: "background 0.5s", opacity: fade ? 0 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", opacity: 0.15 }}><div style={{ fontSize: 100 }}><ChLogo ch={ch || CHANNELS[0]} size={100} /></div><div style={{ fontSize: 24, color: "#fff", marginTop: 8, fontWeight: 700 }}>{ch?.nome}</div></div>
        {ch?.isInfo && cp && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}><div style={{ maxWidth: 600, textAlign: "center" }}><div style={{ fontSize: 48, marginBottom: 16 }}>📺</div><div style={{ fontSize: 28, fontWeight: 700, color: "#fff", marginBottom: 12 }}>{cp.nome}</div><div style={{ fontSize: 16, color: "#999", lineHeight: 1.8 }}>{cp.sinopse}</div></div></div>}
        <div style={{ position: "absolute", top: 16, right: 20, fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.08)", letterSpacing: 2 }}>TVWEB</div>
        {showInfo && <div style={{ position: "absolute", top: 20, left: 20, background: "rgba(0,0,0,0.6)", padding: "6px 14px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{ch?.numero}</span><div><div style={{ fontSize: 13, fontWeight: 600, color: ch?.cor }}>{ch?.nome}</div><div style={{ fontSize: 10, color: "#888" }}>Canal {ch?.numero}</div></div></div>}
      </div>

      {showInfo && <FsBtn cRef={cRef} />}

      {showInfo && !showEPG && !showFull && <div style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", zIndex: 15, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: 0.5 }}>
        <span style={{ fontSize: 16, color: "#888" }}>▲</span><span style={{ writingMode: "vertical-lr", letterSpacing: 2, fontSize: 9, color: "#888" }}>SCROLL</span><span style={{ fontSize: 16, color: "#888" }}>▼</span>
      </div>}

      {/* Info Bar */}
      {showInfo && !showEPG && !showFull && <InfoBar channel={ch} program={cp} nextProgram={np} onOpenEPG={() => setEPG(true)} onOpenFull={() => setFull(true)} />}

      {/* Channel sidebar */}
      <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 15, display: "flex", flexDirection: "column", gap: 4, opacity: showInfo && !showEPG && !showFull ? 0.7 : 0, transition: "opacity 0.3s" }}>
        {CHANNELS.map(c => <div key={c.id} onClick={() => swCh(c.id)} style={{ width: 36, height: 36, borderRadius: 4, background: c.id === curCh ? "rgba(26,115,232,0.3)" : "rgba(0,0,0,0.4)", border: c.id === curCh ? "1px solid #1a73e8" : "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, transition: "all 0.2s", overflow: "hidden" }}><ChLogo ch={c} size={c.logoType === "custom" ? 36: 20} /></div>)}
      </div>

      {/* EPG Compacto (rodapé) */}
      {showEPG && <EPGCompact channels={CHANNELS} currentChannelId={curCh} onSelectChannel={swCh} onSelectProgram={setSP} onOpenFull={() => { setEPG(false); setFull(true); }} onClose={() => setEPG(false)} />}

      {/* Full Day (tela completa) */}
      {showFull && <FullDay channels={CHANNELS} currentChannelId={curCh} onSelectChannel={swCh} onClose={() => setFull(false)} onProgramClick={setSP} />}

      {/* Modal detalhes */}
      {selProg && <ProgModal program={selProg} channel={CHANNELS.find(c => getSchedule(c.id).some(p => p.nome === selProg.nome))} onClose={() => setSP(null)} />}

      <style>{`
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes pulseFull{0%,100%{opacity:.6;transform:translateX(-50%) scale(1)}50%{opacity:1;transform:translateX(-50%) scale(1.05)}}
        ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:rgba(255,255,255,.02)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
        *{box-sizing:border-box;margin:0;padding:0}
      `}</style>
    </div>
  );
}

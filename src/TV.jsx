import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";

/* =========================
   HELPERS
========================= */

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getNowSeconds() {
  const n = new Date();
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
}

/* =========================
   FIREBASE SCHEDULE ENGINE
========================= */

function getScheduleFromFirebase(channelId, programs) {
  const list = programs.filter(p => p.canalId === channelId);

  if (!list.length) return [];

  const sorted = [...list].sort((a, b) => a.horarioInicio - b.horarioInicio);

  return sorted.map(p => ({
    ...p,
    horarioTexto: formatTime(p.horarioInicio),
    horarioFimTexto: formatTime(p.horarioFim)
  }));
}

function getCurrentProgram(channelId, programs) {
  const now = getNowSeconds();
  const schedule = getScheduleFromFirebase(channelId, programs);

  return schedule.find(
    p => now >= p.horarioInicio && now < p.horarioFim
  );
}

/* =========================
   CHANNELS (podem virar Firebase depois)
========================= */

const CHANNELS = [
  { id: 1, numero: 1, nome: "TV Cultura", cor: "#2196F3", logo: "🎭" },
  { id: 2, numero: 2, nome: "CineMax", cor: "#E91E63", logo: "🎬" },
  { id: 3, numero: 3, nome: "DocWorld", cor: "#4CAF50", logo: "🌍" },
  { id: 4, numero: 4, nome: "MúsicaTV", cor: "#FF9800", logo: "🎵" },
  { id: 5, numero: 5, nome: "RetroGames", cor: "#9C27B0", logo: "🎮" }
];

/* =========================
   MAIN TV
========================= */

export default function TVWeb() {
  const [channelId, setChannelId] = useState(1);
  const [programs, setPrograms] = useState([]);
  const [tick, setTick] = useState(0);

  const containerRef = useRef(null);

  /* LIVE CLOCK */
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  /* LOAD FIREBASE (SINCRONIZAÇÃO TV ↔ PAINEL) */
  useEffect(() => {
    async function load() {
      const snap = await getDocs(collection(db, "programs"));
      const data = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setPrograms(data);
    }

    load();

    // refresh leve pra simular live TV
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  /* CURRENT DATA */
  const channel = CHANNELS.find(c => c.id === channelId);
  const currentProgram = getCurrentProgram(channelId, programs);
  const schedule = getScheduleFromFirebase(channelId, programs);

  const currentIndex = schedule.findIndex(
    p => p.id === currentProgram?.id
  );

  const nextProgram =
    currentIndex >= 0 ? schedule[currentIndex + 1] : null;

  /* CHANNEL SWITCH */
  const switchChannel = useCallback((id) => {
    setChannelId(id);
  }, []);

  /* WHEEL NAV */
  const handleWheel = useCallback((e) => {
    const idx = CHANNELS.findIndex(c => c.id === channelId);

    if (e.deltaY > 0) {
      const next = idx < CHANNELS.length - 1 ? idx + 1 : 0;
      setChannelId(CHANNELS[next].id);
    } else {
      const prev = idx > 0 ? idx - 1 : CHANNELS.length - 1;
      setChannelId(CHANNELS[prev].id);
    }
  }, [channelId]);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      style={{
        width: "100%",
        height: "100vh",
        background: "#000",
        color: "#fff",
        fontFamily: "Arial",
        position: "relative",
        overflow: "hidden"
      }}
    >

      {/* SCREEN */}
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle, ${channel?.cor}22, #000)`
      }}>
        <div style={{ textAlign: "center", opacity: 0.2 }}>
          <div style={{ fontSize: 90 }}>{channel?.logo}</div>
          <div style={{ fontSize: 24 }}>{channel?.nome}</div>
        </div>

        {currentProgram && (
          <div style={{
            position: "absolute",
            textAlign: "center",
            maxWidth: 600
          }}>
            <div style={{ fontSize: 40 }}>📺</div>
            <div style={{ fontSize: 28, fontWeight: "bold" }}>
              {currentProgram.nome}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>
              {currentProgram.sinopse}
            </div>
          </div>
        )}
      </div>

      {/* INFO TOP LEFT */}
      <div style={{
        position: "absolute",
        top: 20,
        left: 20,
        background: "rgba(0,0,0,0.5)",
        padding: 10,
        borderRadius: 6
      }}>
        <div style={{ fontSize: 20 }}>{channel?.numero}</div>
        <div style={{ fontSize: 12 }}>{channel?.nome}</div>
      </div>

      {/* NEXT PROGRAM */}
      {nextProgram && (
        <div style={{
          position: "absolute",
          bottom: 20,
          left: 20,
          fontSize: 12,
          opacity: 0.6
        }}>
          Próximo: {nextProgram.nome}
        </div>
      )}

      {/* CHANNEL LIST */}
      <div style={{
        position: "absolute",
        right: 10,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}>
        {CHANNELS.map(c => (
          <div
            key={c.id}
            onClick={() => switchChannel(c.id)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: c.id === channelId ? c.cor : "#111",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer"
            }}
          >
            {c.logo}
          </div>
        ))}
      </div>

    </div>
  );
}

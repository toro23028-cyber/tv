import { useState, useEffect } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  setDoc,
  doc,
  deleteDoc,
  onSnapshot
} from "firebase/firestore";

function fmtSec(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function genDates(n) {
  const ds = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    ds.push(d.toISOString().split("T")[0]);
  }
  return ds;
}

export default function AdminPanel() {
  const dates = genDates(30);

  const [selDate, setSelDate] = useState(dates[0]);
  const [selCh, setSelCh] = useState(1);
  const [programs, setProgs] = useState([]);
  const [showModal, setSM] = useState(false);
  const [editProg, setEP] = useState(null);

  const notify = (m) => alert(m);

  // REALTIME LOAD FIRESTORE
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "programs"), (snap) => {
      const data = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      setProgs(data);
    });
    return () => unsub();
  }, []);

  const handleSave = async (p) => {
    try {
      if (p.id) {
        // Update
        await setDoc(doc(db, "programs", p.id), p);
      } else {
        // Create - Deixa o Firebase gerar o ID automático
        const { id, ...newData } = p;
        await addDoc(collection(db, "programs"), newData);
      }

      notify("Salvo no Firebase com sucesso!");
      setSM(false);
      setEP(null);
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar");
    }
  };

  const handleDel = async (id) => {
    try {
      await deleteDoc(doc(db, "programs", id));
      notify("Removido");
    } catch (err) {
      console.error(err);
      alert("Erro ao deletar");
    }
  };

  // Garante a comparação correta convertendo o canalId para Número
  const dayProgs = programs.filter(p =>
    p.data === selDate && Number(p.canalId) === Number(selCh)
  );

  return (
    <div style={{ padding: 20, fontFamily: "Arial", color: "#fff", background: "#222", minHeight: "100vh" }}>
      <h2>TV Admin (Firebase ativo)</h2>

      <div style={{ margin: "15px 0", display: "flex", gap: "10px" }}>
        <select value={selDate} onChange={e => setSelDate(e.target.value)}>
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <select value={selCh} onChange={e => setSelCh(e.target.value)}>
          <option value={1}>Canal 1 - TV Cultura</option>
          <option value={2}>Canal 2 - CineMax</option>
          <option value={3}>Canal 3 - DocWorld</option>
          <option value={4}>Canal 4 - MúsicaTV</option>
          <option value={5}>Canal 5 - RetroGames</option>
        </select>
      </div>

      <button onClick={() => setSM(true)} style={{ padding: "8px 16px", cursor: "pointer" }}>
        + Novo Programa
      </button>

      <hr style={{ margin: "20px 0", opacity: 0.3 }} />

      {dayProgs.length === 0 && (
        <p>Nenhum programa nesse dia/canal</p>
      )}

      {dayProgs.map(p => (
        <div key={p.id} style={{
          padding: 15,
          border: "1px solid #444",
          background: "#333",
          marginBottom: 8,
          borderRadius: 6
        }}>
          <b>{p.nome}</b>
          <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>
            {fmtSec(p.horarioInicio)} - {fmtSec(p.horarioFim)}
          </div>

          <div style={{ marginTop: 10 }}>
            <button onClick={() => { setEP(p); setSM(true); }}>Editar</button>
            <button onClick={() => handleDel(p.id)} style={{ marginLeft: 8, background: "#d9534f", color: "#fff", border: "none", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}>
              Deletar
            </button>
          </div>
        </div>
      ))}

      {showModal && (
        <ProgramModal
          program={editProg}
          selDate={selDate}
          selCh={selCh}
          onSave={handleSave}
          onClose={() => {
            setSM(false);
            setEP(null);
          }}
        />
      )}
    </div>
  );
}

function ProgramModal({ program, selDate, selCh, onSave, onClose }) {
  const [nome, setNome] = useState(program?.nome || "");
  const [sinopse, setSinopse] = useState(program?.sinopse || "");

  const save = () => {
    if (!nome) return alert("Digite o nome do programa");
    onSave({
      id: program?.id || null,
      nome,
      sinopse: sinopse || "Sem sinopse disponível.",
      data: program?.data || selDate,
      canalId: Number(selCh),
      horarioInicio: 0, 
      horarioFim: 86400 
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyCenter: "center", display: "flex", justifyContent: "center" }}>
      <div style={{ background: "#fff", padding: 25, borderRadius: 8, color: "#000", width: 300, margin: "auto" }}>
        <h3>{program ? "Editar Programa" : "Novo Programa"}</h3>
        <br />
        <input
          style={{ width: "100%", padding: 6, marginBottom: 10 }}
          value={nome}
          onChange={e => setNome(e.target.value)}
          placeholder="Nome do programa"
        />
        <input
          style={{ width: "100%", padding: 6, marginBottom: 10 }}
          value={sinopse}
          onChange={e => setSinopse(e.target.value)}
          placeholder="Sinopse"
        />
        <p style={{ fontSize: 11, color: "#666" }}>Agendado para o dia todo (00:00 - 24:00)</p>
        <br />
        <button onClick={save} style={{ padding: "6px 12px", background: "#2196F3", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Salvar</button>
        <button onClick={onClose} style={{ marginLeft: 8, padding: "6px 12px" }}>Cancelar</button>
      </div>
    </div>
  );
}

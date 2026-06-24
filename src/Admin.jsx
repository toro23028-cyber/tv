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

/* =========================
   HELPERS
========================= */

function fmtSec(s){
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

// Gera as datas no formato local puro YYYY-MM-DD para evitar conflitos de fuso horário internacional
function genDates(n){
  const ds=[];
  const now=new Date();
  for(let i=0;i<n;i++){
    const d=new Date(now);
    d.setDate(now.getDate()+i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    ds.push(`${yyyy}-${mm}-${dd}`);
  }
  return ds;
}

/* =========================
   MAIN
========================= */

export default function AdminPanel(){

  const dates = genDates(30);

  const [selDate,setSelDate]=useState(dates[0]);
  const [selCh,setSelCh]=useState(1);

  const [programs,setProgs]=useState([]);
  const [showModal,setSM]=useState(false);
  const [editProg,setEP]=useState(null);

  const notify = (m) => alert(m);

  /* =========================
     🔥 REALTIME LOAD FIRESTORE
  ========================= */

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

  /* =========================
     💾 SAVE (CREATE / UPDATE)
  ========================= */

  const handleSave = async (p) => {
    try {
      if (editProg) {
        // Atualiza usando o ID existente do Firestore
        await setDoc(doc(db, "programs", p.id), p);
      } else {
        // Criação: Remove o campo id nulo para o Firestore gerar o id aleatório sozinho
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

  /* =========================
     🗑 DELETE
  ========================= */

  const handleDel = async (id) => {
    try {
      await deleteDoc(doc(db, "programs", id));
      notify("Removido");
    } catch (err) {
      console.error(err);
      alert("Erro ao deletar");
    }
  };

  /* =========================
     FILTER (Normalizando IDs dos canais para número)
  ========================= */

  const dayProgs = programs.filter(p =>
    p.data === selDate && Number(p.canalId) === Number(selCh)
  );

  /* =========================
     UI
  ========================= */

  return (
    <div style={{padding:20,fontFamily:"Arial"}}>

      <h2>TV Admin (Firebase ativo)</h2>

      {/* Selects adicionados para você poder navegar e criar itens nos canais e datas corretas */}
      <div style={{ margin: "15px 0", display: "flex", gap: "10px" }}>
        <select value={selDate} onChange={e => setSelDate(e.target.value)} style={{ padding: 6 }}>
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <select value={selCh} onChange={e => setSelCh(e.target.value)} style={{ padding: 6 }}>
          <option value={1}>Canal 1 - TV Cultura</option>
          <option value={2}>Canal 2 - CineMax</option>
          <option value={3}>Canal 3 - DocWorld</option>
          <option value={4}>Canal 4 - MúsicaTV</option>
          <option value={5}>Canal 5 - RetroGames</option>
        </select>
      </div>

      <button onClick={()=>setSM(true)}>
        + Novo Programa
      </button>

      <hr/>

      {dayProgs.length === 0 && (
        <p>Nenhum programa nesse dia/canal</p>
      )}

      {dayProgs.map(p => (
        <div key={p.id} style={{
          padding:10,
          border:"1px solid #ccc",
          marginBottom:8
        }}>
          <b>{p.nome}</b>

          <div>
            {fmtSec(p.horarioInicio)} - {fmtSec(p.horarioFim)}
          </div>

          <div style={{marginTop:6}}>
            <button onClick={()=>{
              setEP(p);
              setSM(true);
            }}>
              Editar
            </button>

            <button
              onClick={()=>handleDel(p.id)}
              style={{marginLeft:8}}
            >
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
          onClose={()=>{
            setSM(false);
            setEP(null);
          }}
        />
      )}

    </div>
  );
}

/* =========================
   MODAL
========================= */

function ProgramModal({program, selDate, selCh, onSave, onClose}){

  const [nome,setNome]=useState(program?.nome||"");

  const save=()=>{
    onSave({
      id: program?.id || null,
      nome,
      sinopse: program?.sinopse || "Programa enviado via Painel.",
      data: program?.data || selDate, // Associa à data visualizada no painel
      canalId: Number(selCh),         // Salva como tipo numérico estável
      horarioInicio: 0,               // 00:00h em segundos
      horarioFim: 86400               // 24:00h em segundos (Garante que fique no ar o dia todo para testes)
    });
  };

  return (
    <div style={{
      position:"fixed",
      inset:0,
      background:"rgba(0,0,0,0.6)",
      display:"flex",
      alignItems:"center",
      justifyContent:"center"
    }}>
      <div style={{
        background:"#fff",
        padding:20,
        borderRadius:8,
        color: "#000"
      }}>

        <h3>Programa</h3>

        <input
          value={nome}
          onChange={e=>setNome(e.target.value)}
          placeholder="Nome"
        />

        <br/><br/>

        <button onClick={save}>
          Salvar
        </button>

        <button onClick={onClose} style={{marginLeft:8}}>
          Cancelar
        </button>

      </div>
    </div>
  );
}

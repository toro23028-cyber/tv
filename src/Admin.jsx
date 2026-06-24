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

function genDates(n){
  const ds=[];
  const now=new Date();
  for(let i=0;i<n;i++){
    const d=new Date(now);
    d.setDate(now.getDate()+i);
    ds.push(d.toISOString().split("T")[0]);
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

        await setDoc(doc(db, "programs", p.id), p);

        setProgs(prev =>
          prev.map(x => x.id === p.id ? p : x)
        );

      } else {

        const ref = await addDoc(collection(db, "programs"), p);

        setProgs(prev => [
          ...prev,
          { ...p, id: ref.id }
        ]);
      }

      notify("Salvo no Firebase");

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

      setProgs(prev =>
        prev.filter(p => p.id !== id)
      );

      notify("Removido");

    } catch (err) {
      console.error(err);
      alert("Erro ao deletar");
    }
  };

  /* =========================
     FILTER
  ========================= */

  const dayProgs = programs.filter(p =>
    p.data === selDate && p.canalId === selCh
  );

  /* =========================
     UI
  ========================= */

  return (
    <div style={{padding:20,fontFamily:"Arial"}}>

      <h2>TV Admin (Firebase ativo)</h2>

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

function ProgramModal({program,onSave,onClose}){

  const [nome,setNome]=useState(program?.nome||"");

  const save=()=>{
    onSave({
      id: program?.id || `prog_${Date.now()}`,
      nome,
      data: "2026-06-24",
      canalId: 1,
      horarioInicio: 0,
      horarioFim: 3600
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
        borderRadius:8
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

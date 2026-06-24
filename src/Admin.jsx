import { useState, useEffect, useCallback, useRef } from "react";
import {
  db
} from "./firebase";

import {
  collection,
  addDoc,
  setDoc,
  doc,
  getDocs,
  deleteDoc
} from "firebase/firestore";

/* =========================
   CONSTANTES (mantidas)
========================= */

const DURATION_PRESETS = [
  { label:"15min", value:900 },{ label:"30min", value:1800 },{ label:"40min", value:2400 },
  { label:"45min", value:2700 },{ label:"1h", value:3600 },{ label:"1h30", value:5400 },
  { label:"2h", value:7200 },{ label:"Custom", value:0 },
];

const CLASSIF_OPTIONS = ["L","10","12","14","16","18"];

const CC = {
  L:"#0f0","10":"#00bfff","12":"#ff0","14":"#f80","16":"#f00","18":"#111"
};

/* =========================
   HELPERS
========================= */

function fmtSec(s){
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  return`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`
}

function secTo(s){
  return{h:Math.floor(s/3600),m:Math.floor((s%3600)/60)}
}

function parseDur(h,m){
  return(parseInt(h)||0)*3600+(parseInt(m)||0)*60
}

function genDates(n){
  const ds=[];
  const now=new Date();
  for(let i=0;i<n;i++){
    const d=new Date(now);
    d.setDate(now.getDate()+i);
    ds.push(d.toISOString().split("T")[0])
  }
  return ds
}

/* =========================
   MAIN
========================= */

export default function AdminPanel(){

  const dates=genDates(30);

  const [tab,setTab]=useState("schedule");
  const [selDate,setSelDate]=useState(dates[0]);
  const [selCh,setSelCh]=useState(1);

  const [programs,setProgs]=useState([]);
  const [channels,setCh]=useState([
    {id:1,numero:1,nome:"Canal 1",cor:"#2196F3"},
    {id:2,numero:2,nome:"Canal 2",cor:"#E91E63"}
  ]);

  const [showModal,setSM]=useState(false);
  const [editProg,setEP]=useState(null);

  const notify = (m) => alert(m);

  /* =========================
     🔥 LOAD FIRESTORE
  ========================= */

  useEffect(() => {
    async function load() {
      const snap = await getDocs(collection(db, "programs"));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProgs(data);
    }

    load();
  }, []);

  /* =========================
     💾 SAVE (CREATE / UPDATE)
  ========================= */

  const handleSave = async (p) => {

    if (editProg) {
      await setDoc(doc(db, "programs", p.id), p);

      setProgs(programs.map(x =>
        x.id === p.id ? p : x
      ));

    } else {
      const ref = await addDoc(collection(db, "programs"), p);

      setProgs([
        ...programs,
        { ...p, id: ref.id }
      ]);
    }

    notify(editProg ? "Atualizado no Firebase" : "Salvo no Firebase");

    setSM(false);
    setEP(null);
  };

  /* =========================
     🗑 DELETE
  ========================= */

  const handleDel = async (id) => {
    await deleteDoc(doc(db, "programs", id));
    setProgs(programs.filter(p => p.id !== id));
    notify("Removido do Firebase");
  };

  /* =========================
     FILTER
  ========================= */

  const dayProgs = programs.filter(p =>
    p.data === selDate && p.canalId === selCh
  );

  /* =========================
     UI SIMPLIFICADA (mantém sua base)
  ========================= */

  return (
    <div style={{padding:20,fontFamily:"Arial"}}>

      <h2>TV Admin (Firebase conectado)</h2>

      <button onClick={()=>setSM(true)}>
        + Novo Programa
      </button>

      <hr/>

      {dayProgs.map(p=>(
        <div key={p.id} style={{padding:10,border:"1px solid #ccc",marginBottom:8}}>
          <b>{p.nome}</b><br/>
          {fmtSec(p.horarioInicio)} - {fmtSec(p.horarioFim)}

          <div style={{marginTop:6}}>
            <button onClick={()=>{setEP(p);setSM(true)}}>
              Editar
            </button>

            <button onClick={()=>handleDel(p.id)} style={{marginLeft:8}}>
              Deletar
            </button>
          </div>
        </div>
      ))}

      {showModal && (
        <ProgramModal
          program={editProg}
          onSave={handleSave}
          onClose={()=>{setSM(false);setEP(null)}}
        />
      )}
    </div>
  );
}

/* =========================
   MODAL SIMPLIFICADO
========================= */

function ProgramModal({program,onSave,onClose}){

  const [nome,setNome]=useState(program?.nome||"");

  const save=()=>{
    onSave({
      id:program?.id || `prog_${Date.now()}`,
      nome,
      data:"2026-06-24",
      canalId:1,
      horarioInicio:0,
      horarioFim:3600
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

      <div style={{background:"#fff",padding:20}}>
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

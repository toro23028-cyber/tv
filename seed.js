import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, getDocs, deleteDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_AUTH_DOMAIN",
  projectId: "tvweb-71058",
  storageBucket: "SEU_BUCKET",
  messagingSenderId: "SEU_ID",
  appId: "SEU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* =========================
   CLEAN DATABASE (opcional)
========================= */
async function clearCollection(name){
  const snap = await getDocs(collection(db, name));
  for (const doc of snap.docs) {
    await deleteDoc(doc.ref);
  }
}

/* =========================
   SEED DATA
========================= */

const channels = [
  { nome:"TV Cultura", numero:1, cor:"#2196F3", logo:"🎭", ativo:true },
  { nome:"CineMax", numero:2, cor:"#E91E63", logo:"🎬", ativo:true },
  { nome:"DocWorld", numero:3, cor:"#4CAF50", logo:"🌍", ativo:true },
];

const programs = [
  { nome:"Sessão da Tarde", sinopse:"Filmes clássicos", duracao:3600, classificacao:"L" },
  { nome:"Documentário Global", sinopse:"História e ciência", duracao:3600, classificacao:"10" },
  { nome:"Cinema Premium", sinopse:"Filmes de ação e drama", duracao:3600, classificacao:"14" },
];

/* =========================
   HELPERS
========================= */

function rand(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

/* cria 24h de programação automática */
function generateSchedule(channelId, programIds){
  const schedule = [];
  let start = 0;

  while (start < 86400) {
    const programId = rand(programIds);
    const duration = 3600;

    schedule.push({
      channelId,
      programId,
      data: new Date().toISOString().split("T")[0],
      start,
      end: start + duration
    });

    start += duration;
  }

  return schedule;
}

/* =========================
   RUN SEED
========================= */

async function run(){

  console.log("🔥 Limpando banco...");

  await clearCollection("channels");
  await clearCollection("programs");
  await clearCollection("schedules");

  console.log("📺 Criando channels...");
  const channelIds = [];

  for (const c of channels){
    const ref = await addDoc(collection(db,"channels"), c);
    channelIds.push(ref.id);
  }

  console.log("🎬 Criando programs...");
  const programIds = [];

  for (const p of programs){
    const ref = await addDoc(collection(db,"programs"), p);
    programIds.push(ref.id);
  }

  console.log("📅 Criando schedules...");

  for (const chId of channelIds){
    const sched = generateSchedule(chId, programIds);

    for (const s of sched){
      await addDoc(collection(db,"schedules"), s);
    }
  }

  console.log("✅ SEED FINALIZADO COM SUCESSO!");
  console.log("TV pronta pra rodar 🔥");
}

run();

import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDVPcI9Gfxmox_3k0H68_MnPO_TgLMVc2A",
  authDomain: "tvweb-71058.firebaseapp.com",
  projectId: "tvweb-71058",
  storageBucket: "tvweb-71058.appspot.com",
  messagingSenderId: "325260348531",
  appId: "1:325260348531:web:45e9468625cbe3b8d4ae06"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Helper exports
export { collection, doc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy };

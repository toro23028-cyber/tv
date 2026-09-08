import {getAuth} from "firebase/auth";
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, writeBatch, runTransaction, getDoc, waitForPendingWrites } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCt0t7IvYYPMXTfXB1zZ6AB4Na9JpL50EQ",
  authDomain: "tvweb-71058.firebaseapp.com",
  projectId: "tvweb-71058",
  storageBucket: "tvweb-71058.appspot.com",
  messagingSenderId: "325260348531",
  appId: "1:325260348531:web:45e9468625cbe3b8d4ae06"
};

// A configuração Firebase é pública; a autorização é imposta por firestore.rules.
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()}),
  ignoreUndefinedProperties:true
});
export const auth = getAuth(app);

// Helper exports
export { collection, doc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, writeBatch, runTransaction, getDoc, waitForPendingWrites };

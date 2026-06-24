import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "SUA_CHAVE",
  authDomain: "tvweb-71058.firebaseapp.com",
  projectId: "tvweb-71058",
  storageBucket: "tvweb-71058.appspot.com",
  messagingSenderId: "SUA_ID",
  appId: "SUA_APP_ID"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

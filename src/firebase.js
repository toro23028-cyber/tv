import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "tvweb-71058.firebaseapp.com",
  projectId: "tvweb-71058",
  storageBucket: "tvweb-71058.firebasestorage.app",
  messagingSenderId: "325260348531",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

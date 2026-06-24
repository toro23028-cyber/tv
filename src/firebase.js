import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCt0t7IvYYPMXTfXB1zZ6AB4Na9JpL50EQ",
  authDomain: "tvweb-71058.firebaseapp.com",
  projectId: "tvweb-71058",
  storageBucket: "tvweb-71058.appspot.com",
  messagingSenderId: "325260348531",
  appId: "1:325260348531:web:45e9468625cbe3b8d4ae06"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

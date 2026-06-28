// js/firebase.js
// Single Firebase init point. Every other module imports db/auth from here
// instead of calling initializeApp again. Keys are untouched from the
// original file — do not change these.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDree7ssZ9P5FANfbgvIpfR5lHDaptuhd0",
    authDomain: "planner-80105.firebaseapp.com",
    projectId: "planner-80105",
    storageBucket: "planner-80105.firebasestorage.app",
    messagingSenderId: "1024783200665",
    appId: "1:1024783200665:web:3aca9a491c3e15159ee308",
    measurementId: "G-T50128ZWTZ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };

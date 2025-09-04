
// assets/firebase-init.js (요지)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


const app = initializeApp({
  apiKey: "AIzaSyD5M5IxzxEIdnNzky3ZijElrEP8clYX31Y",
  authDomain: "jeonjolhyup.firebaseapp.com",
  projectId: "jeonjolhyup",
  storageBucket: "jeonjolhyup.firebasestorage.app",
  appId: "1:547424969197:web:92044afa9f174d6eda87e4",
});

const db = getFirestore(app);
const auth = getAuth(app);

// reCAPTCHA (visible)
window.__recaptcha = new RecaptchaVerifier(auth, 'recaptcha-container', {
  size: 'normal'
});

window.__app = app;
window.__db  = db;
window.__auth = auth;
window.__signInWithPhoneNumber = signInWithPhoneNumber;
window.__onAuthStateChanged = onAuthStateChanged;

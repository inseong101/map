// assets/firebase-init.js
import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ↓ 너의 Firebase 설정으로 교체
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "jeonjolhyup",
  storageBucket: "jeonjolhyup.firebasestorage.app",
  appId: "...",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
window.__app = app;
window.__db  = getFirestore(app);

// assets/firebase-init.js
import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "jeonjolhyup.firebaseapp.com",
  projectId: "jeonjolhyup",
  storageBucket: "jeonjolhyup.firebasestorage.app",
  appId: "YOUR_APP_ID",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
window.__app = app;
window.__db  = getFirestore(app);

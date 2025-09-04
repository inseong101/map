// assets/firebase-init.js
import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD5M5IxzxEIdnNzky3ZijElrEP8clYX31Y",
  authDomain: "jeonjolhyup.firebaseapp.com",
  projectId: "jeonjolhyup",
  storageBucket: "jeonjolhyup.firebasestorage.app",
  appId: "1:547424969197:web:92044afa9f174d6eda87e4",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
window.__app = app;
window.__db  = getFirestore(app);

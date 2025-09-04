// assets/firebase-init.js (type="module"로 로드되는 파일)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const firebaseConfig = {
  apiKey: "AIzaSyD5M5IxzxEIdnNzky3ZijElrEP8clYX31Y",
  authDomain: "jeonjolhyup.firebaseapp.com",
  projectId: "jeonjolhyup",
  storageBucket: "jeonjolhyup.firebasestorage.app",
  appId: "1:547424969197:web:92044afa9f174d6eda87e4",
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// 전역 노출
window.__app = app;
window.__db  = db;

// ✅ 준비 완료 Promise (script.js에서 await 가능)
window.__dbReady = Promise.resolve(true);

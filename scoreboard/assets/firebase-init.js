// assets/firebase-init.js
// Firebase SDK (Compat)를 index.html에서 먼저 로드해야 합니다.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "jeonjolhyup",
  storageBucket: "jeonjolhyup.firebasestorage.app",
  // 필요하면 나머지 키도 그대로 추가
};

firebase.initializeApp(firebaseConfig);
window.__db = firebase.firestore(); // 전역 Firestore 핸들

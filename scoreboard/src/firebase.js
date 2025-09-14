// scoreboard/src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";  // getFirestore → initializeFirestore
import { getFunctions } from "firebase/functions";

// 🔧 이미 쓰시던 프로젝트 값 그대로 유지
const firebaseConfig = {
  apiKey: "AIzaSyD5M5IxzxEIdnNzky3ZijElrEP8clYX31Y",
  authDomain: "jeonjolhyup.firebaseapp.com",
  projectId: "jeonjolhyup",
  storageBucket: "jeonjolhyup.firebasestorage.app",
  appId: "1:547424969197:web:92044afa9f174d6eda87e4",
};

const app = initializeApp(firebaseConfig);

// us-central1에 함수가 있으니 region 지정
export const auth = getAuth(app);

// 🔧 Firestore 초기화 시 옵션 추가
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
});

export const functions = getFunctions(app, "us-central1");

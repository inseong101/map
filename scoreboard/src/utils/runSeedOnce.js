// src/utils/runSeedOnce.js
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "../firebase";
import { signInAnonymously } from "firebase/auth";

export async function runSeedOnce() {
  // 중복 실행 방지 (로컬 브라우저에 깃발 저장)
  if (localStorage.getItem("seed_phone_bindings_done") === "yes") {
    return { skipped: true, message: "이미 실행됨" };
  }

  // 익명 로그인 보장
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  const functions = getFunctions();
  const seedFn = httpsCallable(functions, "seedPhoneBindingsAll");
  const res = await seedFn({});
  localStorage.setItem("seed_phone_bindings_done", "yes");
  return res.data; // { ok: true, message: "총 120명 phoneBindings 설정 완료" }
}

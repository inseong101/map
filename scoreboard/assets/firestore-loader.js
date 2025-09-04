// assets/firestore-loader.js
// 점수 총문항(고정)
const SUBJECT_TOTALS = {
  "간":16,"심":16,"비":16,"폐":16,"신":16,"상한":16,"사상":16,
  "침구":48,"보건":20,"외과":16,"신경":16,"안이비":16,
  "부인과":32,"소아":24,"예방":24,"생리":16,"본초":16
};

// Firestore에서 이미 집계된 구조(scores/{sid})가 있으면 그걸 우선 사용.
// 없고 wrongQuestions만 있을 때는(키맵 없으면) 교시별 합계만 계산해서 “종합”으로 보여줌.
async function fetchRoundFromFirestore(sid, roundLabel){
  const { getDoc, doc, collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  // 1) scores/{sid}에 rounds 구조가 있으면 그대로 사용
  const sref = doc(window.__db, "scores", sid);
  const snap = await getDoc(sref);
  if (snap.exists() && snap.data()?.rounds?.[roundLabel]) {
    // 이미 백엔드에서 계산해둔 모양을 normalizeRound가 처리할 수 있게 래핑
    const r = snap.data().rounds[roundLabel]; // { total_questions, total_correct, group_results, overall_pass ... }
    return r; // normalizeRound가 새 스키마(total_questions 등) 지원
  }

  // 2) fallback: wrongQuestions만 있을 때 교시별 총득점만 계산(과목 세부는 키맵 없으면 불가)
  // 컬렉션 경로: wrongQuestions/{sid}/{roundLabel}/(교시문서들)
  const klassCol = collection(window.__db, "wrongQuestions", sid, roundLabel);
  const klassSnaps = await getDocs(klassCol);

  let total_questions = 0;
  let total_correct = 0;

  // 교시별로 오답 배열이 들어있다고 가정: { wrong: [문항번호...] }
  klassSnaps.forEach(docSnap=>{
    const data = docSnap.data() || {};
    const wrong = Array.isArray(data.wrong) ? data.wrong.length : 0;
    const qcount = Number(data.total) || Number(data.totalQuestions) || 80; // 교시 총문항(엑셀 구조에 맞게 필요시 수정)
    total_questions += qcount;
    total_correct   += Math.max(0, qcount - wrong);
  });

  return {
    total_questions,
    total_correct,
    overall_pass: total_correct >= Math.ceil(340 * 0.6), // 전체 컷 기준(필요시 340→수정)
    group_results: [] // 키맵 없으면 과목/그룹 세부는 생략
  };
}

// 기존 폼 submit 가로채서 Firestore 데이터로 렌더
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#lookup-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const $sid = document.querySelector("#sid");
    const sid = ($sid?.value || "").replace(/\D/g,"").slice(0,6);
    if (sid.length !== 6) return;

    try {
      // 두 회차 시도
      const r1 = await fetchRoundFromFirestore(sid, "1차");
      const r2 = await fetchRoundFromFirestore(sid, "2차");

      // 네가 만든 기존 렌더 함수 재사용
      if (window.renderResult) {
        // normalize는 script.js 안에서 처리
        window.renderResult(sid, window.normalizeRound?.(r1) || r1, window.normalizeRound?.(r2) || r2);
        document.querySelector("#view-home")?.classList.add("hidden");
        document.querySelector("#view-result")?.classList.remove("hidden");
      }
    } catch (err) {
      console.error(err);
      alert("Firestore에서 점수를 불러오지 못했습니다.");
    }
  }, { capture: true });
});

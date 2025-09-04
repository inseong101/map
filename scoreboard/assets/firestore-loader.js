// assets/firestore-loader.js

// 1) 과목 총문항(고정 합 340)
const SUBJECT_TOTALS = {
  "간":16,"심":16,"비":16,"폐":16,"신":16,"상한":16,"사상":16,
  "침구":48,"보건":20,"외과":16,"신경":16,"안이비":16,
  "부인과":32,"소아":24,"예방":24,"생리":16,"본초":16
};

// 2) 그룹 정의(그룹 과락 = 그룹 내 총문항의 40% 미만이면 과락)
const GROUPS = {
  "그룹1": ["간","심","비","폐","신","상한","사상"],         // 112문항
  "그룹3": ["침구"],                                         // 48
  "그룹2": ["보건"],                                         // 20
  "그룹4": ["외과","신경","안이비"],                         // 48
  "그룹5": ["부인과","소아"],                                // 56
  "그룹6": ["예방","생리","본초"],                           // 56
};

// 3) 교시별 문항번호 → 과목 매핑표 (여기만 네 규칙대로 채우면 됨)
//   - 예시: 4교시만 네가 말한대로 넣어 둠. 나머지 1~3교시는 TODO 주석을 네 실규칙대로 채워줘.
//   - 범위는 [시작, 끝] (모두 포함, 1부터 시작)
const CLASS_MAP = {
  "1교시": [
    {range:[1,16],  subject:"간"},
    {range:[17,32], subject:"심"},
    {range:[33,48], subject:"비"},
    {range:[49,64], subject:"폐"},
    {range:[65,80], subject:"폐"},
  ],
  "2교시": [
    {range:[1,16],  subject:"상한"},
    {range:[17,32], subject:"사상"},
    {range:[33,80], subject:"침구"},
    {range:[81,100], subject:"법규"},
  ],
  "3교시": [
    {range:[1,16],  subject:"외과"},
    {range:[17,32], subject:"신경"},
    {range:[33,48], subject:"안이비"},
    {range:[49,80], subject:"부인과"},
  ],
  "4교시": [
    {range:[1,24],  subject:"소아"},
    {range:[25,48], subject:"예방"},
    {range:[49,64], subject:"생리"},
    {range:[65,80], subject:"본초"},
  ],
};

// 4) 유틸
function pct(n,d){ return d ? Math.round((n/d)*100) : 0; }
function sum(arr){ return arr.reduce((a,b)=>a+b,0); }

// 5) wrongQuestions → 과목별 득점 복원
// wrongByClass: { "1교시": {wrong:[...], total:숫자}, ... }
function buildSubjectScoresFromWrong(wrongByClass){
  const subjectCorrect = {};
  const subjectMax = {};

  // 초기화
  Object.keys(SUBJECT_TOTALS).forEach(s=>{
    subjectCorrect[s] = 0;
    subjectMax[s] = SUBJECT_TOTALS[s];
  });

  // 교시별로 처리
  Object.entries(wrongByClass).forEach(([klass, data])=>{
    const wrongList = Array.isArray(data?.wrong) ? data.wrong : [];
    const map = CLASS_MAP[klass] || [];

    map.forEach(({range:[st,en], subject})=>{
      // 이 구간의 총문항
      const blockMax = en - st + 1;
      // 이 구간에서 틀린 문항 수
      const wrongInBlock = wrongList.filter(q => q >= st && q <= en).length;
      // 맞은 개수
      const got = Math.max(0, blockMax - wrongInBlock);

      if (!(subject in subjectCorrect)) {
        subjectCorrect[subject] = 0;
        subjectMax[subject] = 0;
      }
      subjectCorrect[subject] += got;
      subjectMax[subject] += blockMax; // SUBJECT_TOTALS가 정확하면 이 줄은 생략 가능
    });
  });

  // SUBJECT_TOTALS가 “시험 전체 기준”으로 정확하면, subjectMax는 SUBJECT_TOTALS를 그대로 사용하도록 고정
  Object.keys(subjectMax).forEach(s=>{
    subjectMax[s] = SUBJECT_TOTALS[s] ?? subjectMax[s];
    // 혹시 과목이 맵에 없지만 wrong에 나타났을 수 있으니 방어
    if (subjectCorrect[s] > subjectMax[s]) subjectCorrect[s] = subjectMax[s];
  });

  return { subjectCorrect, subjectMax };
}

// 6) 과목 점수 → 그룹 집계 및 합불 판정
function aggregateToGroupResults(subjectCorrect, subjectMax){
  const results = [];
  Object.entries(GROUPS).forEach(([gname, subs])=>{
    const gScore = sum(subs.map(s=>subjectCorrect[s] ?? 0));
    const gMax   = sum(subs.map(s=>subjectMax[s] ?? 0));
    const cutoff = Math.ceil(gMax * 0.4);   // 그룹 과락 40%
    const isFail = gScore < cutoff;

    results.push({
      name: gname,
      total: gMax,
      correct: gScore,
      cutoff,
      is_fail: isFail
    });
  });
  return results;
}

// 7) Firestore에서 wrongQuestions 불러오기 → round 결과로 변환
async function buildRoundFromWrong(sid, roundLabel){
  const {
    collection, getDocs
  } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const klassCol = collection(window.__db, "wrongQuestions", sid, roundLabel);
  const klassSnaps = await getDocs(klassCol);

  // 교시별 wrong/total 모으기
  const wrongByClass = {};
  klassSnaps.forEach(docSnap=>{
    const d = docSnap.data() || {};
    const wrong = Array.isArray(d.wrong) ? d.wrong : [];
    const total = Number(d.total) || Number(d.totalQuestions) || 0;
    wrongByClass[docSnap.id] = { wrong, total };
  });

  // 과목 복원
  const { subjectCorrect, subjectMax } = buildSubjectScoresFromWrong(wrongByClass);

  // 총점/총문항
  const total_questions = sum(Object.values(SUBJECT_TOTALS));
  const total_correct   = sum(Object.keys(SUBJECT_TOTALS).map(s => subjectCorrect[s] ?? 0));

  // 그룹 집계
  const group_results = aggregateToGroupResults(subjectCorrect, subjectMax);

  // 평락(전체 60%) & 그룹 과락(하나라도 is_fail이면 true)
  const overall_cutoff = Math.ceil(total_questions * 0.6);
  const overall_pass   = total_correct >= overall_cutoff && !group_results.some(g=>g.is_fail);

  return {
    total_questions,
    total_correct,
    overall_cutoff,
    overall_pass,
    group_results,
    round_pass: overall_pass
  };
}

// 8) scores/{sid}에 집계가 이미 있으면 그대로 쓰고, 없으면 wrongQuestions로 계산
async function fetchRoundFromFirestore(sid, roundLabel){
  const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  // 우선 scores/{sid}에 rounds가 있으면 그걸 사용
  const sref = doc(window.__db, "scores", sid);
  const snap = await getDoc(sref);
  if (snap.exists() && snap.data()?.rounds?.[roundLabel]) {
    return snap.data().rounds[roundLabel];
  }
  // 없으면 wrongQuestions로 계산
  return await buildRoundFromWrong(sid, roundLabel);
}

// 9) 폼 submit 훅: 렌더링
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#lookup-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const $sid = document.querySelector("#sid");
    const sid = ($sid?.value || "").replace(/\D/g,"").slice(0,6);
    if (sid.length !== 6) return;

    try {
      const r1 = await fetchRoundFromFirestore(sid, "1차");
      const r2 = await fetchRoundFromFirestore(sid, "2차");

      // 너의 기존 script.js 안 normalizeRound가 새 스키마를 지원하므로 그대로 사용 가능
      const norm1 = (window.normalizeRound?.(r1)) || r1;
      const norm2 = (window.normalizeRound?.(r2)) || r2;

      // 화면 표시
      window.renderResult?.(sid, norm1, norm2);
      document.querySelector("#view-home")?.classList.add("hidden");
      document.querySelector("#view-result")?.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      alert("Firestore에서 점수를 불러오지 못했습니다.");
    }
  }, { capture: true });
});

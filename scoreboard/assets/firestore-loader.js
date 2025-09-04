// assets/firestore-loader.js
(() => {
  // 0) script.js 가 미리 노출한 전역 사용
  const SUBJECT_TOTALS = window.__SUBJECT_TOTALS; // {간:16, ...}
  const GROUPS_DEF     = window.__GROUPS_DEF;     // [{id:"그룹1", subjects:[...]}, ...]

  // 1) 교시별 문항→과목 매핑 (★ 1~3교시는 실제 규칙으로 꼭 바꾸세요)
  const CLASS_MAP = {
    "1교시": [
      {range:[1,16],  subject:"간"},
      {range:[17,32], subject:"심"},
      {range:[33,48], subject:"비"},
      {range:[49,64], subject:"폐"},
      {range:[65,80], subject:"신"}, // ← 임시. 실제 규칙으로 수정
    ],
    "2교시": [
      {range:[1,16],  subject:"상한"},
      {range:[17,32], subject:"사상"},
      {range:[33,80], subject:"침구"},
      // {range:[81,100], subject:"법규"}, // 없으면 주석 그대로
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

  // 2) 유틸
  const sum = (arr)=>arr.reduce((a,b)=>a+b,0);

  // wrong 필드가 배열/문자열/객체 등 다양한 케이스 방어 파서
  function parseWrongList(d){
    let raw =
      d?.wrong ??
      d?.wrongs ??
      d?.wrongQuestions ??
      d?.wrong_list ??
      null;

    if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);

    if (typeof raw === "string") {
      return raw.split(/[^0-9]+/).map(Number).filter(Number.isFinite);
    }

    if (raw && typeof raw === "object") {
      return Object.keys(raw).map(Number).filter(Number.isFinite);
    }

    return [];
  }

  // 3) wrongQuestions → 과목 득점 복원
  function buildSubjectScoresFromWrong(wrongByClass){
    const subjectCorrect = {};
    const subjectMax = {};

    Object.keys(SUBJECT_TOTALS).forEach(s=>{
      subjectCorrect[s] = 0;
      subjectMax[s] = SUBJECT_TOTALS[s];
    });

    Object.entries(wrongByClass).forEach(([klass, data])=>{
      const wrongList = (Array.isArray(data?.wrong) ? data.wrong : [])
        .map(v => Number(v))
        .filter(v => Number.isFinite(v));

      const map = CLASS_MAP[klass] || [];
      map.forEach(({range:[st,en], subject})=>{
        const blockMax = en - st + 1;
        const wrongInBlock = wrongList.filter(q => q >= st && q <= en).length;
        const got = Math.max(0, blockMax - wrongInBlock);
        if (!(subject in subjectCorrect)) subjectCorrect[subject] = 0;
        subjectCorrect[subject] += got;
      });
    });

    // 방어
    Object.keys(subjectMax).forEach(s=>{
      if (subjectCorrect[s] > subjectMax[s]) subjectCorrect[s] = subjectMax[s];
    });

    return { subjectCorrect, subjectMax };
  }

  // 4) 과목 → 그룹 집계
  function aggregateToGroupResults(subjectCorrect, subjectMax){
    const results = [];
    GROUPS_DEF.forEach(g=>{
      const subs = g.subjects;
      const gScore = sum(subs.map(s=>subjectCorrect[s] ?? 0));
      const gMax   = sum(subs.map(s=>subjectMax[s] ?? 0));
      const cutoff = Math.ceil(gMax * 0.4); // 40%
      const isFail = gScore < cutoff;
      results.push({ name: g.id, total: gMax, correct: gScore, cutoff, is_fail: isFail });
    });
    return results;
  }

  // 5) wrongQuestions → round 스냅샷 (★ subject_results 포함해 반환)
 // 🔁 여러 라벨 후보를 시도
const ROUND_ALIASES = {
  "1차": ["1차","회차1","1","round1","first","1차시험"],
  "2차": ["2차","회차2","2","round2","second","2차시험"],
};

async function buildRoundFromWrong(sid, roundLabel){
  const { collection, getDocs } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const debug = new URLSearchParams(location.search).get("debug") === "1";
  const wrongByClass = {};
  let pickedLabel = null;

  // ◀ 라벨 후보를 순서대로 시도
  const candidates = ROUND_ALIASES[roundLabel] || [roundLabel];
  for (const label of candidates){
    const colRef = collection(window.__db, "wrongQuestions", sid, label);
    const snaps  = await getDocs(colRef);

    if (debug) console.log(`[WRONG] try round='${label}' -> docs:`, snaps.size);
    if (!snaps.empty){
      pickedLabel = label;
      snaps.forEach(docSnap=>{
        const d = docSnap.data() || {};
        const rawId = String(docSnap.id || "");
        const m = rawId.match(/(\d)/);               // "1", "1 교시", "교시1" → "1교시"
        const klassId = m ? `${m[1]}교시` : rawId;

        const wrong = (Array.isArray(d.wrong) ? d.wrong : [])
          .map(v => Number(v)).filter(v => Number.isFinite(v));
        const total = Number(d.total) || Number(d.totalQuestions) || 0;

        wrongByClass[klassId] = { wrong, total };
        if (debug) console.log(`  · ${klassId} wrong=${wrong.length}, total=${total}`);
      });
      break; // 첫 성공 지점에서 종료
    }
  }

  if (debug && !pickedLabel){
    console.warn(`[WRONG] round '${roundLabel}' 의 어떤 후보에서도 문서가 없음:`, candidates);
  }

  // 과목 집계
  const { subjectCorrect, subjectMax } = buildSubjectScoresFromWrong(wrongByClass);

  const total_questions = Object.values(window.__SUBJECT_TOTALS).reduce((a,b)=>a+b,0);
  const total_correct   = Object.keys(window.__SUBJECT_TOTALS)
                              .reduce((a,s)=>a+(subjectCorrect[s]||0),0);

  const group_results = aggregateToGroupResults(subjectCorrect, subjectMax);
  const overall_cutoff = Math.ceil(total_questions * 0.6);
  const overall_pass = total_correct >= overall_cutoff && !group_results.some(g=>g.is_fail);

  if (debug){
    console.log(`[WRONG] pickedLabel='${pickedLabel}' total_correct=${total_correct}/${total_questions}`);
    console.log(`[WRONG] group_results=`, group_results);
  }

  return {
    total_questions,
    total_correct,
    overall_cutoff,
    overall_pass,
    group_results,
    round_pass: overall_pass
  };
}
  // 6) scores 우선, 없으면 wrongQuestions 계산
 async function fetchRoundFromFirestore(sid, roundLabel){
  const { getDoc, doc } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const debug = new URLSearchParams(location.search).get("debug") === "1";
  const sref = doc(window.__db, "scores", sid);
  const snap = await getDoc(sref);

  if (snap.exists() && snap.data()?.rounds?.[roundLabel]) {
    if (debug) console.log(`[SCORES] use scores/${sid}.rounds['${roundLabel}']`);
    return snap.data().rounds[roundLabel];
  }

  if (debug) console.log(`[SCORES] fallback to wrongQuestions/${sid}/… for '${roundLabel}'`);
  return await buildRoundFromWrong(sid, roundLabel);
}

  // 7) 폼 submit → 렌더
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("#lookup-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const $sid = document.querySelector("#sid");
      const sid = ($sid?.value || "").replace(/\D/g,"").slice(0,6);
      if (sid.length !== 6) return;

      try {
        // Firestore에서 1·2차 가져오기 (scores 우선)
        const r1 = await fetchRoundFromFirestore(sid, "1차");
        const r2 = await fetchRoundFromFirestore(sid, "2차");

        // script.js의 normalizeRound 사용 (subject_results 지원)
        const norm1 = (window.normalizeRound?.(r1)) || r1;
        const norm2 = (window.normalizeRound?.(r2)) || r2;

        // 렌더
        window.renderResult?.(sid, norm1, norm2);
        document.querySelector("#view-home")?.classList.add("hidden");
        document.querySelector("#view-result")?.classList.remove("hidden");
      } catch (err) {
        console.error(err);
        alert("Firestore에서 점수를 불러오지 못했습니다.");
      }
    }, { capture: true });
  });
})();

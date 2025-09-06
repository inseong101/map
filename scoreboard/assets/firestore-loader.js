// assets/firestore-loader.js
(() => {
  // 0) script.js 가 미리 노출한 전역 사용
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
      {range:[81,100], subject:"보건"},
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
  function normalizeKlassId(rawId){
    const s = String(rawId || "");
    const m = s.match(/(\d)/);
    return m ? `${m[1]}교시` : s;
  }
  function toNumberArray(arr){
    return Array.isArray(arr) ? arr.map(v=>Number(v)).filter(v=>Number.isFinite(v)) : [];
  }
  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function roundMatches(roundField, candidates){
    const f = String(roundField).trim().toLowerCase();
    return candidates.some(c => String(c).trim().toLowerCase() === f);
  }
  function addWrong(bucket, klassId, wrong, total){
    if (!bucket[klassId]) bucket[klassId] = { wrong: [], total: 0 };
    if (total) bucket[klassId].total = Math.max(bucket[klassId].total, total);
    const set = new Set([...(bucket[klassId].wrong||[]), ...wrong]);
    bucket[klassId].wrong = Array.from(set);
  }

  // 3) wrongQuestions → 과목 득점 복원
  function buildSubjectScoresFromWrong(wrongByClass){
    const SUBJECT_TOTALS = window.__SUBJECT_TOTALS || {};
    const subjectCorrect = {};
    const subjectMax = {};

    Object.keys(SUBJECT_TOTALS).forEach(s=>{
      subjectCorrect[s] = 0;
      subjectMax[s] = SUBJECT_TOTALS[s];
    });

    Object.entries(wrongByClass || {}).forEach(([klass, data])=>{
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

  // 5) 라운드 이름 후보
  const ROUND_ALIASES = {
    "1차": ["1차","회차1","1","round1","first","1차시험"],
    "2차": ["2차","회차2","2","round2","second","2차시험"],
  };

  // 6) ★ scores_raw/{round}/{klass}/{sid} 먼저 시도
async function readFromScoresRaw(sid, roundLabel, wrongByClass, debug){
  const { doc, getDoc } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const klasses = ["1교시","2교시","3교시","4교시"];
  let hit = 0;

  for (const klass of klasses){
    const dref = doc(window.__db, "scores_raw", roundLabel, klass, sid);
    const snap = await getDoc(dref);
    
    if (debug) console.log(`[TRY scores_raw] scores_raw/${roundLabel}/${klass}/${sid} exists?`, snap.exists());
    
    if (!snap.exists()) continue;

    const d = snap.data() || {};
    
    // 🔍 실제 데이터 구조 확인 - 이 로그가 핵심입니다!
    console.log(`[DEBUG scores_raw] ${roundLabel}/${klass}/${sid} 전체 데이터:`, d);
    console.log(`[DEBUG scores_raw] ${roundLabel}/${klass}/${sid} wrongQuestions:`, d.wrongQuestions);
    console.log(`[DEBUG scores_raw] ${roundLabel}/${klass}/${sid} 전체 키:`, Object.keys(d));

    const wrong = toNumberArray(d.wrongQuestions || d.wrong || []);
    const total = num(d.totalQuestions || d.total || 0);
    
    console.log(`[DEBUG parsed] ${roundLabel}/${klass} - wrong:`, wrong, 'total:', total);
    
    addWrong(wrongByClass, klass, wrong, total);
    hit++;
  }
  
  console.log(`[DEBUG final] ${roundLabel} wrongByClass:`, wrongByClass);
  return hit;
}

  // 7) wrongQuestions → round 스냅샷
  async function buildRoundFromWrong(sid, roundLabel){
    const { collection, getDocs } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const debug = new URLSearchParams(location.search).get("debug") === "1";
    const wrongByClass = {};

    // (0) scores_raw 먼저
    let hit = await readFromScoresRaw(sid, roundLabel, wrongByClass, debug);
    if (hit === 0) {
      const cands = ROUND_ALIASES[roundLabel] || [roundLabel];
      for (const alt of cands){
        if (alt === roundLabel) continue;
        hit = await readFromScoresRaw(sid, alt, wrongByClass, debug);
        if (hit > 0) break;
      }
    }

    // (1) 그래도 없으면 wrongQuestions 여러 구조 시도
    if (hit === 0){
      const roundCandidates = ROUND_ALIASES[roundLabel] || [roundLabel];

      const shapes = [
        // A) wrongQuestions/{sid}/{round}/{klass}
        async (label) => {
          const col = collection(window.__db, "wrongQuestions", sid, label);
          const snaps = await getDocs(col);
          if (debug) console.log(`[TRY A] wrongQuestions/${sid}/${label} -> ${snaps.size} docs`);
          snaps.forEach(docSnap=>{
            const d = docSnap.data() || {};
            const klassId = normalizeKlassId(docSnap.id);
            const wrong = toNumberArray(d.wrong);
            const total = num(d.total) || num(d.totalQuestions) || 0;
            addWrong(wrongByClass, klassId, wrong, total);
          });
          return snaps.size;
        },
        // B) wrongQuestions/{round}/{sid}/{klass}
        async (label) => {
          const col = collection(window.__db, "wrongQuestions", label, sid);
          const snaps = await getDocs(col);
          if (debug) console.log(`[TRY B] wrongQuestions/${label}/${sid} -> ${snaps.size} docs`);
          snaps.forEach(docSnap=>{
            const d = docSnap.data() || {};
            const klassId = normalizeKlassId(docSnap.id);
            const wrong = toNumberArray(d.wrong);
            const total = num(d.total) || num(d.totalQuestions) || 0;
            addWrong(wrongByClass, klassId, wrong, total);
          });
          return snaps.size;
        },
        // C) wrongQuestions/{sid}/{klass} (문서 내 round 필드 필터)
        async (_label) => {
          const col = collection(window.__db, "wrongQuestions", sid);
          const snaps = await getDocs(col);
          if (debug) console.log(`[TRY C] wrongQuestions/${sid} -> ${snaps.size} docs`);
          let used = 0;
          const candidates = ROUND_ALIASES[roundLabel] || [roundLabel];
          snaps.forEach(docSnap=>{
            const d = docSnap.data() || {};
            const roundField = (d.round ?? d.roundLabel ?? d.회차 ?? d["round_label"]);
            if (!roundField) return;
            if (!roundMatches(roundField, candidates)) return;
            const klassId = normalizeKlassId(docSnap.id);
            const wrong = toNumberArray(d.wrong);
            const total = num(d.total) || num(d.totalQuestions) || 0;
            addWrong(wrongByClass, klassId, wrong, total);
            used++;
          });
          if (debug) console.log(`[TRY C] filtered-by-round -> ${used} docs`);
          return used;
        },
        // D) wrongQuestions/{sid}/rounds/{round}/{klass}
        async (label) => {
          const col = collection(window.__db, "wrongQuestions", sid, "rounds", label);
          const snaps = await getDocs(col);
          if (debug) console.log(`[TRY D] wrongQuestions/${sid}/rounds/${label} -> ${snaps.size} docs`);
          snaps.forEach(docSnap=>{
            const d = docSnap.data() || {};
            const klassId = normalizeKlassId(docSnap.id);
            const wrong = toNumberArray(d.wrong);
            const total = num(d.total) || num(d.totalQuestions) || 0;
            addWrong(wrongByClass, klassId, wrong, total);
          });
          return snaps.size;
        },
      ];

      let foundAny = 0;
      for (const label of (ROUND_ALIASES[roundLabel] || [roundLabel])){
        for (const tryShape of shapes){
          const found = await tryShape(label);
          if (found > 0) { foundAny += found; break; }
        }
        if (foundAny > 0) break;
      }
      if (debug && foundAny === 0){
        console.warn(`[WRONG] '${roundLabel}' 어떤 구조에서도 문서가 없음. candidates=`, (ROUND_ALIASES[roundLabel] || [roundLabel]));
      }
    }

    // === 집계 ===
    const SUBJECT_TOTALS = window.__SUBJECT_TOTALS || {};
    const { subjectCorrect, subjectMax } = buildSubjectScoresFromWrong(wrongByClass || {});
    const total_questions = Object.values(SUBJECT_TOTALS).reduce((a,b)=>a+b,0);
    const total_correct   = Object.keys(SUBJECT_TOTALS).reduce((a,s)=>a+(subjectCorrect[s]||0),0);
    const group_results   = aggregateToGroupResults(subjectCorrect, subjectMax);

    // 과목별 결과 배열
    const subject_results = Object.keys(SUBJECT_TOTALS).map(name => ({
      name,
      correct: subjectCorrect[name] || 0,
      total:   SUBJECT_TOTALS[name] || 0,
    }));

    const overall_cutoff = Math.ceil(total_questions * 0.6);
    const overall_pass   = total_correct >= overall_cutoff && !group_results.some(g=>g.is_fail);

    return {
      total_questions,
      total_correct,
      overall_cutoff,
      overall_pass,
      group_results,
      subject_results,
      round_pass: overall_pass
    };
  } // ←←← ★★★ 여기 닫는 중괄호가 꼭 필요합니다! (이게 없어서 Unexpected token)

  // 8) scores 우선, 없으면 wrongQuestions 계산
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

  // 9) script.js에서 호출할 수 있도록 전역으로 노출 (IIFE 내부에서!)
  window.fetchRoundFromFirestore = fetchRoundFromFirestore;
})();

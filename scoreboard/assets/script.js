/* =========================================================
   전졸협 성적 SPA 스크립트 (오프라인 + Firestore 호환)
   - 학수번호 입력 → SCORE_DATA(오프라인) 또는 Firestore 계산 결과 → 렌더
   - 요구사항:
     1) 과목별 고정 문항수(총 340) 강제
     2) 그룹별(그룹 총점 기준) 40% 과락
     3) 그룹 박스: 과락 빨강 / 통과 초록
     4) 그룹1 과목 줄 나눔(간심비폐신 / 상한 사상)
     5) 새 스키마(subject_results, group_results) 및 기존(by_class) 호환
   ========================================================= */

/* --------------------------
   0) 과목별 문항 수(고정) / 그룹 정의
   총점 = 340 (변경 시 SUBJECT_MAX만 수정)
--------------------------- */
const SUBJECT_MAX = {
  "간":16, "심":16, "비":16, "폐":16, "신":16,
  "상한":16, "사상":16,
  "침구":48,
  "보건":20,
  "외과":16, "신경":16, "안이비":16,
  "부인과":32, "소아":24,
  "예방":24, "생리":16, "본초":16
};

// 표시 순서: 1 → 3 → 2 → 4 → 5 → 6
const GROUPS = [
  { id: "그룹1", label: "그룹 1", subjects: ["간","심","비","폐","신","상한","사상"], layoutChunks: [5,2], span: 12 },
  { id: "그룹3", label: "그룹 3", subjects: ["침구"], span: 6 },
  { id: "그룹2", label: "그룹 2", subjects: ["보건"], span: 6 },
  { id: "그룹4", label: "그룹 4", subjects: ["외과","신경","안이비"], span: 12 },
  { id: "그룹5", label: "그룹 5", subjects: ["부인과","소아"], span: 6 },
  { id: "그룹6", label: "그룹 6", subjects: ["예방","생리","본초"], span: 6 },
];

// 모든 과목 목록(렌더/합계에 사용)
const ALL_SUBJECTS = GROUPS.flatMap(g => g.subjects);

/* --------------------------
   1) 데이터 로드/인덱스 (오프라인 데이터 대비)
--------------------------- */
window.SCORE_DATA = window.SCORE_DATA || {};
(function buildIndex(){
  const idx = {};
  for (const k of Object.keys(window.SCORE_DATA)) {
    const six = String(k).replace(/\D/g,'').padStart(6,'0');
    idx[six] = window.SCORE_DATA[k];
  }
  window.__SCORE_INDEX__ = idx;
})();
function getStudentById(id6){
  return (window.__SCORE_INDEX__ && window.__SCORE_INDEX__[id6]) || window.SCORE_DATA[id6] || null;
}

/* --------------------------
   2) DOM/유틸
--------------------------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const RECENT_KEY = "jjh_recent_ids";

function fmt(n, digits=0){
  if (n === undefined || n === null || n === "" || isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ko-KR", {maximumFractionDigits:digits});
}
function pct(score, max){
  const s = Number(score)||0, m = Number(max)||0;
  if (m <= 0) return 0;
  return Math.round((s / m) * 100);
}
function pill(text, type){
  const cls = type === 'ok' ? 'pill green' : (type === 'warn' ? 'pill warn' : 'pill red');
  return `<span class="${cls}">${text}</span>`;
}
function showError(msg){
  const err = $("#error");
  if (!err) return;
  err.textContent = msg;
  err.classList.remove("hidden");
}
function hideError(){
  const err = $("#error");
  if (!err) return;
  err.textContent = "";
  err.classList.add("hidden");
}
function saveRecent(id){
  try{
    const prev = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const next = [id, ...prev.filter(v => v !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }catch(_){}
}
function scanHistory(){
  const box = $("#recent");
  if (!box) return;
  const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  box.innerHTML = "";
  if(list.length === 0){
    showError("최근 기록이 없습니다. 학수번호를 입력해 주세요.");
    return;
  }
  list.forEach(id=>{
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.textContent = id;
    btn.onclick = ()=>{
      const sid = $("#sid");
      if (sid) sid.value = id;
      const form = $("#lookup-form");
    };
    box.appendChild(btn);
  });
  box.classList.remove("hidden");
}

/* --------------------------
   3) 키 호환/정규화
--------------------------- */
function pickKey(obj, candidates){
  if (!obj || typeof obj !== "object") return null;
  for (const key of candidates){
    if (key in obj) return key;
  }
  const map = Object.keys(obj).reduce((acc,k)=>{
    const norm = String(k).toLowerCase().replace(/[\s_]/g,'');
    acc[norm] = k;
    return acc;
  }, {});
  for (const key of candidates){
    const norm = String(key).toLowerCase().replace(/[\s_]/g,'');
    if (norm in map) return map[norm];
  }
  return null;
}

// 새 스키마(subject_results | group_results) 또는 기존(by_class) → 표준형으로
function normalizeRound(raw){
  if (!raw || typeof raw !== 'object') return null;

  // ★ 새 스키마: total_questions/total_correct + subject_results(우선) 또는 group_results
  if ('total_questions' in raw && 'total_correct' in raw) {
    const groups = {};

    if (Array.isArray(raw.subject_results) && raw.subject_results.length){
      // 과목별 스냅샷 그대로 사용
      raw.subject_results.forEach(s=>{
        const nm = s.name;
        groups[nm] = {
          score: Number(s.correct)||0,
          max:   SUBJECT_MAX[nm] ?? (Number(s.total)||0)
        };
      });
    } else if (Array.isArray(raw.group_results)) {
      // (참고) group_results만으로는 과목 칩에 바로 매핑하기 어려움 → 과락 배지 정도만 가능
      // 필요 시 그룹→과목 분해 로직 추가 가능
    }

    return {
      total: { score: 0, max: 0 }, // 과목 합으로 재계산
      pass:  !!(raw.overall_pass ?? raw.round_pass ?? raw.pass),
      fails: [],
      by_class: { "종합": { total: {score:0, max:0}, groups } }
    };
  }

  // 기존 스키마 호환
  const byClassKey = pickKey(raw, ["by_class","byClass","classes","sections"]);
  const byClassRaw = (byClassKey && typeof raw[byClassKey]==='object') ? raw[byClassKey] : {};

  const normByClass = {};
  Object.keys(byClassRaw).forEach(cls=>{
    const sec = byClassRaw[cls] || {};
    const groupsKey = pickKey(sec, ["groups","by_group","byGroup","sections","parts"]);
    const groupsRaw = (groupsKey && typeof sec[groupsKey]==='object') ? sec[groupsKey] : {};
    const groups = {};
    Object.keys(groupsRaw).forEach(name=>{
      const gi = groupsRaw[name] || {};
      groups[name] = {
        score: Number(gi.score)||0,
        max:   SUBJECT_MAX[name] ?? (Number(gi.max)||0)
      };
    });
    const total = sec.total || sec.sum || { score: sec.score ?? 0, max: sec.max ?? 0 };
    normByClass[cls] = { total, groups };
  });

  const total = raw.total || raw.sum || { score: raw.score ?? 0, max: raw.max ?? 0 };
  const passKey = pickKey(raw, ["pass","passed","is_pass","합격"]);
  const pass = !!(passKey ? raw[passKey] : raw.pass);
  const failsKey = pickKey(raw, ["fails","fail","fails_list","과락","과락목록"]);
  const fails = Array.isArray(raw[failsKey]) ? raw[failsKey] : [];

  return { total, pass, fails, by_class: normByClass };
}

function extractRounds(student){
  if (!student) return { r1:null, r2:null, _dbgKeys:[] };

  const r1KeyTop = pickKey(student, ["1차","1차시험","round1","r1","first","회차1","1"]);
  const r2KeyTop = pickKey(student, ["2차","2차시험","round2","r2","second","회차2","2"]);
  let r1 = r1KeyTop ? student[r1KeyTop] : null;
  let r2 = r2KeyTop ? student[r2KeyTop] : null;

  if (!r1 || !r2){
    const roundsKey = pickKey(student, ["rounds","회차","round_list"]);
    const rounds = roundsKey ? student[roundsKey] : undefined;
    if (Array.isArray(rounds)){ r1 = r1 || rounds[0]; r2 = r2 || rounds[1]; }
    else if (rounds && typeof rounds === "object"){
      const r1KeyIn = pickKey(rounds, ["1차","1차시험","round1","r1","first","회차1","1"]);
      const r2KeyIn = pickKey(rounds, ["2차","2차시험","round2","r2","second","회차2","2"]);
      r1 = r1 || (r1KeyIn ? rounds[r1KeyIn] : undefined);
      r2 = r2 || (r2KeyIn ? rounds[r2KeyIn] : undefined);
    }
  }

  return {
    r1: normalizeRound(r1),
    r2: normalizeRound(r2),
    _dbgKeys: Object.keys(student||{})
  };
}

/* --------------------------
   4) 폼/라우팅
--------------------------- */
function goHome(){
  $("#view-result")?.classList.add("hidden");
  $("#view-home")?.classList.remove("hidden");
  $("#sid")?.focus();
}

// script.js
// 기존 lookupStudent(e) 전체를 이걸로 교체
async function lookupStudent(e){
  e.preventDefault();
  hideError();

  const input = $("#sid");
  const id = (input?.value || "").replace(/\D/g,"").slice(0,6);

  if(id.length !== 6){
    showError("학수번호는 숫자 6자리여야 합니다.");
    input?.focus();
    return false;
  }

  try {
    const r1 = await window.fetchRoundFromFirestore?.(id, "1차");
    const r2 = await window.fetchRoundFromFirestore?.(id, "2차");

    const norm1 = (window.normalizeRound?.(r1)) || r1;
    const norm2 = (window.normalizeRound?.(r2)) || r2;

    renderResult(id, norm1, norm2);
    saveRecent(id);
    $("#view-home")?.classList.add("hidden");
    $("#view-result")?.classList.remove("hidden");
  } catch (err){
    console.error(err);
    showError("Firestore에서 점수를 불러오지 못했습니다.");
  }
  return false;
}
}

/* --------------------------
   5) 렌더링(그룹 묶음/과락)
--------------------------- */
(function injectStyles(){
  const css = `
  .group-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
  .group-box{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)}
  .group-box.ok{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.55)}
  .group-box.fail{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.55)}
  .span-12{grid-column:span 12}.span-6{grid-column:span 12}
  @media(min-width:860px){.span-6{grid-column:span 6}}
  .group-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .subj-row{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:6px}
  .subj-chip{padding:4px 8px;border:1px solid var(--line);border-radius:999px;font-weight:800}
  .subj-chip .muted{opacity:.7;font-weight:600}
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
})();

function renderResult(id, round1, round2){
  $("#res-sid").textContent = id;
  const badges = $("#res-badges");
  badges.innerHTML = "";
  if (round1){ badges.innerHTML += `<span class="badge ${round1.pass?"pass":"fail"}">1차 ${round1.pass?"합격":"불합격"}</span>`; }
  if (round2){ badges.innerHTML += `<span class="badge ${round2.pass?"pass":"fail"}">2차 ${round2.pass?"합격":"불합격"}</span>`; }

  renderRound("#round-1", "1차", round1);
  renderRound("#round-2", "2차", round2);
}

// 과목 점수 맵을 뽑는다(없으면 0점), max는 SUBJECT_MAX 강제
function getSubjectScores(round){
  const byClass = round?.by_class || {};
  const subjMap = (byClass["종합"] && byClass["종합"].groups) ? byClass["종합"].groups : {};
  const result = {};
  ALL_SUBJECTS.forEach(name=>{
    const row = subjMap[name] || {};
    result[name] = {
      score: Number(row.score)||0,
      max:   SUBJECT_MAX[name] // 고정표 우선
    };
  });
  return result;
}

function chunk(arr, sizes){
  const out = [];
  let i=0;
  for (const s of sizes){
    out.push(arr.slice(i, i+s));
    i += s;
  }
  if (i < arr.length) out.push(arr.slice(i));
  return out;
}

function renderRound(sel, title, round){
  const host = $(sel);
  if(!host) return;

  if(!round){
    host.innerHTML = `<div class="small" style="opacity:.7">${title} 데이터가 없습니다.</div>`;
    return;
  }

  const subjects = getSubjectScores(round);

  const totalScore = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0), 0);
  const totalMax   = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.max||0),   0); // = 340
 const overallRate = pct(totalScore, totalMax);
 // 집계 결과에 pass가 이미 들어있으면 그걸 신뢰 (60%+그룹과락 없음 기준)
 const overallPass = (round && typeof round.pass === "boolean")
   ? round.pass
   : (totalScore >= totalMax * 0.6); // 백업 계산도 60%로

  let html = `
    <div class="round">
      <div class="flex" style="justify-content:space-between;">
        <h2 style="margin:0">${title} 총점</h2>
        <div class="kpi"><div class="num">${fmt(totalScore)}</div><div class="sub">/ ${fmt(totalMax)}</div></div>
      </div>
      <div class="progress" style="margin:8px 0 2px 0"><div style="width:${overallRate}%"></div></div>
           <div class="small">
       정답률 ${overallRate}% (컷 60%)
       ${overallPass? pill("합격","ok"):pill("불합격","red")}
     </div>
    </div>
    <div class="group-grid" style="margin-top:12px">
  `;

  GROUPS.forEach(g=>{
    const gScore = g.subjects.reduce((a,n)=>a+(subjects[n]?.score||0), 0);
    const gMax   = g.subjects.reduce((a,n)=>a+(subjects[n]?.max||0),   0);
    const gRate  = pct(gScore, gMax);
    const gPass  = gScore >= gMax * 0.4;  // 그룹 과락 (총점 40%)

    let chipsHtml = "";
    if (g.layoutChunks && g.layoutChunks.length){
      const rows = chunk(g.subjects, g.layoutChunks);
      rows.forEach(row=>{
        chipsHtml += `<div class="subj-row">` + row.map(n=>{
          const s = subjects[n]||{score:0,max:SUBJECT_MAX[n]||0};
          return `<span class="subj-chip">${n} <span class="muted">${fmt(s.score)}/${fmt(s.max)}</span></span>`;
        }).join("") + `</div>`;
      });
    } else {
      chipsHtml = `<div class="subj-row">` + g.subjects.map(n=>{
        const s = subjects[n]||{score:0,max:SUBJECT_MAX[n]||0};
        return `<span class="subj-chip">${n} <span class="muted">${fmt(s.score)}/${fmt(s.max)}</span></span>`;
      }).join("") + `</div>`;
    }

    html += `
      <div class="group-box ${gPass? "ok":"fail"} span-${g.span||12}">
        <div class="group-head">
          <div class="name" style="font-weight:800">${g.label}</div>
          <div class="small">소계 ${fmt(gScore)}/${fmt(gMax)} · 정답률 ${gRate}% ${gPass? pill("통과","ok"):pill("과락","red")}</div>
        </div>
        ${chipsHtml}
      </div>
    `;
  });

  html += `</div>`;
  host.innerHTML = html;
}

/* --------------------------
   6) 초기화
--------------------------- */
function initApp(){
  const $sid = $("#sid");
  if ($sid) {
    $sid.addEventListener('input', () => {
      $sid.value = ($sid.value || '').replace(/\D/g, '').slice(0, 6);
    });
    $sid.setAttribute('enterkeyhint', 'done');
  }

  const form = $("#lookup-form");
  if (form) form.addEventListener('submit', lookupStudent);

  scanHistory();

  const p = new URLSearchParams(location.search);
  const sid = p.get("sid") || p.get("id");
  if (sid && /^\d{6}$/.test(sid)) {
    const data = getStudentById(sid);
    if (data) {
      if ($sid) $sid.value = sid;
      const { r1, r2 } = extractRounds(data);
      renderResult(sid, r1, r2);
      $("#view-home")?.classList.add("hidden");
      $("#view-result")?.classList.remove("hidden");
    } else {
      showError("해당 학수번호의 성적 데이터를 찾을 수 없습니다. SCORE_DATA를 확인하세요.");
    }
  }
}

document.addEventListener('DOMContentLoaded', initApp);

// 전역 노출
window.goHome = goHome;
window.scanHistory = scanHistory;
window.initApp = initApp;
window.normalizeRound = normalizeRound;
window.renderResult   = renderResult;

// Firestore 로더가 참조할 전역(중복 선언 금지)
window.__SUBJECT_TOTALS = SUBJECT_MAX;
window.__GROUPS_DEF     = GROUPS;

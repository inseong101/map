/* =========================================================
   전졸협 성적 SPA 스크립트 (오프라인)
   - 학수번호 입력 → window.SCORE_DATA에서 검색 → 결과 뷰 렌더링
   ========================================================= */

// === SCORE_DATA 전제 ===
// window.SCORE_DATA = { "015001": { "1차": {...}, "2차": {...} }, ... }
// ※ 실제 데이터에서 키 이름이 다를 수 있어 아래에서 호환 처리함.

// === 데이터 로드 확인 (없으면 빈 객체) ===
window.SCORE_DATA = window.SCORE_DATA || {};

// ▼▼▼ 추가: 학수번호(0패딩) 인덱스 맵 생성 ▼▼▼
(function buildIndex(){
  const idx = {};
  for (const rawKey of Object.keys(window.SCORE_DATA)) {
    const norm = String(rawKey).replace(/\D/g,'');   // 숫자만
    const six  = norm.padStart(6, '0');              // 6자리 0 패딩
    idx[six] = window.SCORE_DATA[rawKey];
  }
  window.__SCORE_INDEX__ = idx;
})();

// 학수번호로 안전하게 조회
function getStudentById(id6){
  if (window.__SCORE_INDEX__ && window.__SCORE_INDEX__[id6]) return window.__SCORE_INDEX__[id6];
  if (window.SCORE_DATA && window.SCORE_DATA[id6]) return window.SCORE_DATA[id6];
  return null;
}

// 유틸
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const RECENT_KEY = "jjh_recent_ids";

function fmt(n, digits=0){
  if (n === undefined || n === null || isNaN(n)) return "-";
  return Number(n).toLocaleString("ko-KR", {maximumFractionDigits:digits});
}
function pct(score, max){
  if(!max) return 0;
  return Math.round((Number(score) / Number(max)) * 100);
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

// 최근 조회
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
      if (form) form.dispatchEvent(new Event("submit", {cancelable:true}));
    };
    box.appendChild(btn);
  });
  box.classList.remove("hidden");
}

// 홈/결과 뷰 전환
function goHome(){
  $("#view-result")?.classList.add("hidden");
  $("#view-home")?.classList.remove("hidden");
  $("#sid")?.focus();
}

// -------- 키 호환/정규화 레이어 --------

// 후보 키 중 존재하는 실제 키를 찾아 반환
function pickKey(obj, candidates){
  if (!obj) return null;
  for (const key of candidates){
    if (key in obj) return key;
  }
  // 대소문자/공백/언더바 느슨 매칭 (round1 == round_1 == ROUND1)
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

// 라운드 객체를 표준 형태로 정규화
function normalizeRound(raw){
  if (!raw || typeof raw !== 'object') return null;

  // ★★★ 새 스키마(total_questions/total_correct/group_results) 지원 ★★★
  if ('total_questions' in raw && 'total_correct' in raw) {
    const total = {
      score: Number(raw.total_correct) || 0,
      max:   Number(raw.total_questions) || 0
    };
    // overall_pass / round_pass / pass 중 있는 값 사용
    const pass = !!(raw.overall_pass ?? raw.round_pass ?? raw.pass);

    // group_results 배열 → 과목별 점수/과락 변환
    const groups = {};
    (raw.group_results || []).forEach(g => {
      groups[g.name] = {
        score: Number(g.correct) || 0,
        max:   Number(g.total) || 0
      };
    });

    // 과락 목록
    const fails = (raw.group_results || [])
      .filter(g => g.is_fail)
      .map(g => ({
        class: "종합",
        group: g.name,
        score: Number(g.correct) || 0,
        max:   Number(g.total) || 0,
        min:   Number(g.cutoff) || 0
      }));

    // by_class가 없으므로 "종합" 섹션 하나로 묶어 렌더
    return {
      total,
      pass,
      fails,
      by_class: {
        "종합": {
          total,
          groups
        }
      }
    };
  }

  // ★★★ 기존(by_class/byGroup 등) 스키마도 호환 유지 ★★★
  const byClassKey = pickKey(raw, ["by_class","byClass","classes","sections"]);
  const byClassRaw = (byClassKey && typeof raw[byClassKey] === 'object') ? raw[byClassKey] : {};

  const normByClass = {};
  Object.keys(byClassRaw).forEach(cls=>{
    const sec = byClassRaw[cls] || {};
    const groupsKey = pickKey(sec, ["groups","by_group","byGroup","sections","parts"]);
    const groupsRaw = (groupsKey && typeof sec[groupsKey] === 'object') ? sec[groupsKey] : {};
    const total = sec.total || sec.sum || { score: sec.score ?? 0, max: sec.max ?? 0 };
    normByClass[cls] = { total, groups: groupsRaw };
  });

  const total = raw.total || raw.sum || { score: raw.score ?? 0, max: raw.max ?? 0 };
  const passKey = pickKey(raw, ["pass","passed","is_pass","합격"]);
  const pass = !!(passKey ? raw[passKey] : raw.pass);

  const failsKey = pickKey(raw, ["fails","fail","fails_list","과락","과락목록"]);
  const fails = Array.isArray(raw[failsKey]) ? raw[failsKey] : [];

  return { total, pass, fails, by_class: normByClass };

// 데이터 내부에서 1차/2차 라운드를 찾아 정규화
function extractRounds(student){
  if (!student) return { r1:null, r2:null, _dbgKeys:[] };

  // 1) 최상위에서 직접 키 찾기
  const r1KeyTop = pickKey(student, ["1차","1차시험","round1","r1","first","회차1","1"]);
  const r2KeyTop = pickKey(student, ["2차","2차시험","round2","r2","second","회차2","2"]);
  let r1 = r1KeyTop ? student[r1KeyTop] : null;
  let r2 = r2KeyTop ? student[r2KeyTop] : null;

  // 2) rounds 컨테이너 찾기 (배열/객체 모두 호환)
  if (!r1 || !r2){
    const roundsKey = pickKey(student, ["rounds","회차","round_list"]);
    const rounds = roundsKey ? student[roundsKey] : undefined;

    if (Array.isArray(rounds)){
      // 배열이면 0,1 순서 사용
      r1 = r1 || rounds[0];
      r2 = r2 || rounds[1];
    } else if (rounds && typeof rounds === "object"){
      // 객체이면 안쪽에서 1차/2차 키 다시 탐색
      const r1KeyIn = pickKey(rounds, ["1차","1차시험","round1","r1","first","회차1","1"]);
      const r2KeyIn = pickKey(rounds, ["2차","2차시험","round2","r2","second","회차2","2"]);
      r1 = r1 || (r1KeyIn ? rounds[r1KeyIn] : undefined);
      r2 = r2 || (r2KeyIn ? rounds[r2KeyIn] : undefined);
    }
  }

  return {
    r1: normalizeRound(r1),
    r2: normalizeRound(r2),
    _dbgKeys: Object.keys(student || {})
  };
}
// ---------------------------------------

async function lookupStudent(e){
  e.preventDefault();
  const input = $("#sid");
  const id = (input?.value || "").trim();
  hideError();

  // 숫자 6자리만 허용
  if(!/^\d{6}$/.test(id)){
    showError("학수번호는 숫자 6자리여야 합니다.");
    input?.focus();
    return false;
  }

  // ID 존재 여부
  const data = getStudentById(id);
  if(!data){
    showError("해당 학수번호의 성적 데이터를 찾을 수 없습니다. SCORE_DATA를 확인하세요.");
    return false;
  }

  // 라운드 추출/정규화
  const { r1, r2, _dbgKeys } = extractRounds(data);

  // 디버그 모드(?debug=1)에서 실제 키 보여주기
  const q = new URLSearchParams(location.search);
  if (q.get("debug") === "1"){
    console.log("[DEBUG] keys in SCORE_DATA[%s]:", id, _dbgKeys);
    console.log("[DEBUG] R1:", r1);
    console.log("[DEBUG] R2:", r2);
  }

  renderResult(id, r1, r2);
  saveRecent(id);
  $("#view-home")?.classList.add("hidden");
  $("#view-result")?.classList.remove("hidden");
  return false;
}

// 결과 렌더링
function renderResult(id, round1, round2){
  const sidEl = $("#res-sid");
  if (sidEl) sidEl.textContent = id;

  const badges = $("#res-badges");
  if (badges) {
    badges.innerHTML = "";
    if (round1){
      const span = document.createElement("span");
      span.className = "badge " + (round1.pass ? "pass":"fail");
      span.textContent = `1차 ${round1.pass? "합격":"불합격"}`;
      badges.appendChild(span);
    }
    if (round2){
      const span = document.createElement("span");
      span.className = "badge " + (round2.pass ? "pass":"fail");
      span.textContent = `2차 ${round2.pass? "합격":"불합격"}`;
      badges.appendChild(span);
    }
  }

  // 회차별 카드 생성
  renderRound("#round-1", "1차", round1);
  renderRound("#round-2", "2차", round2);
}

function renderRound(sel, title, round){
  const host = $(sel);
  if(!host) return;

  if(!round){
    host.innerHTML = `<div class="small" style="opacity:.7">${title} 데이터가 없습니다.</div>`;
    return;
  }

  const total = round.total || {score:0, max:0};
  const rate = pct(total.score, total.max);
  const pass = !!round.pass;
  const fails = Array.isArray(round.fails) ? round.fails : [];

  // 교시 정렬: 1교시~4교시 (데이터에 있는 것만)
  const byClass = round.by_class || {};
  const classOrder = ["1교시","2교시","3교시","4교시"].filter(k=>k in byClass);
  const dynamicOrder = classOrder.length ? classOrder : Object.keys(byClass);

  let html = `
    <div class="round">
      <div class="flex" style="justify-content:space-between;">
        <h2 style="margin:0">${title} 총점</h2>
        <div class="kpi"><div class="num">${fmt(total.score)}</div><div class="sub">/ ${fmt(total.max)}</div></div>
      </div>
      <div class="progress" style="margin:8px 0 2px 0"><div style="width:${rate}%"></div></div>
      <div class="small">정답률 ${rate}% ${pass? pill("합격","ok"):pill("불합격","red")}</div>
    </div>
  `;

  // 과락 안내
  if(fails.length){
    html += `<div class="group" style="margin-top:8px">
      <div class="name">과락</div>
      <div class="small">${fails.map(f=>{
        const clz = f.class || f.cls || f.period || "-";
        const grp = f.group || f.grp || "-";
        return `${clz}·${grp} (${fmt(f.score)}/${fmt(f.max)} / 최소 ${fmt(f.min)})`;
      }).join(" · ")}</div>
    </div>`;
  }

  // 교시별 표
  (dynamicOrder || []).forEach(cls=>{
    const s = byClass[cls] || {};
    const groups = s.groups || {};
    const keys = Object.keys(groups);

    const subtotal = s.total || {score:0, max:0};
    const rr = pct(subtotal.score, subtotal.max);

    html += `
      <div class="card" style="margin-top:12px">
        <div class="flex" style="justify-content:space-between;">
          <div class="name" style="font-weight:800">${cls}</div>
          <div class="small">소계 ${fmt(subtotal.score)}/${fmt(subtotal.max)} · 정답률 ${rr}%</div>
        </div>
        <div class="group-list">
    `;

    keys.forEach(k=>{
      const gi = groups[k] || {};
      const pr = pct(gi.score || 0, gi.max || 0);
      const minReq = Math.round(((gi.max || 0) * 0.4) * 1000) / 1000;
      const failed = (Number(gi.score) || 0) < (minReq || 0);
      html += `
        <div class="group">
          <div class="name">${k}</div>
          <div class="flex" style="gap:12px">
            <span class="small">${fmt(gi.score)}/${fmt(gi.max)} (${pr}%)</span>
            ${failed ? pill("과락","red") : pill("통과","ok")}
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
  });

  host.innerHTML = html;
}

// 초기화: 입력 필터링/폼 이벤트/최근조회/쿼리파라미터 적용
function initApp(){
  // 입력시 숫자만, 6자리 제한
  const $sid = $("#sid");
  if ($sid) {
    $sid.addEventListener('input', () => {
      $sid.value = ($sid.value || '').replace(/\D/g, '').slice(0, 6);
    });
    $sid.setAttribute('enterkeyhint', 'done');
  }
   console.log("[SCORE] loaded?", typeof window.SCORE_DATA, "size:", window.SCORE_DATA && Object.keys(window.SCORE_DATA).length);
console.log("[SCORE] sample(015001):", getStudentById("015001"));

  // 폼 submit 핸들러
  const form = $("#lookup-form");
  if (form) form.addEventListener('submit', lookupStudent);

  // 최근 보기 표시
  scanHistory();

// ?sid=015001 있으면 자동 렌더 (인덱스/정규화 모두 적용)
const p = new URLSearchParams(location.search);
const sid = p.get("sid") || p.get("id");
if (sid && /^\d{6}$/.test(sid)) {
  const data = getStudentById(sid);
  if (data) {
    const { r1, r2 } = extractRounds(data);
    if ($sid) $sid.value = sid;
    renderResult(sid, r1, r2);
    $("#view-home")?.classList.add("hidden");
    $("#view-result")?.classList.remove("hidden");
  } else {
    showError("해당 학수번호의 성적 데이터를 찾을 수 없습니다. SCORE_DATA를 확인하세요.");
  }
}
}

// DOM 준비 후 초기화
document.addEventListener('DOMContentLoaded', initApp);

// 전역 노출 (HTML에서 호출 가능하도록)
window.goHome = goHome;
window.scanHistory = scanHistory;
window.initApp = initApp;

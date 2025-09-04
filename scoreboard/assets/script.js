/* =========================================================
   전졸협 성적 SPA 스크립트 (오프라인)
   - 학수번호 입력 → window.SCORE_DATA에서 검색 → 결과 뷰 렌더링
   ========================================================= */

// === GENERATED DATA START ===
window.SCORE_DATA = window.SCORE_DATA || {}; // 여기에 SCORE_DATA.js 내용 붙여넣기
// === GENERATED DATA END ===

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
  return Math.round((score / max) * 100);
}
function pill(text, type){
  const cls = type === 'ok' ? 'pill green' : (type === 'warn' ? 'pill warn' : 'pill red');
  return `<span class="${cls}">${text}</span>`;
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
    btn.onclick = ()=>{ $("#sid").value = id; $("#lookup-form").dispatchEvent(new Event("submit", {cancelable:true})); };
    box.appendChild(btn);
  });
  box.classList.remove("hidden");
}

function showError(msg){
  const err = $("#error");
  err.textContent = msg;
  err.classList.remove("hidden");
}

// 홈/결과 뷰 전환
function goHome(){
  $("#view-result").classList.add("hidden");
  $("#view-home").classList.remove("hidden");
  $("#sid").focus();
}
// SCORE_DATA를 "6자리 패딩된 학수번호"로 인덱싱해서 찾기 쉽게
function getByStudentId(id) {
  const raw = window.SCORE_DATA || {};
  // 1) 바로 매칭
  if (raw[id]) return raw[id];

  // 2) 앞자리 0 제거한 키가 있을 수도 있음 (엑셀→JSON에서 015001 -> 15001)
  const noZ = id.replace(/^0+/, ''); // "015001" -> "15001"
  if (raw[noZ]) return raw[noZ];

  // 3) 반대로, 데이터 쪽 키를 6자리로 패딩해서 매칭
  //    (빌더가 15001 같은 키를 만들었다면 여기서 015001로 맞춰봄)
  for (const k of Object.keys(raw)) {
    const pad6 = k.padStart(6, '0');
    if (pad6 === id) return raw[k];
  }

  return null;
}
async function lookupStudent(e){
  e.preventDefault();
  const input = $("#sid");
  const id = (input.value || "").trim();
  const err = $("#error");
  err.classList.add("hidden");
  err.textContent = "";

  if(!/^\d{6}$/.test(id)){
    showError("학수번호는 숫자 6자리여야 합니다.");
    input.focus();
    return false;
  }

  // 데이터 검증
  if(!window.SCORE_DATA || !window.SCORE_DATA[id]){
    showError("해당 학수번호의 성적 데이터를 찾을 수 없습니다. SCORE_DATA를 확인하세요.");
    return false;
  }

  renderResult(id, window.SCORE_DATA[id]);
  saveRecent(id);
  $("#view-home").classList.add("hidden");
  $("#view-result").classList.remove("hidden");
  return false;
}

// 결과 렌더링
function renderResult(id, data){
  $("#res-sid").textContent = id;
  const badges = $("#res-badges");
  badges.innerHTML = "";

  // 1차/2차 배지
  ["1차","2차"].forEach(r=>{
    if(!data[r]) return;
    const pass = !!data[r].pass;
    const span = document.createElement("span");
    span.className = "badge " + (pass ? "pass":"fail");
    span.textContent = `${r} ${pass? "합격":"불합격"}`;
    badges.appendChild(span);
  });

  // 회차별 카드 생성
  renderRound("#round-1", "1차", data["1차"]);
  renderRound("#round-2", "2차", data["2차"]);
}

function renderRound(sel, title, round){
  const host = $(sel);
  if(!round){
    host.innerHTML = `<div class="small" style="opacity:.7">${title} 데이터가 없습니다.</div>`;
    return;
  }

  const total = round.total || {score:0, max:0};
  const rate = pct(total.score, total.max);
  const pass = !!round.pass;
  const fails = round.fails || [];

  // 교시 정렬: 1교시~4교시
  const byClass = round.by_class || {};
  const classOrder = ["1교시","2교시","3교시","4교시"].filter(k=>k in byClass);

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
      <div class="small">${fails.map(f=>`${f.class}·${f.group} (${fmt(f.score)}/${fmt(f.max)} / 최소 ${fmt(f.min)})`).join(" · ")}</div>
    </div>`;
  }

  // 교시별 표
  classOrder.forEach(cls=>{
    const s = byClass[cls];
    const g = s.groups || {};
    const keys = Object.keys(g);

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
      const gi = g[k];
      const pr = pct(gi.score, gi.max);
      const minReq = Math.round(gi.max * 0.4 * 1000) / 1000;
      const failed = gi.score < minReq;
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

// 쿼리스트링 ?id=015001 → 바로 보여주기
(function(){
  const p = new URLSearchParams(location.search);
  const id = p.get("id");
  if(id && /^\d{6}$/.test(id) && window.SCORE_DATA && window.SCORE_DATA[id]){
    renderResult(id, window.SCORE_DATA[id]);
    $("#view-home").classList.add("hidden");
    $("#view-result").classList.remove("hidden");
  }
})();

// 초기화: 폼 이벤트/최근조회 세팅
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('lookup-form');
  if (form) {
    form.addEventListener('submit', lookupStudent);
  }
  scanHistory();
});

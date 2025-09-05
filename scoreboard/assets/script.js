/* =========================================================
   전졸협 성적 SPA 스크립트 (정리본)
   - 학수번호 입력 → Firestore 결과(우선) 또는 오프라인 SCORE_DATA → 동적 카드 렌더
   - 규칙:
     1) 과목별 문항 고정(총 340)
     2) 그룹별(그룹 총점 기준) 40% 과락
     3) 전체 60% 미만 평락
     4) 종합 PASS = [모든 그룹 통과] AND [전체 60% 이상]
     5) SID 카드 뒤면: 1~8차 본인/학교/전국 꺾은선
     6) 각 회차 카드 뒤면: 막대(본인/학교/전국)
========================================================= */

/* --------------------------
   0) 과목/그룹 정의
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

// 전부 한 줄(12칸)로 꽉 차게
const GROUPS = [
  { id: "그룹1", label: "그룹 1", subjects: ["간","심","비","폐","신","상한","사상"], layoutChunks: [5,2], span: 12 },
  { id: "그룹3", label: "그룹 3", subjects: ["침구"], span: 12 },
  { id: "그룹2", label: "그룹 2", subjects: ["보건"], span: 12 },
  { id: "그룹4", label: "그룹 4", subjects: ["외과","신경","안이비"], span: 12 },
  { id: "그룹5", label: "그룹 5", subjects: ["부인과","소아"], span: 12 },
  { id: "그룹6", label: "그룹 6", subjects: ["예방","생리","본초"], span: 12 },
];

const ALL_SUBJECTS = GROUPS.flatMap(g => g.subjects);
const TOTAL_MAX = ALL_SUBJECTS.reduce((a,n)=>a+(SUBJECT_MAX[n]||0),0);  // 340

// 01~12 → 학교명
const SCHOOL_MAP = {
  "01":"가천대","02":"경희대","03":"대구한","04":"대전대",
  "05":"동국대","06":"동신대","07":"동의대","08":"부산대",
  "09":"상지대","10":"세명대","11":"우석대","12":"원광대"
};
function getSchoolFromSid(sid){
  const p2 = String(sid||"").slice(0,2);
  return SCHOOL_MAP[p2] || "미상";
}

const ROUND_LABELS = ["1차","2차","3차","4차","5차","6차","7차","8차"];

/* --------------------------
   1) 평균치 (임시) — 나중에 Firestore로 교체 가능
--------------------------- */
async function getAverages(schoolName, roundLabel){
  // 필요 시 roundLabel/학교별로 다르게 주입
  return {
    nationalAvg: Math.round(TOTAL_MAX * 0.60),
    schoolAvg:   Math.round(TOTAL_MAX * 0.62)
  };
}

/* --------------------------
   2) 오프라인 데이터 인덱스 (폴백)
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
   3) 유틸
--------------------------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function fmt(n){ return (n==null || isNaN(Number(n))) ? "-" : Number(n).toLocaleString("ko-KR"); }
function pct(score, max){ const s=+score||0, m=+max||0; return m<=0 ? 0 : Math.round((s/m)*100); }
function pill(text, type){ const cls = type==='ok'?'pill green':(type==='warn'?'pill warn':'pill red'); return `<span class="${cls}">${text}</span>`; }
function showError(msg){ const e=$("#error"); if(!e) return; e.textContent=msg; e.classList.remove("hidden"); }
function hideError(){ const e=$("#error"); if(!e) return; e.textContent=""; e.classList.add("hidden"); }

// 키 후보 매칭
function pickKey(obj, candidates){
  if (!obj || typeof obj !== "object") return null;
  for (const key of candidates){ if (key in obj) return key; }
  const map = Object.keys(obj).reduce((acc,k)=>{
    const norm = String(k).toLowerCase().replace(/[\s_]/g,''); acc[norm] = k; return acc;
  }, {});
  for (const key of candidates){
    const norm = String(key).toLowerCase().replace(/[\s_]/g,'');
    if (norm in map) return map[norm];
  }
  return null;
}

/* --------------------------
   4) 정규화 (새/구 스키마 모두 수용)
--------------------------- */
function normalizeRound(raw){
  if (!raw || typeof raw !== 'object') return null;

  // 새 스키마: total_questions/total_correct + subject_results
  if ('total_questions' in raw && 'total_correct' in raw) {
    const groups = {};
    if (Array.isArray(raw.subject_results)){
      raw.subject_results.forEach(s=>{
        const nm = s.name;
        groups[nm] = { score: +s.correct||0, max: SUBJECT_MAX[nm] ?? (+s.total||0) };
      });
    } else if (Array.isArray(raw.group_results)) {
      raw.group_results.forEach(g=>{
        const nm = String(g.name);
        if (nm in SUBJECT_MAX){
          groups[nm] = { score:+g.correct||0, max: SUBJECT_MAX[nm] ?? (+g.total||0) };
        }
      });
    }
    return {
      total: { score: 0, max: 0 },  // 과목 합으로 재계산
      pass:  !!(raw.overall_pass ?? raw.round_pass ?? raw.pass),
      fails: [],
      by_class: { "종합": { total: {score:0, max:0}, groups } }
    };
  }

  // 구 스키마
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
      groups[name] = { score:+gi.score||0, max: SUBJECT_MAX[name] ?? (+gi.max||0) };
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

// 과목별 점수 맵 뽑기 (없으면 0), max는 SUBJECT_MAX
function getSubjectScores(round){
  const byClass = round?.by_class || {};
  const subjMap = (byClass["종합"] && byClass["종합"].groups) ? byClass["종합"].groups : {};
  const result = {};
  ALL_SUBJECTS.forEach(name=>{
    const row = subjMap[name] || {};
    result[name] = { score: +row.score||0, max: SUBJECT_MAX[name] };
  });
  return result;
}

/* --------------------------
   5) Firestore 회차 자동 탐색
--------------------------- */
async function discoverRoundsFor(sid){
  const found = [];
  for (const label of ROUND_LABELS){
    try {
      const r = await window.fetchRoundFromFirestore(sid, label);
      if (!r) continue;
      // 존재 판단: (새스키마) total_correct>0 or (정규화 후) 과목합>0
      const ok = (typeof r.total_correct === 'number' && r.total_correct > 0) || (() => {
        const norm = (window.normalizeRound?.(r)) || r;
        const subjects = getSubjectScores(norm);
        const sum = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0),0);
        return sum > 0;
      })();
      if (ok) found.push({ label, raw:r });
    } catch (_) {}
  }
  return found; // [{label, raw}]
}

/* --------------------------
   6) 차트 유틸 (Canvas)
--------------------------- */
// 막대
function drawBarChart(canvas, items){
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  const padding = 24, axisY = H - padding;
  const maxV = Math.max(1, ...items.map(i=>i.value));
  const barW = Math.min(60, (W - padding*2) / (items.length * 1.8));
  const gap  = barW * 0.8;

  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.beginPath(); ctx.moveTo(padding, axisY); ctx.lineTo(W-padding, axisY); ctx.stroke();

  const colors = ['#7ea2ff','#4cc9ff','#22c55e'];
  items.forEach((it, i)=>{
    const x = padding + i*(barW+gap) + 10;
    const h = Math.round((it.value / maxV) * (H - padding*2));
    const y = axisY - h;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = '#e8eeff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(String(it.value), x+barW/2, y-6);
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '12px system-ui';
    ctx.fillText(it.label, x+barW/2, axisY+14);
  });
}

// 꺾은선: labels=["1차"...], series=[{name,values:[..]}], maxValue=TOTAL_MAX
function drawLineChart(canvas, labels, series, maxValue){
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const padL=40, padR=16, padT=24, padB=34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = labels.length;
  const x = (i)=> padL + (n<=1 ? plotW/2 : (i*(plotW/(n-1))));
  const y = (v)=> padT + (plotH * (1 - (v / Math.max(1, maxValue||1))));

  // 축
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT+plotH);
  ctx.lineTo(padL+plotW, padT+plotH);
  ctx.stroke();

  // X라벨
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  labels.forEach((lb,i)=> ctx.fillText(lb, x(i), padT+plotH+18));

  const colors = ['#7ea2ff','#4cc9ff','#22c55e'];

  // 시리즈
  series.forEach((s, si)=>{
    const col = colors[si % colors.length];
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
    s.values.forEach((v,i)=>{
      if (v == null) return;
      const xx=x(i), yy=y(v);
      if (i===0 || s.values[i-1]==null) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
    });
    ctx.stroke();
    ctx.fillStyle = col;
    s.values.forEach((v,i)=>{
      if (v == null) return;
      const xx=x(i), yy=y(v);
      ctx.beginPath(); ctx.arc(xx,yy,3,0,Math.PI*2); ctx.fill();
    });
  });

  // 범례
  const legendX = padL, legendY = 12;
  series.forEach((s, si)=>{
    const col = colors[si % colors.length];
    ctx.fillStyle = col; ctx.fillRect(legendX + si*120, legendY-8, 10, 10);
    ctx.fillStyle = '#e8eeff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign='left';
    ctx.fillText(s.name, legendX + si*120 + 14, legendY+1);
  });
}

/* --------------------------
   7) 카드 생성 & 렌더
--------------------------- */
function makeFlipCard({id, title, frontHTML}){
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="${id}" class="flip-card">
      <div class="flip-inner">
        <div class="flip-face flip-front card">${frontHTML}</div>
        <div class="flip-face flip-back card">
          <h2 style="margin-top:0">${title} 평균 비교</h2>
          <canvas id="${id}-canvas" width="360" height="200"></canvas>
          <div class="small" id="${id}-cap" style="margin-top:8px; opacity:.8"></div>
        </div>
      </div>
    </div>
  `;
  const card = wrap.querySelector('.flip-card');
  card.addEventListener('click', (e)=>{
    if (e.target.closest('button')) return;
    card.classList.toggle('is-flipped');
  });
  return wrap.firstElementChild;
}

function chunk(arr, sizes){
  const out = []; let i=0;
  for (const s of sizes){ out.push(arr.slice(i, i+s)); i+=s; }
  if (i < arr.length) out.push(arr.slice(i));
  return out;
}

function renderRound(hostSel, title, round){
  const host = $(hostSel);
  if(!host) return;

  if(!round){
    host.innerHTML = `<div class="small" style="opacity:.7">${title} 데이터가 없습니다.</div>`;
    return;
  }

  const subjects = getSubjectScores(round);
  const totalScore = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0), 0);
  const totalMax   = TOTAL_MAX;
  const overallRate = pct(totalScore, totalMax);

  // 그룹 요약 (40% 과락)
  const groupSummaries = GROUPS.map(g => {
    const gScore = g.subjects.reduce((a,n)=>a+(subjects[n]?.score||0), 0);
    const gMax   = g.subjects.reduce((a,n)=>a+(subjects[n]?.max||0),   0);
    const gRate  = pct(gScore, gMax);
    const gPass  = gScore >= Math.ceil(gMax * 0.4);
    return { def:g, score:gScore, max:gMax, rate:gRate, pass:gPass };
  });
  const anyGroupFail = groupSummaries.some(s => !s.pass);

  // 평락
  const meets60 = (totalScore >= totalMax * 0.6);
  const overallPass = meets60 && !anyGroupFail;

  // 사유
  let reasonText = "통과";
  if (!overallPass){
    if (!meets60 && anyGroupFail) reasonText = "과락 및 평락으로 인한 불합격";
    else if (!meets60)            reasonText = "평락으로 인한 불합격";
    else                          reasonText = "과락으로 인한 불합격";
  }

  // 상단
  let html = `
    <div class="round ${overallPass ? "" : "fail"}">
      <div class="flex" style="justify-content:space-between;">
        <h2 style="margin:0">${title} 총점</h2>
        <div class="kpi"><div class="num">${fmt(totalScore)}</div><div class="sub">/ ${fmt(totalMax)}</div></div>
      </div>
      <div class="progress" style="margin:8px 0 2px 0">
        <div class="bar" style="width:${overallRate}%"></div>
        <div class="cutline"></div>
      </div>
      <div class="small" style="margin-top:10px">
        정답률 ${overallRate}% (컷 60%) · ${overallPass ? pill("통과","ok") : pill("불합격","red")}
        <div class="small" style="margin-top:6px; opacity:.9">${reasonText}</div>
      </div>
    </div>

    <div class="group-grid" style="margin-top:12px">
  `;

  // 그룹 카드
  groupSummaries.forEach(({def, score, max, rate, pass})=>{
    let chipsHtml = "";
    const names = def.subjects;
    if (def.layoutChunks?.length){
      const rows = chunk(names, def.layoutChunks);
      rows.forEach(row=>{
        chipsHtml += `<div class="subj-row">` + row.map(n=>{
          const s = subjects[n]||{score:0,max:SUBJECT_MAX[n]||0};
          return `<span class="subj-chip">${n} <span class="muted">${fmt(s.score)}/${fmt(s.max)}</span></span>`;
        }).join("") + `</div>`;
      });
    } else {
      chipsHtml = `<div class="subj-row">` + names.map(n=>{
        const s = subjects[n]||{score:0,max:SUBJECT_MAX[n]||0};
        return `<span class="subj-chip">${n} <span class="muted">${fmt(s.score)}/${fmt(s.max)}</span></span>`;
      }).join("") + `</div>`;
    }

    html += `
      <div class="group-box ${pass ? "ok" : "fail"} span-12">
        <div class="group-head">
          <div class="name" style="font-weight:800">${def.label}</div>
          <div class="small">
            소계 ${fmt(score)}/${fmt(max)} · 정답률 ${rate}%
            ${pass ? pill("통과","ok") : pill("과락","red")}
          </div>
        </div>
        ${chipsHtml}
      </div>
    `;
  });

  html += `</div>`;
  host.innerHTML = html;
}

/* --------------------------
   8) 결과 전체 렌더 (동적 카드)
--------------------------- */
async function renderResultDynamic(sid){
  $("#res-sid").textContent = sid;

  const grid = $("#cards-grid");
  grid.innerHTML = "";

  const school = getSchoolFromSid(sid);

  // SID 카드(종합)
  const sidCard = makeFlipCard({
    id: 'card-sid',
    title: '종합',
    frontHTML: `
      <div class="flex" style="justify-content:space-between;">
        <div>
          <div class="small">학수번호</div>
          <div class="kpi"><div class="num">${sid}</div></div>
          <div class="small">${school}</div>
        </div>
        <div class="flex" id="res-badges"></div>
      </div>
      <hr class="sep" />
      <div class="small" style="opacity:.8">카드를 클릭하면 학교/전국 평균 비교 꺾은선 그래프가 나옵니다.</div>
    `
  });
  // SID 카드 높이 조금 더
  sidCard.style.setProperty('--flip-h', '320px');
  grid.appendChild(sidCard);

  // 회차 자동 탐색
  const rounds = await discoverRoundsFor(sid);
  if (rounds.length === 0){
    const msg = document.createElement('div');
    msg.innerHTML = `<div class="card"><div class="small" style="opacity:.8">조회 가능한 회차 데이터가 없습니다.</div></div>`;
    grid.appendChild(msg);
    return;
  }

  // 각 회차 카드 만들고 앞면 렌더
  const studentTotals = {};  // {'1차': 총점, ...}
  for (const {label, raw} of rounds){
    const norm = (window.normalizeRound?.(raw)) || raw;

    const hostId = `round-host-${label}`;
    const card = makeFlipCard({
      id: `card-${label}`,
      title: label,
      frontHTML: `<div id="${hostId}"></div>`
    });
    grid.appendChild(card);

    renderRound(`#${hostId}`, label, norm);

    // 개인 총점 저장 (뒤면 막대용)
    const subs = getSubjectScores(norm);
    studentTotals[label] = ALL_SUBJECTS.reduce((a,n)=>a+(subs[n]?.score||0),0);
  }

  // 상단 배지 (1차/2차만 우선)
  const badgesHost = $('#res-badges');
  if (badgesHost){
    badgesHost.innerHTML = '';
    for (const check of ['1차','2차']){
      const r = rounds.find(x=>x.label===check);
      if (!r) continue;
      const norm = (window.normalizeRound?.(r.raw)) || r.raw;
      const subs = getSubjectScores(norm);
      const sc = ALL_SUBJECTS.reduce((a,n)=>a+(subs[n]?.score||0),0);
      const passOverall = (sc >= TOTAL_MAX*0.6); // (간단표시)
      badgesHost.innerHTML += `<span class="badge ${passOverall?'pass':'fail'}">${check} ${passOverall?'합격':'불합격'}</span>`;
    }
  }

  // 회차 카드 뒤면 — 막대 (본인/학교/전국)
  for (const {label} of rounds){
    const my = studentTotals[label]||0;
    const { nationalAvg, schoolAvg } = await getAverages(school, label);
    drawBarChart(document.getElementById(`card-${label}-canvas`), [
      {label:'본인', value: my},
      {label:'학교평균', value: schoolAvg},
      {label:'전국평균', value: nationalAvg},
    ]);
    const c = document.getElementById(`card-${label}-cap`);
    if (c) c.textContent = `${label} 총점 기준 / 최대 ${TOTAL_MAX}`;
  }

  // SID 카드 뒤면 — 1~8차 꺾은선
  const labels = ROUND_LABELS;
  const me  = labels.map(lb => (studentTotals[lb] ?? null));
  const nat = [], sch = [];
  for (const lb of labels){
    const { nationalAvg, schoolAvg } = await getAverages(school, lb);
    nat.push(nationalAvg ?? null);
    sch.push(schoolAvg   ?? null);
  }
  drawLineChart(
    document.getElementById('card-sid-canvas'),
    labels,
    [
      { name: '본인',     values: me  },
      { name: '학교평균', values: sch },
      { name: '전국평균', values: nat },
    ],
    TOTAL_MAX
  );
  const cap = document.getElementById('card-sid-cap');
  if (cap) cap.textContent = `회차별 총점 추이 (최대 ${TOTAL_MAX})`;
}

/* --------------------------
   9) 폼/라우팅
--------------------------- */
function goHome(){
  $("#view-result")?.classList.add("hidden");
  $("#view-home")?.classList.remove("hidden");
  $("#sid")?.focus();
}

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
    // 화면 전환은 동적 카드가 렌더되면
    await renderResultDynamic(id);
    $("#view-home")?.classList.add("hidden");
    $("#view-result")?.classList.remove("hidden");
  } catch (err){
    console.error(err);
    showError("존재하지 않는 학수번호거나 미응시자입니다.");
  }
  return false;
}

/* --------------------------
   10) 초기화 & 전역
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

  // ?sid=015001 자동 조회
  const p = new URLSearchParams(location.search);
  const sid = p.get("sid") || p.get("id");
  if (sid && /^\d{6}$/.test(sid)) {
    if ($sid) $sid.value = sid;
    form?.dispatchEvent(new Event("submit", {cancelable:true}));
  }
}

document.addEventListener('DOMContentLoaded', initApp);

// 전역 노출
window.goHome = goHome;
window.initApp = initApp;
window.normalizeRound = normalizeRound;
window.renderResultDynamic = renderResultDynamic;

// Firestore 로더가 참조할 전역
window.__SUBJECT_TOTALS = SUBJECT_MAX;
window.__GROUPS_DEF     = GROUPS;

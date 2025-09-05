/* =========================================================
   전졸협 성적 SPA 스크립트 (오프라인 + Firestore 호환)
   - 학수번호 입력 → Firestore 계산 결과(우선) 또는 SCORE_DATA(오프라인) → 렌더
   - 요구사항:
     1) 과목별 고정 문항수(총 340) 강제
     2) 그룹별(그룹 총점 기준) 40% 과락
     3) 그룹 박스: 과락 빨강 / 통과 초록
     4) 그룹1 과목 줄 나눔(간심비폐신 / 상한 사상)
     5) 새 스키마(subject_results, group_results) 및 기존(by_class) 호환
   ========================================================= */

/* --------------------------
   0) 과목별 문항 수(고정) / 그룹 정의
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

// (임시) 평균치 가져오기 — 나중에 Firestore 값으로 교체 가능
async function getAverages(schoolName, roundLabel){
  const TOTAL = ALL_SUBJECTS.reduce((a,n)=>a+(SUBJECT_MAX[n]||0),0);
  return {
    nationalAvg: Math.round(TOTAL * 0.60),
    schoolAvg:   Math.round(TOTAL * 0.62)
  };
}

// 캔버스 막대 그래프
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
// 모든 과목 목록(렌더/합계에 사용)
const ALL_SUBJECTS = GROUPS.flatMap(g => g.subjects);

/* --------------------------
   1) 데이터 로드/인덱스 (오프라인 대비)
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

const ROUND_LABELS = ["1차","2차","3차","4차","5차","6차","7차","8차"];

async function discoverRoundsFor(sid){
  const found = [];
  for (const label of ROUND_LABELS){
    try {
      const r = await window.fetchRoundFromFirestore(sid, label);
      // 데이터 존재 판단: 과목 총점이 0보다 크거나, 새스키마면 total_correct>0
      if (r && (
        (typeof r.total_correct === 'number' && r.total_correct > 0) ||
        (()=>{ // 과목합 검사
          const norm = (window.normalizeRound?.(r)) || r;
          const subjects = getSubjectScores(norm);
          const sum = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0),0);
          return sum > 0;
        })()
      )) {
        found.push({ label, raw:r });
      }
    } catch (_e) {
      // 없는 회차는 조용히 무시
    }
  }
  return found; // [{label, raw}]
}

/* --------------------------
   2) DOM/유틸
--------------------------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

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

function makeFlipCard({id, title, frontHTML}){
  const wrap = document.createElement('div');
  wrap.className = 'col-12 col-lg-4';
  wrap.innerHTML = `
    <div id="${id}" class="flip-card">
      <div class="flip-inner">
        <div class="flip-face flip-front card">${frontHTML}</div>
        <div class="flip-face flip-back card">
          <h2 style="margin-top:0">${title} 평균 비교</h2>
          <canvas id="${id}-canvas" width="360" height="180"></canvas>
          <div class="small" id="${id}-cap" style="margin-top:8px; opacity:.8"></div>
        </div>
      </div>
    </div>
  `;
  // 클릭으로 뒤집기(버튼 클릭은 제외)
  const card = wrap.querySelector('.flip-card');
  card.addEventListener('click', (e)=>{
    if (e.target.closest('button')) return;
    card.classList.toggle('is-flipped');
  });
  return wrap;
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

  // ★ 새 스키마: total_questions/total_correct + subject_results(우선)
  if ('total_questions' in raw && 'total_correct' in raw) {
    const groups = {};

    if (Array.isArray(raw.subject_results) && raw.subject_results.length){
      raw.subject_results.forEach(s=>{
        const nm = s.name;
        groups[nm] = {
          score: Number(s.correct)||0,
          max:   SUBJECT_MAX[nm] ?? (Number(s.total)||0)
        };
      });
    } else if (Array.isArray(raw.group_results)) {
      // 폴백: group_results 항목의 name이 과목명일 때만 사용
      raw.group_results.forEach(g=>{
        const nm = String(g.name);
        if (nm in SUBJECT_MAX) {
          groups[nm] = {
            score: Number(g.correct)||0,
            max:   SUBJECT_MAX[nm] ?? (Number(g.total)||0)
          };
        }
      });
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

// Firestore 우선 조회 (window.fetchRoundFromFirestore 는 firestore-loader.js가 주입)
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
    let r1 = null, r2 = null;

    if (typeof window.fetchRoundFromFirestore === "function") {
      r1 = await window.fetchRoundFromFirestore(id, "1차");
      r2 = await window.fetchRoundFromFirestore(id, "2차");
    } else {
      // 모듈 로더가 준비 전이면 오프라인 데이터로라도 표시
      const data = getStudentById(id);
      if (!data) throw new Error("no offline data");
      const { r1:rr1, r2:rr2 } = extractRounds(data);
      r1 = rr1; r2 = rr2;
    }

    const norm1 = (window.normalizeRound?.(r1)) || r1;
    const norm2 = (window.normalizeRound?.(r2)) || r2;

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

async function renderResultDynamic(sid){
  // 0) 학교/학수번호 카드 먼저
  const school = getSchoolFromSid(sid);
  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';

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
      <div class="small" style="opacity:.8">카드를 클릭하면 학교/전국 평균 비교 그래프가 나옵니다.</div>
    `
  });
  grid.appendChild(sidCard);

  // 1) 회차 자동 탐색
  const rounds = await discoverRoundsFor(sid); // [{label, raw}]
  if (rounds.length === 0){
    // 없으면 메시지
    const msg = document.createElement('div');
    msg.className = 'col-12';
    msg.innerHTML = `<div class="card"><div class="small" style="opacity:.8">조회 가능한 회차 데이터가 없습니다.</div></div>`;
    grid.appendChild(msg);
  }

  // 2) 각 회차 카드 생성 + 앞면에 기존 renderRound 재사용
  //    renderRound(selector, title, roundNorm)
  const totalMax = ALL_SUBJECTS.reduce((a,n)=>a+(SUBJECT_MAX[n]||0),0);
  const studentTotals = {}; // { '1차': number, ... } — 뒤면 차트에 사용

  for (const {label, raw} of rounds){
    const norm = (window.normalizeRound?.(raw)) || raw;

    // 앞면 컨테이너 id를 만들어 renderRound 삽입
    const hostId = `round-host-${label}`;
    const card = makeFlipCard({
      id: `card-${label}`,
      title: label,
      frontHTML: `<div id="${hostId}"></div>`
    });
    grid.appendChild(card);
    renderRound(`#${hostId}`, label, norm);

    // 개인 총점 산출(뒤면 차트용)
    const subjects = getSubjectScores(norm);
    studentTotals[label] = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0),0);
  }

  // 3) 배지(최상단) — 1차/2차만 표시하고 싶으면 rounds에서 찾아서 붙임
  const badgesHost = document.getElementById('res-badges');
  if (badgesHost){
    badgesHost.innerHTML = '';
    for (const check of ['1차','2차']){
      const r = rounds.find(x=>x.label===check);
      if (!r) continue;
      const norm = (window.normalizeRound?.(r.raw)) || r.raw;
      const subjects = getSubjectScores(norm);
      const sc = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0),0);
      const passOverall = sc >= totalMax*0.6; // (여기선 단순 pass만 배지로)
      badgesHost.innerHTML += `<span class="badge ${passOverall?'pass':'fail'}">${check} ${passOverall?'합격':'불합격'}</span>`;
    }
  }

  // 4) 뒤면 그래프 그리기
  const schoolName = school;
  for (const {label} of rounds){
    const my = studentTotals[label]||0;
    const { nationalAvg, schoolAvg } = await getAverages(schoolName, label);
    drawBarChart(document.getElementById(`card-${label}-canvas`), [
      {label:'본인', value: my},
      {label:'학교평균', value: schoolAvg},
      {label:'전국평균', value: nationalAvg},
    ]);
    const c = document.getElementById(`card-${label}-cap`);
    if (c) c.textContent = `${label} 총점 기준 / 최대 ${totalMax}`;
  }

  // 학수번호 카드(종합) — 최근 회차(있으면 2차→… 우선)로 비교
  const pick = rounds.find(r=>r.label==='2차') || rounds[rounds.length-1] || null;
  if (pick){
    const my = studentTotals[pick.label]||0;
    const { nationalAvg, schoolAvg } = await getAverages(schoolName, pick.label);
    drawBarChart(document.getElementById('card-sid-canvas'), [
      {label:'본인', value: my},
      {label:'학교평균', value: schoolAvg},
      {label:'전국평균', value: nationalAvg},
    ]);
    const c = document.getElementById('card-sid-cap');
    if (c) c.textContent = `${pick.label} 총점 기준 / 최대 ${totalMax}`;
  }
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

  // 과목별 점수/최대 강제 적용
  const subjects = getSubjectScores(round);

  // 전체 합계(총점 340 기준)
  const totalScore = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0), 0);
  const totalMax   = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.max||0),   0);
  const overallRate = pct(totalScore, totalMax);

  // ====== 그룹별 과락 판정(40% 미만) 미리 계산 ======
  const groupSummaries = GROUPS.map(g => {
    const gScore = g.subjects.reduce((a,n)=>a+(subjects[n]?.score||0), 0);
    const gMax   = g.subjects.reduce((a,n)=>a+(subjects[n]?.max||0),   0);
    const gRate  = pct(gScore, gMax);
    const gPass  = gScore >= Math.ceil(gMax * 0.4); // 40%
    return { def:g, score:gScore, max:gMax, rate:gRate, pass:gPass };
  });

  const anyGroupFail = groupSummaries.some(s => !s.pass);

  // ====== 평락(총점 60% 미만) 판정 ======
  const meets60 = (totalScore >= totalMax * 0.6); // 60% 이상이면 통과
  const overallPass = meets60 && !anyGroupFail;

  // ====== 사유 문구 생성 ======
  let reasonText = "통과";
  if (!overallPass){
    if (!meets60 && anyGroupFail) reasonText = "과락 및 평락으로 인한 불합격";
    else if (!meets60)            reasonText = "평락으로 인한 불합격";
    else                          reasonText = "과락으로 인한 불합격";
  }

  // 라운드 박스 상태 클래스
  const roundCls = `round ${overallPass ? "" : "fail"}`;

  // ====== 상단 총점 박스 + 진행도바(60% 컷 라인 포함) ======
  let html = `
    <div class="${roundCls}">
      <div class="flex" style="justify-content:space-between;">
        <h2 style="margin:0">${title} 총점</h2>
        <div class="kpi"><div class="num">${fmt(totalScore)}</div><div class="sub">/ ${fmt(totalMax)}</div></div>
      </div>

      <div class="progress" style="margin:8px 0 2px 0">
        <div class="bar" style="width:${overallRate}%"></div>
        <div class="cutline" style="left:60%"></div>
      </div>

      <div class="small progress-caption" style="margin-top:10px">
        정답률 ${overallRate}% (컷 60%) · ${overallPass ? pill("통과","ok") : pill("불합격","red")}
        <div class="small" style="margin-top:6px; opacity:.9">${reasonText}</div>
      </div>
    </div>

    <div class="group-grid" style="margin-top:12px">
  `;

  // ====== 그룹 박스 렌더(각 그룹 옆에 '통과'/'과락' 표시) ======
  groupSummaries.forEach(({def, score, max, rate, pass})=>{
    // 과목 칩들
    let chipsHtml = "";
    const names = def.subjects;
    if (def.layoutChunks && def.layoutChunks.length){
      const rows = (function chunk(arr, sizes){
        const out=[]; let i=0;
        for(const s of sizes){ out.push(arr.slice(i,i+s)); i+=s; }
        if (i < arr.length) out.push(arr.slice(i));
        return out;
      })(names, def.layoutChunks);
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
      <div class="group-box ${pass ? "ok" : "fail"} span-${def.span||12}">
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

  // ?sid=015001 자동 표시 (Firestore 로더가 준비돼 있어도 정상 동작)
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
window.renderResultDynamic = renderResultDynamic;  // ← 필요 시 외부에서 쓰려면 이걸로
// Firestore 로더가 참조할 전역(중복 선언 금지)
window.__SUBJECT_TOTALS = SUBJECT_MAX;
window.__GROUPS_DEF     = GROUPS;

/* === Flip card 안정화 === */
.flip-card { perspective: 1200px; }
.flip-card .flip-inner{
  position: relative;
  width: 100%;
  height: var(--flip-h, 280px); /* 카드 높이 고정 (필요시 260~340px로 조절) */
  transform-style: preserve-3d;
  transition: transform .6s ease;
}
.flip-card.is-flipped .flip-inner{ transform: rotateY(180deg); }

.flip-card .flip-face{
  position: absolute;
  inset: 0;                 /* 앞/뒤 면을 래퍼 높이 안에서 겹치게 */
  backface-visibility: hidden;
  border-radius: 16px;
  overflow: hidden;         /* 내용이 넘치면 잘림 */
}
.flip-card .flip-front{ transform: rotateY(0deg); }
.flip-card .flip-back { transform: rotateY(180deg); }

/* 데스크탑에서 3열 카드 쓸 때 */
@media (min-width: 960px){
  .col-lg-4{ grid-column: span 4; }
}

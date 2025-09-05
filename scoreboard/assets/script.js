/* =========================================================
   전졸협 성적 SPA 스크립트 (오답 패널 반영판, 최종)
   - 상단(맨 위) 카드 앞면: 학수번호/학교 + 회차 배지
   - 상단 카드 뒷면: 꺾은선(본인/학교/전국) — 존재하는 회차만
   - 각 회차 카드 앞면: 상세(총점/그룹/과락)
   - 각 회차 카드 뒷면: 과목별 틀린 문항 목록(wrongQuestions)
   - 플립 높이: 앞/뒤 중 큰 쪽에 자동 맞춤(동적 추가/캔버스 렌더 후 포함)
========================================================= */

/* -------------------- 0) 과목/그룹 정의 -------------------- */
const SUBJECT_MAX = {
  "간":16, "심":16, "비":16, "폐":16, "신":16,
  "상한":16, "사상":16,
  "침구":48,
  "보건":20,
  "외과":16, "신경":16, "안이비":16,
  "부인과":32, "소아":24,
  "예방":24, "생리":16, "본초":16
};
const GROUPS = [
  { id: "그룹1", label: "그룹 1", subjects: ["간","심","비","폐","신","상한","사상"], layoutChunks: [5,2], span: 12 },
  { id: "그룹3", label: "그룹 3", subjects: ["침구"], span: 12 },
  { id: "그룹2", label: "그룹 2", subjects: ["보건"], span: 12 },
  { id: "그룹4", label: "그룹 4", subjects: ["외과","신경","안이비"], span: 12 },
  { id: "그룹5", label: "그룹 5", subjects: ["부인과","소아"], span: 12 },
  { id: "그룹6", label: "그룹 6", subjects: ["예방","생리","본초"], span: 12 },
];
const ALL_SUBJECTS = GROUPS.flatMap(g => g.subjects);
const TOTAL_MAX = ALL_SUBJECTS.reduce((a,n)=>a+(SUBJECT_MAX[n]||0),0); // 340

// 01~12 → 학교명
const SCHOOL_MAP = {
  "01":"가천대","02":"경희대","03":"대구한","04":"대전대",
  "05":"동국대","06":"동신대","07":"동의대","08":"부산대",
  "09":"상지대","10":"세명대","11":"우석대","12":"원광대"
};
function getSchoolFromSid(sid){ const p2 = String(sid||"").slice(0,2); return SCHOOL_MAP[p2] || "미상"; }

const ROUND_LABELS = ["1차","2차","3차","4차","5차","6차","7차","8차"];

/* -------------------- 1) 평균치(임시) -------------------- */
async function getAverages(_schoolName, _roundLabel){
  return { nationalAvg: Math.round(TOTAL_MAX * 0.60), schoolAvg: Math.round(TOTAL_MAX * 0.62) };
}

/* -------------------- 2) 오프라인 인덱스 -------------------- */
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

/* -------------------- 3) 유틸 -------------------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
function fmt(n){ return (n==null || isNaN(Number(n))) ? "-" : Number(n).toLocaleString("ko-KR"); }
function pct(score, max){ const s=+score||0, m=+max||0; return m<=0 ? 0 : Math.round((s/m)*100); }
function pill(text, type){ const cls = type==='ok'?'pill green':(type==='warn'?'pill warn':'pill red'); return `<span class="${cls}">${text}</span>`; }
function showError(msg){ const e=$("#error"); if(!e) return; e.textContent=msg; e.classList.remove("hidden"); }
function hideError(){ const e=$("#error"); if(!e) return; e.textContent=""; e.classList.add("hidden"); }
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

/* -------------------- 4) 정규화 -------------------- */
function normalizeRound(raw){
  if (!raw || typeof raw !== 'object') return null;

  // 새 스키마
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
    return { total:{score:0,max:0}, pass:!!(raw.overall_pass ?? raw.round_pass ?? raw.pass), fails:[], by_class:{ "종합":{ total:{score:0,max:0}, groups } } };
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

// 과목 점수 맵
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

/* -------------------- 5) 회차 자동 탐색(존재하는 회차만) -------------------- */
async function discoverRoundsFor(sid){
  const found = [];
  for (const label of ROUND_LABELS){
    try {
      const r = await window.fetchRoundFromFirestore?.(sid, label);
      if (!r) continue;
      const ok = (typeof r.total_correct === 'number' && r.total_correct > 0) || (()=>{
        const norm = (window.normalizeRound?.(r)) || r;
        const subjects = getSubjectScores(norm);
        const sum = ALL_SUBJECTS.reduce((a,n)=>a+(subjects[n]?.score||0),0);
        return sum > 0;
      })();
      if (ok) found.push({ label, raw:r });
    } catch (_) {}
  }
  return found;
}

/* -------------------- 6) Canvas 차트 -------------------- */
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

  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT+plotH);
  ctx.lineTo(padL+plotW, padT+plotH);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  labels.forEach((lb,i)=> ctx.fillText(lb, x(i), padT+plotH+18));

  const colors = ['#7ea2ff','#4cc9ff','#22c55e'];
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

/* -------------------- 7) 오답 수집 & 패널 -------------------- */

// 다양한 키를 허용해 과목별 오답 배열을 안전하게 뽑는다.
function extractWrongFromSubjectRow(row){
  const candidates = [
    "wrongQuestions","wrong_questions","wrongs","wrong",
    "incorrectQuestions","incorrect_questions","incorrect",
    "오답","틀린문항"
  ];
  for (const k of candidates){
    if (!row || !(k in row)) continue;
    const v = row[k];
    if (Array.isArray(v)) {
      return v.map(n=>+n).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
    }
    if (typeof v === 'string') {
      const arr = v.split(/[,\s]+/).map(n=>+n).filter(n=>!isNaN(n));
      if (arr.length) return arr.sort((a,b)=>a-b);
    }
  }
  return [];
}

// round(raw 또는 normalized)에서 과목별 오답 맵 {과목명:[번호...]} 추출
function collectWrongQuestions(roundRawOrNorm){
  // 1) 새 스키마: subject_results에 직접 오답이 있을 수 있음
  if (Array.isArray(roundRawOrNorm?.subject_results)) {
    const out = {};
    roundRawOrNorm.subject_results.forEach(s=>{
      const name = s?.name;
      if (!name) return;
      const wrongs = extractWrongFromSubjectRow(s);
      if (wrongs.length) out[name] = wrongs;
    });
    return out;
  }

  // 2) 새 스키마(폴백): group_results 항목의 name이 과목명일 때
  if (Array.isArray(roundRawOrNorm?.group_results)) {
    const out = {};
    roundRawOrNorm.group_results.forEach(g=>{
      const name = String(g?.name || '');
      if (!(name in SUBJECT_MAX)) return; // 과목명 아니면 스킵
      const wrongs = extractWrongFromSubjectRow(g);
      if (wrongs.length) out[name] = wrongs;
    });
    return out;
  }

  // 3) 구 스키마 계열: by_class["종합"].groups 안의 각 과목 row에서 오답 키 탐색
  const normalized = (roundRawOrNorm?.by_class) ? roundRawOrNorm : (window.normalizeRound?.(roundRawOrNorm) || roundRawOrNorm);
  const groups = normalized?.by_class?.["종합"]?.groups || {};
  const out = {};
  Object.keys(groups).forEach(name=>{
    const row = groups[name] || {};
    const wrongs = extractWrongFromSubjectRow(row);
    if (wrongs.length) out[name] = wrongs;
  });
  return out;
}

function buildWrongPanelHTML(roundLabel, roundRawOrNorm){
  const wrongMapRaw = collectWrongQuestions(roundRawOrNorm);

  // 17개 과목 전부 버튼으로 노출 (오답이 없어도 버튼 생성)
  const items = ALL_SUBJECTS.map(sj => {
    const arr = Array.isArray(wrongMapRaw[sj]) ? wrongMapRaw[sj].slice(0, 999) : [];
    const cells = arr.length
      ? arr.map(n => `<div class="qcell bad">${n}</div>`).join('')
      : '<div class="small" style="opacity:.8">오답 없음</div>';

    return `
      <div class="item">
        <button type="button" class="acc-btn"
          onclick="this.classList.toggle('open'); const p=this.nextElementSibling; p.style.maxHeight = p.style.maxHeight ? '' : p.scrollHeight + 'px';">
          <span>${sj} 오답 (${arr.length}문항)</span>
          <span class="rotate">❯</span>
        </button>
        <div class="panel">
          <div class="qgrid" style="padding:6px 0">${cells}</div>
        </div>
      </div>
    `;
  });

  return `
    <h2 style="margin-top:0">${roundLabel} 오답 피드백</h2>
    <div class="small" style="opacity:.8; margin-bottom:6px">과목명을 클릭하면 틀린 문항이 펼쳐집니다.</div>
    <div class="accordion">
      ${items.join('')}
    </div>
  `;
}

/* -------------------- 8) 플립 카드 -------------------- */
function makeFlipCard({id, title, frontHTML, backHTML, backCaption}){
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="${id}" class="flip-card">
      <div class="flip-inner">
        <div class="flip-face flip-front card">${frontHTML}</div>
        <div class="flip-face flip-back card">
          ${backHTML ?? `
            <h2 style="margin-top:0">${title} 평균 비교</h2>
            <canvas id="${id}-canvas" width="360" height="200"></canvas>
            <div class="small" id="${id}-cap" style="margin-top:8px; opacity:.8">${backCaption||''}</div>
          `}
        </div>
      </div>
    </div>
  `;
  const card = wrap.querySelector('.flip-card');
  card.addEventListener('click', (e)=>{
    if (e.target.closest('button')) return; // 아코디언 버튼 클릭 예외
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

/* -------------------- 9) 회차 상세(앞면) -------------------- */
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

  // 평락/종합
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
        정답률 ${overallRate}% (컷 60%: 204/340) · ${overallPass ? pill("통과","ok") : pill("불합격","red")}
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

/* -------------------- 10) 전체 렌더 -------------------- */
async function renderResultDynamic(sid){
  const grid = $("#cards-grid");
  grid.innerHTML = "";

  const school = getSchoolFromSid(sid);
  const rounds = await discoverRoundsFor(sid);
  if (rounds.length === 0){
    const msg = document.createElement('div');
    msg.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="small" style="opacity:.8">조회 가능한 회차 데이터가 없습니다.</div></div>`;
    grid.appendChild(msg);
    return;
  }

  // 회차 카드들만 렌더 (앞: 상세, 뒤: 오답 패널)
  for (const {label, raw} of rounds){
    const norm = (window.normalizeRound?.(raw)) || raw;
    const hostId = `round-host-${label}`;

    // 뒤면: 과목별 오답 패널 (항상 17개 과목을 버튼으로 노출)
    const roundBackHTML = buildWrongPanelHTML(label, raw);

    const card = makeFlipCard({
      id: `card-${label}`,
      title: label,
      frontHTML: `<div id="${hostId}"></div>`,
      backHTML: roundBackHTML
    });
    grid.appendChild(card);

    // 앞면 상세 렌더
    renderRound(`#${hostId}`, label, norm);
  }

  // 플립 높이 동기화(앞/뒤 큰쪽)
  requestAnimationFrame(()=>{
    syncFlipHeights(grid);
    installFlipHeightObservers();
  });
}
/* -------------------- 11) 폼/라우팅 -------------------- */
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
    await renderResultDynamic(id);
    $("#view-home")?.classList.add("hidden");
    $("#view-result")?.classList.remove("hidden");
  } catch (err){
    console.error(err);
    showError("존재하지 않는 학수번호거나 미응시자입니다.");
  }
  return false;
}

/* -------------------- 12) 초기화 & 전역 -------------------- */
function initApp(){
  // 살짝 간격 추가(박스들 너무 붙지 않게)
  (function injectMinorSpacing(){
    const css = `
      #cards-grid { display:grid; gap:14px; }        /* 카드 사이 간격 */
      .flip-card { margin:0; }                       /* 개별 마진은 0 */
      .accordion .item { margin-bottom: 6px; }
      .accordion .acc-btn{ width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--line); border-radius:10px; background:var(--surface-1); font-weight:700; }
      .accordion .acc-btn .rotate{ transition:.2s transform ease; }
      .accordion .acc-btn.open .rotate{ transform: rotate(90deg); }
      .accordion .panel{ overflow:hidden; max-height:0; transition:max-height .25s ease; }
      .qgrid{ display:flex; flex-wrap:wrap; gap:6px; }
      .qcell{ padding:3px 8px; border-radius:999px; border:1px solid var(--line); font-weight:700; }
      .qcell.bad{ background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.55); }
      .group-grid{ display:grid; grid-template-columns:repeat(12,1fr); gap:12px; }
      .group-box{ border:1px solid var(--line); border-radius:12px; padding:12px; background:var(--surface-2) }
      .group-box.ok{ background:rgba(34,197,94,.12); border-color:rgba(34,197,94,.55) }
      .group-box.fail{ background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.55) }
      .subj-row{ display:flex; flex-wrap:wrap; gap:6px 10px; margin-top:6px }
      .subj-chip{ padding:4px 8px; border:1px solid var(--line); border-radius:999px; font-weight:800 }
      .subj-chip .muted{ opacity:.7; font-weight:600 }
      .cutline{ left:60% }
    `;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  })();

  const $sid = $("#sid");
  if ($sid) {
    $sid.addEventListener('input', () => {
      $sid.value = ($sid.value || '').replace(/\D/g, '').slice(0, 6);
    });
    $sid.setAttribute('enterkeyhint', 'done');
  }

  const form = $("#lookup-form");
  if (form) form.addEventListener('submit', lookupStudent);

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
window.__SUBJECT_TOTALS = SUBJECT_MAX;
window.__GROUPS_DEF     = GROUPS;

/* -------------------- 13) Flip 높이 동기화 -------------------- */
function measureFaceHeight(card, faceEl){
  const tmp = document.createElement('div');
  tmp.className = faceEl.className.replace('flip-face','').trim(); // .card 스타일 유지
  tmp.style.cssText = `
    position:absolute; visibility:hidden; left:-9999px; top:-9999px;
    width:${card.clientWidth}px;
  `;
  tmp.innerHTML = faceEl.innerHTML;
  document.body.appendChild(tmp);
  const h = Math.ceil(tmp.scrollHeight);
  document.body.removeChild(tmp);
  return h;
}

function syncFlipHeights(root = document){
  const scope = (root instanceof Element ? root : document);
  const cards = scope.querySelectorAll('.flip-card');
  cards.forEach(card=>{
    const inner = card.querySelector('.flip-inner');
    const front = card.querySelector('.flip-front');
    const back  = card.querySelector('.flip-back');
    if (!inner || !front || !back) return;
    const hf = measureFaceHeight(card, front);
    const hb = measureFaceHeight(card, back);
    inner.style.height = Math.max(hf, hb) + 'px';
  });
}

let __flipObserverInstalled = false;
function installFlipHeightObservers(){
  if (__flipObserverInstalled) return;
  __flipObserverInstalled = true;

  const grid = document.getElementById('cards-grid');

  window.addEventListener('resize', ()=> syncFlipHeights(grid));

  const ro = new ResizeObserver(()=> syncFlipHeights(grid));

  const mo = new MutationObserver((mutList)=>{
    mutList.forEach(m=>{
      m.addedNodes.forEach(node=>{
        if (!(node instanceof Element)) return;
        node.querySelectorAll?.('.flip-card .flip-face').forEach(face => ro.observe(face));
        if (node.matches?.('.flip-card') || node.querySelector?.('.flip-card')) {
          requestAnimationFrame(()=> syncFlipHeights(grid));
        }
      });
    });
  });
  if (grid) mo.observe(grid, { childList:true, subtree:true });

  document.querySelectorAll('.flip-card .flip-face').forEach(el=> ro.observe(el));

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(()=> syncFlipHeights(grid)).catch(()=>{});
  }
}

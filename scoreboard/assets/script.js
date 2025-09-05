<script>
/* =========================================================
   전졸협 성적 SPA 스크립트 (오답 패널 반영판)
   - 상단 카드 뒤: 꺾은선(본인/학교/전국)
   - 회차 카드 뒤: 과목별 틀린 문제 목록(wrongQuestions)
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

const SCHOOL_MAP = {
  "01":"가천대","02":"경희대","03":"대구한","04":"대전대",
  "05":"동국대","06":"동신대","07":"동의대","08":"부산대",
  "09":"상지대","10":"세명대","11":"우석대","12":"원광대"
};
function getSchoolFromSid(sid){ const p2 = String(sid||"").slice(0,2); return SCHOOL_MAP[p2] || "미상"; }

const ROUND_LABELS = ["1차","2차","3차","4차","5차","6차","7차","8차"];

/* -------------------- 1) 평균치(임시) -------------------- */
async function getAverages(schoolName, roundLabel){
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

  if ('total_questions' in raw && 'total_correct' in raw) { // 새 스키마
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

/* -------------------- 5) 회차 자동 탐색 -------------------- */
async function discoverRoundsFor(sid){
  const found = [];
  for (const label of ROUND_LABELS){
    try {
      const r = await window.fetchRoundFromFirestore?.(sid, label);
      if (!r) continue;
      const ok = (typeof r.total_correct === 'number' && r.total_correct > 0) || (() => {
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
// 막대(상단 카드가 아님: 회차 카드 뒤는 이제 오답 패널이라 사용X, 필요시 남겨둠)
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
// 다양한 키를 허용해 과목별 오답 배열을 뽑는다.
function extractWrongFromSubjectRow(row){
  // 후보 키들
  const keys = [
    "wrongQuestions","wrong_questions","wrongs","wrong","incorrectQuestions","incorrect_questions","incorrect","오답","틀린문항"
  ];
  for (const k of keys){
    if (k in (row||{})) {
      const v = row[k];
      if (Array.isArray(v)) return v.map(n=>+n).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
      // 문자열 "1, 3, 7" 형태도 허용
      if (typeof v === 'string') {
        const arr = v.split(/[,\s]+/).map(n=>+n).filter(n=>!isNaN(n));
        if (arr.length) return arr.sort((a,b)=>a-b);
      }
    }
  }
  return [];
}

// round(raw or normalized)에서 과목별 오답 맵 {과목:[번호...]}
function collectWrongQuestions(roundRawOrNorm){
  const r = (roundRawOrNorm?.by_class || roundRawOrNorm?.subject_results || roundRawOrNorm?.group_results)
    ? roundRawOrNorm
    : (window.normalizeRound?.(roundRawOrNorm) || roundRawOrNorm);

  // 1) 새 스키마: subject_results
  if (Array.isArray(roundRawOrNorm?.subject_results)) {
    const out = {};
    roundRawOrNorm.subject_results.forEach(s=>{
      const nm = s.name;
      if (!nm) return;
      const wrongs = extractWrongFromSubjectRow(s);
      if (wrongs.length) out[nm] = wrongs;
    });
    return out;
  }
  // 2) 새 스키마(폴백): group_results 항목이 과목명일 때
  if (Array.isArray(roundRawOrNorm?.group_results)) {
    const out = {};
    roundRawOrNorm.group_results.forEach(g=>{
      const nm = String(g.name);
      if (!(nm in SUBJECT_MAX)) return; // 과목명 아닌 그룹은 스킵
      const wrongs = extractWrongFromSubjectRow(g);
      if (wrongs.length) out[nm] = wrongs;
    });
    return out;
  }
  // 3) 구 스키마 계열(by_class → "종합".groups 안의 과목 row에 오답 키가 있는 경우)
  const groups = r?.by_class?.["종합"]?.groups || {};
  const out = {};
  Object.keys(groups).forEach(nm=>{
    const row = groups[nm] || {};
    const wrongs = extractWrongFromSubjectRow(row);
    if (wrongs.length) out[nm] = wrongs;
  });
  return out;
}

// 오답 패널 HTML (과목별 아코디언 + qcell 목록)
function buildWrongPanelHTML(roundLabel, roundRawOrNorm){
  const wrongMap = collectWrongQuestions(roundRawOrNorm);

  const subjectOrder = ALL_SUBJECTS; // 표준 과목 순서 유지
  const items = subjectOrder
    .filter(sj => Array.isArray(wrongMap[sj]) && wrongMap[sj].length)
    .map(sj => {
      const arr = wrongMap[sj].slice(0, 999); // 과도한 길이 방지
      const cells = arr.map(n => `<div class="qcell bad">${n}</div>`).join('');
      return `
        <div class="item">
          <button type="button" onclick="this.classList.toggle('open'); const p=this.nextElementSibling; p.style.maxHeight = p.style.maxHeight ? '' : p.scrollHeight + 'px';">
            <span>${sj} 오답 (${arr.length}문항)</span>
            <span class="rotate">❯</span>
          </button>
          <div class="panel">
            <div class="qgrid" style="padding:6px 0">${cells || '<div class="small">오답 없음</div>'}</div>
          </div>
        </div>
      `;
    });

  const emptyHtml = `
    <div class="small" style="opacity:.8">
      제공된 데이터에 과목별 오답 항목이 없습니다.
    </div>
  `;

  return `
    <h2 style="margin-top:0">${roundLabel} 오답 피드백</h2>
    <div class="small" style="opacity:.8; margin-bottom:6px">과목명을 클릭하면 틀린 문항이 펼쳐집니다.</div>
    <div class="accordion">
      ${items.length ? items.join('') : emptyHtml}
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
    msg.innerHTML = `<div class="card"><div class="small" style="opacity:.8">조회 가능한 회차 데이터가 없습니다.</div></div>`;
    grid.appendChild(msg);
    return;
  }

  // (A) 맨 위 카드 (앞: SID/학교/배지, 뒤: 꺾은선)
  const topCard = makeFlipCard({
    id: 'card-trend',
    title: '종합 추이',
    frontHTML: `
      <div class="flex" style="justify-content:space-between;">
        <div>
          <div class="small">학수번호</div>
          <div class="kpi"><div class="num">${sid}</div></div>
          <div class="small">${school}</div>
        </div>
        <div class="flex" id="trend-badges"></div>
      </div>
      <hr class="sep" />
      <div class="small" style="opacity:.8">카드를 클릭하면 회차별 본인/학교/전국 꺾은선 그래프가 보입니다.</div>
    `
    // backHTML 미지정 → 캔버스 기본 템플릿 사용
  });
  topCard.querySelector('.flip-inner').style.setProperty('--flip-h','320px');
  grid.appendChild(topCard);

  // (B) 회차 카드들 (앞: 상세, 뒤: 오답 패널)
  const studentTotals = {}; // 꺾은선에 사용
  for (const {label, raw} of rounds){
    const norm = (window.normalizeRound?.(raw)) || raw;
    const hostId = `round-host-${label}`;

    const roundBackHTML = buildWrongPanelHTML(label, raw); // 오답 패널 생성

    const card = makeFlipCard({
      id: `card-${label}`,
      title: label,
      frontHTML: `<div id="${hostId}"></div>`,
      backHTML: roundBackHTML
    });
    grid.appendChild(card);

    renderRound(`#${hostId}`, label, norm);

    // 본인 총점 저장(상단 꺾은선용)
    const subs = getSubjectScores(norm);
    studentTotals[label] = ALL_SUBJECTS.reduce((a,n)=>a+(subs[n]?.score||0),0);
  }

  // (C) 상단 배지(존재 회차만)
  const badgesHost = $('#trend-badges');
  if (badgesHost){
    badgesHost.innerHTML = '';
    rounds.forEach(({label, raw})=>{
      const norm = (window.normalizeRound?.(raw)) || raw;
      const subs = getSubjectScores(norm);
      const sc = ALL_SUBJECTS.reduce((a,n)=>a+(subs[n]?.score||0),0);
      const passOverall = (sc >= TOTAL_MAX*0.6);
      badgesHost.innerHTML += `<span class="badge ${passOverall?'pass':'fail'}">${label} ${passOverall?'합격':'불합격'}</span>`;
    });
  }

  // (D) 상단 카드 뒤: 존재 회차만 꺾은선
  const labels = rounds.map(r => r.label).sort((a,b)=> parseInt(a) - parseInt(b));
  const me  = labels.map(lb => studentTotals[lb] ?? null);
  const

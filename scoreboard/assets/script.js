/* =========================================================
   전졸협 성적 SPA 스크립트 (오답 패널 완전반영 · 상단 SID카드 제거판)
   - 각 회차 카드: 앞면(총점/그룹/과락) · 뒷면(과목별 오답 리스트)
   - Firestore에서 오는 다양한 스키마의 오답 키를 폭넓게 수집
   - 플립 높이: 앞/뒤 큰쪽으로 자동 동기화(동적 추가/캔버스/폰트 로드 이후 포함)
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

/* (참고: 학교/라운드 라벨) */
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

/* -------------------- 3-1) 과목명 정규화(별칭 ↔ 표준명) -------------------- */
const SUBJECT_ALIAS = {
  "간":"간","간학":"간","간담":"간",
  "심":"심","심학":"심",
  "비":"비","비학":"비",
  "폐":"폐","폐학":"폐",
  "신":"신","신학":"신",
  "상한":"상한","상한론":"상한",
  "사상":"사상","사상의학":"사상",
  "침구":"침구","침구학":"침구","acupuncture":"침구","chimgu":"침구",
  "보건":"보건","공중보건":"보건",
  "외과":"외과","외과학":"외과",
  "신경":"신경","신경과":"신경","neuro":"신경",
  "안이비":"안이비","안이비과":"안이비","안·이비":"안이비","안이비인후":"안이비","eyeent":"안이비",
  "부인과":"부인과","부인":"부인과","obgy":"부인과",
  "소아":"소아","소아과":"소아","pedi":"소아",
  "예방":"예방","예방의학":"예방","preventive":"예방",
  "생리":"생리","생리학":"생리","physio":"생리",
  "본초":"본초","본초학":"본초","materiamedica":"본초",
  // 로마자/축약
  "gan":"간","sim":"심","bi":"비","pye":"폐","pe":"폐","sin":"신","shin":"신",
  "sanghan":"상한","sasang":"사상","bogun":"보건","bogeon":"보건","oegwa":"외과","oe":"외과",
  "singyeong":"신경","sin-gyeong":"신경","anibi":"안이비","buin":"부인과","soa":"소아",
  "yebang":"예방","saengri":"생리","boncho":"본초","chimgu":"침구","jingju":"침구"
};
function toStdSubjectName(name){
  if (!name) return null;
  const raw = String(name).trim();
  if (SUBJECT_MAX[raw] != null) return raw;
  const key1 = raw.toLowerCase().replace(/\s+/g,'');
  if (SUBJECT_ALIAS[key1]) return SUBJECT_ALIAS[key1];
  if (SUBJECT_ALIAS[raw])  return SUBJECT_ALIAS[raw];
  const key2 = key1.replace(/[()\[\]\-_.]/g,'');
  return SUBJECT_ALIAS[key2] || null;
}

/* -------------------- 4) 점수 정규화 -------------------- */
function normalizeRound(raw){
  if (!raw || typeof raw !== 'object') return null;

  // 새 스키마
  if ('total_questions' in raw && 'total_correct' in raw) {
    const groups = {};
    if (Array.isArray(raw.subject_results)){
      raw.subject_results.forEach(s=>{
        const nmStd = toStdSubjectName(s.name);
        if (!nmStd) return;
        groups[nmStd] = { score:+(s.correct||0), max: SUBJECT_MAX[nmStd] ?? +(s.total||0) };
      });
    } else if (Array.isArray(raw.group_results)) {
      raw.group_results.forEach(g=>{
        const nmStd = toStdSubjectName(g.name);
        if (!nmStd) return;
        groups[nmStd] = { score:+(g.correct||0), max: SUBJECT_MAX[nmStd] ?? +(g.total||0) };
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
      const nmStd = toStdSubjectName(name);
      const gi = groupsRaw[name] || {};
      groups[nmStd || name] = { score:+(gi.score||0), max: (nmStd ? SUBJECT_MAX[nmStd] : +(gi.max||0)) };
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

/* -------------------- 5) Firestore 회차 자동 탐색 -------------------- */
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

/* -------------------- 6) (상단 꺾은선만 필요시) -------------------- */
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

  const legendX = padL, legendY = 12;
  series.forEach((s, si)=>{
    const col = colors[si % colors.length];
    ctx.fillStyle = col; ctx.fillRect(legendX + si*120, legendY-8, 10, 10);
    ctx.fillStyle = '#e8eeff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign='left';
    ctx.fillText(s.name, legendX + si*120 + 14, legendY+1);
  });
}


/* -------------------- 6.5) scores_raw → round 오답 주입기 -------------------- */
/**
 * Firestore 로더가 제공하는 훅들을 “있으면 사용, 없으면 그냥 통과” 방식으로 호출.
 * 기대하는 로더 측 함수(아무거나 하나만 구현돼도 됨):
 *  - window.fetchScoresRawSession(sid, roundLabel, sessionLabel) → { wrongNumbers: [...]} 또는 { wrong: [...]} 등
 *  - window.fetchScoresRawAllSessions(sid, roundLabel) → { "1교시":[...], "2교시":[...], ... }
 *  - window.fetchWrongBySession(sid, roundLabel) → { "1교시":[...], ... } (별칭)
 *
 * 반환: roundRaw에 { wrong_by_session: {...} } 을 병합한 새 객체
 */
async function enrichRoundWithWrongs(sid, roundLabel, roundRaw) {
  const dst = { ...roundRaw };

  // 1) 한 방에 모든 교시를 주는 API가 있으면 사용
  if (typeof window.fetchScoresRawAllSessions === 'function') {
    try {
      const all = await window.fetchScoresRawAllSessions(sid, roundLabel);
      if (all && typeof all === 'object') {
        dst.wrong_by_session = all;
        return dst;
      }
    } catch(e) { /* ignore */ }
  }
  if (typeof window.fetchWrongBySession === 'function') {
    try {
      const all = await window.fetchWrongBySession(sid, roundLabel);
      if (all && typeof all === 'object') {
        dst.wrong_by_session = all;
        return dst;
      }
    } catch(e) { /* ignore */ }
  }

  // 2) 세션별로 하나씩 불러오는 API가 있으면 1~4교시 순회
  const sessions = ["1교시","2교시","3교시","4교시"];
  const bag = {};
  let hit = false;

  if (typeof window.fetchScoresRawSession === 'function') {
    for (const sess of sessions) {
      try {
        const doc = await window.fetchScoresRawSession(sid, roundLabel, sess);
        // 예상 필드: wrongNumbers / wrong / wrong_questions / wrongQuestions
        const arr = toNumArray(
          doc?.wrongNumbers ?? doc?.wrong ?? doc?.wrong_questions ?? doc?.wrongQuestions
        );
        if (arr.length) { bag[sess] = arr; hit = true; }
      } catch(e) { /* ignore */ }
    }
  }

  if (hit) {
    dst.wrong_by_session = { ...(dst.wrong_by_session||{}), ...bag };
  }

  return dst;
}






/* -------------------- 7) 오답 수집 & 패널 -------------------- */

/** ① 교시 → 과목 구간표
 *  - 네가 준 기준(1교시): 1~16 간, 17~32 심, 33~48 비, 49~64 폐, 65~80 신
 *  - 나머지 교시는 알고 있는 구간대로 이어서 채우면 됨(예시는 비워둠)
 */
const SESSION_SUBJECT_RANGES = {
  "1교시": [
    { s: "간", from:  1, to: 16 },
    { s: "심", from: 17, to: 32 },
    { s: "비", from: 33, to: 48 },
    { s: "폐", from: 49, to: 64 },
    { s: "신", from: 65, to: 80 },
  ],
  "2교시": [
    { s: "상한", from:  1, to: 16 },
    { s: "사상", from: 17, to: 32 },
    { s: "침구", from: 33, to: 80 },
    { s: "법규", from: 80, to: 100 },
  ],
     "3교시": [
    { s: "외과", from:  1, to: 16 },
    { s: "신경", from: 17, to: 32 },
    { s: "안이비", from: 33, to: 48 },
    { s: "부인", from: 49, to: 80 },
  ],
     "4교시": [
    { s: "소아", from:  1, to: 24 },
    { s: "예방", from: 25, to: 48 },
    { s: "생리", from: 49, to: 64 },
    { s: "본초", from: 65, to: 80 },
  ],
};

/** ② 교시명 정규화: 다양한 키에서 교시를 추출 ('1교시','2교시' 등으로 통일) */
function toStdSessionName(name){
  const k = String(name||"").toLowerCase();
  if (/(^|[^0-9])1(교시|st|nd|rd|th)?\b/.test(k) || /(first|제?1|첫)/.test(k)) return "1교시";
  if (/(^|[^0-9])2(교시|st|nd|rd|th)?\b/.test(k) || /(second|제?2)/.test(k)) return "2교시";
  if (/(^|[^0-9])3(교시|st|nd|rd|th)?\b/.test(k) || /(third|제?3)/.test(k)) return "3교시";
  if (/(^|[^0-9])4(교시|st|nd|rd|th)?\b/.test(k) || /(fourth|제?4)/.test(k)) return "4교시";
  if (/(^|[^0-9])5(교시|st|nd|rd|th)?\b/.test(k) || /(fifth|제?5)/.test(k)) return "5교시";
  return null;
}

/** ③ 숫자 배열 정규화: [1,2,'3'] 또는 "1, 2  3" → [1,2,3] */
function toNumArray(v){
  if (Array.isArray(v)) return v.map(n=>+n).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
  if (typeof v === 'string') {
    return v.split(/[,\s/]+/).map(n=>+n).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
  }
  return [];
}

/** ④ 과목 row 안에서 오답 키 추출 (subject_results, group_results, by_class.*.groups.* 용) */
function extractWrongFromSubjectRow(row){
  const keys = [
    "wrongQuestions","wrong_questions","wrongs","wrong",
    "incorrectQuestions","incorrect_questions","incorrect",
    "오답","틀린문항"
  ];
  for (const k of keys){
    if (k in (row||{})) {
      const arr = toNumArray(row[k]);
      if (arr.length) return arr;
    }
  }
  return [];
}

/** ⑤ 교시 오답 → 과목 오답으로 맵핑해서 acc에 누적 */
function mapSessionNumbersToSubjects(sessionLabel, nums, acc){
  const segs = SESSION_SUBJECT_RANGES[sessionLabel];
  if (!segs || !nums || !nums.length) return;
  for (const n of nums){
    for (const seg of segs){
      if (n >= seg.from && n <= seg.to){
        (acc[seg.s] ||= []).push(n);
        break;
      }
    }
  }
}

/** ⑥ round(raw 또는 normalized) → {과목:[문항...]} */
function collectWrongQuestions(roundRawOrNorm){
  const r = (roundRawOrNorm?.by_class || roundRawOrNorm?.subject_results || roundRawOrNorm?.group_results || roundRawOrNorm?.wrong_questions || roundRawOrNorm?.wrongs)
    ? roundRawOrNorm
    : (window.normalizeRound?.(roundRawOrNorm) || roundRawOrNorm);

  const out = {};

  // A) 최상위 맵 형태(예: wrong_questions: { '침구':[...], '간':[...], 'acupuncture':[...], ... })
  const topKeys = ["wrong_questions","wrongQuestions","wrongs","incorrect_questions","incorrectQuestions"];
  for (const tk of topKeys){
    if (r && r[tk] && typeof r[tk] === 'object'){
      Object.keys(r[tk]).forEach(rawName=>{
        // 이 케이스는 과목명이 이미 명시된 형태라 세션 맵핑 불필요
        const nm = String(rawName).trim();
        const arr = toNumArray(r[tk][rawName]);
        if (SUBJECT_MAX[nm] != null && arr.length) (out[nm] ||= []).push(...arr);
      });
    }
  }

  // B) 새 스키마: subject_results[*] 안에 오답 키가 있을 때
  if (Array.isArray(r?.subject_results)) {
    r.subject_results.forEach(s=>{
      const nm = String(s?.name||"").trim();
      if (!nm || SUBJECT_MAX[nm]==null) return;
      const arr = extractWrongFromSubjectRow(s);
      if (arr.length) (out[nm] ||= []).push(...arr);
    });
  }

  // C) 새 스키마 변형: group_results[*] 이름이 과목명일 때
  if (Array.isArray(r?.group_results)) {
    r.group_results.forEach(g=>{
      const nm = String(g?.name||"").trim();
      if (SUBJECT_MAX[nm]==null) return;
      const arr = extractWrongFromSubjectRow(g);
      if (arr.length) (out[nm] ||= []).push(...arr);
    });
  }

  // D) 구 스키마: by_class → "종합".groups.* 에 오답 키가 있는 경우
  const groups = r?.by_class?.["종합"]?.groups || {};
  Object.keys(groups).forEach(nm=>{
    if (SUBJECT_MAX[nm]==null) return;
    const row = groups[nm] || {};
    const arr = extractWrongFromSubjectRow(row);
    if (arr.length) (out[nm] ||= []).push(...arr);
  });

  // E) 교시(세션) 단위 오답 → 과목으로 변환
  //   - 1) wrong_by_session 같이 묶인 객체
  const bySession = r?.wrong_by_session || r?.wrongBySession || r?.wrong_sessions || r?.wrongSessions;
  if (bySession && typeof bySession === 'object'){
    Object.entries(bySession).forEach(([sessKey, val])=>{
      const sess = toStdSessionName(sessKey);
      if (!sess) return;
      mapSessionNumbersToSubjects(sess, toNumArray(val), out);
    });
  }
  //   - 2) 개별 키들(예: wrong_1교시, wrong1, wrong_first, wrongSession1 등)
  Object.keys(r||{}).forEach(k=>{
    if (!/wrong/i.test(k)) return;                 // wrong이 들어간 키만 확인
    const sess = toStdSessionName(k);              // 키에서 교시 추출
    if (!sess) return;
    mapSessionNumbersToSubjects(sess, toNumArray(r[k]), out);
  });

  // 정리: 중복 제거 + 정렬
  Object.keys(out).forEach(nm=>{
    const set = new Set(out[nm]);
    out[nm] = Array.from(set).sort((a,b)=>a-b);
  });

  return out;
}

/** ⑦ 오답 패널 HTML (17개 과목 버튼: 오답 없어도 전부 노출) */
function buildWrongPanelHTML(roundLabel, roundRawOrNorm){
  const wrongMap = collectWrongQuestions(roundRawOrNorm);

  const items = ALL_SUBJECTS.map(sj => {
    const arr = Array.isArray(wrongMap[sj]) ? wrongMap[sj] : [];
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
    if (e.target.closest('button')) return; // 아코디언 버튼은 뒤집지 않기
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

  // 맨 위 SID 카드 없음 → 바로 회차 카드 렌더
  const rounds = await discoverRoundsFor(sid);
  if (rounds.length === 0){
    const msg = document.createElement('div');
    msg.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="small" style="opacity:.8">조회 가능한 회차 데이터가 없습니다.</div></div>`;
    grid.appendChild(msg);
    return;
  }

for (const {label, raw} of rounds){
  const norm = (window.normalizeRound?.(raw)) || raw;
  const hostId = `round-host-${label}`;
  const roundBackHTML = buildWrongPanelHTML(label, raw);

    const card = makeFlipCard({
      id: `card-${label}`,
      title: label,
      frontHTML: `<div id="${hostId}"></div>`,
      backHTML: roundBackHTML
    });
    grid.appendChild(card);

    // 앞면 렌더
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
  // (간격 조금 띄우기) — CSS가 이미 있으면 생략 가능
  (function injectMinorSpacing(){
    const css = `
      #cards-grid { display:grid; gap:14px; }
      .flip-card { margin:0; }
      .accordion .item { margin-bottom:6px; }
      .accordion .acc-btn{ width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--line); border-radius:10px; background:var(--surface-1, #151d36); font-weight:700; }
      .accordion .acc-btn .rotate{ transition:.2s transform ease; }
      .accordion .acc-btn.open .rotate{ transform: rotate(90deg); }
      .accordion .panel{ overflow:hidden; max-height:0; transition:max-height .25s ease; }
      .qgrid{ display:flex; flex-wrap:wrap; gap:6px; }
      .qcell{ padding:3px 8px; border-radius:999px; border:1px solid var(--line); font-weight:700; }
      .qcell.bad{ background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.55); }
      .group-grid{ display:grid; grid-template-columns:repeat(12,1fr); gap:12px; }
      .group-box{ border:1px solid var(--line); border-radius:12px; padding:12px; background:var(--surface-2, #11172b) }
      .group-box.ok{ background:rgba(34,197,94,.12); border-color:rgba(34,197,94,.55) }
      .group-box.fail{ background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.55) }
      .subj-row{ display:flex; flex-wrap:wrap; gap:6px 10px; margin-top:6px }
      .subj-chip{ padding:4px 8px; border:1px solid var(--line); border-radius:999px; font-weight:800 }
      .subj-chip .muted{ opacity:.7; font-weight:600 }
      .cutline{ left:60% }
      .flip-card { margin-bottom:16px; }
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
  tmp.className = faceEl.className.replace('flip-face','').trim();
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

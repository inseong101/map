// src/utils/helpers.js

// 숫자 포맷팅
export function fmt(n) {
  return (n == null || isNaN(Number(n))) ? "-" : Number(n).toLocaleString("ko-KR");
}

// 퍼센트 계산 (0~100, 정수 반올림)
export function pct(score, max) {
  const s = +score || 0;
  const m = +max || 0;
  return m <= 0 ? 0 : Math.round((s / m) * 100);
}

// 배지 HTML 생성
export function pill(text, type) {
  const className = type === 'ok' ? 'pill green' : (type === 'warn' ? 'pill warn' : 'pill red');
  return `<span class="${className}">${text}</span>`;
}

// 배열을 지정된 크기로 청크 분할
export function chunk(arr, sizes) {
  const out = [];
  let i = 0;
  for (const s of sizes) {
    out.push(arr.slice(i, i + s));
    i += s;
  }
  if (i < arr.length) out.push(arr.slice(i));
  return out;
}

// ----- 점수/분포 계산 계층 (🔥 새로 추가되는 부분) -----
import { SESSION_SUBJECT_RANGES, SUBJECT_MAX, TOTAL_MAX } from '../services/dataService';

/**
 * wrongBySession(교시별 오답 문항 배열)을 과목별(간/심/...) 점수로 환산
 * - 각 과목은 SUBJECT_MAX의 만점에서 시작
 * - 오답 1개당 1점 차감
 */
export function buildSubjectScores(wrongBySession = {}) {
  // 모든 과목 만점으로 초기화
  const scores = {};
  Object.keys(SUBJECT_MAX).forEach(s => { scores[s] = SUBJECT_MAX[s]; });

  // 교시별 오답 차감
  Object.entries(wrongBySession).forEach(([session, wrongList]) => {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    (wrongList || []).forEach(qNum => {
      const r = ranges.find(rr => qNum >= rr.from && qNum <= rr.to);
      if (r && scores[r.s] != null) {
        scores[r.s] = Math.max(0, scores[r.s] - 1);
      }
    });
  });

  return scores;
}

/**
 * 4개 교시를 그룹으로 묶어 그룹 점수 생성
 * - label: "1교시", "2교시" ...
 * - subjects: 해당 교시 과목 배열
 * - layoutChunks: 칩(과목 표시) 줄바꿈 레이아웃 제안 (UI용)
 * - score/max/rate/pass
 *   - pass 기준은 임시로 rate >= 40 으로 설정 (원 규칙이 있으면 여기만 조정)
 */
export function buildGroupResults(subjectScores) {
  const groupsDef = {
    "1교시": ["간", "심", "비", "폐", "신"],
    "2교시": ["상한", "사상", "침구", "보건"],
    "3교시": ["외과", "신경", "안이비", "부인과"],
    "4교시": ["소아", "예방", "생리", "본초"],
  };

  const out = [];

  Object.entries(groupsDef).forEach(([label, subjects]) => {
    const score = subjects.reduce((s, subj) => s + (subjectScores?.[subj] || 0), 0);
    const max   = subjects.reduce((s, subj) => s + (SUBJECT_MAX[subj] || 0), 0);
    const rate  = pct(score, max);
    const pass  = rate >= 40; // 필요시 규칙 조정

    // 보기 좋은 칩 배치 (대충 3~6개 기준으로 2줄 정도)
    const layoutChunks = subjects.length <= 4 ? [subjects.length] : [Math.ceil(subjects.length/2), Math.floor(subjects.length/2)];

    out.push({
      name: label,
      label,
      subjects,
      layoutChunks,
      score,
      max,
      rate,
      pass
    });
  });

  return out;
}

/**
 * Round 데이터 한 건을 계산해서 최소 필드 보장
 * - subjectScores이 없으면 wrongBySession으로부터 재계산
 * - groupResults이 없으면 subjectScores로부터 생성
 * - totalScore/totalMax/overallPass/meets60/anyGroupFail 보장
 */
export function enrichRoundData(roundData = {}) {
  const wrongBySession = roundData.wrongBySession || {};
  const subjectScores  = roundData.subjectScores || buildSubjectScores(wrongBySession);
  const groupResults   = roundData.groupResults  || buildGroupResults(subjectScores);

  // 총점
  const totalScore = Object.values(subjectScores).reduce((a, b) => a + (b || 0), 0);
  const totalMax   = TOTAL_MAX || 340;

  // 통과 여부
  const meets60 = totalScore >= totalMax * 0.6;          // 60% 컷
  const anyGroupFail = groupResults.some(g => !g.pass);  // 그룹 과락 여부
  const overallPass = meets60 && !anyGroupFail;

  return {
    ...roundData,
    wrongBySession,
    subjectScores,
    groupResults,
    totalScore,
    totalMax,
    meets60,
    anyGroupFail,
    overallPass,
  };
}

// ----- 라인 차트 (기존) -----
export function drawLineChart(canvas, labels, series, maxValue) {
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const padL = 40, padR = 16, padT = 24, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = labels.length;

  const x = (i) => padL + (n <= 1 ? plotW / 2 : (i * (plotW / (n - 1))));
  const y = (v) => padT + (plotH * (1 - (v / Math.max(1, maxValue || 1))));

  // 축
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // 라벨
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  labels.forEach((lb, i) => ctx.fillText(lb, x(i), padT + plotH + 18));

  // 시리즈
  const colors = ['#7ea2ff', '#4cc9ff', '#22c55e'];
  series.forEach((s, si) => {
    const col = colors[si % colors.length];

    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      if (v == null) return;
      const xx = x(i), yy = y(v);
      if (i === 0 || s.values[i - 1] == null) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();

    ctx.fillStyle = col;
    s.values.forEach((v, i) => {
      if (v == null) return;
      const xx = x(i), yy = y(v);
      ctx.beginPath();
      ctx.arc(xx, yy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // 범례
  const legendX = padL, legendY = 12;
  series.forEach((s, si) => {
    const col = colors[si % colors.length];
    ctx.fillStyle = col;
    ctx.fillRect(legendX + si * 120, legendY - 8, 10, 10);
    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, legendX + si * 120 + 14, legendY + 1);
  });
}

// ==== 아래 함수들은 그대로 유지 (이름 중복 주의) ====

// 유효한 학수번호인지 확인 (01~12로 시작하는 6자리)
function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string') return false;
  if (sid.length !== 6) return false;
  const schoolCode = sid.slice(0, 2);
  const validCodes = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  return validCodes.includes(schoolCode);
}

// 실제 평균 계산용
export async function getAverages(schoolName, roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');
    const schoolCode = getSchoolCodeFromName(schoolName);

    const sessions = ['1교시','2교시','3교시','4교시'];
    const allScores = {};              // sid -> totalScore
    const completedFlags = {};         // sid -> { '1교시':true, ... }
    const nationalScores = [];
    const schoolScores = [];

    // 교시별 점수 집계 + completed 판정
    for (const session of sessions) {
      const sessionRef = collection(db, 'scores_raw', roundLabel, session);
      const snap = await getDocs(sessionRef);
      snap.forEach(doc => {
        const sid = doc.id;
        if (!isValidStudentId(sid)) return;
        const d = doc.data() || {};
        if (!completedFlags[sid]) completedFlags[sid] = {};
        completedFlags[sid][session] = (d.status === 'completed');

        if (allScores[sid] == null) allScores[sid] = 0;
        // 🔥 서버에서 totalScore를 이미 저장했다면 사용, 없으면 오답 기반 추산(안전장치)
        if (typeof d.totalScore === 'number') {
          allScores[sid] += d.totalScore;
        } else {
          const wrong = Array.isArray(d.wrongQuestions) ? d.wrongQuestions.length : 0;
          // 이 추산은 세션별 총문항(=해당 교시 max)을 알아야 하므로, 보수적으로 0 가산
          // (서버 totalScore가 없는 극히 예외 케이스 대비)
          allScores[sid] += 0;
        }
      });
    }

    // 4교시 모두 completed 인 학생만 유효
    Object.entries(allScores).forEach(([sid, score]) => {
      const flags = completedFlags[sid] || {};
      const completedCount = ['1교시','2교시','3교시','4교시'].reduce((c, s) => c + (flags[s] ? 1 : 0), 0);
      if (completedCount < 4) return;
      nationalScores.push(score);
      if (sid.slice(0,2) === getSchoolCodeFromName(schoolName)) schoolScores.push(score);
    });

    const avg = arr => arr.length ? Math.round(arr.reduce((a,b) => a+b, 0) / arr.length) : null;
    return {
      nationalAvg: avg(nationalScores) ?? '-',
      schoolAvg:   avg(schoolScores)   ?? '-',
    };
  } catch (e) {
    console.error('평균 조회 오류:', e);
    return { nationalAvg: '-', schoolAvg: '-' };
  }
}

// 실제 점수 분포 (유효응시자 4교시 모두 completed만 포함)
export async function getRealScoreDistribution(roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');

    const sessions = ['1교시','2교시','3교시','4교시'];
    const totals = {};         // sid -> 누적 점수
    const completedFlags = {}; // sid -> 세션 완료 플래그

    for (const session of sessions) {
      const sessionRef = collection(db, 'scores_raw', roundLabel, session);
      const snap = await getDocs(sessionRef);
      snap.forEach(doc => {
        const sid = doc.id;
        const d = doc.data() || {};
        if (!isValidStudentId(sid)) return;
        if (!completedFlags[sid]) completedFlags[sid] = {};
        completedFlags[sid][session] = (d.status === 'completed');

        if (totals[sid] == null) totals[sid] = 0;
        if (typeof d.totalScore === 'number') {
          totals[sid] += d.totalScore;
        } else {
          // 안전장치: 서버 totalScore 없으면 0 가산 (추산하지 않음)
          totals[sid] += 0;
        }
      });
    }

    const bySchool = {};
    const national = [];

    Object.entries(totals).forEach(([sid, score]) => {
      const flags = completedFlags[sid] || {};
      const completedCount = ['1교시','2교시','3교시','4교시'].reduce((c, s) => c + (flags[s] ? 1 : 0), 0);
      if (completedCount < 4) return; // 유효응시자만

      national.push(score);
      const sc = sid.slice(0,2);
      if (!bySchool[sc]) bySchool[sc] = [];
      bySchool[sc].push(score);
    });

    return { national, bySchool, school: bySchool };
  } catch (e) {
    console.error('점수 분포 조회 오류:', e);
    return { national: [], bySchool: {}, school: {} };
  }
}

// 학교명 → 코드
function getSchoolCodeFromName(name) {
  const map = {
    '가천대': '01','경희대': '02','대구한': '03','대전대': '04',
    '동국대': '05','동신대': '06','동의대': '07','부산대': '08',
    '상지대': '09','세명대': '10','우석대': '11','원광대': '12',
  };
  return map[name] || '01';
}

// ✅ 4교시 모두 completed 학생만 집계한 참여/분포/백분위용 통계
export async function getParticipationStats(roundLabel, schoolCodeOrNull = null) {
  const { db } = await import('../services/firebase');
  const { collection, getDocs } = await import('firebase/firestore');

  const sessions = ['1교시', '2교시', '3교시', '4교시'];
  const perSid = {}; // sid -> {completed:0..4, any:boolean, sum: number}

  for (const session of sessions) {
    const ref = collection(db, 'scores_raw', roundLabel, session);
    const snap = await getDocs(ref);

    snap.forEach(doc => {
      const sid = doc.id;
      const code = String(sid).slice(0, 2);

      // 유효 학번 + (학교 필터가 있으면 해당 학교만)
      if (!['01','02','03','04','05','06','07','08','09','10','11','12'].includes(code)) return;
      if (schoolCodeOrNull && code !== schoolCodeOrNull) return;

      const data = doc.data() || {};
      const st = data.status; // 'completed' | 'absent'
      const sc = Number.isFinite(data.totalScore) ? Number(data.totalScore) : 0;

      if (!perSid[sid]) perSid[sid] = { completed: 0, any: false, sum: 0 };
      if (st === 'completed') {
        perSid[sid].any = true;
        perSid[sid].completed += 1;
        perSid[sid].sum += sc; // 교시별 totalScore 합산(총점)
      }
    });
  }

  let total = 0, completed = 0, absent = 0, dropout = 0;
  const completedScores = [];

  Object.values(perSid).forEach(v => {
    total += 1;
    if (v.completed === 4) {
      completed += 1;
      completedScores.push(v.sum);
    } else if (v.completed === 0) {
      absent += 1;
    } else {
      dropout += 1;
    }
  });

  return { total, completed, absent, dropout, completedScores };
}

// ✅ 백분위(1등=0.0%, 꼴등=100.0%) — 유효 응시자 점수 배열 기준
export function calculatePercentileStrict(scores, myScore) {
  if (!Array.isArray(scores) || scores.length === 0 || !Number.isFinite(myScore)) return null;

  // 내림차순 정렬 (높은 점수가 1등)
  const sorted = [...scores].sort((a, b) => b - a);

  // 내 점수 이하가 처음으로 나오는 인덱스(0-based)
  let idx = sorted.findIndex(s => s <= myScore);
  if (idx === -1) idx = sorted.length - 1; // 모두 내 점수보다 큼 → 최하위 취급

  if (sorted.length === 1) return 0.0;

  // 0.0 ~ 100.0로 선형 맵핑 (1등=0.0, 꼴등=100.0)
  const pct = (idx / (sorted.length - 1)) * 100;
  const clamped = Math.min(100, Math.max(0, pct));

  return +clamped.toFixed(1);
}
export function calcPercentileFromScores(scores, myScore) {
  if (!Array.isArray(scores) || scores.length === 0 || myScore == null) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  const n = sorted.length;
  if (n === 1) return 0.0;

  let idx = sorted.findIndex(s => s <= myScore);
  if (idx < 0) idx = n - 1;

  const p = (idx / (n - 1)) * 100;
  return Math.max(0, Math.min(100, +p.toFixed(1)));
}
// 01~12로 시작하는 6자리만 유효
export function isValidSid(sid) {
  return typeof sid === 'string' && /^(0[1-9]|1[0-2])\d{4}$/.test(sid);
}

// 4교시 모두 completed 여부
export function isCompleted4(r) {
  return r?.s1?.status === 'completed' &&
         r?.s2?.status === 'completed' &&
         r?.s3?.status === 'completed' &&
         r?.s4?.status === 'completed';
}

/**
 * 라운드별 학생 상태 판정
 * 반환값: 'completed' | 'absent' | 'dropout' | 'invalid'
 * - invalid: 학수번호 형식 위반(01~12 아님)
 * - absent: 4교시 중 하나라도 'absent'
 * - dropout: 4교시 중 하나라도 'dropout'
 * - completed: 4교시 모두 completed
 */
export function deriveRoundStatus(roundData, sid) {
  if (!isValidSid(sid)) return 'invalid';

  const statuses = [
    roundData?.s1?.status, roundData?.s2?.status,
    roundData?.s3?.status, roundData?.s4?.status
  ].filter(Boolean);

  if (statuses.length < 4) return 'absent'; // 데이터 불완전은 absent 취급(원한다면 'unknown' 등 별도 분류)

  if (statuses.some(s => s === 'dropout')) return 'dropout';
  if (statuses.some(s => s === 'absent')) return 'absent';
  if (statuses.every(s => s === 'completed')) return 'completed';

  // 그 외 예외 상태가 섞여 있으면 미응시 취급
  return 'absent';
}

// === 사전집계 분포 조회 (Cloud Functions HTTPS) ===
export async function getPrebinnedDistribution(roundLabel) {
  try {
    // Hosting 리라이트가 있다면 이 상대경로로 OK.
    // 없다면 전체 URL(예: https://asia-northeast3-<project>.cloudfunctions.net/getPrebinnedDistribution?roundLabel=1차)로 바꿔주세요.
    const url = `/getPrebinnedDistribution?roundLabel=${encodeURIComponent(roundLabel)}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json(); // { success, data }
  } catch (e) {
    console.error('getPrebinnedDistribution error:', e);
    return { success: false, data: null };
  }
}

// === bin 기반 백분위(상위%) 계산 유틸 ===
export function calcPercentileFromBins(bins, studentScore) {
  if (!Array.isArray(bins) || bins.length === 0 || !Number.isFinite(studentScore)) return null;
  const total = bins.reduce((s,b)=>s + (b.count||0), 0);
  if (total <= 1) return 0.0;

  let higher = 0;
  for (const b of bins) {
    if (b.max <= studentScore) continue;
    higher += (b.count || 0);
  }
  const myBin = bins.find(b => (b.min <= studentScore) && (studentScore < b.max || (b.min===b.max && studentScore===b.max)));
  const tieAdj = myBin ? Math.max(0, (myBin.count || 0) - 1) * 0.5 : 0;
  const rankLike = higher + tieAdj;

  const pct = (rankLike / (total - 1)) * 100;
  const clamped = Math.max(0, Math.min(100, +pct.toFixed(1)));
  return clamped;
}

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

// ----- 점수/분포 계산 계층 -----
import { SESSION_SUBJECT_RANGES, SUBJECT_MAX, TOTAL_MAX } from '../services/dataService';

/**
 * wrongBySession(교시별 오답 문항 배열)을 과목별 점수로 환산
 * - 각 과목은 SUBJECT_MAX의 만점에서 시작
 * - 오답 1개당 1점 차감
 */
export function buildSubjectScores(wrongBySession = {}) {
  const scores = {};
  Object.keys(SUBJECT_MAX).forEach(s => { scores[s] = SUBJECT_MAX[s]; });

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
    const pass  = rate >= 40;

    const layoutChunks = subjects.length <= 4
      ? [subjects.length]
      : [Math.ceil(subjects.length/2), Math.floor(subjects.length/2)];

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
 * Round 데이터 한 건을 enrichment
 */
export function enrichRoundData(roundData = {}) {
  const wrongBySession = roundData.wrongBySession || {};
  const subjectScores  = roundData.subjectScores || buildSubjectScores(wrongBySession);
  const groupResults   = roundData.groupResults  || buildGroupResults(subjectScores);

  const totalScore = Object.values(subjectScores).reduce((a, b) => a + (b || 0), 0);
  const totalMax   = TOTAL_MAX || 340;

  const meets60 = totalScore >= totalMax * 0.6;
  const anyGroupFail = groupResults.some(g => !g.pass);
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

// ======== 사전집계(prebinned) 기반 API & 유틸 ========

// 학교명 → 코드
export function getSchoolCodeFromName(name) {
  const map = {
    '가천대': '01','경희대': '02','대구한': '03','대전대': '04',
    '동국대': '05','동신대': '06','동의대': '07','부산대': '08',
    '상지대': '09','세명대': '10','우석대': '11','원광대': '12',
  };
  return map[name] || '01';
}

// === 사전집계 분포 조회 (Cloud Functions HTTPS - Hosting rewrite 가정) ===
export async function getPrebinnedDistribution(roundLabel) {
  try {
    const url = `/api/prebinned?roundLabel=${encodeURIComponent(roundLabel)}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json(); // { success, data }
  } catch (e) {
    console.error('getPrebinnedDistribution error:', e);
    return { success: false, data: null };
  }
}

/**
 * ✅ 평균 계산 (prebinned bins 기반)
 * - bins가 min/max/count 또는 mean 값을 가질 수 있다고 가정
 * - mean 있으면 그걸 사용, 없으면 (min+max)/2 중앙값을 사용해 가중 평균
 * - 반환: { nationalAvg: number | '-', schoolAvg: number | '-' }
 */
export async function getAverages(schoolName, roundLabel) {
  try {
    const sch = getSchoolCodeFromName(schoolName);
    const preb = await getPrebinnedDistribution(roundLabel);
    const d = preb?.data || {};
    const natBins = Array.isArray(d?.national) ? d.national : [];
    const schBins = Array.isArray(d?.bySchool?.[sch]) ? d.bySchool[sch] : [];

    const avgFromBins = (bins) => {
      const total = bins.reduce((s,b)=> s + (b?.count||0), 0);
      if (total <= 0) return '-';
      let sum = 0;
      for (const b of bins) {
        const c = b?.count || 0;
        const mean = Number.isFinite(b?.mean)
          ? b.mean
          : (Number.isFinite(b?.min) && Number.isFinite(b?.max))
            ? (b.min + b.max) / 2
            : 0;
        sum += mean * c;
      }
      const avg = sum / total;
      // 소수점 1자리로 표시 (필요시 변경)
      return Math.round(avg * 10) / 10;
    };

    return {
      nationalAvg: avgFromBins(natBins),
      schoolAvg:   avgFromBins(schBins),
    };
  } catch (e) {
    console.error('getAverages(prebinned) error:', e);
    return { nationalAvg: '-', schoolAvg: '-' };
  }
}

// ✅ prebinned 기반 참여 통계(총원/유효응시자)
export async function getParticipationStats(roundLabel, schoolCodeOrNull = null) {
  try {
    const preb = await getPrebinnedDistribution(roundLabel);
    const d = preb?.data || {};
    const bins = schoolCodeOrNull
      ? (Array.isArray(d?.bySchool?.[schoolCodeOrNull]) ? d.bySchool[schoolCodeOrNull] : [])
      : (Array.isArray(d?.national) ? d.national : []);
    const total = bins.reduce((s, b) => s + (b?.count || 0), 0);
    return { total, completed: total, absent: 0, dropout: 0, completedScores: [] };
  } catch (e) {
    console.error('participation(prebinned) 조회 오류:', e);
    return { total: 0, completed: 0, absent: 0, dropout: 0, completedScores: [] };
  }
}

// === bin 기반 백분위(상위%) 계산
export function calcPercentileFromBins(bins, studentScore) {
  if (!Array.isArray(bins) || bins.length === 0 || !Number.isFinite(studentScore)) return null;
  const total = bins.reduce((s,b)=>s + (b.count||0), 0);
  if (total <= 1) return 0.0;

  // 내 점수보다 높은 구간 합
  let higher = 0;
  for (const b of bins) {
    // 해당 bin 전체가 내 점수보다 "높은 점수 영역"일 때만 더함
    if (Number.isFinite(b.max) && b.max <= studentScore) continue;
    if (Number.isFinite(b.min) && Number.isFinite(b.max) && b.min >= studentScore) {
      higher += (b.count || 0);
    }
  }

  // 내 bin 동점 보정 (동점자 가운데쯤)
  const myBin = bins.find(b =>
    Number.isFinite(b.min) && Number.isFinite(b.max) &&
    ((b.min <= studentScore) && (studentScore < b.max || (b.min===b.max && studentScore===b.max)))
  );
  const tieAdj = myBin ? Math.max(0, (myBin.count || 0) - 1) * 0.5 : 0;

  const rankLike = higher + tieAdj;
  const pct = (rankLike / (total - 1)) * 100;
  const clamped = Math.max(0, Math.min(100, +pct.toFixed(1)));
  return clamped;
}

// (다른 곳에서 쓸 수 있어 남겨둠) 점수배열 기반 백분위
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

/**
 * 라운드별 학생 상태 판정
 * 반환: 'completed' | 'absent' | 'dropout' | 'invalid'
 */
export function deriveRoundStatus(roundData, sid) {
  if (!isValidSid(sid)) return 'invalid';

  const statuses = [
    roundData?.s1?.status, roundData?.s2?.status,
    roundData?.s3?.status, roundData?.s4?.status
  ].filter(Boolean);

  if (statuses.length < 4) return 'absent';
  if (statuses.some(s => s === 'dropout')) return 'dropout';
  if (statuses.some(s => s === 'absent')) return 'absent';
  if (statuses.every(s => s === 'completed')) return 'completed';
  return 'absent';
}

// src/utils/helpers.js

// 숫자 포맷팅
export function fmt(n) {
  return (n == null || isNaN(Number(n))) ? "-" : Number(n).toLocaleString("ko-KR");
}

// 퍼센트 계산
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

// 캔버스에 라인 차트 그리기
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

  // 축 그리기
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

  // 시리즈 그리기
  const colors = ['#7ea2ff', '#4cc9ff', '#22c55e'];
  series.forEach((s, si) => {
    const col = colors[si % colors.length];
    
    // 선 그리기
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      if (v == null) return;
      const xx = x(i), yy = y(v);
      if (i === 0 || s.values[i - 1] == null) {
        ctx.moveTo(xx, yy);
      } else {
        ctx.lineTo(xx, yy);
      }
    });
    ctx.stroke();
    
    // 포인트 그리기
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

/* =========================
   점수/분포 계산 유틸 (프런트)
   ========================= */

// 유효한 학수번호인지 확인 (01~12로 시작하는 6자리)
function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string') return false;
  if (sid.length !== 6) return false;
  const schoolCode = sid.slice(0, 2);
  const validCodes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  return validCodes.includes(schoolCode);
}

// 세션 최대 문항 수 (fallback용)
// 1교시 80, 2교시 100, 3교시 80, 4교시 80 → 총 340
const SESSION_MAX_QUESTIONS = {
  '1교시': 80,
  '2교시': 100,
  '3교시': 80,
  '4교시': 80
};

// 학교명 → 학교코드 변환
function getSchoolCodeFromName(schoolName) {
  const schoolMap = {
    "가천대": "01", "경희대": "02", "대구한": "03", "대전대": "04",
    "동국대": "05", "동신대": "06", "동의대": "07", "부산대": "08",
    "상지대": "09", "세명대": "10", "우석대": "11", "원광대": "12"
  };
  return schoolMap[schoolName] || "01";
}

/**
 * 라운드별 평균 (전국/학교)
 * - 유효응시자(최소 1교시라도 completed)만 포함
 * - 각 학생의 라운드 총점 = 4개 교시 totalScore 합
 *   - totalScore 필드가 없을 경우 fallback: (세션문항수 - wrongQuestions.length)
 */
export async function getAverages(schoolName, roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');

    const schoolCode = getSchoolCodeFromName(schoolName);
    const sessions = ['1교시', '2교시', '3교시', '4교시'];

    // sid -> { sum: number, completedSessions: number }
    const agg = {};

    for (const session of sessions) {
      const sessionRef = collection(db, 'scores_raw', roundLabel, session);
      const snap = await getDocs(sessionRef);

      snap.forEach(docSnap => {
        const sid = docSnap.id;
        if (!isValidStudentId(sid)) return;

        const data = docSnap.data() || {};
        if (data.status !== 'completed') return; // 미응시/중도포기 세션 제외

        const wrongQuestions = Array.isArray(data.wrongQuestions) ? data.wrongQuestions : (Array.isArray(data.wrong) ? data.wrong : []);
        const fallbackMax = SESSION_MAX_QUESTIONS[session] || 0;

        // 세션 점수 결정
        let sessionScore = Number.isFinite(data.totalScore) ? Number(data.totalScore) : (fallbackMax - (wrongQuestions?.length || 0));
        if (!Number.isFinite(sessionScore)) sessionScore = 0;
        sessionScore = Math.max(0, Math.min(fallbackMax, sessionScore));

        if (!agg[sid]) agg[sid] = { sum: 0, completedSessions: 0 };
        agg[sid].sum += sessionScore;
        agg[sid].completedSessions += 1;
      });
    }

    // 유효응시자(최소 1교시라도 completed)만 점수 배열로
    const nationalScores = [];
    const schoolScores = [];

    Object.entries(agg).forEach(([sid, { sum, completedSessions }]) => {
      if (completedSessions <= 0) return; // 완전 미응시 제거
      nationalScores.push(sum);
      if (sid.slice(0, 2) === schoolCode) schoolScores.push(sum);
    });

    const nationalAvg = nationalScores.length > 0
      ? Math.round(nationalScores.reduce((a, b) => a + b, 0) / nationalScores.length)
      : null;

    const schoolAvg = schoolScores.length > 0
      ? Math.round(schoolScores.reduce((a, b) => a + b, 0) / schoolScores.length)
      : null;

    return {
      nationalAvg: nationalAvg ?? '-',
      schoolAvg: schoolAvg ?? '-'
    };
  } catch (error) {
    console.error('평균 조회 오류:', error);
    return { nationalAvg: '-', schoolAvg: '-' };
  }
}

/**
 * 실제 점수 분포 (전국/학교)
 * - 유효응시자(최소 1교시라도 completed)만 포함
 * - 각 학생의 라운드 총점 = 4개 교시 합산 (위와 동일한 로직)
 */
export async function getRealScoreDistribution(roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');

    const sessions = ['1교시', '2교시', '3교시', '4교시'];
    const agg = {}; // sid -> { sum, completedSessions }

    for (const session of sessions) {
      const sessionRef = collection(db, 'scores_raw', roundLabel, session);
      const snap = await getDocs(sessionRef);

      snap.forEach(docSnap => {
        const sid = docSnap.id;
        if (!isValidStudentId(sid)) return;

        const data = docSnap.data() || {};
        if (data.status !== 'completed') return; // 해당 세션 미응답 제외

        const wrongQuestions = Array.isArray(data.wrongQuestions) ? data.wrongQuestions : (Array.isArray(data.wrong) ? data.wrong : []);
        const fallbackMax = SESSION_MAX_QUESTIONS[session] || 0;

        let sessionScore = Number.isFinite(data.totalScore) ? Number(data.totalScore) : (fallbackMax - (wrongQuestions?.length || 0));
        if (!Number.isFinite(sessionScore)) sessionScore = 0;
        sessionScore = Math.max(0, Math.min(fallbackMax, sessionScore));

        if (!agg[sid]) agg[sid] = { sum: 0, completedSessions: 0 };
        agg[sid].sum += sessionScore;
        agg[sid].completedSessions += 1;
      });
    }

    const bySchool = {}; // schoolCode -> scores[]
    const national = [];

    Object.entries(agg).forEach(([sid, { sum, completedSessions }]) => {
      if (completedSessions <= 0) return; // 완전 미응시 제거
      national.push(sum);
      const sc = sid.slice(0, 2);
      if (!bySchool[sc]) bySchool[sc] = [];
      bySchool[sc].push(sum);
    });

    return {
      national,
      school: bySchool,
      bySchool
    };
  } catch (error) {
    console.error('점수 분포 조회 오류:', error);
    return { national: [], school: {}, bySchool: {} };
  }
}

// 학교명 → 학교코드 변환 (외부에서 쓰는 함수)
export function getSchoolCodeFromName(schoolName) {
  return {
    "가천대": "01", "경희대": "02", "대구한": "03", "대전대": "04",
    "동국대": "05", "동신대": "06", "동의대": "07", "부산대": "08",
    "상지대": "09", "세명대": "10", "우석대": "11", "원광대": "12"
  }[schoolName] || "01";
}

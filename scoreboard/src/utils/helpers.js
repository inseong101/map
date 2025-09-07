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
      if (i === 0 || s.values[i - 1] == null) {
        ctx.moveTo(xx, yy);
      } else {
        ctx.lineTo(xx, yy);
      }
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

// ---------------- 공통 유틸 ----------------

// 유효한 학수번호인지 확인 (01~12로 시작하는 6자리)
function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string') return false;
  if (sid.length !== 6) return false;
  const code = sid.slice(0, 2);
  return ['01','02','03','04','05','06','07','08','09','10','11','12'].includes(code);
}

// 학교명 → 코드
function getSchoolCodeFromName(name) {
  const map = {
    '가천대':'01','경희대':'02','대구한':'03','대전대':'04',
    '동국대':'05','동신대':'06','동의대':'07','부산대':'08',
    '상지대':'09','세명대':'10','우석대':'11','원광대':'12'
  };
  return map[name] || '01';
}

// ---------------- Firestore 데이터 조회 ----------------

// 평균 (전국/학교)
export async function getAverages(schoolName, roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');
    const schoolCode = getSchoolCodeFromName(schoolName);

    const sessions = ['1교시','2교시','3교시','4교시'];
    const studentData = {}; // sid -> { completedSessions, wrongCount }

    for (const session of sessions) {
      const snap = await getDocs(collection(db, 'scores_raw', roundLabel, session));
      snap.forEach(doc => {
        const sid = doc.id;
        if (!isValidStudentId(sid)) return;
        const data = doc.data();
        if (!studentData[sid]) studentData[sid] = { completedSessions: 0, wrongCount: 0 };
        if (data.status === 'completed') {
          studentData[sid].completedSessions++;
          studentData[sid].wrongCount += (data.wrongQuestions || []).length;
        }
      });
    }

    const nationalScores = [];
    const schoolScores = [];
    Object.entries(studentData).forEach(([sid, info]) => {
      if (info.completedSessions < 4) return; // 4교시 완주자만 포함
      const score = Math.max(0, 340 - info.wrongCount);
      nationalScores.push(score);
      if (sid.slice(0,2) === schoolCode) schoolScores.push(score);
    });

    const nationalAvg = nationalScores.length > 0
      ? Math.round(nationalScores.reduce((a,b)=>a+b,0)/nationalScores.length)
      : null;
    const schoolAvg = schoolScores.length > 0
      ? Math.round(schoolScores.reduce((a,b)=>a+b,0)/schoolScores.length)
      : null;

    return { nationalAvg: nationalAvg ?? '-', schoolAvg: schoolAvg ?? '-' };
  } catch (e) {
    console.error('평균 조회 오류:', e);
    return { nationalAvg: '-', schoolAvg: '-' };
  }
}

// 분포 (전국/학교별)
export async function getRealScoreDistribution(roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');

    const sessions = ['1교시','2교시','3교시','4교시'];
    const studentData = {}; // sid -> { completedSessions, wrongCount }

    for (const session of sessions) {
      const snap = await getDocs(collection(db, 'scores_raw', roundLabel, session));
      snap.forEach(doc => {
        const sid = doc.id;
        if (!isValidStudentId(sid)) return;
        const data = doc.data();
        if (!studentData[sid]) studentData[sid] = { completedSessions: 0, wrongCount: 0 };
        if (data.status === 'completed') {
          studentData[sid].completedSessions++;
          studentData[sid].wrongCount += (data.wrongQuestions || []).length;
        }
      });
    }

    const nationalScores = [];
    const schoolScores = {};
    Object.entries(studentData).forEach(([sid, info]) => {
      if (info.completedSessions < 4) return; // 4교시 완주자만 포함
      const score = Math.max(0, 340 - info.wrongCount);
      nationalScores.push(score);
      const code = sid.slice(0,2);
      if (!schoolScores[code]) schoolScores[code] = [];
      schoolScores[code].push(score);
    });

    return { national: nationalScores, bySchool: schoolScores };
  } catch (e) {
    console.error('점수 분포 조회 오류:', e);
    return { national: [], bySchool: {} };
  }
}

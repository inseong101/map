// src/utils/helpers.js
// -------------------------------------------------------------
// 공용 유틸 (숫자/퍼센트/배지/청크/라인차트/학교코드/분포&평균 API)
// - 유효응시자(4교시 모두 status==='completed')만 평균/분포에 포함
// - 점수는 Firestore에 저장된 교시별 totalScore를 합산해서 사용 (재계산 금지)
// - 미응답은 오답처리지만 정답률/오답률/분포/등수에는 제외(= completed만 집계)
// -------------------------------------------------------------

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
    // 선
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
    // 포인트
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

// 유효한 학수번호인지 확인 (01~12로 시작하는 6자리)
function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string') return false;
  if (sid.length !== 6) return false;
  const schoolCode = sid.slice(0, 2);
  const validCodes = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  return validCodes.includes(schoolCode);
}

// 학교명 → 학교코드 변환
function getSchoolCodeFromName(schoolName) {
  const schoolMap = {
    "가천대":"01","경희대":"02","대구한":"03","대전대":"04",
    "동국대":"05","동신대":"06","동의대":"07","부산대":"08",
    "상지대":"09","세명대":"10","우석대":"11","원광대":"12"
  };
  return schoolMap[schoolName] || "01";
}

// 상위 백분위(1등=0.0%, 꼴등=100.0%) 계산 (동점은 같은 위치 취급)
export function calculatePercentileStrict(scores, myScore) {
  if (!Array.isArray(scores) || scores.length === 0 || myScore == null) return null;
  const sorted = [...scores].sort((a,b) => b - a); // 내림차순(높은 점수 먼저)
  const N = sorted.length;
  // 나보다 높은 점수 개수
  const higher = sorted.filter(s => s > myScore).length;
  const percentile = N <= 1 ? (higher === 0 ? 0 : 100) : (higher / (N - 1)) * 100;
  // 1등=0.0, 꼴등=100.0 보장
  const min = 0.0, max = 100.0;
  const val = Math.min(max, Math.max(min, percentile));
  return Math.round(val * 10) / 10; // 소수점 1자리
}

// 학교별/전국 평균 (유효응시자만, 점수=교시별 totalScore 합)
export async function getAverages(schoolName, roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');

    const sessions = ['1교시','2교시','3교시','4교시'];
    const perSid = new Map(); // sid -> { total, completed, school }

    for (const session of sessions) {
      const colRef = collection(db, 'scores_raw', roundLabel, session);
      const snap = await getDocs(colRef);
      snap.forEach(d => {
        const sid = d.id;
        const data = d.data();
        if (!isValidStudentId(sid)) return;
        if (data?.status !== 'completed') return; // 해당 교시 미응시 제외
        const s = perSid.get(sid) || { total:0, completed:0, school: sid.slice(0,2) };
        const ts = Number.isFinite(+data.totalScore) ? +data.totalScore : 0;
        s.total += ts;
        s.completed += 1;
        perSid.set(sid, s);
      });
    }

    // 4교시 모두 응시자만
    const schoolCode = getSchoolCodeFromName(schoolName);
    const valid = Array.from(perSid.values()).filter(v => v.completed === 4);

    const nationalScores = valid.map(v => v.total);
    const schoolScores = valid.filter(v => v.school === schoolCode).map(v => v.total);

    const avg = arr => (arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null);

    return {
      nationalAvg: nationalScores.length ? avg(nationalScores) : '-',
      schoolAvg: schoolScores.length ? avg(schoolScores) : '-'
    };
  } catch (e) {
    console.error('평균 조회 오류:', e);
    return { nationalAvg:'-', schoolAvg:'-' };
  }
}

// 실제 점수 분포 (유효응시자만, 점수=교시별 totalScore 합)
export async function getRealScoreDistribution(roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');

    const sessions = ['1교시','2교시','3교시','4교시'];
    const perSid = new Map(); // sid -> { total, completed, school }

    for (const session of sessions) {
      const colRef = collection(db, 'scores_raw', roundLabel, session);
      const snap = await getDocs(colRef);
      snap.forEach(d => {
        const sid = d.id;
        const data = d.data();
        if (!isValidStudentId(sid)) return;
        if (data?.status !== 'completed') return; // 해당 교시 미응시 제외
        const s = perSid.get(sid) || { total:0, completed:0, school: sid.slice(0,2) };
        const ts = Number.isFinite(+data.totalScore) ? +data.totalScore : 0;
        s.total += ts;
        s.completed += 1;
        perSid.set(sid, s);
      });
    }

    // 4교시 모두 응시자만 → 분포 집계
    const valid = Array.from(perSid.values()).filter(v => v.completed === 4);

    const national = valid.map(v => v.total);
    const bySchool = {};
    valid.forEach(v => {
      if (!bySchool[v.school]) bySchool[v.school] = [];
      bySchool[v.school].push(v.total);
    });

    return { national, bySchool, school: bySchool };
  } catch (e) {
    console.error('점수 분포 조회 오류:', e);
    return { national: [], bySchool: {}, school: {} };
  }
}

export { getSchoolCodeFromName }; // 필요 시 외부 사용

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

// 학교별/전국 평균 데이터 조회 (Firestore에서)
export async function getAverages(schoolName, roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    
    // 학교 코드 추출
    const schoolCode = getSchoolCodeFromName(schoolName);
    
    // 전국 평균 조회
    const nationalRef = doc(db, 'averages', roundLabel, 'data', 'national');
    const nationalSnap = await getDoc(nationalRef);
    
    // 학교 평균 조회
    const schoolRef = doc(db, 'averages', roundLabel, 'data', `school_${schoolCode}`);
    const schoolSnap = await getDoc(schoolRef);
    
    const nationalAvg = nationalSnap.exists() ? nationalSnap.data().avg : 204;
    const schoolAvg = schoolSnap.exists() ? schoolSnap.data().avg : 211;
    
    return { nationalAvg, schoolAvg };
  } catch (error) {
    console.error('평균 조회 오류:', error);
    return {
      nationalAvg: 204,
      schoolAvg: 211
    };
  }
}

// 실제 점수 분포 데이터 조회
export async function getRealScoreDistribution(roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');
    
    const sessions = ['1교시', '2교시', '3교시', '4교시'];
    const allScores = {}; // sid -> totalScore
    const schoolScores = {}; // schoolCode -> [scores]
    
    // 교시별 데이터 수집
    for (const session of sessions) {
      const sessionRef = collection(db, 'scores_raw', roundLabel, session);
      const snapshot = await getDocs(sessionRef);
      
      snapshot.forEach(doc => {
        const sid = doc.id;
        const data = doc.data();
        const wrongQuestions = data.wrongQuestions || data.wrong || [];
        
        if (!allScores[sid]) {
          allScores[sid] = 340; // 만점에서 시작
        }
        
        // 오답 개수만큼 점수 차감
        if (Array.isArray(wrongQuestions)) {
          allScores[sid] = Math.max(0, allScores[sid] - wrongQuestions.length);
        }
      });
    }
    
    // 학교별로 점수 분류
    Object.entries(allScores).forEach(([sid, score]) => {
      const schoolCode = sid.slice(0, 2);
      if (!schoolScores[schoolCode]) {
        schoolScores[schoolCode] = [];
      }
      schoolScores[schoolCode].push(score);
    });
    
    // 전국 점수 (모든 학교 합계)
    const nationalScores = Object.values(allScores);
    
    return {
      national: nationalScores,
      school: schoolScores, // 학교코드별 점수 배열
      bySchool: schoolScores
    };
    
  } catch (error) {
    console.error('점수 분포 조회 오류:', error);
    return {
      national: [],
      school: {},
      bySchool: {}
    };
  }
}

// 학교명 → 학교코드 변환
function getSchoolCodeFromName(schoolName) {
  const schoolMap = {
    "가천대": "01", "경희대": "02", "대구한": "03", "대전대": "04",
    "동국대": "05", "동신대": "06", "동의대": "07", "부산대": "08",
    "상지대": "09", "세명대": "10", "우석대": "11", "원광대": "12"
  };
  return schoolMap[schoolName] || "01";
}

// src/utils/helpers.js - 상위 퍼센트 계산 수정

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
  
  const x = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (val) => padT + plotH - (val / maxValue) * plotH;

  // 축 그리기
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // 라벨
  ctx.fillStyle = '#666';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < labels.length; i++) {
    ctx.fillText(labels[i], x(i), padT + plotH + 18);
  }

  // 시리즈별 라인
  const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107'];
  series.forEach((data, seriesIdx) => {
    ctx.strokeStyle = colors[seriesIdx % colors.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const cx = x(i);
      const cy = y(data[i]);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  });
}

// 유효한 학번 체크 (01~12로 시작하는 학번만)
function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string') return false;
  const schoolCode = sid.slice(0, 2);
  const validCodes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  return validCodes.includes(schoolCode);
}

// 평균 점수 조회
export async function getAverages(schoolName, roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    
    const nationalRef = doc(db, 'averages', `${roundLabel}_national`);
    const schoolRef = doc(db, 'averages', `${roundLabel}_${getSchoolCodeFromName(schoolName)}`);
    
    const [nationalSnap, schoolSnap] = await Promise.all([
      getDoc(nationalRef),
      getDoc(schoolRef)
    ]);
    
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

// ✅ 수정된 상위 퍼센트 계산 함수
export function calculatePercentile(studentScore, allScores) {
  if (!Array.isArray(allScores) || allScores.length === 0) {
    return null;
  }
  
  if (studentScore == null || isNaN(studentScore)) {
    return null;
  }
  
  // 자신보다 점수가 낮은 사람의 수
  const lowerCount = allScores.filter(score => score < studentScore).length;
  
  // 상위 퍼센트 계산
  // 점수가 높을수록 1%에 가까워짐 (상위권), 낮을수록 100%에 가까워짐 (하위권)
  const percentile = Math.round((lowerCount / allScores.length) * 100);
  
  // 100 - percentile이 상위 퍼센트
  return 100 - percentile;
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
        
        // 유효한 학수번호만 처리 (01~12로 시작하는 것만)
        if (!isValidStudentId(sid)) {
          return; // 유효하지 않은 학번은 제외
        }
        
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
    
    // 학교별로 점수 분류 (유효한 학번만)
    Object.entries(allScores).forEach(([sid, score]) => {
      if (!isValidStudentId(sid)) return; // 이중 체크
      
      const schoolCode = sid.slice(0, 2);
      if (!schoolScores[schoolCode]) {
        schoolScores[schoolCode] = [];
      }
      schoolScores[schoolCode].push(score);
    });
    
    // 전국 점수 (유효한 학번의 점수만)
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

// ✅ 누락된 함수 추가
export function detectStudentAbsenceStatus(wrongBySession) {
  // 4교시가 모두 있는지 확인
  const allSessions = ["1교시", "2교시", "3교시", "4교시"];
  const attendedSessions = Object.keys(wrongBySession);
  
  const isFullAttendance = allSessions.every(session => attendedSessions.includes(session));
  const isPartialAttendance = attendedSessions.length > 0 && attendedSessions.length < 4;
  const isNoAttendance = attendedSessions.length === 0;
  
  return {
    isFullAttendance,
    isPartialAttendance,
    isNoAttendance,
    attendedSessions,
    missedSessions: allSessions.filter(session => !attendedSessions.includes(session))
  };
}

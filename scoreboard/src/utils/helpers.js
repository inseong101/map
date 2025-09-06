// src/utils/helpers.js - 모든 누락 함수 포함

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

// 유효한 학수번호인지 확인 (01~12로 시작하는 6자리)
export function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string') return false;
  if (sid.length !== 6) return false;
  const schoolCode = sid.slice(0, 2);
  const validCodes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  return validCodes.includes(schoolCode);
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

// ✅ 상위 퍼센트(상위 백분위): 등수 기반, 동점 처리
export function calculatePercentile(studentScore, allScores) {
  if (!Array.isArray(allScores) || allScores.length === 0) return null;
  if (studentScore == null || isNaN(studentScore)) return null;
  const S = allScores.filter(Number.isFinite).sort((a, b) => b - a);
  if (S.length === 0) return null;
  const firstIdx = S.findIndex(v => v === studentScore);
  const rank = firstIdx === -1 ? (S.length + 1) : (firstIdx + 1); // 1등=1
  const pct = (rank / S.length) * 100;
  return Math.round(pct * 10) / 10; // 소수 1자리
}

// 실제 점수 분포 데이터 조회 (유효 SID만; 중도포기 제외; 4종 카운트 포함)
export async function getRealScoreDistribution(roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');
    
    const sessions = ['1교시', '2교시', '3교시', '4교시'];

    // 임시 누적
    const rawScoreBySid = {}; // sid -> 임시 총점(세션별 오답 차감 합산)
    const sessionCount = {};  // sid -> 응시한 교시 수
    const schoolOfSid = {};   // sid -> '01'~'12'

    // 교시별 데이터 수집
    for (const session of sessions) {
      const sessionRef = collection(db, 'scores_raw', roundLabel, session);
      const snapshot = await getDocs(sessionRef);
      
      snapshot.forEach(docSnap => {
        const sid = docSnap.id;
        if (!isValidStudentId(sid)) return; // ❗️비유효 SID는 완전 제외

        const data = docSnap.data();
        const wrongQuestions = data.wrongQuestions || data.wrong || [];

        sessionCount[sid] = (sessionCount[sid] ?? 0) + 1;
        schoolOfSid[sid] = sid.slice(0, 2);

        // 점수 누적(만점 340에서 오답만큼 차감)
        rawScoreBySid[sid] = (rawScoreBySid[sid] ?? 340);
        if (Array.isArray(wrongQuestions)) {
          rawScoreBySid[sid] = Math.max(0, rawScoreBySid[sid] - wrongQuestions.length);
        }
      });
    }

    // ✅ 분포/퍼센타일용 점수는 "풀참여(4교시)"만 사용 (중도포기 1~3교시는 제외)
    const nationalScores = [];
    const schoolScores = {}; // schoolCode -> [scores]

    Object.entries(rawScoreBySid).forEach(([sid, score]) => {
      const c = sessionCount[sid] || 0;
      if (c === 4) {
        nationalScores.push(score);
        const sc = schoolOfSid[sid];
        if (!schoolScores[sc]) schoolScores[sc] = [];
        schoolScores[sc].push(score);
      }
    });

    // ✅ 카운트(전국 기준) — 모두 유효 SID만 대상으로 계산
    //  - 전체응시자: 1~4교시 중 하나라도 응시
    //  - 유효응시자: 4교시 모두 응시
    //  - 중도포기자: 1~3교시
    //  - 미응시자: raw에서 0교시는 잡히지 않음(명부 없으면 0으로 둠)
    let totalAttended = 0, validFull = 0, dropout = 0;
    Object.values(sessionCount).forEach(c => {
      if (c >= 1) totalAttended += 1;
      if (c === 4) validFull += 1;
      if (c >= 1 && c <= 3) dropout += 1;
    });
    const absent = 0;

    return {
      national: nationalScores,
      school: schoolScores,
      bySchool: schoolScores,
      countsNational: {
        totalAttended,   // 전체 응시자(1~4교시)
        validFull,       // 유효 응시자(4교시)
        absent,          // 미응시자(0교시, 명부 없으면 0)
        dropout          // 중도포기(1~3교시)
      }
    };
  } catch (error) {
    console.error('점수 분포 조회 오류:', error);
    return {
      national: [],
      school: {},
      bySchool: {},
      countsNational: { totalAttended: 0, validFull: 0, absent: 0, dropout: 0 }
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
  const allSessions = ["1교시", "2교시", "3교시", "4교시"];
  const attendedSessions = Object.keys(wrongBySession || {});
  const attendedCount = attendedSessions.length; // 참석한 교시 수
  
  const isFullAttendance = allSessions.every(sess => attendedSessions.includes(sess));
  const isPartiallyAbsent = attendedCount > 0 && attendedCount < 4; // 일부 교시만 응시(중도포기)
  const isNoAttendance = attendedCount === 0;
  
  return {
    isFullAttendance,
    isPartiallyAbsent,        // 중도포기 여부
    isNoAttendance,
    attendedCount,            // 참석한 교시 개수
    attendedSessions,
    missedSessions: allSessions.filter(sess => !attendedSessions.includes(sess))
  };
}

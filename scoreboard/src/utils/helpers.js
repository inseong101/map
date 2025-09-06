// src/utils/helpers.js 파일 맨 끝에 추가할 코드

// 유효한 학수번호인지 확인 (01~12로 시작하는 6자리)
function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string') return false;
  if (sid.length !== 6) return false;
  
  const schoolCode = sid.slice(0, 2);
  const validCodes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  return validCodes.includes(schoolCode);
}

// 학교명 → 학교코드 변환 (기존 함수를 export로 변경)
export function getSchoolCodeFromName(schoolName) {
  const schoolMap = {
    "가천대": "01", "경희대": "02", "대구한": "03", "대전대": "04",
    "동국대": "05", "동신대": "06", "동의대": "07", "부산대": "08",
    "상지대": "09", "세명대": "10", "우석대": "11", "원광대": "12"
  };
  return schoolMap[schoolName] || "01";
}

// 미응시자 통계 분석 함수
export async function getAbsenceStatistics(roundLabel) {
  try {
    const { db } = await import('../services/firebase');
    const { collection, getDocs } = await import('firebase/firestore');
    
    const sessions = ['1교시', '2교시', '3교시', '4교시'];
    const studentData = {}; // sid -> { attendedSessions: [], hasValidResponses: boolean }
    const validStudentIds = new Set(); // 유효한 학수번호 추적
    
    // 모든 교시 데이터 수집
    for (const session of sessions) {
      const sessionRef = collection(db, 'scores_raw', roundLabel, session);
      const snapshot = await getDocs(sessionRef);
      
      snapshot.forEach(doc => {
        const sid = doc.id;
        const data = doc.data();
        
        // 유효한 학수번호만 처리
        if (!isValidStudentId(sid)) return;
        
        validStudentIds.add(sid);
        
        if (!studentData[sid]) {
          studentData[sid] = {
            attendedSessions: [],
            hasValidResponses: false,
            totalWrong: 0
          };
        }
        
        // 응답 데이터 확인
        const responses = data.responses || {};
        const wrongQuestions = data.wrongQuestions || data.wrong || [];
        
        // 1~5 범위의 유효한 응답이 있는지 확인
        const validResponses = Object.values(responses).filter(answer => 
          Number.isInteger(answer) && answer >= 1 && answer <= 5
        );
        
        if (validResponses.length > 0) {
          studentData[sid].attendedSessions.push(session);
          studentData[sid].hasValidResponses = true;
          
          // 오답 수 누적
          if (Array.isArray(wrongQuestions)) {
            studentData[sid].totalWrong += wrongQuestions.length;
          }
        }
      });
    }
    
    // 120명 전체 기준으로 분류
    const totalExpected = 120; // 시험 대상자 총 120명
    const totalValidStudents = validStudentIds.size;
    
    let fullAttendees = 0;      // 4교시 모두 응시
    let partialAttendees = 0;   // 1~3교시만 응시
    let fullAbsentees = 0;      // 전체 미응시
    
    // 유효한 학생 데이터 분석
    Object.values(studentData).forEach(student => {
      const sessionCount = student.attendedSessions.length;
      
      if (sessionCount === 4) {
        fullAttendees++;
      } else if (sessionCount > 0) {
        partialAttendees++;
      } else {
        fullAbsentees++;
      }
    });
    
    // 120명에서 누락된 학생들은 전체 미응시로 간주
    const missingStudents = totalExpected - totalValidStudents;
    fullAbsentees += missingStudents;
    
    return {
      totalExpected,           // 120
      totalValidStudents,      // 실제 데이터 있는 학생 수
      fullAttendees,          // 4교시 모두 응시
      partialAttendees,       // 1~3교시만 응시  
      fullAbsentees,          // 전체 미응시
      attendees: fullAttendees + partialAttendees, // 총 응시자
      
      // 상세 정보
      studentData
    };
    
  } catch (error) {
    console.error('미응시자 통계 조회 오류:', error);
    return {
      totalExpected: 120,
      totalValidStudents: 0,
      fullAttendees: 0,
      partialAttendees: 0,
      fullAbsentees: 120,
      attendees: 0,
      studentData: {}
    };
  }
}

// 학생 개별 미응시 상태 확인
export function detectStudentAbsenceStatus(data) {
  if (!data || !data.wrongBySession) return { isNormal: true };
  
  const sessions = ["1교시", "2교시", "3교시", "4교시"];
  const attendedSessions = sessions.filter(session => 
    data.wrongBySession[session] && Array.isArray(data.wrongBySession[session])
  );
  
  if (attendedSessions.length === 0) {
    return { isFullyAbsent: true };
  } else if (attendedSessions.length < 4) {
    return { isPartiallyAbsent: true, attendedCount: attendedSessions.length };
  } else {
    return { isNormal: true };
  }
}

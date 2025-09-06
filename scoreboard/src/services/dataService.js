// src/services/dataService.js - convertWrongToScores 함수 수정

// 🔥 수정 전 (문제가 되는 코드)
function convertWrongToScores(wrongBySession) {
  const subjectScores = {};
  
  // 모든 과목을 만점으로 초기화 ← 문제!
  ALL_SUBJECTS.forEach(subject => {
    subjectScores[subject] = SUBJECT_MAX[subject];
  });

  // 교시별 오답을 과목별로 차감
  Object.entries(wrongBySession).forEach(([session, wrongList]) => {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    
    wrongList.forEach(questionNum => {
      const range = ranges.find(r => questionNum >= r.from && questionNum <= r.to);
      if (range && range.s in subjectScores) {
        subjectScores[range.s] = Math.max(0, subjectScores[range.s] - 1);
      }
    });
  });
  
  // ... 나머지 코드
}

// ✅ 수정 후 (중도포기자 처리 추가)
function convertWrongToScores(wrongBySession) {
  const subjectScores = {};
  const sessions = ["1교시", "2교시", "3교시", "4교시"];
  
  // 1단계: 응시한 교시 확인
  const attendedSessions = Object.keys(wrongBySession);
  const isPartialAbsent = attendedSessions.length < 4;
  
  // 2단계: 과목별 점수 초기화
  ALL_SUBJECTS.forEach(subject => {
    // 해당 과목이 속한 교시를 찾기
    const sessionForSubject = findSessionForSubject(subject);
    
    if (attendedSessions.includes(sessionForSubject)) {
      // 응시한 교시의 과목: 만점에서 시작
      subjectScores[subject] = SUBJECT_MAX[subject];
    } else {
      // 미응시한 교시의 과목: 0점
      subjectScores[subject] = 0;
    }
  });

  // 3단계: 교시별 오답을 과목별로 차감
  Object.entries(wrongBySession).forEach(([session, wrongList]) => {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    
    wrongList.forEach(questionNum => {
      const range = ranges.find(r => questionNum >= r.from && questionNum <= r.to);
      if (range && range.s in subjectScores) {
        subjectScores[range.s] = Math.max(0, subjectScores[range.s] - 1);
      }
    });
  });

  // ... 나머지 그룹별 결과 계산 코드는 동일
}

// 새로운 헬퍼 함수: 과목이 속한 교시 찾기
function findSessionForSubject(subject) {
  for (const [session, ranges] of Object.entries(SESSION_SUBJECT_RANGES)) {
    if (ranges.some(range => range.s === subject)) {
      return session;
    }
  }
  return null;
}

// ==========================================
// 전체 수정된 convertWrongToScores 함수
// ==========================================

function convertWrongToScores(wrongBySession) {
  const subjectScores = {};
  const attendedSessions = Object.keys(wrongBySession);
  
  // 과목이 속한 교시를 찾는 헬퍼 함수
  const findSessionForSubject = (subject) => {
    for (const [session, ranges] of Object.entries(SESSION_SUBJECT_RANGES)) {
      if (ranges.some(range => range.s === subject)) {
        return session;
      }
    }
    return null;
  };
  
  // 과목별 점수 초기화 (미응시 교시 고려)
  ALL_SUBJECTS.forEach(subject => {
    const sessionForSubject = findSessionForSubject(subject);
    
    if (attendedSessions.includes(sessionForSubject)) {
      // 응시한 교시의 과목: 만점에서 시작
      subjectScores[subject] = SUBJECT_MAX[subject];
    } else {
      // 미응시한 교시의 과목: 0점
      subjectScores[subject] = 0;
    }
  });

  // 교시별 오답을 과목별로 차감
  Object.entries(wrongBySession).forEach(([session, wrongList]) => {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    
    wrongList.forEach(questionNum => {
      const range = ranges.find(r => questionNum >= r.from && questionNum <= r.to);
      if (range && range.s in subjectScores) {
        subjectScores[range.s] = Math.max(0, subjectScores[range.s] - 1);
      }
    });
  });

  // 그룹별 결과 계산
  const groupResults = GROUPS.map(group => {
    const groupScore = group.subjects.reduce((sum, subject) => sum + (subjectScores[subject] || 0), 0);
    const groupMax = group.subjects.reduce((sum, subject) => sum + (SUBJECT_MAX[subject] || 0), 0);
    const cutoff = Math.ceil(groupMax * 0.4);
    const pass = groupScore >= cutoff;

    return {
      name: group.id,
      label: group.label,
      subjects: group.subjects,
      layoutChunks: group.layoutChunks,
      score: groupScore,
      max: groupMax,
      rate: Math.round((groupScore / groupMax) * 100),
      pass,
      cutoff
    };
  });

  const totalScore = ALL_SUBJECTS.reduce((sum, subject) => sum + (subjectScores[subject] || 0), 0);
  const overallCutoff = Math.ceil(TOTAL_MAX * 0.6);
  const meets60 = totalScore >= overallCutoff;
  const anyGroupFail = groupResults.some(g => !g.pass);
  const overallPass = meets60 && !anyGroupFail;

  return {
    totalScore,
    totalMax: TOTAL_MAX,
    overallPass,
    meets60,
    anyGroupFail,
    groupResults,
    subjectScores,
    wrongBySession
  };
}

// ==========================================
// 예시: 중도포기자 처리 결과
// ==========================================

/*
중도포기자 (1,2교시만 응시, 3,4교시 미응시):
- wrongBySession: { "1교시": [3, 7, 15], "2교시": [5, 22, 45] }
- attendedSessions: ["1교시", "2교시"]

수정 전 결과:
- 간(1교시): 16-3 = 13점 ✓
- 침구(2교시): 48-3 = 45점 ✓  
- 외과(3교시): 16점 ← 문제! (미응시인데 만점)
- 소아(4교시): 24점 ← 문제! (미응시인데 만점)

수정 후 결과:
- 간(1교시): 16-3 = 13점 ✓
- 침구(2교시): 48-3 = 45점 ✓
- 외과(3교시): 0점 ✓ (미응시)
- 소아(4교시): 0점 ✓ (미응시)
*/

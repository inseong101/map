// functions/index.js - 완전한 통계 분석 함수들
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// 과목별 최대 점수
const SUBJECT_MAX = {
  "간":16, "심":16, "비":16, "폐":16, "신":16,
  "상한":16, "사상":16, "침구":48, "보건":20,
  "외과":16, "신경":16, "안이비":16, "부인과":32, 
  "소아":24, "예방":24, "생리":16, "본초":16
};

// 교시별 문항번호 → 과목 매핑
const SESSION_SUBJECT_RANGES = {
  "1교시": [
    { from: 1,  to: 16, s: "간" },
    { from: 17, to: 32, s: "심" },
    { from: 33, to: 48, s: "비" },
    { from: 49, to: 64, s: "폐" },
    { from: 65, to: 80, s: "신" }
  ],
  "2교시": [
    { from: 1,  to: 16, s: "상한" },
    { from: 17, to: 32, s: "사상" },
    { from: 33, to: 80, s: "침구" },
    { from: 81, to: 100, s: "보건" }
  ],
  "3교시": [
    { from: 1,  to: 16, s: "외과" },
    { from: 17, to: 32, s: "신경" },
    { from: 33, to: 48, s: "안이비" },
    { from: 49, to: 80, s: "부인과" }
  ],
  "4교시": [
    { from: 1,  to: 24, s: "소아" },
    { from: 25, to: 48, s: "예방" },
    { from: 49, to: 64, s: "생리" },
    { from: 65, to: 80, s: "본초" }
  ]
};

/**
 * 답안 제출 시 통계를 자동으로 업데이트하는 트리거
 */
exports.updateAnalyticsOnSubmission = functions.firestore
  .document('scores_raw/{roundLabel}/{session}/{sid}')
  .onWrite(async (change, context) => {
    const { roundLabel, session, sid } = context.params;
    
    try {
      console.log(`통계 업데이트 트리거: ${roundLabel} ${session} ${sid}`);
      
      // 해당 교시의 통계 업데이트
      await updateSessionAnalytics(roundLabel, session);
      
      // 전체 회차 통계도 업데이트
      await updateRoundAnalytics(roundLabel);
      
      console.log('통계 업데이트 완료');
      
    } catch (error) {
      console.error('통계 업데이트 실패:', error);
    }
  });

/**
 * HTTP 요청으로 수동 통계 업데이트 (관리자용)
 */
exports.manualUpdateAnalytics = functions.https.onRequest(async (req, res) => {
  // CORS 헤더 설정
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { roundLabel, session } = req.method === 'POST' ? req.body : req.query;
    
    if (!roundLabel) {
      return res.status(400).json({ error: '회차(roundLabel)는 필수입니다.' });
    }
    
    console.log(`수동 통계 업데이트: ${roundLabel} ${session || '전체'}`);
    
    if (session) {
      // 특정 교시만 업데이트
      await updateSessionAnalytics(roundLabel, session);
    } else {
      // 전체 회차 업데이트
      const sessions = ['1교시', '2교시', '3교시', '4교시'];
      for (const sess of sessions) {
        await updateSessionAnalytics(roundLabel, sess);
      }
    }
    
    await updateRoundAnalytics(roundLabel);
    
    res.json({ 
      success: true, 
      message: `${roundLabel} ${session || '전체'} 통계가 업데이트되었습니다.`,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
  } catch (error) {
    console.error('수동 통계 업데이트 실패:', error);
    res.status(500).json({ 
      error: '통계 업데이트 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

/**
 * 특정 교시의 통계를 업데이트합니다
 */
async function updateSessionAnalytics(roundLabel, session) {
  try {
    console.log(`교시별 통계 업데이트: ${roundLabel} ${session}`);
    
    // 해당 교시의 모든 학생 데이터 조회
    const sessionRef = db.collection('scores_raw').doc(roundLabel).collection(session);
    const snapshot = await sessionRef.get();
    
    const analytics = {
      roundLabel,
      session,
      totalStudents: 0,
      questionStats: {}, // 문항별 통계
      choiceStats: {},   // 선택지별 통계
      schoolStats: {},   // 학교별 통계
      subjectStats: {},  // 과목별 통계
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const { sid, responses = {}, wrongQuestions = [] } = data;
      
      analytics.totalStudents++;
      
      // 학교별 통계
      const schoolCode = sid.substring(0, 2);
      if (!analytics.schoolStats[schoolCode]) {
        analytics.schoolStats[schoolCode] = {
          totalStudents: 0,
          totalWrong: 0,
          questionStats: {}
        };
      }
      analytics.schoolStats[schoolCode].totalStudents++;
      
      // 문항별 통계 계산
      Object.entries(responses).forEach(([questionNum, choice]) => {
        const qNum = parseInt(questionNum);
        
        if (!analytics.questionStats[qNum]) {
          analytics.questionStats[qNum] = {
            totalResponses: 0,
            wrongCount: 0,
            choices: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
          };
        }
        
        if (!analytics.choiceStats[qNum]) {
          analytics.choiceStats[qNum] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        }
        
        // 응답 수 증가
        analytics.questionStats[qNum].totalResponses++;
        analytics.choiceStats[qNum][choice]++;
        
        // 오답 여부 확인
        if (wrongQuestions.includes(qNum)) {
          analytics.questionStats[qNum].wrongCount++;
          analytics.schoolStats[schoolCode].totalWrong++;
          
          if (!analytics.schoolStats[schoolCode].questionStats[qNum]) {
            analytics.schoolStats[schoolCode].questionStats[qNum] = { wrongCount: 0 };
          }
          analytics.schoolStats[schoolCode].questionStats[qNum].wrongCount++;
        }
        
        // 과목별 통계
        const subject = findSubjectByQuestionNum(qNum, session);
        if (subject) {
          if (!analytics.subjectStats[subject]) {
            analytics.subjectStats[subject] = {
              totalQuestions: 0,
              wrongCount: 0,
              questions: []
            };
          }
          
          if (!analytics.subjectStats[subject].questions.includes(qNum)) {
            analytics.subjectStats[subject].questions.push(qNum);
            analytics.subjectStats[subject].totalQuestions++;
          }
          
          if (wrongQuestions.includes(qNum)) {
            analytics.subjectStats[subject].wrongCount++;
          }
        }
      });
    });
    
    // 오답률 계산
    Object.keys(analytics.questionStats).forEach(questionNum => {
      const stats = analytics.questionStats[questionNum];
      stats.errorRate = stats.totalResponses > 0 
        ? (stats.wrongCount / stats.totalResponses * 100) 
        : 0;
    });
    
    // 결과 저장
    const analyticsRef = db.collection('analytics').doc(`${roundLabel}_${session}`);
    await analyticsRef.set(analytics);
    
    console.log(`${roundLabel} ${session} 통계 업데이트 완료: ${analytics.totalStudents}명`);
    
  } catch (error) {
    console.error('교시별 통계 업데이트 실패:', error);
    throw error;
  }
}

/**
 * 전체 회차 통계를 업데이트합니다
 */
async function updateRoundAnalytics(roundLabel) {
  try {
    console.log(`전체 회차 통계 업데이트: ${roundLabel}`);
    
    const sessions = ['1교시', '2교시', '3교시', '4교시'];
    const roundAnalytics = {
      roundLabel,
      sessions: {},
      overall: {
        totalStudents: 0,
        averageScore: 0,
        passRate: 0,
        topWrongQuestions: [], // 상위 오답 문항 (오답률 높은 순)
        highErrorRateQuestions: {}, // 과목별 고오답률 문항
        schoolComparison: {}   // 학교별 비교
      },
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // 각 교시별 통계 수집
    for (const session of sessions) {
      try {
        const analyticsRef = db.collection('analytics').doc(`${roundLabel}_${session}`);
        const analyticsSnap = await analyticsRef.get();
        
        if (analyticsSnap.exists()) {
          roundAnalytics.sessions[session] = analyticsSnap.data();
        }
      } catch (error) {
        console.warn(`${session} 통계 조회 실패:`, error);
      }
    }
    
    // 전체 통계 계산
    const allQuestions = {};
    const schoolTotals = {};
    
    Object.values(roundAnalytics.sessions).forEach(sessionData => {
      roundAnalytics.overall.totalStudents = Math.max(
        roundAnalytics.overall.totalStudents, 
        sessionData.totalStudents || 0
      );
      
      // 문항별 통계 병합
      Object.entries(sessionData.questionStats || {}).forEach(([qNum, stats]) => {
        if (!allQuestions[qNum]) {
          allQuestions[qNum] = { ...stats };
        }
      });
      
      // 학교별 통계 병합
      Object.entries(sessionData.schoolStats || {}).forEach(([schoolCode, stats]) => {
        if (!schoolTotals[schoolCode]) {
          schoolTotals[schoolCode] = {
            totalStudents: 0,
            totalWrong: 0
          };
        }
        schoolTotals[schoolCode].totalStudents = Math.max(
          schoolTotals[schoolCode].totalStudents,
          stats.totalStudents || 0
        );
        schoolTotals[schoolCode].totalWrong += stats.totalWrong || 0;
      });
    });
    
    // 상위 오답 문항 추출 (오답률 50% 이상)
    roundAnalytics.overall.topWrongQuestions = Object.entries(allQuestions)
      .map(([qNum, stats]) => ({
        questionNum: parseInt(qNum),
        errorRate: Math.round(stats.errorRate || 0),
        wrongCount: stats.wrongCount || 0,
        totalResponses: stats.totalResponses || 0
      }))
      .filter(q => q.errorRate >= 50)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 50);
    
    // 과목별 고오답률 문항 분류
    roundAnalytics.overall.topWrongQuestions.forEach(q => {
      const subject = findSubjectByQuestionNum(q.questionNum);
      if (subject) {
        if (!roundAnalytics.overall.highErrorRateQuestions[subject]) {
          roundAnalytics.overall.highErrorRateQuestions[subject] = [];
        }
        roundAnalytics.overall.highErrorRateQuestions[subject].push(q.questionNum);
      }
    });
    
    roundAnalytics.overall.schoolComparison = schoolTotals;
    
    // 결과 저장
    const roundRef = db.collection('analytics').doc(`${roundLabel}_summary`);
    await roundRef.set(roundAnalytics);
    
    console.log(`${roundLabel} 전체 통계 업데이트 완료`);
    
  } catch (error) {
    console.error('회차별 통계 업데이트 실패:', error);
    throw error;
  }
}

/**
 * 문항 번호로 과목을 찾습니다
 */
function findSubjectByQuestionNum(questionNum, session = null) {
  // 교시를 모르는 경우 모든 교시에서 검색
  const sessionsToCheck = session ? [session] : Object.keys(SESSION_SUBJECT_RANGES);
  
  for (const sess of sessionsToCheck) {
    const ranges = SESSION_SUBJECT_RANGES[sess] || [];
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) {
        return range.s;
      }
    }
  }
  
  return null;
}

/**
 * 고오답률 문항 조회 API
 */
exports.getHighErrorRateQuestions = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { roundLabel } = req.query;
    
    if (!roundLabel) {
      return res.status(400).json({ error: '회차(roundLabel)는 필수입니다.' });
    }
    
    const summaryRef = db.collection('analytics').doc(`${roundLabel}_summary`);
    const summarySnap = await summaryRef.get();
    
    if (summarySnap.exists()) {
      const data = summarySnap.data();
      res.json({
        success: true,
        data: data.overall?.highErrorRateQuestions || {},
        topQuestions: data.overall?.topWrongQuestions || []
      });
    } else {
      res.json({
        success: true,
        data: {},
        topQuestions: [],
        message: '해당 회차의 통계 데이터가 없습니다.'
      });
    }
    
  } catch (error) {
    console.error('고오답률 문항 조회 실패:', error);
    res.status(500).json({
      error: '데이터 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 문항별 선택률 조회 API
 */
exports.getQuestionChoiceStats = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const { roundLabel, questionNum } = req.query;
    
    if (!roundLabel || !questionNum) {
      return res.status(400).json({ error: '회차와 문항번호는 필수입니다.' });
    }
    
    const qNum = parseInt(questionNum);
    const session = findSessionByQuestionNum(qNum);
    
    if (!session) {
      return res.status(400).json({ error: '유효하지 않은 문항번호입니다.' });
    }
    
    const analyticsRef = db.collection('analytics').doc(`${roundLabel}_${session}`);
    const analyticsSnap = await analyticsRef.get();
    
    if (analyticsSnap.exists()) {
      const data = analyticsSnap.data();
      const questionStats = data.questionStats?.[qNum];
      const choiceStats = data.choiceStats?.[qNum];
      
      if (questionStats && choiceStats) {
        // 정답 조회
        const answerKeyRef = db.collection('answer_keys').doc(roundLabel);
        const answerKeySnap = await answerKeyRef.get();
        const correctAnswer = answerKeySnap.exists() ? answerKeySnap.data()?.[qNum] : null;
        
        res.json({
          success: true,
          data: {
            questionNum: qNum,
            choices: choiceStats,
            totalResponses: questionStats.totalResponses,
            wrongCount: questionStats.wrongCount,
            errorRate: questionStats.errorRate,
            correctAnswer
          }
        });
      } else {
        res.json({
          success: true,
          data: null,
          message: '해당 문항의 통계 데이터가 없습니다.'
        });
      }
    } else {
      res.json({
        success: true,
        data: null,
        message: '해당 회차의 통계 데이터가 없습니다.'
      });
    }
    
  } catch (error) {
    console.error('문항별 선택률 조회 실패:', error);
    res.status(500).json({
      error: '데이터 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 문항 번호로 교시를 찾습니다
 */
function findSessionByQuestionNum(questionNum) {
  for (const [session, ranges] of Object.entries(SESSION_SUBJECT_RANGES)) {
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) {
        return session;
      }
    }
  }
  return null;
}

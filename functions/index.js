// functions/index.js - Firebase Cloud Functions for Analytics
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * 답안 제출 시 통계를 자동으로 업데이트하는 트리거
 */
exports.updateAnalyticsOnSubmission = functions.firestore
  .document('scores_raw/{roundLabel}/{session}/{sid}')
  .onWrite(async (change, context) => {
    const { roundLabel, session, sid } = context.params;
    
    try {
      console.log(`통계 업데이트 트리거: ${roundLabel} ${session} ${sid}`);
      
      // 해당 교시의 모든 데이터를 다시 집계
      await updateSessionAnalytics(roundLabel, session);
      
      // 전체 회차 통계도 업데이트
      await updateRoundAnalytics(roundLabel);
      
      console.log('통계 업데이트 완료');
      
    } catch (error) {
      console.error('통계 업데이트 실패:', error);
    }
  });

/**
 * 특정 교시의 통계를 업데이트합니다
 */
async function updateSessionAnalytics(roundLabel, session) {
  try {
    // 해당 교시의 모든 학생 데이터 조회
    const sessionRef = db.collection('scores_raw').doc(roundLabel).collection(session);
    const snapshot = await sessionRef.get();
    
    const analytics = {
      totalStudents: 0,
      questionStats: {}, // 문항별 통계
      choiceStats: {},   // 선택지별 통계
      schoolStats: {},   // 학교별 통계
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
    
    console.log(`${roundLabel} ${session} 통계 업데이트 완료`);
    
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
    const sessions = ['1교시', '2교시', '3교시', '4교시'];
    const roundAnalytics = {
      roundLabel,
      sessions: {},
      overall: {
        totalStudents: 0,
        averageScore: 0,
        passRate: 0,
        topWrongQuestions: [], // 상위 오답 문항
        schoolComparison: {}   // 학교별 비교
      },
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };
    
    for (const session of sessions) {
      const analyticsRef = db.collection('analytics').doc(`${roundLabel}_${session}`);
      const analyticsSnap = await analyticsRef.get();
      
      if (analyticsSnap.exists()) {
        roundAnalytics.sessions[session] = analyticsSnap.data();
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
    
    // 상위 오답 문항 추출 (오답률 높은 순)
    roundAnalytics.overall.topWrongQuestions = Object.entries(allQuestions)
      .map(([qNum, stats]) => ({
        questionNum: parseInt(qNum),
        errorRate: stats.errorRate || 0,
        wrongCount: stats.wrongCount || 0,
        totalResponses: stats.totalResponses || 0
      }))
      .filter(q => q.errorRate >= 30) // 30% 이상 오답률
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 50); // 상위 50문항
    
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
 * HTTP 요청으로 수동 통계 업데이트 (관리자용)
 */
exports.manualUpdateAnalytics = functions.https.onRequest(async (req, res) => {
  try {
    const { roundLabel, session } = req.body;
    
    if (!roundLabel) {
      return res.status(400).json({ error: '회차(roundLabel)는 필수입니다.' });
    }
    
    if (session) {
      // 특정 교시만 업데이트
      await updateSessionAnalytics(roundLabel, session);
      await updateRoundAnalytics(roundLabel);
      
      res.json({ 
        success: true, 
        message: `${roundLabel} ${session} 통계가 업데이트되었습니다.` 
      });
    } else {
      // 전체 회차 업데이트
      const sessions = ['1교시', '2교시', '3교시', '4교시'];
      
      for (const sess of sessions) {
        await updateSessionAnalytics(roundLabel, sess);
      }
      await updateRoundAnalytics(roundLabel);
      
      res.json({ 
        success: true, 
        message: `${roundLabel} 전체 통계가 업데이트되었습니다.` 
      });
    }
    
  } catch (error) {
    console.error('수동 통계 업데이트 실패:', error);
    res.status(500).json({ 
      error: '통계 업데이트 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

/**
 * 정답지 업데이트 시 모든 통계 재계산
 */
exports.recalculateOnAnswerKeyUpdate = functions.firestore
  .document('answer_keys/{roundLabel}')
  .onWrite(async (change, context) => {
    const { roundLabel } = context.params;
    
    try {
      console.log(`정답지 업데이트로 인한 통계 재계산: ${roundLabel}`);
      
      const sessions = ['1교시', '2교시', '3교시', '4교시'];
      
      for (const session of sessions) {
        await updateSessionAnalytics(roundLabel, session);
      }
      await updateRoundAnalytics(roundLabel);
      
      console.log('정답지 기반 통계 재계산 완료');
      
    } catch (error) {
      console.error('통계 재계산 실패:', error);
    }
  });

/**
 * 스케줄된 작업으로 일일 통계 정리 (매일 자정)
 */
exports.scheduledAnalyticsCleanup = functions.pubsub
  .schedule('0 0 * * *')
  .timeZone('Asia/Seoul')
  .onRun(async (context) => {
    try {
      console.log('일일 통계 정리 작업 시작');
      
      // 오래된 임시 통계 데이터 정리
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7); // 7일 이전 데이터
      
      const oldDataQuery = db.collection('analytics')
        .where('lastUpdated', '<', cutoffDate);
      
      const snapshot = await oldDataQuery.get();
      const batch = db.batch();
      
      snapshot.forEach(doc => {
        if (doc.id.includes('_needs_update')) {
          batch.delete(doc.ref);
        }
      });
      
      await batch.commit();
      
      console.log(`${snapshot.size}개의 오래된 통계 데이터를 정리했습니다.`);
      
    } catch (error) {
      console.error('일일 통계 정리 실패:', error);
    }
  });

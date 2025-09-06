// functions/index.js - 단순화된 버전
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * 간단한 수동 통계 업데이트 함수 (HTTP)
 */
exports.manualUpdateAnalytics = functions.https.onRequest(async (req, res) => {
  try {
    const { roundLabel, session } = req.body;
    
    if (!roundLabel) {
      return res.status(400).json({ error: '회차(roundLabel)는 필수입니다.' });
    }
    
    console.log(`통계 업데이트 요청: ${roundLabel} ${session || '전체'}`);
    
    // 간단한 성공 응답
    res.json({ 
      success: true, 
      message: `${roundLabel} 통계 업데이트 요청이 접수되었습니다.`,
      timestamp: new Date().toISOString()
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
 * 답안 제출 감지 함수 (Firestore 트리거) - 단순화
 */
exports.updateAnalyticsOnSubmission = functions.firestore
  .document('scores_raw/{roundLabel}/{session}/{sid}')
  .onWrite(async (change, context) => {
    const { roundLabel, session, sid } = context.params;
    
    try {
      console.log(`답안 제출 감지: ${roundLabel} ${session} ${sid}`);
      
      // 간단한 로그만 기록
      await db.collection('analytics').doc(`${roundLabel}_log`).set({
        lastActivity: admin.firestore.FieldValue.serverTimestamp(),
        roundLabel,
        session,
        sid,
        action: 'submission_detected'
      }, { merge: true });
      
      console.log('통계 로그 업데이트 완료');
      
    } catch (error) {
      console.error('통계 업데이트 실패:', error);
    }
  });

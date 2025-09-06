// functions/index.js - Firebase Functions v6 문법으로 수정
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

/**
 * 답안 제출 시 통계를 자동으로 업데이트하는 트리거
 */
exports.updateAnalyticsOnSubmission = onDocumentWritten(
  'scores_raw/{roundLabel}/{session}/{sid}',
  async (event) => {
    const { roundLabel, session, sid } = event.params;
    
    try {
      console.log(`통계 업데이트 트리거: ${roundLabel} ${session} ${sid}`);
      
      // 간단한 로그만 기록
      await db.collection('analytics').doc(`${roundLabel}_log`).set({
        lastActivity: new Date(),
        roundLabel,
        session,
        sid,
        action: 'submission_detected'
      }, { merge: true });
      
      console.log('통계 업데이트 완료');
      
    } catch (error) {
      console.error('통계 업데이트 실패:', error);
    }
  }
);

/**
 * HTTP 요청으로 수동 통계 업데이트 (관리자용)
 */
exports.manualUpdateAnalytics = onRequest(
  {
    cors: true,
    timeoutSeconds: 300,
    memory: '512MiB'
  },
  async (req, res) => {
    try {
      const { roundLabel, session } = req.method === 'POST' ? req.body : req.query;
      
      if (!roundLabel) {
        return res.status(400).json({ error: '회차(roundLabel)는 필수입니다.' });
      }
      
      console.log(`수동 통계 업데이트: ${roundLabel} ${session || '전체'}`);
      
      // 간단한 처리
      await db.collection('analytics').doc(`${roundLabel}_manual`).set({
        timestamp: new Date(),
        roundLabel,
        session: session || 'all',
        status: 'completed'
      });
      
      res.json({ 
        success: true, 
        message: `${roundLabel} 통계가 업데이트되었습니다.` 
      });
      
    } catch (error) {
      console.error('수동 통계 업데이트 실패:', error);
      res.status(500).json({ 
        error: '통계 업데이트 중 오류가 발생했습니다.',
        details: error.message 
      });
    }
  }
);

/**
 * 정답지 업데이트 시 모든 통계 재계산
 */
exports.recalculateOnAnswerKeyUpdate = onDocumentWritten(
  'answer_keys/{roundLabel}',
  async (event) => {
    const { roundLabel } = event.params;
    
    try {
      console.log(`정답지 업데이트로 인한 통계 재계산: ${roundLabel}`);
      
      // 간단한 로그 기록
      await db.collection('analytics').doc(`${roundLabel}_recalc`).set({
        timestamp: new Date(),
        roundLabel,
        action: 'answer_key_updated'
      });
      
      console.log('정답지 기반 통계 재계산 완료');
      
    } catch (error) {
      console.error('통계 재계산 실패:', error);
    }
  }
);

/**
 * 스케줄된 작업으로 일일 통계 정리 (매일 자정)
 */
exports.scheduledAnalyticsCleanup = onSchedule(
  {
    schedule: '0 0 * * *',
    timeZone: 'Asia/Seoul'
  },
  async (event) => {
    try {
      console.log('일일 통계 정리 작업 시작');
      
      // 7일 이전 임시 데이터 정리
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);
      
      const oldDataQuery = db.collection('analytics')
        .where('timestamp', '<', cutoffDate);
      
      const snapshot = await oldDataQuery.get();
      
      if (!snapshot.empty) {
        const batch = db.batch();
        
        snapshot.forEach(doc => {
          if (doc.id.includes('_temp') || doc.id.includes('_log')) {
            batch.delete(doc.ref);
          }
        });
        
        await batch.commit();
        console.log(`${snapshot.size}개의 오래된 통계 데이터를 정리했습니다.`);
      } else {
        console.log('정리할 오래된 데이터가 없습니다.');
      }
      
    } catch (error) {
      console.error('일일 통계 정리 실패:', error);
    }
  }
);

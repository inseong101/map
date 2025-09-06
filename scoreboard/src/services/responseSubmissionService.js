// src/services/responseSubmissionService.js
import { db } from './firebase';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';

/**
 * 학생의 답안을 Firebase에 저장합니다
 * @param {string} sid - 학수번호
 * @param {string} roundLabel - 회차 (예: "1차")
 * @param {string} session - 교시 (예: "1교시")
 * @param {Object} responses - 문항별 선택 답안 { questionNum: choice, ... }
 * @param {Array} wrongQuestions - 틀린 문항 번호 배열
 * @returns {Promise<void>}
 */
export async function submitStudentResponses(sid, roundLabel, session, responses, wrongQuestions = []) {
  try {
    // scores_raw/{roundLabel}/{session}/{sid} 경로에 저장
    const docRef = doc(db, "scores_raw", roundLabel, session, sid);
    
    const submissionData = {
      sid,
      roundLabel,
      session,
      responses, // { "1": 3, "2": 1, "3": 4, ... } 형태
      wrongQuestions, // [1, 5, 12, ...] 형태
      submittedAt: new Date(),
      lastUpdated: new Date()
    };

    await setDoc(docRef, submissionData, { merge: true });
    
    console.log(`${sid} 학생의 ${roundLabel} ${session} 답안이 저장되었습니다.`);
    
    // 통계 업데이트 트리거 (선택사항)
    await triggerAnalyticsUpdate(roundLabel, session);
    
  } catch (error) {
    console.error('답안 저장 실패:', error);

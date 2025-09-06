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
    throw error;
  }
}

/**
 * 정답지를 저장합니다 (관리자용)
 * @param {string} roundLabel - 회차
 * @param {Object} answerKey - 정답지 { questionNum: correctAnswer, ... }
 * @returns {Promise<void>}
 */
export async function submitAnswerKey(roundLabel, answerKey) {
  try {
    const docRef = doc(db, "answer_keys", roundLabel);
    
    await setDoc(docRef, {
      ...answerKey,
      roundLabel,
      createdAt: new Date(),
      lastUpdated: new Date()
    }, { merge: true });
    
    console.log(`${roundLabel} 정답지가 저장되었습니다.`);
    
  } catch (error) {
    console.error('정답지 저장 실패:', error);
    throw error;
  }
}

/**
 * 학생의 특정 교시 답안을 업데이트합니다
 * @param {string} sid - 학수번호
 * @param {string} roundLabel - 회차
 * @param {string} session - 교시
 * @param {Object} updates - 업데이트할 필드들
 * @returns {Promise<void>}
 */
export async function updateStudentResponses(sid, roundLabel, session, updates) {
  try {
    const docRef = doc(db, "scores_raw", roundLabel, session, sid);
    
    await updateDoc(docRef, {
      ...updates,
      lastUpdated: new Date()
    });
    
    console.log(`${sid} 학생의 답안이 업데이트되었습니다.`);
    
  } catch (error) {
    console.error('답안 업데이트 실패:', error);
    throw error;
  }
}

/**
 * 특정 학생의 답안을 조회합니다
 * @param {string} sid - 학수번호
 * @param {string} roundLabel - 회차
 * @param {string} session - 교시
 * @returns {Promise<Object|null>} 답안 데이터
 */
export async function getStudentResponses(sid, roundLabel, session) {
  try {
    const docRef = doc(db, "scores_raw", roundLabel, session, sid);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return docSnap.data();
    }
    
    return null;
    
  } catch (error) {
    console.error('답안 조회 실패:', error);
    throw error;
  }
}

/**
 * 배치로 여러 학생의 답안을 저장합니다 (관리자용)
 * @param {string} roundLabel - 회차
 * @param {string} session - 교시
 * @param {Array} studentData - 학생 데이터 배열
 * @returns {Promise<void>}
 */
export async function batchSubmitResponses(roundLabel, session, studentData) {
  try {
    const batch = writeBatch(db);
    
    studentData.forEach(student => {
      const { sid, responses, wrongQuestions } = student;
      const docRef = doc(db, "scores_raw", roundLabel, session, sid);
      
      batch.set(docRef, {
        sid,
        roundLabel,
        session,
        responses,
        wrongQuestions,
        submittedAt: new Date(),
        lastUpdated: new Date()
      }, { merge: true });
    });
    
    await batch.commit();
    console.log(`${studentData.length}명의 답안이 일괄 저장되었습니다.`);
    
    // 통계 업데이트
    await triggerAnalyticsUpdate(roundLabel, session);
    
  } catch (error) {
    console.error('일괄 답안 저장 실패:', error);
    throw error;
  }
}

/**
 * 통계 업데이트를 트리거합니다
 * @param {string} roundLabel - 회차
 * @param {string} session - 교시
 * @returns {Promise<void>}
 */
async function triggerAnalyticsUpdate(roundLabel, session) {
  try {
    // 통계 재계산이 필요함을 표시
    const statsRef = doc(db, "analytics", `${roundLabel}_needs_update`);
    await setDoc(statsRef, {
      roundLabel,
      session,
      needsUpdate: true,
      timestamp: new Date()
    }, { merge: true });
    
  } catch (error) {
    console.warn('통계 업데이트 트리거 실패:', error);
  }
}

/**
 * Excel 파일에서 답안을 파싱하여 저장합니다 (관리자용)
 * @param {File} excelFile - Excel 파일
 * @param {string} roundLabel - 회차
 * @param {string} session - 교시
 * @returns {Promise<Object>} 처리 결과
 */
export async function uploadExcelResponses(excelFile, roundLabel, session) {
  try {
    // Excel 파일 파싱 (SheetJS 사용)
    const arrayBuffer = await excelFile.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    const processedData = [];
    const errors = [];
    
    jsonData.forEach((row, index) => {
      try {
        const sid = String(row['학수번호'] || row.sid || '').trim();
        if (!sid) {
          errors.push(`행 ${index + 2}: 학수번호가 없습니다.`);
          return;
        }
        
        const responses = {};
        const wrongQuestions = [];
        
        // 문항별 답안 파싱 (1번~80번 또는 100번)
        for (let i = 1; i <= 100; i++) {
          const answer = row[`${i}번`] || row[i];
          if (answer && answer >= 1 && answer <= 5) {
            responses[i] = parseInt(answer);
          }
        }
        
        // 오답 문항 파싱 (별도 컬럼이 있는 경우)
        const wrongStr = row['오답문항'] || row.wrong || '';
        if (wrongStr) {
          const wrongNums = String(wrongStr).split(/[,\s]+/)
            .map(n => parseInt(n.trim()))
            .filter(n => !isNaN(n));
          wrongQuestions.push(...wrongNums);
        }
        
        processedData.push({
          sid,
          responses,
          wrongQuestions
        });
        
      } catch (rowError) {
        errors.push(`행 ${index + 2}: ${rowError.message}`);
      }
    });
    
    if (processedData.length === 0) {
      throw new Error('처리할 수 있는 유효한 데이터가 없습니다.');
    }
    
    // 배치로 저장
    await batchSubmitResponses(roundLabel, session, processedData);
    
    return {
      success: true,
      processed: processedData.length,
      errors: errors.length > 0 ? errors : null,
      message: `${processedData.length}명의 답안이 성공적으로 저장되었습니다.`
    };
    
  } catch (error) {
    console.error('Excel 업로드 실패:', error);
    return {
      success: false,
      error: error.message,
      message: 'Excel 파일 처리 중 오류가 발생했습니다.'
    };
  }
}

// src/services/analyticsService.js
import { db } from './firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';

/**
 * 특정 문항의 선택률 통계를 가져옵니다
 * @param {string} roundLabel - 회차 (예: "1차")
 * @param {number} questionNum - 문항 번호
 * @returns {Promise<Object>} 선택률 통계 객체
 */
export async function getQuestionChoiceStats(roundLabel, questionNum) {
  try {
    // 1. 해당 문항이 속한 교시 찾기
    const session = findSessionByQuestionNum(questionNum);
    if (!session) {
      throw new Error(`문항 ${questionNum}에 해당하는 교시를 찾을 수 없습니다.`);
    }

    // 2. scores_raw/{roundLabel}/{session} 컬렉션에서 모든 학생 데이터 가져오기
    const sessionRef = collection(db, "scores_raw", roundLabel, session);
    const snapshot = await getDocs(sessionRef);

    const choices = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalResponses = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      const responses = data.responses || data.choices || {};
      
      // 해당 문항의 선택을 확인
      const choice = responses[questionNum];
      if (choice && choice >= 1 && choice <= 5) {
        choices[choice]++;
        totalResponses++;
      }
    });

    // 3. 정답 정보 가져오기 (별도 컬렉션에서)
    const correctAnswer = await getCorrectAnswer(roundLabel, questionNum);

    return {
      questionNum,
      choices,
      totalResponses,
      correctAnswer,
      errorRate: correctAnswer ? ((totalResponses - choices[correctAnswer]) / totalResponses * 100) : null
    };

  } catch (error) {
    console.error('문항 선택률 통계 조회 실패:', error);
    throw error;
  }
}

/**
 * 오답률이 높은 문항들을 가져옵니다
 * @param {string} roundLabel - 회차
 * @param {number} minErrorRate - 최소 오답률 (기본값: 50%)
 * @returns {Promise<Object>} 과목별 고오답률 문항 객체
 */
export async function getHighErrorRateQuestions(roundLabel, minErrorRate = 50) {
  try {
    // 캐시된 데이터가 있는지 확인
    const cacheRef = doc(db, "analytics", `${roundLabel}_high_error_questions`);
    const cacheSnap = await getDoc(cacheRef);
    
    if (cacheSnap.exists()) {
      const cacheData = cacheSnap.data();
      // 캐시가 24시간 이내라면 사용
      if (cacheData.timestamp && (Date.now() - cacheData.timestamp.toMillis()) < 24 * 60 * 60 * 1000) {
        return cacheData.questions;
      }
    }

    // 캐시가 없거나 오래된 경우 새로 계산
    const result = {};
    const sessions = ["1교시", "2교시", "3교시", "4교시"];

    for (const session of sessions) {
      const sessionRef = collection(db, "scores_raw", roundLabel, session);
      const snapshot = await getDocs(sessionRef);

      // 각 문항별 통계 계산
      const questionStats = {};
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const wrongQuestions = data.wrongQuestions || data.wrong || [];
        
        wrongQuestions.forEach(questionNum => {
          if (!questionStats[questionNum]) {
            questionStats[questionNum] = { wrong: 0, total: 0 };
          }
          questionStats[questionNum].wrong++;
        });

        // 전체 응답자 수 카운트
        Object.keys(data.responses || {}).forEach(questionNum => {
          const qNum = parseInt(questionNum);
          if (!questionStats[qNum]) {
            questionStats[qNum] = { wrong: 0, total: 0 };
          }
          questionStats[qNum].total++;
        });
      });

      // 오답률 계산 및 필터링
      Object.entries(questionStats).forEach(([questionNum, stats]) => {
        if (stats.total > 0) {
          const errorRate = (stats.wrong / stats.total) * 100;
          if (errorRate >= minErrorRate) {
            const subject = findSubjectByQuestionNum(parseInt(questionNum));
            if (subject) {
              if (!result[subject]) result[subject] = [];
              result[subject].push({
                questionNum: parseInt(questionNum),
                errorRate: Math.round(errorRate),
                wrongCount: stats.wrong,
                totalCount: stats.total
              });
            }
          }
        }
      });
    }

    // 각 과목별로 오답률 순으로 정렬
    Object.keys(result).forEach(subject => {
      result[subject].sort((a, b) => b.errorRate - a.errorRate);
    });

    // 결과를 캐시에 저장 (선택사항)
    try {
      await setDoc(cacheRef, {
        questions: result,
        timestamp: new Date(),
        roundLabel
      });
    } catch (cacheError) {
      console.warn('캐시 저장 실패:', cacheError);
    }

    return result;

  } catch (error) {
    console.error('고오답률 문항 조회 실패:', error);
    throw error;
  }
}

/**
 * 정답 정보를 가져옵니다
 * @param {string} roundLabel - 회차
 * @param {number} questionNum - 문항 번호
 * @returns {Promise<number|null>} 정답 번호 (1-5)
 */
async function getCorrectAnswer(roundLabel, questionNum) {
  try {
    const answersRef = doc(db, "answer_keys", roundLabel);
    const answersSnap = await getDoc(answersRef);
    
    if (answersSnap.exists()) {
      const answers = answersSnap.data();
      return answers[questionNum] || null;
    }
    
    return null;
  } catch (error) {
    console.warn('정답 조회 실패:', error);
    return null;
  }
}

/**
 * 문항 번호로 교시를 찾습니다
 * @param {number} questionNum - 문항 번호
 * @returns {string|null} 교시명
 */
function findSessionByQuestionNum(questionNum) {
  // 교시별 문항 범위 (dataService.js의 SESSION_SUBJECT_RANGES 참조)
  if (questionNum >= 1 && questionNum <= 80) return "1교시";
  if (questionNum >= 1 && questionNum <= 100) return "2교시"; // 중복 처리 필요
  if (questionNum >= 1 && questionNum <= 80) return "3교시";
  if (questionNum >= 1 && questionNum <= 80) return "4교시";
  
  // 더 정확한 매핑이 필요한 경우 SESSION_SUBJECT_RANGES 사용
  const sessions = {
    "1교시": { min: 1, max: 80 },
    "2교시": { min: 1, max: 100 },
    "3교시": { min: 1, max: 80 },
    "4교시": { min: 1, max: 80 }
  };

  for (const [session, range] of Object.entries(sessions)) {
    if (questionNum >= range.min && questionNum <= range.max) {
      return session;
    }
  }

  return null;
}

/**
 * 문항 번호로 과목을 찾습니다
 * @param {number} questionNum - 문항 번호
 * @returns {string|null} 과목명
 */
function findSubjectByQuestionNum(questionNum) {
  // SESSION_SUBJECT_RANGES를 이용한 정확한 매핑 필요
  // 임시로 간단한 매핑 사용
  const mapping = {
    // 1교시 (1-80)
    1: "간", 17: "심", 33: "비", 49: "폐", 65: "신",
    // 2교시 (1-100)  
    // 3교시 (1-80)
    // 4교시 (1-80)
  };

  // 더 정교한 로직으로 교체 필요
  if (questionNum >= 1 && questionNum <= 16) return "간";
  if (questionNum >= 17 && questionNum <= 32) return "심";
  // ... 나머지 과목들

  return null;
}

/**
 * 전체 통계 요약을 가져옵니다
 * @param {string} roundLabel - 회차
 * @returns {Promise<Object>} 통계 요약
 */
export async function getAnalyticsSummary(roundLabel) {
  try {
    const summaryRef = doc(db, "analytics", `${roundLabel}_summary`);
    const summarySnap = await getDoc(summaryRef);
    
    if (summarySnap.exists()) {
      return summarySnap.data();
    }

    // 요약 데이터가 없는 경우 기본값 반환
    return {
      totalStudents: 0,
      averageScore: 0,
      passRate: 0,
      subjectAverages: {},
      lastUpdated: null
    };

  } catch (error) {
    console.error('통계 요약 조회 실패:', error);
    throw error;
  }
}

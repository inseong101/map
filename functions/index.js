// functions/index.js - Part 1: 기본 함수들
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const XLSX = require('xlsx');

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
 * Firebase Storage에 Excel 파일이 업로드되면 자동으로 처리하는 함수
 */
exports.processStorageExcel = functions.storage.object().onFinalize(async (object) => {
  try {
    const { name: filePath, bucket } = object;
    
    // Excel 파일인지 확인
    if (!filePath || !filePath.includes('.xlsx')) {
      console.log('Excel 파일이 아님:', filePath);
      return null;
    }
    
    // 파일명에서 회차와 교시 정보 추출
    const fileInfo = extractFileInfo(filePath);
    if (!fileInfo) {
      console.log('파일명 형식이 맞지 않음:', filePath);
      return null;
    }
    
    console.log('Excel 파일 처리 시작:', filePath, fileInfo);
    
    // Storage에서 파일 다운로드
    const storage = admin.storage();
    const file = storage.bucket(bucket).file(filePath);
    
    const [buffer] = await file.download();
    
    // Excel 파일 파싱
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    console.log('Excel 데이터 읽기 완료. 행 수:', jsonData.length);
    
    // 데이터 처리 및 Firebase에 저장
    const result = await processExcelData(jsonData, fileInfo.roundLabel, fileInfo.session);
    
    console.log('데이터 처리 완료:', result);
    
    // 처리 결과를 로그 컬렉션에 저장
    await db.collection('upload_logs').add({
      filePath,
      roundLabel: fileInfo.roundLabel,
      session: fileInfo.session,
      processedCount: result.processedCount,
      attendedCount: result.attendedCount,
      absentCount: result.absentCount,
      errorCount: result.errorCount,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed'
    });
    
    return null;
    
  } catch (error) {
    console.error('Excel 파일 처리 실패:', error);
    
    // 오류 로그 저장
    await db.collection('upload_logs').add({
      filePath: object.name,
      error: error.message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'failed'
    });
    
    return null;
  }
});

/**
 * 파일명에서 회차와 교시 정보 추출
 */
function extractFileInfo(filePath) {
  // "1차 모의고사 1교시.xlsx" 형태에서 정보 추출
  const fileName = filePath.split('/').pop(); // 폴더 경로 제거
  console.log('파일명 분석:', fileName);
  
  // 파일명에서 모든 숫자 추출
  const numbers = fileName.match(/\d+/g);
  console.log('추출된 숫자들:', numbers);
  
  if (numbers && numbers.length >= 2) {
    const result = {
      roundLabel: `${numbers[0]}차`,
      session: `${numbers[1]}교시`
    };
    console.log('추출된 정보:', result);
    return result;
  }
  
  console.log('숫자 추출 실패 - 파일명:', fileName);
  return null;
}

/**
 * Excel 데이터를 Firebase에 저장 - 미응답 포함 버전
 */
async function processExcelData(jsonData, roundLabel, session) {
  try {
    const processedData = [];
    const errors = [];
    
    if (jsonData.length < 5) {
      throw new Error('Excel 파일에 충분한 데이터가 없습니다 (최소 5행 필요)');
    }
    
    // Excel 구조 분석
    const questionNumbers = jsonData[0] || [];     // 1행: 문항번호
    const scores = jsonData[1] || [];              // 2행: 배점 (모두 1점)
    const answerKey = jsonData[2] || [];           // 3행: 정답
    // 4행: 여백행
    // 5행부터: 학생 데이터
    
    console.log('총 컬럼 수:', questionNumbers.length);
    console.log('문항번호 예시:', questionNumbers.slice(1, 10));
    console.log('정답 예시:', answerKey.slice(1, 10));
    
    // 유효한 문항만 추출 (매 2번째 컬럼마다: B=1, D=2, F=3...)
    const validQuestions = [];
    for (let i = 1; i < questionNumbers.length; i += 2) { // 1, 3, 5, 7... (B, D, F, H...)
      const questionNum = questionNumbers[i];
      const correctAnswer = answerKey[i];
      
      // 문항번호가 숫자이고 정답이 1-5 범위인 경우만 유효
      if (questionNum && !isNaN(questionNum) && correctAnswer >= 1 && correctAnswer <= 5) {
        validQuestions.push({
          columnIndex: i,
          questionNum: parseInt(questionNum),
          correctAnswer: parseInt(correctAnswer)
        });
      }
    }
    
    console.log('유효한 문항 수:', validQuestions.length);
    console.log('문항 범위:', validQuestions[0]?.questionNum, '~', validQuestions[validQuestions.length-1]?.questionNum);
    
    // 정답지 추출 및 저장 (교시별로 별도 저장)
    const answerKeyObj = {};
    validQuestions.forEach(q => {
      answerKeyObj[q.questionNum] = q.correctAnswer;
    });
    
    // 교시별로 별도 문서에 정답지 저장
    await db.collection('answer_keys').doc(`${roundLabel}_${session}`).set(answerKeyObj);
    console.log(`${roundLabel} ${session} 정답지 저장 완료:`, Object.keys(answerKeyObj).length, '문항');
    
    // 학생 데이터 처리 (5행부터 - 인덱스 4부터)
    for (let i = 4; i < jsonData.length; i++) {
      const row = jsonData[i];
      
      try {
        // 학수번호 추출 (첫 번째 컬럼)
        const sid = String(row[0] || '').trim();
        
        if (!sid || sid.length < 6) {
          if (sid) { // 빈 행이 아닌 경우만 오류로 기록
            errors.push(`행 ${i + 1}: 유효하지 않은 학수번호 (${sid})`);
          }
          continue;
        }
        
        const responses = {};
        const wrongQuestions = [];
        let hasAnyResponse = false; // 응답 여부 체크
        
        // 유효한 문항들만 처리 (모든 문항에 대해 응답 또는 null 저장)
        validQuestions.forEach(q => {
          const studentAnswer = row[q.columnIndex];
          
          if (studentAnswer >= 1 && studentAnswer <= 5) {
            // 유효한 응답 (1-5)
            responses[q.questionNum] = parseInt(studentAnswer);
            hasAnyResponse = true;
            
            // 정답과 비교하여 오답 문항 확인
            if (studentAnswer !== q.correctAnswer) {
              wrongQuestions.push(q.questionNum);
            }
          } else {
            // 미응답 (None, 빈값, 기타) - null로 저장
            responses[q.questionNum] = null;
          }
        });
        
        // 학수번호가 있으면 응답 여부와 관계없이 모든 응시 대상자를 저장
        processedData.push({
          sid,
          responses,
          wrongQuestions: wrongQuestions.sort((a, b) => a - b),
          status: hasAnyResponse ? 'completed' : 'absent' // hasResponses 필드 제거
        });
        
      } catch (rowError) {
        errors.push(`행 ${i + 1}: ${rowError.message}`);
      }
    }
    
    // 응시 대상자와 실제 응시자 통계
    const totalStudents = processedData.length;
    const attendedStudents = processedData.filter(s => s.status === 'completed').length;
    const absentStudents = totalStudents - attendedStudents;
    
    console.log(`총 응시 대상자: ${totalStudents}명`);
    console.log(`실제 응시자: ${attendedStudents}명`);
    console.log(`미응시자: ${absentStudents}명`);
    console.log(`오류 수: ${errors.length}`);
    
    if (processedData.length === 0) {
      throw new Error('처리할 수 있는 유효한 학수번호가 없습니다.');
    }
    
    // Firebase에 일괄 저장 (배치 단위로 나누어 저장)
    const batchSize = 500; // Firestore 배치 제한
    const batches = [];
    
    for (let i = 0; i < processedData.length; i += batchSize) {
      const batch = db.batch();
      const chunk = processedData.slice(i, i + batchSize);
      
      chunk.forEach(student => {
        const docRef = db.collection('scores_raw')
          .doc(roundLabel)
          .collection(session)
          .doc(student.sid);
        
        batch.set(docRef, {
          sid: student.sid,
          roundLabel,
          session,
          responses: student.responses,
          wrongQuestions: student.wrongQuestions,
          status: student.status,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      
      batches.push(batch);
    }
    
    // 모든 배치 실행
    for (const batch of batches) {
      await batch.commit();
    }
    
    console.log(`총 ${totalStudents}명의 응시 대상자 데이터가 Firebase에 저장되었습니다.`);
    console.log(`(응시: ${attendedStudents}명, 미응시: ${absentStudents}명)`);
    
    // 통계 업데이트
    await updateSessionAnalytics(roundLabel, session);
    await updateRoundAnalytics(roundLabel);
    
    return {
      processedCount: totalStudents,
      attendedCount: attendedStudents,
      absentCount: absentStudents,
      errorCount: errors.length,
      errors: errors.slice(0, 10) // 최대 10개 오류만 반환
    };
    
  } catch (error) {
    console.error('Excel 데이터 처리 실패:', error);
    throw error;
  }
}












// functions/index.js - Part 2: 통계 및 분석 함수들

/**
 * 전체 시험 통합 상태 분석 (미응시자, 중도포기자, 완전응시자)
 */
async function analyzeOverallStatus(roundLabel) {
  try {
    console.log(`전체 시험 통합 분석 시작: ${roundLabel}`);
    
    const sessions = ["1교시", "2교시", "3교시", "4교시"];
    const allStudents = {};
    
    // 모든 교시 데이터 수집
    for (const session of sessions) {
      try {
        const sessionRef = db.collection('scores_raw').doc(roundLabel).collection(session);
        const snapshot = await sessionRef.get();
        
        snapshot.forEach(doc => {
          const sid = doc.id;
          if (!allStudents[sid]) {
            allStudents[sid] = {
              sid,
              sessions: {}
            };
          }
          allStudents[sid].sessions[session] = doc.data();
        });
        
        console.log(`${session} 데이터 수집 완료: ${snapshot.size}명`);
      } catch (error) {
        console.warn(`${session} 데이터 수집 실패:`, error);
      }
    }
    
    // 학생별 전체 상태 분석
    const analysis = {
      roundLabel,
      totalStudents: 0,
      byStatus: {
        completed: 0,     // 4교시 모두 응시
        dropout: 0,       // 1~3교시만 응시  
        absent: 0         // 전체 미응시
      },
      bySession: {},
      studentDetails: {}  // 학생별 상세 정보
    };
    
    // 교시별 응시 통계 초기화
    sessions.forEach(session => {
      analysis.bySession[session] = {
        attended: 0,
        absent: 0
      };
    });
    
    // 학생별 분석
    Object.entries(allStudents).forEach(([sid, studentData]) => {
      analysis.totalStudents++;
      
      let completedSessions = 0;
      const sessionStatuses = {};
      
      sessions.forEach(session => {
        const sessionData = studentData.sessions[session];
        const isAttended = sessionData && sessionData.status === 'completed';
        
        sessionStatuses[session] = isAttended ? 'completed' : 'absent';
        
        if (isAttended) {
          completedSessions++;
          analysis.bySession[session].attended++;
        } else {
          analysis.bySession[session].absent++;
        }
      });
      
      // 전체 상태 결정
      let overallStatus;
      if (completedSessions === 0) {
        overallStatus = 'absent';        // 미응시자: 4교시 모두 미응시
      } else if (completedSessions === 4) {
        overallStatus = 'completed';     // 완전응시자: 4교시 모두 응시  
      } else {
        overallStatus = 'dropout';       // 중도포기자: 1~3교시만 응시
      }
      
      analysis.byStatus[overallStatus]++;
      
      // 학생별 상세 정보 저장
      analysis.studentDetails[sid] = {
        overallStatus,
        completedSessions,
        sessionStatuses
      };
    });
    
    // 결과 저장
    await db.collection('analytics').doc(`${roundLabel}_overall_status`).set({
      ...analysis,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`전체 통합 분석 완료:`, analysis.byStatus);
    return analysis;
    
  } catch (error) {
    console.error('전체 상태 분석 실패:', error);
    throw error;
  }
}

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
      attendedStudents: 0,
      absentStudents: 0,
      questionStats: {}, // 문항별 통계
      choiceStats: {},   // 선택지별 통계 (raw count)
      schoolStats: {},   // 학교별 통계
      subjectStats: {},  // 과목별 통계
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const { sid, responses = {}, wrongQuestions = [], status } = data;
      
      analytics.totalStudents++;
      
      if (status === 'completed') {
        analytics.attendedStudents++;
      } else {
        analytics.absentStudents++;
      }
      
      // 학교별 통계
      const schoolCode = String(sid).substring(0, 2);
      if (!analytics.schoolStats[schoolCode]) {
        analytics.schoolStats[schoolCode] = {
          totalStudents: 0,
          attendedStudents: 0,
          totalWrong: 0,
          questionStats: {}
        };
      }
      analytics.schoolStats[schoolCode].totalStudents++;
      if (status === 'completed') {
        analytics.schoolStats[schoolCode].attendedStudents++;
      }
      
      // 문항별 통계 계산 (응답이 있는 문항만)
      Object.entries(responses).forEach(([questionNum, choice]) => {
        const qNum = parseInt(questionNum, 10);
        
        if (!analytics.questionStats[qNum]) {
          analytics.questionStats[qNum] = {
            totalResponses: 0,
            actualResponses: 0, // null이 아닌 응답
            wrongCount: 0,
            choices: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, null: 0 }
          };
        }
        
        if (!analytics.choiceStats[qNum]) {
          analytics.choiceStats[qNum] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, null: 0 };
        }
        
        // 총 응답 수 증가 (null 포함)
        analytics.questionStats[qNum].totalResponses++;
        analytics.choiceStats[qNum][choice || 'null']++;
        
        // 실제 응답 수 증가 (null 제외)
        if (choice !== null) {
          analytics.questionStats[qNum].actualResponses++;
        }
        
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

    // --- helper: 1~5번 선택 비율을 정수 퍼센트(합=100)로 정규화 ---
    function normalizeTo100(choiceCounts) {
      const keys = [1,2,3,4,5];
      const total = keys.reduce((s,k)=>s + (choiceCounts?.[k] || 0), 0);
      if (total <= 0) return {1:0,2:0,3:0,4:0,5:0};

      const raw = keys.map(k => (choiceCounts[k] || 0) * 100 / total);
      const floors = raw.map(v => Math.floor(v));
      let rem = 100 - floors.reduce((a,b)=>a+b,0);

      // 소수점 큰 순서대로 남은 1% 분배
      const order = raw
        .map((v,i)=>({i, frac: v - floors[i]}))
        .sort((a,b)=>b.frac - a.frac)
        .map(x=>x.i);

      const out = floors.slice();
      for (let i=0; i<rem; i++) out[order[i % order.length]] += 1;

      return {1: out[0], 2: out[1], 3: out[2], 4: out[3], 5: out[4]};
    }

    // 오답률/정답률 및 선택 퍼센트 계산 (미응답 제외)
    Object.keys(analytics.questionStats).forEach((qStr) => {
      const q = parseInt(qStr, 10);
      const stats = analytics.questionStats[q];

      // 미응답(null) 제외한 실제 응답 수
      const nonNullTotal =
        (analytics.choiceStats[q]?.[1] || 0) +
        (analytics.choiceStats[q]?.[2] || 0) +
        (analytics.choiceStats[q]?.[3] || 0) +
        (analytics.choiceStats[q]?.[4] || 0) +
        (analytics.choiceStats[q]?.[5] || 0);

      // 안전 보정
      stats.actualResponses = nonNullTotal;

      const wrongCount   = stats.wrongCount || 0;
      const correctCount = Math.max(nonNullTotal - wrongCount, 0);

      const correctRate = nonNullTotal > 0 ? (correctCount / nonNullTotal) * 100 : 0;
      const errorRate   = nonNullTotal > 0 ? 100 - correctRate : 0;

      // 응답률(옵션): 전체 응답 대비 실제 응답
      stats.responseRate = stats.totalResponses > 0
        ? +((stats.actualResponses / stats.totalResponses) * 100).toFixed(2)
        : 0;

      stats.correctCount = correctCount;
      stats.correctRate  = +correctRate.toFixed(2);
      stats.errorRate    = +errorRate.toFixed(2);

      // 1~5번 선택 분포(%). 미응답 제외, 합=100 (정수)
      analytics.choicePercents = analytics.choicePercents || {};
      analytics.choicePercents[q] = normalizeTo100(analytics.choiceStats[q]);
    });

    // 결과 저장
    const analyticsRef = db.collection('analytics').doc(`${roundLabel}_${session}`);
    await analyticsRef.set(analytics);
    
    console.log(`${roundLabel} ${session} 통계 업데이트 완료: 총 ${analytics.totalStudents}명 (응시: ${analytics.attendedStudents}명, 미응시: ${analytics.absentStudents}명)`);
    
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
        
        if (analyticsSnap.exists) {
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
            attendedStudents: 0,
            totalWrong: 0
          };
        }
        schoolTotals[schoolCode].totalStudents = Math.max(
          schoolTotals[schoolCode].totalStudents,
          stats.totalStudents || 0
        );
        schoolTotals[schoolCode].attendedStudents = Math.max(
          schoolTotals[schoolCode].attendedStudents,
          stats.attendedStudents || 0
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
        totalResponses: stats.actualResponses || 0
      }))
      .filter(q => q.errorRate >= 50 && q.totalResponses > 0)
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
    
    // 전체 통합 상태 분석도 실행
    await analyzeOverallStatus(roundLabel);
    
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
    
    if (summarySnap.exists) {
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
    
    const qNum = parseInt(questionNum, 10);
    const session = findSessionByQuestionNum(qNum);
    
    if (!session) {
      return res.status(400).json({ error: '유효하지 않은 문항번호입니다.' });
    }
    
    const analyticsRef = db.collection('analytics').doc(`${roundLabel}_${session}`);
    const analyticsSnap = await analyticsRef.get();
    
    if (analyticsSnap.exists) {
      const data = analyticsSnap.data();
      const questionStats = data.questionStats?.[qNum];
      const choiceStats = data.choiceStats?.[qNum];
      const choicePercents = data.choicePercents?.[qNum]; // 추가: 선지 퍼센트(합=100)
      
      if (questionStats && choiceStats) {
        // 정답 조회
        const answerKeyRef = db.collection('answer_keys').doc(`${roundLabel}_${session}`);
        const answerKeySnap = await answerKeyRef.get();
        const correctAnswer = answerKeySnap.exists ? answerKeySnap.data()?.[qNum] : null;
        
        res.json({
          success: true,
          data: {
            questionNum: qNum,
            choices: choiceStats,                // raw count
            choicePercents: choicePercents || null, // 1~5 합=100, 미응답 제외
            totalResponses: questionStats.totalResponses,
            actualResponses: questionStats.actualResponses,
            wrongCount: questionStats.wrongCount,
            errorRate: questionStats.errorRate,
            responseRate: questionStats.responseRate,
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
 * 전체 응시 상태 조회 API
 */
exports.getOverallStatus = functions.https.onRequest(async (req, res) => {
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
    
    const statusRef = db.collection('analytics').doc(`${roundLabel}_overall_status`);
    const statusSnap = await statusRef.get();
    
    if (statusSnap.exists) {
      const data = statusSnap.data();
      res.json({
        success: true,
        data: {
          totalStudents: data.totalStudents,
          byStatus: data.byStatus,
          bySession: data.bySession,
          lastUpdated: data.lastUpdated
        }
      });
    } else {
      // 데이터가 없으면 새로 분석
      const analysis = await analyzeOverallStatus(roundLabel);
      res.json({
        success: true,
        data: {
          totalStudents: analysis.totalStudents,
          byStatus: analysis.byStatus,
          bySession: analysis.bySession
        }
      });
    }
    
  } catch (error) {
    console.error('전체 응시 상태 조회 실패:', error);
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

/**
 * 업로드 로그 조회 API
 */
exports.getUploadLogs = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const logsRef = db.collection('upload_logs')
      .orderBy('timestamp', 'desc')
      .limit(50);
    
    const snapshot = await logsRef.get();
    const logs = [];
    
    snapshot.forEach(doc => {
      logs.push({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate()
      });
    });
    
    res.json({
      success: true,
      logs
    });
    
  } catch (error) {
    console.error('업로드 로그 조회 실패:', error);
    res.status(500).json({
      error: '로그 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

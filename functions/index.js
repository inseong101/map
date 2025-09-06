// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const logger = require('firebase-functions/logger');

admin.initializeApp();
const db = admin.firestore();

// ===== 엑셀 업로드 처리 =====

/** Storage: 엑셀 업로드 트리거 */
exports.onExcelUploaded = onObjectFinalized(async (event) => {
  const filePath = event.data.name;                 // ex) 'uploads/1차 모의고사 1교시.xlsx'
  const bucket = admin.storage().bucket(event.data.bucket);
  const { round, klass, base } = detectRoundClass(filePath);

  logger.info("Excel uploaded:", { filePath, round, klass });

  // 1) /tmp 로 다운로드
  const tempFile = `/tmp/${Date.now()}-${base}`;
  await bucket.file(filePath).download({ destination: tempFile });

  // 2) 엑셀 파싱
  const { positions, corrects, studentRows } = parseExcel(tempFile);
  logger.info(`Parsed ${positions.length} questions from ${base}`);

  // 3) Firestore 저장 (학번별: 맞은개수/총문항/틀린문항 배열 포함)
  const batch = db.batch();
  for (const row of studentRows) {
    const graded = gradeStudentRow(row, positions, corrects);
    if (!graded) continue;
    const { sid, correct, total, wrongQuestions } = graded;

    const ref = db
      .collection("scores_raw")
      .doc(round)
      .collection(klass)
      .doc(sid);

    batch.set(
      ref,
      {
        file: base,
        round,
        klass,
        totalQuestions: total,
        correct,
        wrongQuestions, // ★ 여기에 저장
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();

  logger.info(`Saved raw scores for ${base}: ${round}/${klass}`);

  // 4) 해당 회차의 평균 자동 재계산
  await calculateRoundAverages(round);
});

// ===== 평균 계산 핵심 로직 =====

/** 특정 회차의 평균 계산 */
async function calculateRoundAverages(round) {
  try {
    logger.info(`${round} 평균 계산 중...`);
    
    // scores_raw에서 데이터 수집
    const scoresData = await collectScoresData(round);
    
    if (Object.keys(scoresData).length === 0) {
      logger.info(`${round}: 데이터 없음`);
      return;
    }
    
    // 학교별 평균 계산
    const schoolAverages = calculateSchoolAverages(scoresData);
    
    // 전국 평균 계산
    const nationalAverage = calculateNationalAverage(scoresData);
    
    // Firestore에 저장
    await saveAverages(round, schoolAverages, nationalAverage);
    
    logger.info(`${round} 평균 저장 완료`);
  } catch (error) {
    logger.error(`${round} 평균 계산 오류:`, error);
  }
}

/** scores_raw에서 데이터 수집 */
async function collectScoresData(round) {
  const sessions = ['1교시', '2교시', '3교시', '4교시'];
  const scoresData = {}; // sid -> { school, totalScore }
  
  for (const session of sessions) {
    try {
      const sessionRef = db.collection('scores_raw').doc(round).collection(session);
      const snapshot = await sessionRef.get();
      
      snapshot.forEach(doc => {
        const sid = doc.id;
        const data = doc.data();
        const wrongQuestions = data.wrongQuestions || data.wrong || [];
        
        if (!scoresData[sid]) {
          const schoolCode = sid.slice(0, 2);
          scoresData[sid] = {
            school: schoolCode,
            totalScore: 340, // 만점에서 시작
            wrongCount: 0
          };
        }
        
        // 오답 개수만큼 점수 차감
        if (Array.isArray(wrongQuestions)) {
          scoresData[sid].wrongCount += wrongQuestions.length;
          scoresData[sid].totalScore = Math.max(0, 340 - scoresData[sid].wrongCount);
        }
      });
    } catch (error) {
      logger.error(`${round}/${session} 데이터 수집 오류:`, error);
    }
  }
  
  return scoresData;
}

/** 학교별 평균 계산 */
function calculateSchoolAverages(scoresData) {
  const schoolStats = {}; // schoolCode -> { scores: [], count: 0 }
  
  Object.values(scoresData).forEach(({ school, totalScore }) => {
    if (!schoolStats[school]) {
      schoolStats[school] = { scores: [], count: 0 };
    }
    schoolStats[school].scores.push(totalScore);
    schoolStats[school].count++;
  });
  
  const schoolAverages = {};
  Object.entries(schoolStats).forEach(([school, stats]) => {
    if (stats.count > 0) {
      const sum = stats.scores.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / stats.count);
      schoolAverages[school] = {
        avg,
        count: stats.count,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
    }
  });
  
  return schoolAverages;
}

/** 전국 평균 계산 */
function calculateNationalAverage(scoresData) {
  const allScores = Object.values(scoresData).map(d => d.totalScore);
  if (allScores.length === 0) {
    return {
      avg: 0,
      count: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
  }
  
  const sum = allScores.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / allScores.length);
  
  return {
    avg,
    count: allScores.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

/** Firestore에 평균 저장 */
async function saveAverages(round, schoolAverages, nationalAverage) {
  const batch = db.batch();
  
  // 전국 평균 저장
  const nationalRef = db.collection('averages').doc(round).collection('data').doc('national');
  batch.set(nationalRef, nationalAverage);
  
  // 학교별 평균 저장
  Object.entries(schoolAverages).forEach(([schoolCode, data]) => {
    const schoolRef = db.collection('averages').doc(round).collection('data').doc(`school_${schoolCode}`);
    batch.set(schoolRef, data);
  });
  
  await batch.commit();
  logger.info(`${round} 평균 데이터 저장 완료`);
}

// ===== 엑셀 파싱 헬퍼 함수들 =====

function detectRoundClass(filePath) {
  // 파일 경로에서 회차와 교시 추출
  // ex) 'uploads/1차 모의고사 1교시.xlsx' -> { round: '1차', klass: '1교시' }
  const base = filePath.split('/').pop();
  
  // 회차 추출
  const roundMatch = base.match(/(\d+차)/);
  const round = roundMatch ? roundMatch[1] : '1차';
  
  // 교시 추출
  const klassMatch = base.match(/(\d+교시)/);
  const klass = klassMatch ? klassMatch[1] : '1교시';
  
  return { round, klass, base };
}

function parseExcel(tempFile) {
  // 엑셀 파싱 로직 (기존 구현 사용)
  // 실제 구현은 xlsx 라이브러리 등을 사용
  const XLSX = require('xlsx');
  
  try {
    const workbook = XLSX.readFile(tempFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // 간단한 파싱 예시 (실제 구현에 맞게 수정 필요)
    const positions = []; // 문제 위치
    const corrects = [];  // 정답
    const studentRows = []; // 학생 데이터
    
    // 첫 번째 행에서 문제 위치 찾기
    if (data.length > 0) {
      const headerRow = data[0];
      headerRow.forEach((cell, index) => {
        if (typeof cell === 'number' && cell > 0 && cell <= 100) {
          positions.push({ questionNum: cell, colIndex: index });
        }
      });
    }
    
    // 두 번째 행에서 정답 추출
    if (data.length > 1) {
      const answerRow = data[1];
      positions.forEach(pos => {
        corrects[pos.questionNum] = answerRow[pos.colIndex];
      });
    }
    
    // 학생 데이터 추출 (3행부터)
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      if (row && row.length > 0 && row[0]) {
        studentRows.push({
          sid: String(row[0]).padStart(6, '0'),
          answers: row,
          rowIndex: i
        });
      }
    }
    
    return { positions, corrects, studentRows };
  } catch (error) {
    logger.error('엑셀 파싱 오류:', error);
    return { positions: [], corrects: [], studentRows: [] };
  }
}

function gradeStudentRow(row, positions, corrects) {
  try {
    const { sid, answers } = row;
    
    let correct = 0;
    const wrongQuestions = [];
    
    positions.forEach(pos => {
      const studentAnswer = answers[pos.colIndex];
      const correctAnswer = corrects[pos.questionNum];
      
      if (studentAnswer === correctAnswer) {
        correct++;
      } else {
        wrongQuestions.push(pos.questionNum);
      }
    });
    
    return {
      sid,
      correct,
      total: positions.length,
      wrongQuestions: wrongQuestions.sort((a, b) => a - b)
    };
  } catch (error) {
    logger.error('채점 오류:', error);
    return null;
  }
}

// functions/index.js
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

// ---------------- Helper ----------------
function calculatePercentile(scores, myScore) {
  if (!scores || scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  const rank = sorted.findIndex(s => s <= myScore);
  if (rank === 0) return 0.0;
  if (rank === sorted.length - 1) return 100.0;
  return +((rank / (sorted.length - 1)) * 100).toFixed(1);
}

// ---------------- Storage Trigger ----------------
exports.processStorageExcel = functions.storage.object().onFinalize(async (object) => {
  try {
    const { name: filePath, bucket } = object;
    if (!filePath || !filePath.includes('.xlsx')) return null;

    const fileInfo = extractFileInfo(filePath);
    if (!fileInfo) return null;

    const storage = admin.storage();
    const file = storage.bucket(bucket).file(filePath);
    const [buffer] = await file.download();

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const result = await processExcelData(jsonData, fileInfo.roundLabel, fileInfo.session);

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
    console.error('Excel 처리 실패:', error);
    await db.collection('upload_logs').add({
      filePath: object.name,
      error: error.message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'failed'
    });
    return null;
  }
});

// ---------------- File Info ----------------
function extractFileInfo(filePath) {
  const fileName = filePath.split('/').pop();
  const numbers = fileName.match(/\d+/g);
  if (numbers && numbers.length >= 2) {
    return { roundLabel: `${numbers[0]}차`, session: `${numbers[1]}교시` };
  }
  return null;
}

// ---------------- Excel Data Processor ----------------
async function processExcelData(jsonData, roundLabel, session) {
  try {
    const processedData = [];
    const errors = [];

    const questionNumbers = jsonData[0] || [];
    const answerKey = jsonData[2] || [];

    const validQuestions = [];
    for (let i = 1; i < questionNumbers.length; i += 2) {
      const qNum = questionNumbers[i];
      const ans = answerKey[i];
      if (qNum && !isNaN(qNum) && ans >= 1 && ans <= 5) {
        validQuestions.push({
          columnIndex: i,
          questionNum: parseInt(qNum),
          correctAnswer: parseInt(ans)
        });
      }
    }

    // 정답지 저장
    const answerKeyObj = {};
    validQuestions.forEach(q => { answerKeyObj[q.questionNum] = q.correctAnswer; });
    await db.collection('answer_keys').doc(`${roundLabel}_${session}`).set(answerKeyObj);

    // 학생 데이터
    for (let i = 4; i < jsonData.length; i++) {
      const row = jsonData[i];
      try {
        const sid = String(row[0] || '').trim();
        if (!sid || sid.length < 6) continue;

        const responses = {};
        const wrongQuestions = [];
        let hasAnyResponse = false;
        let totalScore = 0;

        validQuestions.forEach(q => {
          const studentAnswer = row[q.columnIndex];
          if (studentAnswer >= 1 && studentAnswer <= 5) {
            responses[q.questionNum] = parseInt(studentAnswer);
            hasAnyResponse = true;
            if (studentAnswer === q.correctAnswer) {
              totalScore += 1;
            } else {
              wrongQuestions.push(q.questionNum);
            }
          } else {
            responses[q.questionNum] = null;
          }
        });

        processedData.push({
          sid,
          responses,
          wrongQuestions: wrongQuestions.sort((a, b) => a - b),
          status: hasAnyResponse ? 'completed' : 'absent',
          totalScore
        });
      } catch (rowError) {
        errors.push(`행 ${i + 1}: ${rowError.message}`);
      }
    }

    // Percentile 계산
    const scoresOnly = processedData.filter(s => s.status === 'completed').map(s => s.totalScore);
    processedData.forEach(stu => {
      if (stu.status === 'completed') {
        stu.percentile = calculatePercentile(scoresOnly, stu.totalScore);
      } else {
        stu.percentile = null;
      }
    });

    // Firestore 저장 (batch)
    const batchSize = 500;
    for (let i = 0; i < processedData.length; i += batchSize) {
      const batch = db.batch();
      const chunk = processedData.slice(i, i + batchSize);
      chunk.forEach(student => {
        const docRef = db.collection('scores_raw').doc(roundLabel).collection(session).doc(student.sid);
        batch.set(docRef, {
          ...student,
          roundLabel,
          session,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    }

    await updateSessionAnalytics(roundLabel, session);
    await updateRoundAnalytics(roundLabel);

    return {
      processedCount: processedData.length,
      attendedCount: scoresOnly.length,
      absentCount: processedData.length - scoresOnly.length,
      errorCount: errors.length,
      errors: errors.slice(0, 10)
    };
  } catch (err) {
    console.error('Excel 데이터 처리 실패:', err);
    throw err;
  }
}

// ---------------- 이후 Analytics 함수들 (생략 없이 기존 그대로) ----------------
// ... (updateSessionAnalytics, updateRoundAnalytics, analyzeOverallStatus 등 기존 코드 유지)

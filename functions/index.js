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
     // 전체 통합 상태 문서도 갱신
  await analyzeOverallStatus(roundLabel);

  // [NEW] 분포 사전집계도 함께 생성
  await buildPrebinnedDistributions(roundLabel);

  console.log(`회차 요약 통계 업데이트 완료: ${roundLabel}`);

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

// ---------------- Analytics helpers & functions (ADD BELOW) ----------------

// 과목 찾기 (교시 주어지면 해당 교시에서만, 없으면 전 교시 검색)
function findSubjectByQuestionNum(questionNum, session = null) {
  const sessionsToCheck = session ? [session] : Object.keys(SESSION_SUBJECT_RANGES);
  for (const sess of sessionsToCheck) {
    const ranges = SESSION_SUBJECT_RANGES[sess] || [];
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) return range.s;
    }
  }
  return null;
}

// 문항번호로 교시 찾기
function findSessionByQuestionNum(questionNum) {
  for (const [session, ranges] of Object.entries(SESSION_SUBJECT_RANGES)) {
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) return session;
    }
  }
  return null;
}

// 1~5 선택 분포를 정수 퍼센트(합=100)로 정규화 (미응답 제외)
function normalizeTo100(choiceCounts) {
  const keys = [1,2,3,4,5];
  const total = keys.reduce((s,k)=>s + (choiceCounts?.[k] || 0), 0);
  if (total <= 0) return {1:0,2:0,3:0,4:0,5:0};

  const raw = keys.map(k => (choiceCounts[k] || 0) * 100 / total);
  const floors = raw.map(v => Math.floor(v));
  let rem = 100 - floors.reduce((a,b)=>a+b,0);

  // 소수점 큰 순서대로 1%씩 분배
  const order = raw
    .map((v,i)=>({i, frac: v - floors[i]}))
    .sort((a,b)=>b.frac - a.frac)
    .map(x=>x.i);

  const out = floors.slice();
  for (let i=0; i<rem; i++) out[order[i % order.length]] += 1;
  return {1: out[0], 2: out[1], 3: out[2], 4: out[3], 5: out[4]};
}

/**
 * 교시별 통계를 생성/갱신합니다.
 * 결과 저장 위치: analytics/{roundLabel}_{session}
 */
async function updateSessionAnalytics(roundLabel, session) {
  console.log(`교시별 통계 업데이트 시작: ${roundLabel} ${session}`);

  // 해당 교시의 모든 학생 원자료
  const sessionRef = db.collection('scores_raw').doc(roundLabel).collection(session);
  const snapshot = await sessionRef.get();

  const analytics = {
    roundLabel,
    session,
    totalStudents: 0,
    attendedStudents: 0,
    absentStudents: 0,
    questionStats: {}, // { qNum: { totalResponses, actualResponses, wrongCount, correctCount, errorRate, correctRate, responseRate, choices } }
    choiceStats: {},   // { qNum: {1,2,3,4,5,null} }
    choicePercents: {},// { qNum: {1..5} (합 100, 미응답 제외) }
    schoolStats: {},   // { schoolCode: {...} }  (필요시 확장)
    subjectStats: {},  // { subject: { totalQuestions, wrongCount, questions: [] } }
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  };

  snapshot.forEach(doc => {
    const data = doc.data() || {};
    const { sid, responses = {}, wrongQuestions = [], status } = data;

    analytics.totalStudents++;

    if (status === 'completed') analytics.attendedStudents++;
    else analytics.absentStudents++;

    // 학교 코드 (상위 2자리)
    const schoolCode = String(sid || '').substring(0, 2) || '00';
    if (!analytics.schoolStats[schoolCode]) {
      analytics.schoolStats[schoolCode] = {
        totalStudents: 0,
        attendedStudents: 0,
        totalWrong: 0,
        questionStats: {}
      };
    }
    analytics.schoolStats[schoolCode].totalStudents++;
    if (status === 'completed') analytics.schoolStats[schoolCode].attendedStudents++;

    // 각 문항별 집계
    Object.entries(responses).forEach(([qStr, choice]) => {
      const qNum = parseInt(qStr, 10);
      if (!Number.isFinite(qNum)) return;

      // 초기화
      if (!analytics.questionStats[qNum]) {
        analytics.questionStats[qNum] = {
          totalResponses: 0,    // null 포함
          actualResponses: 0,   // null 제외
          wrongCount: 0,
          correctCount: 0,
          choices: { 1:0, 2:0, 3:0, 4:0, 5:0, null:0 }
        };
      }
      if (!analytics.choiceStats[qNum]) {
        analytics.choiceStats[qNum] = { 1:0, 2:0, 3:0, 4:0, 5:0, null:0 };
      }

      // 총 응답(실제 제출된 학생 수 기준) — null 포함
      analytics.questionStats[qNum].totalResponses++;
      analytics.choiceStats[qNum][choice ?? 'null']++;

      // 실제 응답(미응답 제외)
      if (choice !== null && choice !== undefined) {
        analytics.questionStats[qNum].actualResponses++;
      }

      // 정오답 계산 (오답 리스트에 있으면 오답)
      if (Array.isArray(wrongQuestions) && wrongQuestions.includes(qNum)) {
        analytics.questionStats[qNum].wrongCount++;
        analytics.schoolStats[schoolCode].totalWrong++;
        if (!analytics.schoolStats[schoolCode].questionStats[qNum]) {
          analytics.schoolStats[schoolCode].questionStats[qNum] = { wrongCount: 0 };
        }
        analytics.schoolStats[schoolCode].questionStats[qNum].wrongCount++;
      } else if (choice !== null && choice !== undefined) {
        // 응답했고 오답 리스트에 없다 → 정답
        analytics.questionStats[qNum].correctCount++;
      }

      // 과목 통계 (선택적)
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
        if (Array.isArray(wrongQuestions) && wrongQuestions.includes(qNum)) {
          analytics.subjectStats[subject].wrongCount++;
        }
      }
    });
  });

  // 비율 계산 (미응답 제외)
  Object.keys(analytics.questionStats).forEach(qStr => {
    const q = parseInt(qStr, 10);
    const stats = analytics.questionStats[q];

    const nonNull =
      (analytics.choiceStats[q]?.[1] || 0) +
      (analytics.choiceStats[q]?.[2] || 0) +
      (analytics.choiceStats[q]?.[3] || 0) +
      (analytics.choiceStats[q]?.[4] || 0) +
      (analytics.choiceStats[q]?.[5] || 0);

    stats.actualResponses = nonNull;

    const correctCount = stats.correctCount || 0;
    const wrongCount   = stats.wrongCount   || 0;

    const correctRate = nonNull > 0 ? (correctCount / nonNull) * 100 : 0;
    const errorRate   = nonNull > 0 ? (wrongCount   / nonNull) * 100 : 0;
    const responseRate = stats.totalResponses > 0
      ? (nonNull / stats.totalResponses) * 100
      : 0;

    stats.correctRate  = +correctRate.toFixed(2);
    stats.errorRate    = +errorRate.toFixed(2);
    stats.responseRate = +responseRate.toFixed(2);

    // 선택 퍼센트 (합=100, 미응답 제외)
    analytics.choicePercents[q] = normalizeTo100(analytics.choiceStats[q]);
  });

  // 저장
  const analyticsRef = db.collection('analytics').doc(`${roundLabel}_${session}`);
  await analyticsRef.set(analytics);

  console.log(`교시별 통계 업데이트 완료: ${roundLabel} ${session} (응시 ${analytics.attendedStudents} / 총 ${analytics.totalStudents})`);
}

/**
 * 회차 요약 통계를 생성/갱신합니다.
 * 결과 저장 위치: analytics/{roundLabel}_summary
 */
async function updateRoundAnalytics(roundLabel) {
  console.log(`회차 요약 통계 업데이트 시작: ${roundLabel}`);

  const sessions = ['1교시', '2교시', '3교시', '4교시'];
  const round = {
    roundLabel,
    sessions: {},
    overall: {
      totalStudents: 0,
      topWrongQuestions: [],     // [{questionNum, errorRate, wrongCount, totalResponses}]
      highErrorRateQuestions: {},// { subject: [qNum,...] }
      schoolComparison: {}       // 집계 값 (간단 합산/최댓값)
    },
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  };

  const allQuestions = {};
  const schoolTotals = {};

  for (const sess of sessions) {
    const ref = db.collection('analytics').doc(`${roundLabel}_${sess}`);
    const snap = await ref.get();
    if (!snap.exists) continue;

    const data = snap.data();
    round.sessions[sess] = data;

    // 전체 학생 수는 교시 중 최댓값 사용
    round.overall.totalStudents = Math.max(round.overall.totalStudents, data.totalStudents || 0);

    // 문항 병합
    Object.entries(data.questionStats || {}).forEach(([qNum, stats]) => {
      if (!allQuestions[qNum]) allQuestions[qNum] = { ...stats };
    });

    // 학교 병합 (간단 합산/최대)
    Object.entries(data.schoolStats || {}).forEach(([schoolCode, st]) => {
      if (!schoolTotals[schoolCode]) {
        schoolTotals[schoolCode] = { totalStudents: 0, attendedStudents: 0, totalWrong: 0 };
      }
      schoolTotals[schoolCode].totalStudents = Math.max(schoolTotals[schoolCode].totalStudents, st.totalStudents || 0);
      schoolTotals[schoolCode].attendedStudents = Math.max(schoolTotals[schoolCode].attendedStudents, st.attendedStudents || 0);
      schoolTotals[schoolCode].totalWrong += st.totalWrong || 0;
    });
  }

  // 상위 오답 (오답률 50% 이상만 추려 Top 50)
  round.overall.topWrongQuestions = Object.entries(allQuestions)
    .map(([qNum, st]) => ({
      questionNum: parseInt(qNum, 10),
      errorRate: Math.round(st.errorRate || 0),
      wrongCount: st.wrongCount || 0,
      totalResponses: st.actualResponses || 0
    }))
    .filter(q => q.errorRate >= 50 && q.totalResponses > 0)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 50);

  // 과목별 고오답률 분류
  round.overall.topWrongQuestions.forEach(q => {
    const subject = findSubjectByQuestionNum(q.questionNum);
    if (!subject) return;
    if (!round.overall.highErrorRateQuestions[subject]) round.overall.highErrorRateQuestions[subject] = [];
    round.overall.highErrorRateQuestions[subject].push(q.questionNum);
  });

  round.overall.schoolComparison = schoolTotals;

  await db.collection('analytics').doc(`${roundLabel}_summary`).set(round);

  // 전체 통합 상태 문서도 갱신
  await analyzeOverallStatus(roundLabel);

  console.log(`회차 요약 통계 업데이트 완료: ${roundLabel}`);
}

/**
 * 전체 시험 통합 상태 (완전응시/중도포기/미응시) 분석
 * 결과 저장 위치: analytics/{roundLabel}_overall_status
 */
async function analyzeOverallStatus(roundLabel) {
  console.log(`전체 응시 상태 분석 시작: ${roundLabel}`);

  const sessions = ["1교시", "2교시", "3교시", "4교시"];
  const allStudents = {}; // { sid: { sessions: { '1교시': docData, ... } } }

  // 모든 교시 데이터 수집
  for (const session of sessions) {
    const sessionRef = db.collection('scores_raw').doc(roundLabel).collection(session);
    const snap = await sessionRef.get();
    snap.forEach(doc => {
      const sid = doc.id;
      if (!allStudents[sid]) allStudents[sid] = { sid, sessions: {} };
      allStudents[sid].sessions[session] = doc.data();
    });
  }

  // 집계
  const analysis = {
    roundLabel,
    totalStudents: 0,
    byStatus: { completed: 0, dropout: 0, absent: 0 },
    bySession: {},
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  };
  sessions.forEach(s => analysis.bySession[s] = { attended: 0, absent: 0 });

  Object.entries(allStudents).forEach(([sid, st]) => {
    analysis.totalStudents++;
    let completedCnt = 0;

    sessions.forEach(s => {
      const d = st.sessions[s];
      const isAttended = d && d.status === 'completed';
      if (isAttended) {
        completedCnt++;
        analysis.bySession[s].attended++;
      } else {
        analysis.bySession[s].absent++;
      }
    });

    if (completedCnt === 4) analysis.byStatus.completed++;
    else if (completedCnt === 0) analysis.byStatus.absent++;
    else analysis.byStatus.dropout++;
  });

  await db.collection('analytics').doc(`${roundLabel}_overall_status`).set(analysis);
  console.log(`전체 응시 상태 분석 완료: ${roundLabel}`);
}

// ---------------- Cloud Functions (Triggers / HTTP) ----------------

// 점수/응답 저장 시마다 자동으로 통계 재계산 (권장)
exports.updateAnalyticsOnSubmission = functions.firestore
  .document('scores_raw/{roundLabel}/{session}/{sid}')
  .onWrite(async (change, context) => {
    const { roundLabel, session } = context.params;
    try {
      console.log(`통계 트리거 작동: ${roundLabel} ${session}`);
      await updateSessionAnalytics(roundLabel, session);
      await updateRoundAnalytics(roundLabel);
      console.log('통계 트리거 완료');
    } catch (e) {
      console.error('통계 트리거 실패:', e);
    }
  });

// 수동으로 특정 회차(또는 교시) 통계 재계산
exports.manualUpdateAnalytics = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { roundLabel, session } = req.method === 'POST' ? req.body : req.query;
    if (!roundLabel) return res.status(400).json({ error: 'roundLabel은 필수입니다.' });

    if (session) {
      await updateSessionAnalytics(roundLabel, session);
    } else {
      const sessions = ['1교시', '2교시', '3교시', '4교시'];
      for (const s of sessions) await updateSessionAnalytics(roundLabel, s);
    }
    await updateRoundAnalytics(roundLabel);

    res.json({ success: true, message: `${roundLabel} ${session || '전체'} 통계 갱신 완료` });
  } catch (e) {
    console.error('manualUpdateAnalytics 실패:', e);
    res.status(500).json({ error: '서버 오류', details: e.message });
  }
});

// 고오답률 문항 조회
exports.getHighErrorRateQuestions = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { roundLabel } = req.query;
    if (!roundLabel) return res.status(400).json({ error: 'roundLabel은 필수입니다.' });

    const snap = await db.collection('analytics').doc(`${roundLabel}_summary`).get();
    if (!snap.exists) {
      return res.json({ success: true, data: {}, topQuestions: [], message: '데이터 없음' });
    }
    const data = snap.data() || {};
    res.json({
      success: true,
      data: data.overall?.highErrorRateQuestions || {},
      topQuestions: data.overall?.topWrongQuestions || []
    });
  } catch (e) {
    console.error('getHighErrorRateQuestions 실패:', e);
    res.status(500).json({ error: '서버 오류', details: e.message });
  }
});

// 문항별 선택률/정답률 조회
exports.getQuestionChoiceStats = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { roundLabel, questionNum } = req.query;
    if (!roundLabel || !questionNum) {
      return res.status(400).json({ error: 'roundLabel, questionNum은 필수입니다.' });
    }
    const qNum = parseInt(questionNum, 10);
    const session = findSessionByQuestionNum(qNum);
    if (!session) return res.status(400).json({ error: '유효하지 않은 문항번호' });

    const ref = db.collection('analytics').doc(`${roundLabel}_${session}`);
    const snap = await ref.get();
    if (!snap.exists) return res.json({ success: true, data: null, message: '통계 없음' });
    const data = snap.data();

    const qStats = data.questionStats?.[qNum];
    const choiceStats = data.choiceStats?.[qNum];
    const choicePerc = data.choicePercents?.[qNum];

    // 정답 조회
    const ansSnap = await db.collection('answer_keys').doc(`${roundLabel}_${session}`).get();
    const correctAnswer = ansSnap.exists ? ansSnap.data()?.[qNum] : null;

    if (!qStats || !choiceStats) {
      return res.json({ success: true, data: null, message: '해당 문항 통계 없음' });
    }

    res.json({
      success: true,
      data: {
        questionNum: qNum,
        choices: choiceStats,       // raw count (1~5, null)
        choicePercents: choicePerc, // % (1~5, 합=100)
        totalResponses: qStats.totalResponses,
        actualResponses: qStats.actualResponses,
        wrongCount: qStats.wrongCount,
        correctCount: qStats.correctCount,
        errorRate: qStats.errorRate,
        correctRate: qStats.correctRate,
        responseRate: qStats.responseRate,
        correctAnswer
      }
    });
  } catch (e) {
    console.error('getQuestionChoiceStats 실패:', e);
    res.status(500).json({ error: '서버 오류', details: e.message });
  }
});

// 전체 응시 상태 조회 (TrendChart 등에서 사용)
exports.getOverallStatus = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { roundLabel } = req.query;
    if (!roundLabel) return res.status(400).json({ error: 'roundLabel은 필수입니다.' });

    const ref = db.collection('analytics').doc(`${roundLabel}_overall_status`);
    const snap = await ref.get();

    if (!snap.exists) {
      await analyzeOverallStatus(roundLabel);
      const snap2 = await ref.get();
      if (!snap2.exists) return res.json({ success: true, data: null, message: '데이터 없음' });
      return res.json({ success: true, data: snap2.data() });
    }
    return res.json({ success: true, data: snap.data() });
  } catch (e) {
    console.error('getOverallStatus 실패:', e);
    res.status(500).json({ error: '서버 오류', details: e.message });
  }
});


// ====== [NEW] 사전 집계 설정 ======
const BIN_SIZE = 5;
const CUTOFF_SCORE = 204;

/**
 * 4교시 모두 completed 학생들만 대상으로
 * - 전국/학교별 총점 분포를 5점 단위 bin으로 사전 집계하여 저장합니다.
 * 저장 위치: distributions/{roundLabel}
 * 구조:
 * {
 *   roundLabel,
 *   range: { min, max },
 *   cutoff: 204,
 *   national: [{min,max,count}, ...],
 *   bySchool: { "01":[...], "02":[...], ... },
 *   averages: {
 *     nationalAvg: number|null,
 *     bySchool: { "01": number|null, ... }
 *   },
 *   stats: {
 *     national: { total, completed },        // completed == 유효응시자(4교시 완료)
 *     bySchool: { "01": { total, completed }, ... }
 *   },
 *   updatedAt: serverTimestamp
 * }
 */
async function buildPrebinnedDistributions(roundLabel) {
  // 1) 4개 교시 읽어서 sid별 completed count와 총점 누적
  const sessions = ['1교시','2교시','3교시','4교시'];
  const perSid = {}; // sid -> { completed:0..4, sum: number }
  const schoolTotals = {}; // 학교별 { total(유효 sid 수), completed(4교시 완료 수) }
  const nationalTotals = { total: 0, completed: 0 };

  for (const session of sessions) {
    const snap = await db.collection('scores_raw').doc(roundLabel).collection(session).get();
    snap.forEach(doc => {
      const sid = doc.id;
      const data = doc.data() || {};
      const code = String(sid).slice(0,2);
      if (!/^(0[1-9]|1[0-2])$/.test(code)) return;

      if (!perSid[sid]) perSid[sid] = { completed: 0, sum: 0, code };
      if (data.status === 'completed') {
        perSid[sid].completed += 1;
        perSid[sid].sum += (Number.isFinite(data.totalScore) ? Number(data.totalScore) : 0);
      }
    });
  }

  // 2) 4교시 완료자만 집계 대상으로 사용
  const nationalScores = [];
  const bySchoolScores = {};  // code -> number[]
  Object.values(perSid).forEach(v => {
    nationalTotals.total += 1;
    const code = v.code;
    if (!schoolTotals[code]) schoolTotals[code] = { total: 0, completed: 0 };
    schoolTotals[code].total += 1;

    if (v.completed === 4) {
      nationalTotals.completed += 1;
      schoolTotals[code].completed += 1;

      nationalScores.push(v.sum);
      if (!bySchoolScores[code]) bySchoolScores[code] = [];
      bySchoolScores[code].push(v.sum);
    }
  });

  // 3) 동적 범위(분포 있는 점수 기준) 계산
  let minScore = nationalScores.length ? Math.min(...nationalScores) : 0;
  let maxScore = nationalScores.length ? Math.max(...nationalScores) : 0;
  if (minScore === maxScore) {
    minScore = Math.max(0, minScore - BIN_SIZE * 3);
    maxScore = Math.min(340, maxScore + BIN_SIZE * 3);
  }
  // 커트라인을 범위에 포함
  if (CUTOFF_SCORE < minScore) minScore = Math.floor(CUTOFF_SCORE / BIN_SIZE) * BIN_SIZE - BIN_SIZE * 2;
  if (CUTOFF_SCORE > maxScore) maxScore = Math.ceil(CUTOFF_SCORE / BIN_SIZE) * BIN_SIZE + BIN_SIZE * 2;
  minScore = Math.max(0, Math.floor(minScore / BIN_SIZE) * BIN_SIZE);
  maxScore = Math.min(340, Math.ceil(maxScore / BIN_SIZE) * BIN_SIZE);

  // 4) 5점 bin 생성 도우미
  const makeBins = (scores) => {
    if (!scores || !scores.length) {
      // 빈 분포라도 min/max는 유지
      const out = [];
      for (let x = minScore; x < maxScore; x += BIN_SIZE) {
        out.push({ min: x, max: x + BIN_SIZE, count: 0 });
      }
      out.push({ min: maxScore, max: maxScore, count: 0 }); // 끝점 포함
      return out;
    }
    const counts = [];
    for (let x = minScore; x < maxScore; x += BIN_SIZE) {
      const c = scores.filter(s => s >= x && s < x + BIN_SIZE).length;
      counts.push({ min: x, max: x + BIN_SIZE, count: c });
    }
    // 끝 값(==maxScore)
    const lastCount = scores.filter(s => s === maxScore).length;
    counts.push({ min: maxScore, max: maxScore, count: lastCount });
    return counts;
  };

  const national = makeBins(nationalScores);
  const bySchool = {};
  Object.entries(bySchoolScores).forEach(([code, arr]) => {
    bySchool[code] = makeBins(arr);
  });

  // 5) 평균(반올림) 계산
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0) / arr.length) : null;
  const averages = {
    nationalAvg: avg(nationalScores),
    bySchool: {}
  };
  Object.entries(bySchoolScores).forEach(([code, arr]) => {
    averages.bySchool[code] = avg(arr);
  });

  // 6) 저장
  await db.collection('distributions').doc(roundLabel).set({
    roundLabel,
    range: { min: minScore, max: maxScore },
    cutoff: CUTOFF_SCORE,
    national,
    bySchool,
    averages,
    stats: {
      national: { total: nationalTotals.total, completed: nationalTotals.completed },
      bySchool: schoolTotals
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[dist] saved distributions/${roundLabel}  (N=${nationalTotals.completed})`);
}

/**
 * [NEW] 사전집계 조회 API
 * GET /getPrebinnedDistribution?roundLabel=1차
 */
exports.getPrebinnedDistribution = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { roundLabel } = req.query;
    if (!roundLabel) return res.status(400).json({ success: false, error: 'roundLabel은 필수입니다.' });

    const ref = db.collection('distributions').doc(roundLabel);
    const snap = await ref.get();

    if (!snap.exists) {
      // 없으면 즉석 생성 후 반환
      await buildPrebinnedDistributions(roundLabel);
      const snap2 = await ref.get();
      if (!snap2.exists) return res.json({ success: true, data: null, message: '데이터 없음' });
      return res.json({ success: true, data: snap2.data() });
    }

    return res.json({ success: true, data: snap.data() });
  } catch (e) {
    console.error('getPrebinnedDistribution 실패:', e);
    res.status(500).json({ success: false, error: '서버 오류', details: e.message });
  }
});

// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { PDFDocument, rgb, degrees } = require("pdf-lib");

try { admin.app(); } catch { admin.initializeApp(); }

// 공통: 로그 저장
async function writeAudit({ uid, sid, filePath, action, meta = {}, req }) {
  const col = admin.firestore().collection("pdf_audit");
  const doc = {
    uid: uid || null,
    sid: sid || null,
    filePath,
    action,                       // 'view' | 'download_attempt' | 'print_attempt' | ...
    ts: admin.firestore.FieldValue.serverTimestamp(),
    ip: req?.ip || req?.headers?.["x-forwarded-for"] || null,
    ua: req?.headers?.["user-agent"] || null,
    ...meta,
  };
  await col.add(doc);
}

// ① 워터마크 PDF 제공 (Callable)
exports.serveWatermarkedPdf = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { filePath, sid } = data || {};
  if (!filePath || !sid) {
    throw new functions.https.HttpsError("invalid-argument", "filePath, sid가 필요합니다.");
  }

  // Storage에서 원본 PDF 읽기
  const bucket = admin.storage().bucket(); // 기본 버킷
  const [bytes] = await bucket.file(filePath).download();

  // PDF-lib로 워터마크 삽입
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();

  const text = `SID: ${sid}`;
  pages.forEach((page) => {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 4,
      y: height / 2,
      size: 18,
      color: rgb(0.95, 0.1, 0.1),
      opacity: 0.25,
      rotate: degrees(45),
    });
    // 모서리에도 작게
    page.drawText(text, { x: 24, y: 24, size: 10, color: rgb(0.9, 0.2, 0.2), opacity: 0.6 });
  });

  const out = await pdfDoc.save();

  // 열람(view) 로그
  await writeAudit({
    uid: context.auth.uid,
    sid,
    filePath,
    action: "view",
    req: context.rawRequest
  });

  // base64로 반환 (프론트에서 Blob 변환)
  return Buffer.from(out).toString("base64");
});

// ② 프론트에서 “시도” 감지 시 호출하는 로거 (Callable)
exports.logPdfAction = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { filePath, sid, action, meta } = data || {};
  if (!filePath || !sid || !action) {
    throw new functions.https.HttpsError("invalid-argument", "filePath, sid, action이 필요합니다.");
  }
  await writeAudit({
    uid: context.auth.uid,
    sid,
    filePath,
    action,        // 'download_attempt' | 'print_attempt' ...
    meta: meta || {},
    req: context.rawRequest
  });
  return { ok: true };
});

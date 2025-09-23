// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const XLSX = require("xlsx");
const { PDFDocument, rgb, degrees, StandardFonts } = require("pdf-lib");

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();


function toKRE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+82")) return digits;
  const onlyDigits = digits.replace(/\D/g, "");
  if (onlyDigits.startsWith("0")) return "+82" + onlyDigits.slice(1);
  return null;
}
function groupByPhone(rows) {
  const map = new Map();
  for (const r of rows) {
    const e164 = toKRE164(r.phone);
    if (!e164) continue;
    const sid = String(r.sid || "").trim();
    if (!sid || sid.length < 6) continue;
    const school = r.school ? String(r.school).trim() : undefined;

    if (!map.has(e164)) map.set(e164, { sids: new Set(), school });
    const cur = map.get(e164);
    cur.sids.add(sid);
    if (school && !cur.school) cur.school = school;
  }
  const out = [];
  for (const [phone, v] of map) {
    out.push({ phone, sids: Array.from(v.sids).sort(), school: v.school || null });
  }
  return out;
}

const SUBJECT_MAX = {
  "간":16, "심":16, "비":16, "폐":16, "신":16,
  "상한":16, "사상":16, "침구":48, "법규":20,
  "외과":16, "신정":16, "안이비":16, "부인":32, 
  "소아":24, "예방":24, "생리":16, "본초":16
};

const SESSION_SUBJECT_RANGES = {
  "1교시": [
    { from: 1, to: 80, s: "내과학" },
  ],
  "2교시": [
    { from: 1,  to: 16, s: "상한" },
    { from: 17, to: 32, s: "사상" },
    { from: 33, to: 80, s: "침구" },
    { from: 81, to: 100, s: "법규" }
  ],
  "3교시": [
    { from: 1, to: 16, s: "외과" },
    { from: 17, to: 32, s: "신정" },
    { from: 33, to: 48, s: "안이비" },
    { from: 49, to: 80, s: "부인" }
  ],
  "4교시": [
    { from: 1, to: 24, s: "소아" },
    { from: 25, to: 48, s: "예방" },
    { from: 49, to: 64, s: "생리" },
    { from: 65, to: 80, s: "본초" }
  ]
};

function calculatePercentile(scores, myScore) {
  if (!scores || scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  const rank = sorted.findIndex(s => s <= myScore);
  if (rank === 0) return 0.0;
  if (rank === sorted.length - 1) return 100.0;
  return +((rank / (sorted.length - 1)) * 100).toFixed(1);
}

exports.processStorageExcel = functions.storage.object().onFinalize(async (object) => {
  try {
    const { name: filePath, bucket } = object;
    if (!filePath || !filePath.endsWith('.xlsx')) return null;
    if (!/^scores\//.test(filePath)) return null;

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
      status: 'completed',
      type: 'scores'
    });

    return null;
  } catch (error) {
    console.error('Excel 처리 실패:', error);
    await db.collection('upload_logs').add({
      filePath: object.name,
      error: error.message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'failed',
      type: 'scores'
    });
    return null;
  }
});

function extractFileInfo(filePath) {
  const fileName = filePath.split('/').pop();
  const numbers = fileName.match(/\d+/g);
  if (numbers && numbers.length >= 2) {
    return { roundLabel: `${numbers[0]}차`, session: `${numbers[1]}교시` };
  }
  return null;
}

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

    const answerKeyObj = {};
    validQuestions.forEach(q => { answerKeyObj[q.questionNum] = q.correctAnswer; });
    await db.collection('answer_keys').doc(`${roundLabel}_${session}`).set(answerKeyObj);

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

    const scoresOnly = processedData.filter(s => s.status === 'completed').map(s => s.totalScore);
    processedData.forEach(stu => {
      if (stu.status === 'completed') {
        stu.percentile = calculatePercentile(scoresOnly, stu.totalScore);
      } else {
        stu.percentile = null;
      }
    });

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
    await analyzeOverallStatus(roundLabel);
    await buildPrebinnedDistributions(roundLabel);

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

async function findSubjectByQuestionNum(questionNum, session, roundLabel) {
  const mappingDocRef = db.collection('subject_mappings').doc(`${roundLabel}_${session}`);
  const doc = await mappingDocRef.get();
  if (doc.exists) {
    return doc.data().mapping[questionNum - 1] || null;
  }
  const ranges = SESSION_SUBJECT_RANGES[session] || [];
  for (const range of ranges) {
    if (questionNum >= range.from && questionNum <= range.to) return range.s;
  }
  return null;
}
function findSessionByQuestionNum(questionNum) {
  for (const [session, ranges] of Object.entries(SESSION_SUBJECT_RANGES)) {
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) return session;
    }
  }
  return null;
}
function normalizeTo100(choiceCounts) {
  const keys = [1,2,3,4,5];
  const total = keys.reduce((s,k)=>s + (choiceCounts?.[k] || 0), 0);
  if (total <= 0) return {1:0,2:0,3:0,4:0,5:0};

  const raw = keys.map(k => (choiceCounts[k] || 0) * 100 / total);
  const floors = raw.map(v => Math.floor(v));
  let rem = 100 - floors.reduce((a,b)=>a+b,0);

  const order = raw
    .map((v,i)=>({i, frac: v - floors[i]}))
    .sort((a,b)=>b.frac - a.frac)
    .map(x=>x.i);

  const out = floors.slice();
  for (let i=0; i<rem; i++) out[order[i % order.length]] += 1;
  return {1: out[0], 2: out[1], 3: out[2], 4: out[3], 5: out[4]};
}

async function updateSessionAnalytics(roundLabel, session) {
  console.log(`교시별 통계 업데이트 시작: ${roundLabel} ${session}`);
  const sessionRef = db.collection('scores_raw').doc(roundLabel).collection(session);
  const snapshot = await sessionRef.get();

  const analytics = {
    roundLabel,
    session,
    totalStudents: 0,
    attendedStudents: 0,
    absentStudents: 0,
    questionStats: {},
    choiceStats: {},
    choicePercents: {},
    schoolStats: {},
    subjectStats: {},
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  };

  snapshot.forEach(doc => {
    const data = doc.data() || {};
    const { sid, responses = {}, wrongQuestions = [], status } = data;

    analytics.totalStudents++;
    if (status === 'completed') analytics.attendedStudents++;
    else analytics.absentStudents++;

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

    Object.entries(responses).forEach(([qStr, choice]) => {
      const qNum = parseInt(qStr, 10);
      if (!Number.isFinite(qNum)) return;

      if (!analytics.questionStats[qNum]) {
        analytics.questionStats[qNum] = {
          totalResponses: 0,
          actualResponses: 0,
          wrongCount: 0,
          correctCount: 0,
          choices: { 1:0, 2:0, 3:0, 4:0, 5:0, null:0 }
        };
      }
      if (!analytics.choiceStats[qNum]) {
        analytics.choiceStats[qNum] = { 1:0, 2:0, 3:0, 4:0, 5:0, null:0 };
      }

      analytics.questionStats[qNum].totalResponses++;
      analytics.choiceStats[qNum][choice ?? 'null']++;

      if (choice !== null && choice !== undefined) {
        analytics.questionStats[qNum].actualResponses++;
      }

      if (Array.isArray(wrongQuestions) && wrongQuestions.includes(qNum)) {
        analytics.questionStats[qNum].wrongCount++;
        analytics.schoolStats[schoolCode].totalWrong++;
        if (!analytics.schoolStats[schoolCode].questionStats[qNum]) {
          analytics.schoolStats[schoolCode].questionStats[qNum] = { wrongCount: 0 };
        }
        analytics.schoolStats[schoolCode].questionStats[qNum].wrongCount++;
      } else if (choice !== null && choice !== undefined) {
        analytics.questionStats[qNum].correctCount++;
      }

      const subject = findSubjectByQuestionNum(qNum, session, roundLabel);
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

    analytics.choicePercents[q] = normalizeTo100(analytics.choiceStats[q]);
  });

  await db.collection('analytics').doc(`${roundLabel}_${session}`).set(analytics);
  console.log(`교시별 통계 업데이트 완료: ${roundLabel} ${session} (응시 ${analytics.attendedStudents} / 총 ${analytics.totalStudents})`);
}

async function updateRoundAnalytics(roundLabel) {
  console.log(`회차 요약 통계 업데이트 시작: ${roundLabel}`);

  const sessions = ['1교시', '2교시', '3교시', '4교시'];
  const round = {
    roundLabel,
    sessions: {},
    overall: {
      totalStudents: 0,
      topWrongQuestions: [],
      highErrorRateQuestions: {},
      schoolComparison: {}
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

    round.overall.totalStudents = Math.max(round.overall.totalStudents, data.totalStudents || 0);

    Object.entries(data.questionStats || {}).forEach(([qNum, stats]) => {
      if (!allQuestions[qNum]) allQuestions[qNum] = { ...stats };
    });

    Object.entries(data.schoolStats || {}).forEach(([schoolCode, st]) => {
      if (!schoolTotals[schoolCode]) {
        schoolTotals[schoolCode] = { totalStudents: 0, attendedStudents: 0, totalWrong: 0 };
      }
      schoolTotals[schoolCode].totalStudents = Math.max(schoolTotals[schoolCode].totalStudents, st.totalStudents || 0);
      schoolTotals[schoolCode].attendedStudents = Math.max(schoolTotals[schoolCode].attendedStudents, st.attendedStudents || 0);
      schoolTotals[schoolCode].totalWrong += st.totalWrong || 0;
    });
  }

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

    round.overall.topWrongQuestions.forEach(q => {
    const subject = findSubjectByQuestionNum(q.questionNum);
    if (!subject) return;
    if (!round.overall.highErrorRateQuestions[subject]) {
      round.overall.highErrorRateQuestions[subject] = [];
    }
    round.overall.highErrorRateQuestions[subject].push(q.questionNum);
  });

  round.overall.schoolComparison = schoolTotals;

  await db.collection('analytics').doc(`${roundLabel}_summary`).set(round);
  await analyzeOverallStatus(roundLabel);
  console.log(`회차 요약 통계 업데이트 완료: ${roundLabel}`);
}

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
    await analyzeOverallStatus(roundLabel);

    res.json({ success: true, message: `${roundLabel} ${session || '전체'} 통계 갱신 완료` });
  } catch (e) {
    console.error('manualUpdateAnalytics 실패:', e);
    res.status(500).json({ error: '서버 오류', details: e.message });
  }
});

exports.getHighErrorRateQuestions = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { roundLabel } = data || {};
  if (!roundLabel) {
    throw new functions.https.HttpsError("invalid-argument", "roundLabel은 필수입니다.");
  }
  
  const snap = await db.collection('analytics').doc(`${roundLabel}_summary`).get();
  if (!snap.exists) {
    return { success: true, data: {}, topQuestions: [], message: '데이터 없음' };
  }
  const summary = snap.data() || {};
  return {
    success: true,
    data: summary.overall?.highErrorRateQuestions || {},
    topQuestions: summary.overall?.topWrongQuestions || []
  };
});

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

    const ansSnap = await db.collection('answer_keys').doc(`${roundLabel}_${session}`).get();
    const correctAnswer = ansSnap.exists ? ansSnap.data()?.[qNum] : null;

    if (!qStats || !choiceStats) {
      return res.json({ success: true, data: null, message: '해당 문항 통계 없음' });
    }

    res.json({
      success: true,
      data: {
        questionNum: qNum,
        choices: choiceStats,
        choicePercents: choicePerc,
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

const BIN_SIZE = 5;
const CUTOFF_SCORE = 204;

async function buildPrebinnedDistributions(roundLabel) {
  const sessions = ['1교시','2교시','3교시','4교시'];
  const perSid = {};
  const seenSid = new Set();

  for (const session of sessions) {
    const snap = await db.collection('scores_raw').doc(roundLabel).collection(session).get();
    snap.forEach(doc => {
      const sid = doc.id;
      seenSid.add(sid);
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

  const nationalScores = [];
  const bySchoolScores = {};
  const nationalStats = { total: 0, completed: 0, absent: 0, dropout: 0 };
  const bySchoolStats = {};

  for (const sid of seenSid) {
    const rec = perSid[sid] || { completed: 0, sum: 0, code: String(sid).slice(0,2) };
    const code = rec.code;
    if (!/^(0[1-9]|1[0-2])$/.test(code)) continue;

    nationalStats.total += 1;
    if (!bySchoolStats[code]) bySchoolStats[code] = { total: 0, completed: 0, absent: 0, dropout: 0 };
    bySchoolStats[code].total += 1;

    if (rec.completed === 0) {
      nationalStats.absent += 1;
      bySchoolStats[code].absent += 1;
    } else if (rec.completed > 0 && rec.completed < 4) {
      nationalStats.dropout += 1;
      bySchoolStats[code].dropout += 1;
    } else if (rec.completed === 4) {
      nationalStats.completed += 1;
      bySchoolStats[code].completed += 1;

      nationalScores.push(rec.sum);
      if (!bySchoolScores[code]) bySchoolScores[code] = [];
      bySchoolScores[code].push(rec.sum);
    }
  }

  let minScore = nationalScores.length ? Math.min(...nationalScores) : 0;
  let maxScore = nationalScores.length ? Math.max(...nationalScores) : 0;
  if (minScore === maxScore) {
    minScore = Math.max(0, minScore - BIN_SIZE * 3);
    maxScore = Math.min(340, maxScore + BIN_SIZE * 3);
  }
  if (CUTOFF_SCORE < minScore) minScore = Math.floor(CUTOFF_SCORE / BIN_SIZE) * BIN_SIZE - BIN_SIZE * 2;
  if (CUTOFF_SCORE > maxScore) maxScore = Math.ceil(CUTOFF_SCORE / BIN_SIZE) * BIN_SIZE + BIN_SIZE * 2;
  minScore = Math.max(0, Math.floor(minScore / BIN_SIZE) * BIN_SIZE);
  maxScore = Math.min(340, Math.ceil(maxScore / BIN_SIZE) * BIN_SIZE);

  const makeBins = (scores) => {
    const out = [];
    if (!scores || !scores.length) {
      for (let x = minScore; x < maxScore; x += BIN_SIZE) out.push({ min: x, max: x + BIN_SIZE, count: 0 });
      out.push({ min: maxScore, max: maxScore, count: 0 });
      return out;
    }
    for (let x = minScore; x < maxScore; x += BIN_SIZE) {
      const c = scores.filter(s => s >= x && s < x + BIN_SIZE).length;
      out.push({ min: x, max: x + BIN_SIZE, count: c });
    }
    const lastCount = scores.filter(s => s === maxScore).length;
    out.push({ min: maxScore, max: maxScore, count: lastCount });
    return out;
  };

  const national = makeBins(nationalScores);
  const bySchool = {};
  Object.entries(bySchoolScores).forEach(([code, arr]) => { bySchool[code] = makeBins(arr); });

  const avg = (arr) => (arr && arr.length ? Math.round(arr.reduce((a,b)=>a+b,0) / arr.length) : null);
  const averages = { nationalAvg: avg(nationalScores), bySchool: {} };
  Object.entries(bySchoolScores).forEach(([code, arr]) => { averages.bySchool[code] = avg(arr); });

  await db.collection('distributions').doc(roundLabel).set({
    roundLabel,
    range: { min: minScore, max: maxScore },
    cutoff: CUTOFF_SCORE,
    national,
    bySchool,
    averages,
    stats: { national: nationalStats, bySchool: bySchoolStats },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`[dist] saved distributions/${roundLabel} (N=${nationalStats.completed}, total=${nationalStats.total}, absent=${nationalStats.absent}, dropout=${nationalStats.dropout})`);
}

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


async function writeAudit({ uid, sid, filePath, action, meta = {}, req }) {
  const col = admin.firestore().collection("pdf_audit");
  const doc = {
    uid: uid || null,
    sid: sid || null,
    filePath,
    action, // 'view' | 'download_attempt' | 'print_attempt' | ...
    ts: admin.firestore.FieldValue.serverTimestamp(),
    ip: req?.ip || req?.headers?.["x-forwarded-for"] || null,
    ua: req?.headers?.["user-agent"] || null,
    ...meta,
  };
  await col.add(doc);
}

exports.serveWatermarkedPdf = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const { filePath, sid } = data || {};
  if (!filePath || !sid) {
    throw new functions.https.HttpsError("invalid-argument", "filePath, sid가 필요합니다.");
  }

  const bucket = admin.storage().bucket();
  const [bytes] = await bucket.file(filePath).download();

  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const text = String(sid);
  const fontSize = 42;
  const angle = degrees(36);
  const color = rgb(0.6, 0.6, 0.6);
  const opacity = 0.12;

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = fontSize;

    const stepX = textWidth * 1.8;
    const stepY = textHeight * 1.0;

    for (let y = -stepY; y < height + stepY; y += stepY) {
      const xOffset = (y / stepY) % 2 === 0 ? 0 : stepX / 2;
      for (let x = -stepX; x < width + stepX; x += stepX) {
        page.drawText(text, {
          x: x + xOffset,
          y,
          size: fontSize,
          font,
          color,
          opacity,
          rotate: angle,
        });
      }
    }
    page.drawText(text, {
      x: 24,
      y: 24,
      size: 12,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.6,
    });
  }

  const out = await pdfDoc.save();

  await writeAudit({
    uid: context.auth.uid,
    sid,
    filePath,
    action: "view",
    req: context.rawRequest,
  });

  return Buffer.from(out).toString("base64");
});

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
    action,
    meta: meta || {},
    req: context.rawRequest
  });
  return { ok: true };
});

exports.getExplanationIndex = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { roundLabel } = data || {};
  const bucket = admin.storage().bucket();

  const [files] = await bucket.getFiles({ prefix: "explanation/" });
  const bySession = { "1교시": [], "2교시": [], "3교시": [], "4교시": [] };

  files.forEach(f => {
    const m = f.name.match(/^explanation\/(\d+)-(\d+)-(\d+)\.pdf$/);
    if (!m) return;
    const [_, r, s, q] = m;
    const rLabel = `${parseInt(r,10)}차`;
    const sLabel = `${parseInt(s,10)}교시`;
    const qNum   = parseInt(q, 10);
    if (roundLabel && roundLabel !== rLabel) return;
    if (bySession[sLabel]) bySession[sLabel].push(qNum);
  });

  Object.keys(bySession).forEach(k => {
    const set = new Set(bySession[k]);
    bySession[k] = Array.from(set).sort((a,b)=>a-b);
  });

  return bySession;
});


exports.verifyAndBindPhoneSid = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { phone, sid } = data || {};
  const e164 = toKRE164(phone);
  if (!e164) {
    throw new functions.https.HttpsError("invalid-argument", "유효한 전화번호 형식이 아닙니다.");
  }
  const cleanSid = String(sid || '').trim();
  if (!/^\d{6}$/.test(cleanSid)) {
    throw new functions.https.HttpsError("invalid-argument", "학수번호는 6자리 숫자여야 합니다.");
  }

  const snap = await db.collection('phones').doc(e164).get();
  if (!snap.exists) {
    return { ok: false, code: 'PHONE_NOT_FOUND', message: '등록되지 않은 전화번호입니다.' };
  }
  const sids = snap.data()?.sids || [];
  if (!sids.includes(cleanSid)) {
    return { ok: false, code: 'SID_MISMATCH', message: '전화번호와 학수번호가 일치하지 않습니다.' };
  }

  const uid = context.auth.uid;
  const bindRef = db.collection('bindings').doc(uid);
  await bindRef.set({
    sids: admin.firestore.FieldValue.arrayUnion(cleanSid),
    phone: e164,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, message: '검증 및 바인딩 완료', phone: e164, sid: cleanSid };
});

exports.getMyBindings = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = context.auth.uid;
  const snap = await db.collection('bindings').doc(uid).get();
  if (!snap.exists) return { ok: true, sids: [], phone: null };
  const { sids = [], phone = null } = snap.data() || {};
  return { ok: true, sids, phone };
});

exports.listAvailableRounds = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  try {
    const analyticsRef = db.collection('analytics');
    const summaries = await analyticsRef.get();
    const rounds = [];
    summaries.forEach(doc => {
      const id = doc.id;
      if (id.endsWith('_summary')) {
        const roundLabel = id.replace('_summary', '');
        rounds.push(roundLabel);
      }
    });
    return { rounds: rounds.sort() };
  } catch (e) {
    console.error("Available rounds list failed:", e);
    return { rounds: [] };
  }
});

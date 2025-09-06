// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// 평균 계산 함수
exports.calculateAverages = functions.pubsub
  .schedule('0 2 * * *') // 매일 새벽 2시 실행
  .timeZone('Asia/Seoul')
  .onRun(async (context) => {
    console.log('평균 계산 시작');
    
    const rounds = ['1차', '2차', '3차', '4차', '5차', '6차', '7차', '8차'];
    
    for (const round of rounds) {
      await calculateRoundAverages(round);
    }
    
    console.log('평균 계산 완료');
    return null;
  });

// 수동 평균 계산 트리거
exports.triggerAverageCalculation = functions.https.onRequest(async (req, res) => {
  const round = req.query.round;
  
  if (round) {
    await calculateRoundAverages(round);
    res.json({ success: true, message: `${round} 평균 계산 완료` });
  } else {
    const rounds = ['1차', '2차', '3차', '4차', '5차', '6차', '7차', '8차'];
    for (const r of rounds) {
      await calculateRoundAverages(r);
    }
    res.json({ success: true, message: '모든 회차 평균 계산 완료' });
  }
});

// 특정 회차의 평균 계산
async function calculateRoundAverages(round) {
  try {
    console.log(`${round} 평균 계산 중...`);
    
    // scores_raw에서 데이터 수집
    const scoresData = await collectScoresData(round);
    
    if (Object.keys(scoresData).length === 0) {
      console.log(`${round}: 데이터 없음`);
      return;
    }
    
    // 학교별 평균 계산
    const schoolAverages = calculateSchoolAverages(scoresData);
    
    // 전국 평균 계산
    const nationalAverage = calculateNationalAverage(scoresData);
    
    // Firestore에 저장
    await saveAverages(round, schoolAverages, nationalAverage);
    
    console.log(`${round} 평균 저장 완료`);
  } catch (error) {
    console.error(`${round} 평균 계산 오류:`, error);
  }
}

// scores_raw에서 데이터 수집
async function collectScoresData(round) {
  const sessions = ['1교시', '2교시', '3교시', '4교시'];
  const scoresData = {}; // sid -> { school, totalScore }
  
  for (const session of sessions) {
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
  }
  
  return scoresData;
}

// 학교별 평균 계산
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
    const sum = stats.scores.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / stats.count);
    schoolAverages[school] = {
      avg,
      count: stats.count,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
  });
  
  return schoolAverages;
}

// 전국 평균 계산
function calculateNationalAverage(scoresData) {
  const allScores = Object.values(scoresData).map(d => d.totalScore);
  const sum = allScores.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / allScores.length);
  
  return {
    avg,
    count: allScores.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

// Firestore에 평균 저장
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
}

// src/services/dataService.js - 기존 로직 거의 그대로, 최소 수정만
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

// 과목별 최대 점수
export const SUBJECT_MAX = {
  "간":16, "심":16, "비":16, "폐":16, "신":16,
  "상한":16, "사상":16, "침구":48, "보건":20,
  "외과":16, "신경":16, "안이비":16, "부인과":32, 
  "소아":24, "예방":24, "생리":16, "본초":16
};

// 그룹 정의
export const GROUPS = [
  { id: "그룹1", label: "그룹 1", subjects: ["간","심","비","폐","신","상한","사상"], layoutChunks: [5,2] },
  { id: "그룹3", label: "그룹 3", subjects: ["침구"] },
  { id: "그룹2", label: "그룹 2", subjects: ["보건"] },
  { id: "그룹4", label: "그룹 4", subjects: ["외과","신경","안이비"] },
  { id: "그룹5", label: "그룹 5", subjects: ["부인과","소아"] },
  { id: "그룹6", label: "그룹 6", subjects: ["예방","생리","본초"] }
];

export const ALL_SUBJECTS = GROUPS.flatMap(g => g.subjects);
export const TOTAL_MAX = ALL_SUBJECTS.reduce((a,n) => a + (SUBJECT_MAX[n] || 0), 0);

// 라운드 레이블
export const ROUND_LABELS = ["1차","2차","3차","4차","5차","6차","7차","8차"];

// 교시별 문항번호 → 과목 매핑
export const SESSION_SUBJECT_RANGES = {
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

// 학수번호 → 학교명
const SCHOOL_MAP = {
  "01":"가천대","02":"경희대","03":"대구한","04":"대전대",
  "05":"동국대","06":"동신대","07":"동의대","08":"부산대",
  "09":"상지대","10":"세명대","11":"우석대","12":"원광대"
};

export function getSchoolFromSid(sid) {
  const p2 = String(sid || "").slice(0, 2);
  return SCHOOL_MAP[p2] || "미상";
}

// Firestore 데이터 읽기 - 🎯 기존 로직 100% 보존
export async function fetchRoundData(sid, roundLabel) {
  try {
    // scores 컬렉션에서 먼저 시도
    const sidStr = String(sid);
    const scoresRef = doc(db, "scores", sidStr);
    const scoresSnap = await getDoc(scoresRef);
    
    if (scoresSnap.exists()) {
      const data = scoresSnap.data();
      if (data.rounds && data.rounds[roundLabel]) {
        return data.rounds[roundLabel];
      }
    }

    // scores_raw에서 교시별 데이터 수집
    const wrongBySession = {};
    const sessions = ["1교시", "2교시", "3교시", "4교시"];
    
    for (const session of sessions) {
      const docRef = doc(db, "scores_raw", roundLabel, session, sid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        const wrong = data.wrongQuestions || data.wrong || [];
        if (Array.isArray(wrong) && wrong.length > 0) {
          wrongBySession[session] = wrong.map(n => Number(n)).filter(n => !isNaN(n));
        }
      }
    }

    // 오답을 과목별 점수로 변환
    if (Object.keys(wrongBySession).length > 0) {
      return convertWrongToScores(wrongBySession);
    }

    return null;
  } catch (error) {
    console.error('데이터 fetch 오류:', error);
    return null;
  }
}

// 오답을 과목별 점수로 변환 - 🎯 기존 로직 100% 보존
function convertWrongToScores(wrongBySession) {
  const subjectScores = {};
  
  // 모든 과목을 만점으로 초기화
  ALL_SUBJECTS.forEach(subject => {
    subjectScores[subject] = SUBJECT_MAX[subject];
  });

  // 교시별 오답을 과목별로 차감
  Object.entries(wrongBySession).forEach(([session, wrongList]) => {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    
    wrongList.forEach(questionNum => {
      const range = ranges.find(r => questionNum >= r.from && questionNum <= r.to);
      if (range && range.s in subjectScores) {
        subjectScores[range.s] = Math.max(0, subjectScores[range.s] - 1);
      }
    });
  });

  // 그룹별 결과 계산
  const groupResults = GROUPS.map(group => {
    const groupScore = group.subjects.reduce((sum, subject) => sum + (subjectScores[subject] || 0), 0);
    const groupMax = group.subjects.reduce((sum, subject) => sum + (SUBJECT_MAX[subject] || 0), 0);
    const cutoff = Math.ceil(groupMax * 0.4);
    const pass = groupScore >= cutoff;

    return {
      name: group.id,
      label: group.label,
      subjects: group.subjects,
      layoutChunks: group.layoutChunks,
      score: groupScore,
      max: groupMax,
      rate: Math.round((groupScore / groupMax) * 100),
      pass,
      cutoff
    };
  });

  const totalScore = ALL_SUBJECTS.reduce((sum, subject) => sum + (subjectScores[subject] || 0), 0);
  const overallCutoff = Math.ceil(TOTAL_MAX * 0.6);
  const meets60 = totalScore >= overallCutoff;
  const anyGroupFail = groupResults.some(g => !g.pass);
  const overallPass = meets60 && !anyGroupFail;

  return {
    totalScore,
    totalMax: TOTAL_MAX,
    overallPass,
    meets60,
    anyGroupFail,
    groupResults,
    subjectScores,
    wrongBySession
  };
}

// 회차 자동 탐색 - 🎯 기존 로직 100% 보존
export async function discoverRoundsFor(sid) {
  const found = [];
  
  for (const label of ROUND_LABELS) {
    const data = await fetchRoundData(sid, label);
    if (data && data.totalScore > 0) {
      found.push({ label, data });
    }
  }
  
  return found;
}

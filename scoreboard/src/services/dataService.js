// src/services/dataService.js
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

// 과목별 최대 점수 설정
const SUBJECT_MAX = {
  "간": 16, "심": 16, "비": 16, "폐": 16, "신": 16,
  "침구": 48, "안이": 16, "부인": 16, "소아": 24, "외과": 16,
  "한의": 8
};

// 전체 과목 목록
const ALL_SUBJECTS = ["간", "심", "비", "폐", "신", "침구", "안이", "부인", "소아", "외과", "한의"];

// 총점
const TOTAL_MAX = Object.values(SUBJECT_MAX).reduce((sum, val) => sum + val, 0);

// 그룹 설정
const GROUPS = [
  {
    id: "basic",
    label: "기초과목",
    subjects: ["간", "심", "비", "폐", "신"],
    layoutChunks: [[1, "간"], [2, "심"], [3, "비"], [4, "폐"], [5, "신"]]
  },
  {
    id: "clinical",
    label: "임상과목",
    subjects: ["침구", "안이", "부인", "소아", "외과"],
    layoutChunks: [[1, "침구"], [2, "안이"], [3, "부인"], [4, "소아"], [5, "외과"]]
  },
  {
    id: "prevention",
    label: "예방과목",
    subjects: ["한의"],
    layoutChunks: [[1, "한의"]]
  }
];

// 교시별 과목 범위 설정
const SESSION_SUBJECT_RANGES = {
  "1교시": [
    { from: 1, to: 16, s: "간" },
    { from: 17, to: 32, s: "심" },
    { from: 33, to: 48, s: "비" },
    { from: 49, to: 64, s: "폐" },
    { from: 65, to: 80, s: "신" }
  ],
  "2교시": [
    { from: 1, to: 48, s: "침구" },
    { from: 49, to: 64, s: "안이" },
    { from: 65, to: 80, s: "부인" },
    { from: 81, to: 100, s: "소아" }
  ],
  "3교시": [
    { from: 1, to: 16, s: "외과" },
    { from: 17, to: 80, s: "기타" } // 필요시 추가 과목
  ],
  "4교시": [
    { from: 1, to: 8, s: "한의" },
    { from: 9, to: 80, s: "기타" } // 필요시 추가 과목
  ]
};

// 회차 라벨
const ROUND_LABELS = ["1차", "2차", "3차", "4차", "5차"];

// 학교 코드 매핑
const SCHOOL_MAP = {
  "01": "가천대", "02": "경희대", "03": "대구한", "04": "대전대",
  "05": "동국대", "06": "동신대", "07": "동의대", "08": "부산대",
  "09": "상지대", "10": "세명대", "11": "우석대", "12": "원광대"
};

export function getSchoolFromSid(sid) {
  const p2 = String(sid || "").slice(0, 2);
  return SCHOOL_MAP[p2] || "미상";
}

// Firestore 데이터 읽기
export async function fetchRoundData(sid, roundLabel) {
  try {
    // scores 컬렉션에서 먼저 시도
    const scoresRef = doc(db, "scores", sid);
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

// 오답을 과목별 점수로 변환 (중도포기자 처리 포함)
function convertWrongToScores(wrongBySession) {
  const subjectScores = {};
  const attendedSessions = Object.keys(wrongBySession);
  
  // 과목이 속한 교시를 찾는 헬퍼 함수
  const findSessionForSubject = (subject) => {
    for (const [session, ranges] of Object.entries(SESSION_SUBJECT_RANGES)) {
      if (ranges.some(range => range.s === subject)) {
        return session;
      }
    }
    return null;
  };
  
  // 과목별 점수 초기화 (미응시 교시 고려)
  ALL_SUBJECTS.forEach(subject => {
    const sessionForSubject = findSessionForSubject(subject);
    
    if (attendedSessions.includes(sessionForSubject)) {
      // 응시한 교시의 과목: 만점에서 시작
      subjectScores[subject] = SUBJECT_MAX[subject];
    } else {
      // 미응시한 교시의 과목: 0점
      subjectScores[subject] = 0;
    }
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

// 회차 자동 탐색
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

// 상수들을 export
export { 
  SUBJECT_MAX, 
  ALL_SUBJECTS, 
  TOTAL_MAX, 
  GROUPS, 
  SESSION_SUBJECT_RANGES, 
  ROUND_LABELS 
};

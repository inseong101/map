// src/services/dataService.js - 기존 구조 유지하면서 필요한 기능만 추가
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { detectStudentAbsenceStatus } from '../utils/helpers'; // 🎯 추가

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

// 라운드 레이블 - 🎯 기존 번호형에서 한글형으로 변경
export const ROUND_LABELS = ["제1회", "제2회", "제3회"]; // 🎯 수정

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

// 🎯 상위 퍼센트 계산 함수 추가
export async function calculateRankPercentile(studentScore, roundLabel, validOnly = false) {
  try {
    const sessions = ['1교시', '2교시', '3교시', '4교시'];
    const sessionMaxScores = { '1교시': 80, '2교시': 100, '3교시': 80, '4교시': 80 };
    const studentScores = {}; // sid -> { totalScore, attendedSessions }

    // 모든 학생의 교시별 데이터 수집
    for (const session of sessions) {
      try {
        const sessionRef = collection(db, 'scores_raw', roundLabel, session);
        const snapshot = await getDocs(sessionRef);
        
        snapshot.forEach(doc => {
          const sid = doc.id;
          const data = doc.data();
          const wrongQuestions = data.wrongQuestions || [];
          
          if (!studentScores[sid]) {
            studentScores[sid] = { totalScore: 0, attendedSessions: 0 };
          }
          
          // 실제 응시한 교시만 점수 추가
          const sessionMax = sessionMaxScores[session] || 80;
          const sessionScore = Math.max(0, sessionMax - wrongQuestions.length);
          studentScores[sid].totalScore += sessionScore;
          studentScores[sid].attendedSessions += 1;
        });
      } catch (error) {
        console.warn(`${session} 데이터 조회 실패:`, error);
      }
    }

    // 🎯 validOnly가 true면 완전 응시자만, false면 모든 응시자 포함
    const validScores = [];
    
    Object.entries(studentScores).forEach(([sid, data]) => {
      if (validOnly) {
        // 완전 응시자만 (4교시 모두 응시)
        if (data.attendedSessions === 4) {
          validScores.push(data.totalScore);
        }
      } else {
        // 모든 응시자 (1교시 이상 응시)
        if (data.attendedSessions > 0) {
          validScores.push(data.totalScore);
        }
      }
    });
    
    if (validScores.length === 0) {
      return { percentile: null, totalStudents: 0, rank: null };
    }

    // 내림차순 정렬
    validScores.sort((a, b) => b - a);
    
    // 본인보다 높은 점수 개수 계산
    const higherCount = validScores.filter(score => score > studentScore).length;
    
    // 상위 퍼센트 계산 (1등이 1%, 꼴등이 100%)
    const percentile = Math.ceil(((higherCount + 1) / validScores.length) * 100);
    
    return {
      percentile,
      totalStudents: validScores.length,
      rank: higherCount + 1
    };
    
  } catch (error) {
    console.error('상위 퍼센트 계산 오류:', error);
    return { percentile: null, totalStudents: 0, rank: null };
  }
}

// 🎯 응시자 분류 통계 계산 추가
export async function calculateAttendanceStats(roundLabel) {
  try {
    const sessions = ['1교시', '2교시', '3교시', '4교시'];
    const allStudents = new Set();
    const attendanceData = {}; // sid -> attendedSessions

    // 모든 교시 데이터 수집
    for (const session of sessions) {
      try {
        const sessionRef = collection(db, 'scores_raw', roundLabel, session);
        const snapshot = await getDocs(sessionRef);
        
        snapshot.forEach(doc => {
          const sid = doc.id;
          allStudents.add(sid);
          
          if (!attendanceData[sid]) {
            attendanceData[sid] = new Set(); // Set으로 중복 방지
          }
          attendanceData[sid].add(session); // 해당 교시 응시 표시
        });
      } catch (error) {
        console.warn(`${session} 데이터 조회 실패:`, error);
      }
    }

    // 🎯 정확한 분류 기준 적용
    let totalTargets = allStudents.size;
    let validAttendees = 0; // 4교시 모두 응시
    let absentees = 0; // 0교시 응시 
    let dropouts = 0; // 1~3교시 응시

    Array.from(allStudents).forEach(sid => {
      const attendedSessionsSet = attendanceData[sid] || new Set();
      const attendedCount = attendedSessionsSet.size;

      if (attendedCount === 0) {
        absentees++; // 미응시자
      } else if (attendedCount === 4) {
        validAttendees++; // 유효응시자
      } else {
        dropouts++; // 중도포기자 (1~3교시)
      }
    });

    return {
      totalTargets,
      validAttendees,
      absentees,
      dropouts
    };

  } catch (error) {
    console.error('응시자 분류 통계 계산 오류:', error);
    return {
      totalTargets: 0,
      validAttendees: 0,
      absentees: 0,
      dropouts: 0
    };
  }
}

// Firestore 데이터 읽기 - 🎯 수정된 점수 계산 로직 적용
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
    const sessionMaxScores = { '1교시': 80, '2교시': 100, '3교시': 80, '4교시': 80 };
    
    let attendedSessions = 0;
    let totalScore = 0; // 🎯 0점에서 시작
    
    for (const session of sessions) {
      try {
        const docRef = doc(db, "scores_raw", roundLabel, session, sid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          const wrong = data.wrongQuestions || data.wrong || [];
          
          if (Array.isArray(wrong)) {
            wrongBySession[session] = wrong.map(n => Number(n)).filter(n => !isNaN(n));
            attendedSessions++;
            
            // 🎯 응시한 교시만 점수 추가
            const sessionMax = sessionMaxScores[session] || 80;
            const sessionScore = Math.max(0, sessionMax - wrong.length);
            totalScore += sessionScore;
          }
        }
      } catch (error) {
        console.warn(`${session} 데이터 조회 실패:`, error);
      }
    }

    // 오답을 과목별 점수로 변환 (기존 로직 유지)
    if (Object.keys(wrongBySession).length > 0) {
      const result = convertWrongToScores(wrongBySession);
      
      // 🎯 수정된 점수와 추가 정보 반영
      result.totalScore = totalScore;
      result.attendedSessions = attendedSessions;
      
      // 🎯 완전 응시자만 합격 가능
      result.overallPass = attendedSessions === 4 && totalScore >= TOTAL_MAX * 0.6;
      result.meets60 = attendedSessions === 4 && totalScore >= TOTAL_MAX * 0.6;
      result.anyGroupFail = attendedSessions < 4;
      
      // 🎯 상위 퍼센트 계산 (완전 응시자만)
      const absence = detectStudentAbsenceStatus(wrongBySession);
      if (!absence.isNoAttendance && !absence.isPartiallyAbsent) {
        const rankData = await calculateRankPercentile(totalScore, roundLabel, true);
        result.percentile = rankData.percentile;
        result.rank = rankData.rank;
        result.totalStudents = rankData.totalStudents;
      }
      
      // 🎯 응시자 분류 통계 추가
      result.attendanceStats = await calculateAttendanceStats(roundLabel);
      
      return result;
    }

    return null;
  } catch (error) {
    console.error('데이터 fetch 오류:', error);
    return null;
  }
}

// 오답을 과목별 점수로 변환 (기존 함수 유지)
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

// 회차 자동 탐색 - 🎯 조건 완화 (미응시자/0점자도 포함)
export async function discoverRoundsFor(sid) {
  const found = [];
  
  for (const label of ROUND_LABELS) {
    const data = await fetchRoundData(sid, label);
    
    // 🎯 데이터가 있으면 점수 상관없이 모두 포함
    if (data) {
      found.push({ label, data });
    }
  }
  
  return found;
}

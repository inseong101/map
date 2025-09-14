// src/services/dataService.js
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// 과목별 최대 점수
export const SUBJECT_MAX = {
  "간":16, "심":16, "비":16, "폐":16, "신":16,
  "상한":16, "사상":16, "침구":48, "보건":20,
  "외과":16, "신경":16, "안이비":16, "부인과":32, 
  "소아":24, "예방":24, "생리":16, "본초":16
};

// 그룹 정의
export const GROUPS = [
  { id: "그룹1", label: "그룹 1", subjects: ["간","심","비","폐","신","상한","사상"]},
  { id: "그룹3", label: "그룹 3", subjects: ["침구"] },
  { id: "그룹2", label: "그룹 2", subjects: ["보건"] },
  { id: "그룹4", label: "그룹 4", subjects: ["외과","신경","안이비"] },
  { id: "그룹5", label: "그룹 5", subjects: ["부인과","소아"] },
  { id: "그룹6", label: "그룹 6", subjects: ["예방","생리","본초"] }
];

export const ALL_SUBJECTS = GROUPS.flatMap(g => g.subjects);
export const TOTAL_MAX = ALL_SUBJECTS.reduce((a,n) => a + (SUBJECT_MAX[n] || 0), 0);

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

// === 내부 상수 ===
const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

/**
 * 존재하는 회차 목록 (distributions 컬렉션 기준)
 */
export async function listAvailableRounds() {
  const colRef = collection(db, 'distributions');
  const snap = await getDocs(colRef);
  const rounds = [];
  snap.forEach(d => {
    const id = d.id; // "1차" 등
    if (id && /차$/.test(id)) rounds.push(id);
  });
  rounds.sort((a, b) => {
    const na = parseInt(String(a).replace(/\D/g, ''), 10);
    const nb = parseInt(String(b).replace(/\D/g, ''), 10);
    return na - nb;
  });
  return rounds;
}

/**
 * ✅ 세부데이터 가져오기
 * - 1) scores/{sid} 캐시 시도(권한 없으면 무시)
 * - 2) scores_raw/{round}/{session}/{sid}에서 오답 수집 → 과목/그룹 점수 계산
 */
export async function fetchRoundData(sid, roundLabel) {
  const sidStr = String(sid || '').trim();
  try {
    // (1) scores 캐시 읽기 — 실패(권한)해도 무시하고 계속
    try {
      const scoresRef = doc(db, "scores", sidStr);
      const scoresSnap = await getDoc(scoresRef);
      if (scoresSnap.exists()) {
        const data = scoresSnap.data();
        if (data.rounds && data.rounds[roundLabel]) {
          return data.rounds[roundLabel];
        }
      }
    } catch (_ignore) {
      // console.debug('scores 캐시 접근 불가(무시):', _ignore?.message);
    }

    // (2) scores_raw에서 오답 모으기
    const wrongBySession = {};
    for (const session of SESSIONS) {
      const docRef = doc(db, "scores_raw", roundLabel, session, sidStr);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const d = docSnap.data() || {};
        const wrong = d.wrongQuestions || d.wrong || [];
        if (Array.isArray(wrong) && wrong.length > 0) {
          wrongBySession[session] = wrong
            .map(n => Number(n))
            .filter(n => Number.isFinite(n));
        }
      }
    }

    if (Object.keys(wrongBySession).length > 0) {
      return convertWrongToScores(wrongBySession);
    }

    return null;
  } catch (error) {
    console.error('데이터 fetch 오류:', error);
    return null;
  }
}

// 오답을 과목별 점수로 변환
function convertWrongToScores(wrongBySession) {
  const subjectScores = {};
  ALL_SUBJECTS.forEach(subject => { subjectScores[subject] = SUBJECT_MAX[subject]; });

  Object.entries(wrongBySession).forEach(([session, wrongList]) => {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    wrongList.forEach(questionNum => {
      const range = ranges.find(r => questionNum >= r.from && questionNum <= r.to);
      if (range && range.s in subjectScores) {
        subjectScores[range.s] = Math.max(0, subjectScores[range.s] - 1);
      }
    });
  });

  const groupResults = GROUPS.map(group => {
    const groupScore = group.subjects.reduce((sum, s) => sum + (subjectScores[s] || 0), 0);
    const groupMax   = group.subjects.reduce((sum, s) => sum + (SUBJECT_MAX[s] || 0), 0);
    const cutoff     = Math.ceil(groupMax * 0.4);
    const pass       = groupScore >= cutoff;
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

  const totalScore    = ALL_SUBJECTS.reduce((sum, s) => sum + (subjectScores[s] || 0), 0);
  const overallCutoff = Math.ceil(TOTAL_MAX * 0.6);
  const meets60       = totalScore >= overallCutoff;
  const anyGroupFail  = groupResults.some(g => !g.pass);
  const overallPass   = meets60 && !anyGroupFail;

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

/**
 * ✅ 회차 자동 탐색
 * - distributions에서 실제 존재하는 회차만
 * - 4개 교시 중 하나라도 scores_raw 문서가 있으면 포함
 */
export async function discoverRoundsFor(sid) {
  const cleanSid = String(sid || '').trim();
  if (!/^\d{6}$/.test(cleanSid)) return [];

  const rounds = await listAvailableRounds();
  const found = [];

  for (const round of rounds) {
    let existsInAnySession = false;
    for (const session of SESSIONS) {
      const ref = doc(db, 'scores_raw', round, session, cleanSid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        existsInAnySession = true;
        break;
      }
    }
    if (existsInAnySession) {
      found.push({ label: round, data: { status: 'unknown' } });
    }
  }

  return found;
}

/* ===== 유틸 ===== */
export function getSubjectByQuestion(questionNum, session) {
  const ranges = SESSION_SUBJECT_RANGES[session] || [];
  for (const range of ranges) {
    if (questionNum >= range.from && questionNum <= range.to) return range.s;
  }
  return null;
}
export function findSubjectByQuestionNum(questionNum) {
  for (const session of Object.keys(SESSION_SUBJECT_RANGES)) {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) return range.s;
    }
  }
  return null;
}
export function findSessionByQuestionNum(questionNum) {
  for (const [session, ranges] of Object.entries(SESSION_SUBJECT_RANGES)) {
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) return session;
    }
  }
  return null;
}

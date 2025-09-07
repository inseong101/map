// src/components/StudentCard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { TOTAL_MAX } from '../services/dataService';
import TrendChart from './TrendChart';

// Firestore
import { getFirestore, collection, getDocs, getDoc, doc } from 'firebase/firestore';

// helpers: 학수번호 유효성 검사 (이미 helpers.js에 추가했다 했으니 가져다 씀)
import { isValidSid } from '../utils/helpers';

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

// (참고) 상위 요약/분포용 백분위(내림차순 정의)
function calcPercentileDesc(scores, myScore) {
  if (!Array.isArray(scores) || scores.length === 0 || myScore == null) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  const n = sorted.length;
  if (n === 1) return 0.0;
  let idx = sorted.findIndex(s => s <= myScore);
  if (idx < 0) idx = n - 1;
  const p = (idx / (n - 1)) * 100;
  return Math.max(0, Math.min(100, +p.toFixed(1)));
}

// 라운드별 전체 통계(참여/유효/백분위 계산용). 학수번호 필터/explicit 상태 반영은
// helpers 쪽에서 이미 정리 중이지만, 여기선 기존 로직 유지.
async function buildRoundStats(roundLabel) {
  const db = getFirestore();
  const map = new Map();

  for (const session of SESSIONS) {
    const snap = await getDocs(collection(db, 'scores_raw', roundLabel, session));
    snap.forEach(docu => {
      const sid = docu.id;
      const d = docu.data() || {};
      if (!map.has(sid)) {
        map.set(sid, { completed: new Set(), totalScoreSum: 0, sawAny: false });
      }
      const rec = map.get(sid);
      rec.sawAny = true;

      if (d.status === 'completed') {
        rec.completed.add(session);
        const ts = Number(d.totalScore);
        rec.totalScoreSum += Number.isFinite(ts) ? ts : 0;
      }
    });
  }

  let totalStudents = 0;
  let eligible = 0;
  let absent = 0;
  let dropout = 0;
  const eligibleScores = [];

  map.forEach((rec) => {
    totalStudents += 1;
    const c = rec.completed.size;
    if (c === 0) {
      absent += 1;
    } else if (c < 4) {
      dropout += 1;
    } else {
      eligible += 1;
      eligibleScores.push(rec.totalScoreSum);
    }
  });

  return {
    totalStudents,
    eligible,
    absent,
    dropout,
    eligibleScores
  };
}

// === 추가: 내 회차 상태를 Firestore에서 직접 판정 ===
// 반환: 'completed' | 'absent' | 'dropout' | 'invalid'
async function fetchMyRoundStatus(db, roundLabel, sid) {
  if (!isValidSid(sid)) return 'invalid';

  let seen = 0;
  let completed = 0;
  let hasAbsent = false;
  let hasDropout = false;

  for (const s of SESSIONS) {
    const ref = doc(db, 'scores_raw', roundLabel, s, sid);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;

    seen += 1;
    const st = (snap.data() || {}).status;
    if (st === 'completed') completed += 1;
    else if (st === 'absent') hasAbsent = true;
    else if (st === 'dropout' || st === 'dropped') hasDropout = true;
  }

  if (seen === 0) return 'absent';           // 문서 자체가 하나도 없음 = 미응시
  if (hasDropout) return 'dropout';          // 중도포기 신호 우선
  if (hasAbsent) return 'absent';            // absent가 하나라도 있으면 absent
  if (completed === 4) return 'completed';   // 4교시 모두 완료
  return 'dropout';                          // 일부만 있음 = 불완료 → dropout 처리
}

function StudentCard({ sid, school, rounds }) {
  const [roundSummaries, setRoundSummaries] = useState({});
  const [myStatusByLabel, setMyStatusByLabel] = useState({});
  const labels = useMemo(() => (rounds || []).map(r => r.label), [rounds]);

  // 라운드별 전반 통계(상단 요약/백분위 계산용)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Array.isArray(rounds) || rounds.length === 0) {
        setRoundSummaries({});
        return;
      }
      const out = {};
      for (const { label, data } of rounds) {
        try {
          const stats = await buildRoundStats(label);
          const myTotal = Number(data?.totalScore);
          const percentile = Number.isFinite(myTotal)
            ? calcPercentileDesc(stats.eligibleScores, myTotal)
            : null;
          out[label] = { ...stats, percentile };
        } catch (e) {
          console.error('라운드 통계 수집 실패:', label, e);
          out[label] = { totalStudents: 0, eligible: 0, absent: 0, dropout: 0, percentile: null };
        }
      }
      if (!cancelled) setRoundSummaries(out);
    })();
    return () => { cancelled = true; };
  }, [sid, rounds]);

  // === 추가: 내 상태 라벨별 조회 ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getFirestore();
      const map = {};
      for (const { label } of (rounds || [])) {
        try {
          map[label] = await fetchMyRoundStatus(db, label, sid);
        } catch (e) {
          console.error('내 상태 조회 실패:', label, e);
          map[label] = 'absent'; // 실패 시 최소 absent로 표시
        }
      }
      if (!cancelled) setMyStatusByLabel(map);
    })();
    return () => { cancelled = true; };
  }, [sid, rounds]);

  // 상단 배지 (합격/불합격/무효)
  const renderBadges = () => {
    return (rounds || []).map(({ label, data }) => {
      // Firestore에서 판정된 내 상태를 최우선 사용
      const status = myStatusByLabel[label] ?? data?.status ?? 'absent';
      const isInvalid = ['absent', 'dropout', 'dropped', 'invalid'].includes(status);

      const score = Number(data?.totalScore);
      const max = Number(data?.totalMax) || TOTAL_MAX;

      // 합/불은 completed + 유효 점수일 때만
      const passOverall = !isInvalid && Number.isFinite(score) && score >= max * 0.6;

      const badgeClass = isInvalid
        ? 'badge invalid'
        : (passOverall ? 'badge pass' : 'badge fail');

      const badgeText = isInvalid
        ? '무효'
        : (passOverall ? '합격' : '불합격');

      const title = isInvalid
        ? (
            status === 'invalid' ? '학수번호 형식 위반 (01~12로 시작하는 6자리만 유효)'
            : status === 'absent' ? '미응시 (분포/백분위 제외)'
            : '중도포기 (분포/백분위 제외)'
          )
        : `총점 ${Number.isFinite(score) ? score : '-'}점`;

      return (
        <span key={label} className={badgeClass} title={title}>
          {label} {badgeText}
        </span>
      );
    });
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="small">학수번호</div>
          <div className="kpi">
            <div className="num">{sid}</div>
          </div>
          <div className="small">{school}</div>
        </div>
        <div className="flex" style={{ gap: '8px', flexWrap: 'wrap' }}>
          {renderBadges()}
        </div>
      </div>

      <hr className="sep" />

      {/* 요약 블록 제거됨 */}

      <div>
        <TrendChart rounds={rounds} school={school} />
        <div className="small" style={{ marginTop: '8px', opacity: 0.8 }} />
      </div>
    </div>
  );
}

export default StudentCard;

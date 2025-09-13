// src/components/StudentCard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { TOTAL_MAX } from '../services/dataService';
import TrendChart from './TrendChart';

// helpers
import { isValidSid, getPrebinnedDistribution, calcPercentileFromBins } from '../utils/helpers';

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

// 라운드별 전체 통계(참여/유효/백분위 계산용) — ✅ prebinned 기반
async function buildRoundStats(roundLabel, schoolCode = null) {
  const preb = await getPrebinnedDistribution(roundLabel);
  const d = preb?.data || {};
  const bins = schoolCode
    ? (d?.bySchool?.[schoolCode] || [])
    : (d?.national || []);

  const total = bins.reduce((s, b) => s + (b?.count || 0), 0);

  return {
    totalStudents: total,
    eligible: total,
    absent: 0,
    dropout: 0,
    eligibleScores: [], // 이제는 안 씀
    bins
  };
}

// === 내 회차 상태 (Firestore 직접 접근) ===
import { getFirestore, getDoc, doc } from 'firebase/firestore';
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

  if (seen === 0) return 'absent';
  if (hasDropout) return 'dropout';
  if (hasAbsent) return 'absent';
  if (completed === 4) return 'completed';
  return 'dropout';
}

function StudentCard({ sid, school, rounds }) {
  const [roundSummaries, setRoundSummaries] = useState({});
  const [myStatusByLabel, setMyStatusByLabel] = useState({});
  const labels = useMemo(() => (rounds || []).map(r => r.label), [rounds]);

  // 라운드별 전반 통계(상단 요약/백분위 계산용) → prebinned 기반
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
            ? calcPercentileFromBins(stats.bins, myTotal)
            : null;
          out[label] = { ...stats, percentile };
        } catch (e) {
          console.error('라운드 통계 수집 실패:', label, e);
          out[label] = { totalStudents: 0, eligible: 0, absent: 0, dropout: 0, percentile: null, bins: [] };
        }
      }
      if (!cancelled) setRoundSummaries(out);
    })();
    return () => { cancelled = true; };
  }, [sid, rounds]);

  // === 내 상태 라벨별 조회 ===
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
          map[label] = 'absent';
        }
      }
      if (!cancelled) setMyStatusByLabel(map);
    })();
    return () => { cancelled = true; };
  }, [sid, rounds]);

  // 상단 배지 (합격/불합격/무효)
  const renderBadges = () => {
    return (rounds || []).map(({ label, data }) => {
      const status = myStatusByLabel[label] ?? data?.status ?? 'absent';
      const isInvalid = ['absent', 'dropout', 'dropped', 'invalid'].includes(status);

      const score = Number(data?.totalScore);
      const max = Number(data?.totalMax) || TOTAL_MAX;

      const passOverall = !isInvalid && Number.isFinite(score) && score >= max * 0.6;

      const badgeClass = isInvalid
        ? 'badge invalid'
        : (passOverall ? 'badge pass' : 'badge fail');

      const badgeText = isInvalid
        ? '무효'
        : (passOverall ? '합격' : '불합격');

      const title = isInvalid
        ? (
            status === 'invalid' ? '학수번호 형식 위반'
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

      <div>
        <TrendChart rounds={rounds} school={school} />
        <div className="small" style={{ marginTop: '8px', opacity: 0.8 }} />
      </div>
    </div>
  );
}

export default StudentCard;

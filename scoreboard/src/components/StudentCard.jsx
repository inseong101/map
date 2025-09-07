// src/components/StudentCard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { TOTAL_MAX } from '../services/dataService';
import TrendChart from './TrendChart';

// Firestore
import { getFirestore, collection, getDocs } from 'firebase/firestore';

// 내부 상수
const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

/** 상위 백분위 (0% = 1등, 100% = 꼴등)
 * - scores: 내림차순 정렬 기준
 * - 동일 점수 다수 존재 시, "내 점수 이하 최초 index"를 순위로 사용
 * - N=1인 경우 0.0%
 */
function calcPercentileDesc(scores, myScore) {
  if (!Array.isArray(scores) || scores.length === 0 || myScore == null) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  const n = sorted.length;
  if (n === 1) return 0.0;

  let idx = sorted.findIndex(s => s <= myScore);
  if (idx < 0) idx = n - 1; // 매우 낮은 점수(이상 케이스) 방어

  const p = (idx / (n - 1)) * 100;
  // 0.0~100.0에 고정, 소수점 한 자리
  return Math.max(0, Math.min(100, +p.toFixed(1)));
}

/** 라운드별 통계(클라이언트에서 계산)
 * - roundLabel 전체 학생 수/상태 카운트
 * - eligibleScores: 4교시 모두 completed인 학생들의 총점 배열
 * - myTotal: 해당 학생의 교시 합계(부모(App.jsx)에서 보정되어 전달된 data.totalScore 우선)
 */
async function buildRoundStats(roundLabel) {
  const db = getFirestore();
  // sid별 집계
  const map = new Map(); // sid -> { completed: Set(session), totalScoreSum: number, sawAny: boolean }

  for (const session of SESSIONS) {
    const snap = await getDocs(collection(db, 'scores_raw', roundLabel, session));
    snap.forEach(doc => {
      const sid = doc.id;
      const d = doc.data() || {};
      if (!map.has(sid)) {
        map.set(sid, { completed: new Set(), totalScoreSum: 0, sawAny: false });
      }
      const rec = map.get(sid);
      rec.sawAny = true;

      // completed만 점수 반영
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

function StudentCard({ sid, school, rounds }) {
  // round label -> { totalStudents, eligible, absent, dropout, percentile }
  const [roundSummaries, setRoundSummaries] = useState({}); 

  // 라운드 레이블 목록 (메모)
  const labels = useMemo(() => (rounds || []).map(r => r.label), [rounds]);

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
          // 내 총점: 부모(App.jsx)에서 Firestore 집계로 보정해준 totalScore가 있다면 그걸 신뢰
          const myTotal = Number(data?.totalScore);
          const percentile = Number.isFinite(myTotal)
            ? calcPercentileDesc(stats.eligibleScores, myTotal)
            : null;

          out[label] = {
            ...stats,
            percentile
          };
        } catch (e) {
          console.error('라운드 통계 수집 실패:', label, e);
          out[label] = {
            totalStudents: 0,
            eligible: 0,
            absent: 0,
            dropout: 0,
            percentile: null
          };
        }
      }

      if (!cancelled) setRoundSummaries(out);
    })();

    return () => { cancelled = true; };
  }, [sid, rounds]);

  // 상단 배지 (합격/불합격)
  const renderBadges = () => {
    return rounds.map(({ label, data }) => {
      const score = Number(data?.totalScore) || 0;
      const passOverall = score >= TOTAL_MAX * 0.6;
      const badgeClass = passOverall ? 'badge pass' : 'badge fail';
      const badgeText = passOverall ? '합격' : '불합격';
      
      return (
        <span key={label} className={badgeClass}>
          {label} {badgeText}
        </span>
      );
    });
  };

  // 회차별 “본인 점수 (전국 상위 x.x%) / 전체/유효/미응/중도”
  const renderRoundSummaries = () => {
    return rounds.map(({ label, data }) => {
      const score = Number(data?.totalScore);
      const rs = roundSummaries[label] || {};
      const {
        totalStudents = 0,
        eligible = 0,
        absent = 0,
        dropout = 0,
        percentile = null
      } = rs;

      const scoreTxt = Number.isFinite(score) ? `${score}점` : '표시 안함';
      const pctTxt = Number.isFinite(percentile) ? ` (전국 상위 ${percentile}%)` : '';

      return (
        <div
          key={`sum-${label}`}
          className="small"
          style={{
            marginTop: 6,
            padding: '6px 8px',
            borderRadius: 8,
            background: 'rgba(21,29,54,0.35)',
            border: '1px solid var(--line)'
          }}
        >
          <strong>{label}</strong> — 본인 점수: <span style={{ color: '#ef4444', fontWeight: 700 }}>{scoreTxt}</span>
          {pctTxt}
          {'  '}
          <span style={{ opacity: 0.9, marginLeft: 4 }}>
            전체응시자: {totalStudents} · 유효응시자: {eligible} · 미응시자: {absent} · 중도포기자: {dropout}
          </span>
        </div>
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
        {/* TrendChart는 그대로 사용 (전국/학교 토글 포함 버전) */}
        <TrendChart rounds={rounds} school={school} />
        <div className="small" style={{ marginTop: '8px', opacity: 0.8 }}>
        </div>
      </div>
    </div>
  );
}

export default StudentCard;

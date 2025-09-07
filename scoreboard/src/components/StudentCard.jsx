// src/components/StudentCard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { TOTAL_MAX } from '../services/dataService';
import TrendChart from './TrendChart';

// Firestore
import { getFirestore, collection, getDocs } from 'firebase/firestore';

// 내부 상수
const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

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

async function buildRoundStats(roundLabel) {
  const db = getFirestore();
  const map = new Map();

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
  const [roundSummaries, setRoundSummaries] = useState({}); 
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

  const renderBadges = () => {
    return rounds.map(({ label, data }) => {
      const status = data?.status;
      const score = Number(data?.totalScore) || 0;

      let badgeClass = '';
      let badgeText = '';

      if (status === 'absent' || status === 'dropout') {
        badgeClass = 'badge invalid';
        badgeText = '무효';
      } else {
        const passOverall = score >= TOTAL_MAX * 0.6;
        badgeClass = passOverall ? 'badge pass' : 'badge fail';
        badgeText = passOverall ? '합격' : '불합격';
      }

      return (
        <span key={label} className={badgeClass}>
          {label} {badgeText}
        </span>
      );
    });
  };

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
            border: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12
          }}
        >
          {/* 좌측 */}
          <div>
            <strong>{label}</strong> — 본인 점수:{' '}
            <span style={{ color: '#ef4444', fontWeight: 700 }}>{scoreTxt}</span>
            {pctTxt}
            <div style={{ marginTop: 4 }}>전체응시자: {totalStudents}명</div>
          </div>

          {/* 우측 */}
          <div style={{ textAlign: 'right' }}>
            <div>유효응시자: {eligible}</div>
            <div>
              무효응시자: {absent + dropout} (미응시자: {absent} · 중도포기: {dropout})
            </div>
          </div>
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

      {/* 새 레이아웃 반영 */}
      <div style={{ marginBottom: 8 }}>
        {renderRoundSummaries()}
      </div>

      <div>
        <TrendChart rounds={rounds} school={school} />
        <div className="small" style={{ marginTop: '8px', opacity: 0.8 }}></div>
      </div>
    </div>
  );
}

export default StudentCard;

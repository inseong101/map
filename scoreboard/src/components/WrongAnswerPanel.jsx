// src/components/WrongAnswerPanel.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { SESSION_SUBJECT_RANGES } from '../services/dataService';
import './WrongPanel.css';

// 교시별 문항 수
const SESSION_LENGTH = {
  '1교시': 80,
  '2교시': 100,
  '3교시': 80,
  '4교시': 80,
};

function WrongAnswerPanel({ roundLabel, data }) {
  const [open, setOpen] = useState({
    '1교시': true,
    '2교시': true,
    '3교시': true,
    '4교시': true,
  });

  // 내 오답(교시별 Set)
  const wrongBySession = useMemo(() => {
    const out = { '1교시': new Set(), '2교시': new Set(), '3교시': new Set(), '4교시': new Set() };
    if (data?.wrongBySession) {
      for (const [sess, arr] of Object.entries(data.wrongBySession)) {
        if (Array.isArray(arr)) arr.forEach(n => out[sess]?.add(Number(n)));
      }
    }
    return out;
  }, [data]);

  // 정답률 맵(문항번호 → 정답률%)
  const [correctRateMap, setCorrectRateMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const db = getFirestore();
        const sessions = ['1교시', '2교시', '3교시', '4교시'];
        const rateMap = {};

        // 각 교시 analytics 로드해서 questionStats.correctRate 수집
        for (const sess of sessions) {
          const ref = doc(db, 'analytics', `${roundLabel}_${sess}`);
          const snap = await getDoc(ref);
          if (!snap.exists()) continue;
          const a = snap.data() || {};
          const qs = a.questionStats || {};
          Object.entries(qs).forEach(([k, st]) => {
            const q = parseInt(k, 10);
            if (Number.isFinite(q) && typeof st?.correctRate === 'number') {
              rateMap[q] = Math.round(st.correctRate);
            }
          });
        }

        if (!cancelled) setCorrectRateMap(rateMap);
      } catch (e) {
        console.error('WrongAnswerPanel: 정답률 로드 실패', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [roundLabel]);

  const toggle = (sess) => setOpen(prev => ({ ...prev, [sess]: !prev[sess] }));

  const QButton = ({ session, idx }) => {
    const qNum = idx; // 1-based
    const isWrong = wrongBySession[session]?.has(qNum);
    const rate = correctRateMap[qNum];
    const title = Number.isFinite(rate) ? `문항 ${qNum} · 정답률 ${rate}%` : `문항 ${qNum}`;

    return (
      <button
        type="button"
        className={`qbtn${isWrong ? ' red' : ''}`}
        title={title}
        aria-label={title}
      >
        {qNum}
      </button>
    );
  };

  const renderSession = (session) => {
    const total = SESSION_LENGTH[session] || 80;
    return (
      <div className="session" key={session}>
        <button
          type="button"
          className={`session-head ${open[session] ? 'open' : ''}`}
          onClick={() => toggle(session)}
          aria-expanded={open[session]}
        >
          <span>{session}</span>
          <span className="arrow">❯</span>
        </button>

        <div
          className="panel"
          style={{
            maxHeight: open[session] ? 'none' : 0,
            padding: open[session] ? '10px 0 4px' : 0,
            overflow: open[session] ? 'visible' : 'hidden',
          }}
        >
          <div className="grid">
            {Array.from({ length: total }, (_, i) => (
              <QButton key={i + 1} session={session} idx={i + 1} />
            ))}
          </div>
          {loading && (
            <div className="loading">정답률 불러오는 중…</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 보기</h2>
      <div className="small" style={{ opacity: .85, marginBottom: 6 }}>
        색상: <b style={{color:'#ffd8d8'}}>빨강</b>=내 오답, 회색=정답(또는 데이터 없음). (정답률은 버튼 툴팁에서 확인)
      </div>

      <div className="accordion">
        {['1교시', '2교시', '3교시', '4교시'].map(renderSession)}
      </div>

      {/* 전용 스타일 */}
      <style jsx>{`
        .accordion { display: flex; flex-direction: column; gap: 10px; }
        .session { border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }

        .session-head {
          width: 100%;
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 12px;
          background: linear-gradient(90deg, var(--primary), #4cc9ff);
          color: #fff; border: none; border-radius: 12px 12px 0 0; cursor: pointer;
          font-weight: 800; letter-spacing: .2px;
        }
        .session-head .arrow { transition: transform .25s ease; }
        .session-head.open .arrow { transform: rotate(90deg); }

        .panel { transition: all .25s ease; border-top: 1px solid var(--line); }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
          gap: 6px;
          padding: 8px 10px 12px;
        }

        /* 기본(무채색) 버튼 */
        .qbtn {
          appearance: none;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.02);
          color: var(--ink);
          border-radius: 8px;
          padding: 8px 0;
          font-weight: 800;
          font-size: 13px;
          cursor: default;
        }
        /* 내 오답 = 빨강 */
        .qbtn.red {
          background: rgba(239,68,68,.16);
          border-color: rgba(239,68,68,.45);
          color: #ffd8d8;
        }

        .loading {
          padding: 8px 12px;
          color: var(--muted);
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}

export default WrongAnswerPanel;

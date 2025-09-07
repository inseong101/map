// src/components/WrongAnswerPanel.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import './WrongPanel.css';

// 교시별 문항 수
const SESSION_LENGTH = {
  '1교시': 80,
  '2교시': 100,
  '3교시': 80,
  '4교시': 80,
};

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

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
        if (Array.isArray(arr)) arr.forEach((n) => out[sess]?.add(Number(n)));
      }
    }
    return out;
  }, [data]);

  // 정답률 맵(교시별: 문항번호 → 정답률%)
  const [correctRateMap, setCorrectRateMap] = useState({
    '1교시': {},
    '2교시': {},
    '3교시': {},
    '4교시': {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const db = getFirestore();
        const rateMap = { '1교시': {}, '2교시': {}, '3교시': {}, '4교시': {} };

        for (const sess of SESSIONS) {
          const ref = doc(db, 'analytics', `${roundLabel}_${sess}`);
          const snap = await getDoc(ref);
          if (!snap.exists()) continue;
          const a = snap.data() || {};
          const qs = a.questionStats || {};
          Object.entries(qs).forEach(([k, st]) => {
            const q = parseInt(k, 10);
            if (Number.isFinite(q) && typeof st?.correctRate === 'number') {
              rateMap[sess][q] = Math.round(st.correctRate);
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
    return () => {
      cancelled = true;
    };
  }, [roundLabel]);

  const toggle = (sess) => setOpen((prev) => ({ ...prev, [sess]: !prev[sess] }));

  const QButton = ({ session, idx }) => {
    const qNum = idx; // 1-based
    const isWrong = wrongBySession[session]?.has(qNum);
    const rate = correctRateMap?.[session]?.[qNum];
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

  // ====== 접힘이 확실히 되도록: 패널 실제 높이를 측정해서 max-height에 px로 반영 ======
  const panelRefs = useRef({
    '1교시': null,
    '2교시': null,
    '3교시': null,
    '4교시': null,
  });
  const [panelHeights, setPanelHeights] = useState({
    '1교시': 0,
    '2교시': 0,
    '3교시': 0,
    '4교시': 0,
  });

  const measureHeights = useCallback(() => {
    const next = { ...panelHeights };
    for (const sess of SESSIONS) {
      const el = panelRefs.current[sess];
      if (el) {
        // 패널 내부 실제 내용 높이 측정
        next[sess] = el.scrollHeight;
      }
    }
    setPanelHeights(next);
  }, [panelHeights]);

  // 콘텐츠가 바뀌거나(로딩 종료), 열림/닫힘이 바뀌거나, 리사이즈 시 재계산
  useEffect(() => {
    // 처음 렌더 직후 한 번
    requestAnimationFrame(measureHeights);
    const onResize = () => measureHeights();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    requestAnimationFrame(measureHeights);
  }, [loading, open, measureHeights]);

  const renderSession = (session) => {
    const total = SESSION_LENGTH[session] || 80;
    const isOpen = open[session];

    return (
      <div className="session" key={session}>
        <button
          type="button"
          className={`session-head ${isOpen ? 'open' : ''}`}
          onClick={() => toggle(session)}
          aria-expanded={isOpen}
        >
          <span>{session}</span>
          <span className="arrow">❯</span>
        </button>

        {/* 측정 대상: 패널의 "내용 래퍼"를 따로 두면 더 정확하지만,
            현 구조에서도 패널 자체 scrollHeight 측정으로 충분합니다. */}
        <div
          className="panel"
          ref={(el) => (panelRefs.current[session] = el)}
          style={{
            maxHeight: isOpen ? `${panelHeights[session]}px` : '0px',
            padding: isOpen ? '10px 0 4px' : '0px',
            overflow: 'hidden',
          }}
        >
          <div className="grid">
            {Array.from({ length: total }, (_, i) => (
              <QButton key={i + 1} session={session} idx={i + 1} />
            ))}
          </div>
          {loading && <div className="loading">정답률 불러오는 중…</div>}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 보기</h2>
      <div className="small" style={{ opacity: 0.85, marginBottom: 6 }}>
        색상: <b style={{ color: '#ffd8d8' }}>빨강</b>=내 오답, 회색=정답(또는 데이터 없음). (정답률은 버튼 툴팁에서 확인)
      </div>

      <div className="accordion">
        {SESSIONS.map(renderSession)}
      </div>
    </div>
  );
}

export default WrongAnswerPanel;

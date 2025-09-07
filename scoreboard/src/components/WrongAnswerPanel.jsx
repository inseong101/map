// src/components/WrongAnswerPanel.jsx
import React, { useMemo, useState } from 'react';
import './WrongPanel.css';

// 교시별 문항 수
const SESSION_LENGTH = {
  '1교시': 80,
  '2교시': 100,
  '3교시': 80,
  '4교시': 80,
};

function WrongAnswerPanel({ roundLabel, data }) {
  // ✅ 항상 하나만 열려 있도록: 기본은 1교시
  const [openSession, setOpenSession] = useState('1교시');

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

  // 🔥 특별 해설 제공(불타는) 문항 세트
  // - 백엔드 필드명 여러 가지 지원: fireBySession / featuredBySession / hotBySession / specialBySession
  const fireBySession = useMemo(() => {
    const out = { '1교시': new Set(), '2교시': new Set(), '3교시': new Set(), '4교시': new Set() };
    const source =
      data?.fireBySession ||
      data?.featuredBySession ||
      data?.hotBySession ||
      data?.specialBySession ||
      {};

    for (const [sess, arr] of Object.entries(source)) {
      if (Array.isArray(arr)) arr.forEach(n => out[sess]?.add(Number(n)));
    }
    return out;
  }, [data]);

  const handleToggle = (sess) => {
    if (openSession !== sess) setOpenSession(sess);
  };

  const renderSession = (session) => {
    const total = SESSION_LENGTH[session] || 80;
    const isOpen = openSession === session;

    return (
      <div className="session" key={session}>
        <button
          type="button"
          className={`session-head ${isOpen ? 'open' : ''}`}
          onClick={() => handleToggle(session)}
          aria-expanded={isOpen}
          aria-controls={`panel-${session}`}
        >
          <span>{session}</span>
          <span className="arrow">❯</span>
        </button>

        {isOpen && (
          <div
            id={`panel-${session}`}
            className="panel"
            aria-hidden={!isOpen}
          >
            <div className="grid">
              {Array.from({ length: total }, (_, i) => {
                const qNum = i + 1;
                const isWrong = wrongBySession[session]?.has(qNum);
                const isFire = fireBySession[session]?.has(qNum);
                const cls = `qbtn${isWrong ? ' red' : ''}${isFire ? ' fire' : ''}`;
                const label = `문항 ${qNum}${isWrong ? ' (내 오답)' : ''}${isFire ? ' · 특별 해설 제공' : ''}`;

                return (
                  <button
                    key={qNum}
                    type="button"
                    className={cls}
                    title={label}
                    aria-label={label}
                  >
                    {qNum}
                    {isFire && <span className="flame-emoji" aria-hidden>🔥</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 보기</h2>
      <div className="small" style={{ opacity: .85, marginBottom: 6 }}>
        색상: <b style={{color:'#ffd8d8'}}>빨강</b>=내 오답, 회색=정답(또는 데이터 없음), <b>🔥</b>=특별 해설 제공
      </div>

      <div className="accordion">
        {['1교시', '2교시', '3교시', '4교시'].map(renderSession)}
      </div>
    </div>
  );
}

export default WrongAnswerPanel;

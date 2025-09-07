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

  const handleToggle = (sess) => {
    // 항상 하나만 열려 있게: 클릭한 걸로 고정(같은 걸 다시 눌러도 유지)
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
                return (
                  <button
                    key={qNum}
                    type="button"
                    className={`qbtn${isWrong ? ' red' : ''}`}
                  >
                    {qNum}
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
        색상: <b style={{color:'#ffd8d8'}}>빨강</b>=내 오답, 회색=정답(또는 데이터 없음)
      </div>

      <div className="accordion">
        {['1교시', '2교시', '3교시', '4교시'].map(renderSession)}
      </div>
    </div>
  );
}

export default WrongAnswerPanel;

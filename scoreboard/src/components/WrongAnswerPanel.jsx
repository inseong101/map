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
  // 접힘 상태 (초기: 모두 펼침)
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

  const toggle = (sess) => setOpen(prev => ({ ...prev, [sess]: !prev[sess] }));

  const renderSession = (session) => {
    const total = SESSION_LENGTH[session] || 80;

    return (
      <div className="session" key={session}>
        <button
          type="button"
          className={`session-head ${open[session] ? 'open' : ''}`}
          onClick={() => toggle(session)}
          aria-expanded={open[session]}
          aria-controls={`panel-${session}`}
        >
          <span>{session}</span>
          <span className="arrow">❯</span>
        </button>

        {/* 닫힐 때는 아예 렌더 제거 → 확실한 “접힘” */}
        {open[session] && (
          <div
            id={`panel-${session}`}
            className="panel"
            aria-hidden={!open[session]}
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

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
  // 현재 선택된 교시 (기본값: 1교시)
  const [activeSession, setActiveSession] = useState('1교시');

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

  // 교시별 버튼 그리드
  const renderButtons = (session) => {
    const total = SESSION_LENGTH[session] || 80;
    return (
      <div className="grid no-scroll">
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
    );
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 보기</h2>

      {/* 설명 */}
      <div className="small" style={{ opacity: .85, marginBottom: 8 }}>
        색상: <b style={{color:'#ffd8d8'}}>빨강</b>=내 오답, 회색=정답(또는 데이터 없음)
      </div>

      {/* 상단 탭 버튼 */}
      <div className="session-tabs">
        {['1교시','2교시','3교시','4교시'].map(sess => (
          <button
            key={sess}
            className={`tab-btn ${activeSession === sess ? 'active' : ''}`}
            onClick={() => setActiveSession(sess)}
          >
            {sess}
          </button>
        ))}
      </div>

      {/* 선택된 교시의 버튼들 */}
      <div className="session-panel">
        {renderButtons(activeSession)}
      </div>
    </div>
  );
}

export default WrongAnswerPanel;

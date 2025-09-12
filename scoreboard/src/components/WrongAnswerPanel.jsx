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
  // ✅ 상단 탭으로 하나만 표시: 기본 1교시
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

  // 🔥 특별 해설 제공 문항(교시별 Set) — 다양한 키명을 지원
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

  const renderButtons = (session) => {
    const total = SESSION_LENGTH[session] || 80;
    return (
      <div className="btn-grid">
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
    );
  };

  return (
    <div className="wrong-panel-root">
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 보기</h2>

      {/* 설명 줄 — 실제 🔥 예시 버튼 포함 */}
      <div className="legend-line">
        <span>
          색상: <b className="legend-red">빨강</b>=내 오답, 회색=정답(또는 데이터 없음),{' '}
        </span>
        <span className="legend-example">
          <button
            type="button"
            className="qbtn fire"
            aria-label="특별 해설 제공 예시"
          >
            예시<span className="flame-emoji" aria-hidden>🔥</span>
          </button>
          = 특별 해설 제공
        </span>
      </div>

      {/* 상단 탭 */}
      <div className="session-tabs" role="tablist" aria-label="교시 선택">
        {['1교시', '2교시', '3교시', '4교시'].map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={activeSession === s}
            className={`tab-btn ${activeSession === s ? 'active' : ''}`}
            onClick={() => setActiveSession(s)}
            type="button"
          >
            {s}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 — 내부 스크롤 없음 */}
      <div className="tab-content" role="tabpanel" aria-label={`${activeSession} 문항`}>
        {renderButtons(activeSession)}
      </div>
    </div>
  );
}

export default WrongAnswerPanel;

// src/components/WrongPanel.jsx
import React, { useMemo } from 'react';
import './WrongPanel.css';

const SESSION_COUNTS = { '1교시': 80, '2교시': 100, '3교시': 80, '4교시': 80 };

function WrongPanel({ data, wrongRates }) {
  // wrongRates: { '1교시': {문항번호: 오답률}, ... }
  // data.wrongBySession: { '1교시': [내가 틀린 번호들], ... }

  const { wrongBySession = {} } = data || {};

  // 교시별 Top10 오답률 번호 구하기
  const topWrongBySession = useMemo(() => {
    const result = {};
    for (const [session, rates] of Object.entries(wrongRates || {})) {
      const top = Object.entries(rates)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([num]) => Number(num));
      result[session] = new Set(top);
    }
    return result;
  }, [wrongRates]);

  const renderSession = (session, count) => {
    const myWrongs = new Set(wrongBySession[session] || []);
    const topWrongs = topWrongBySession[session] || new Set();

    return (
      <div key={session} className="session-block">
        <h3>{session}</h3>
        <div className="grid">
          {Array.from({ length: count }, (_, i) => {
            const qnum = i + 1;
            const isWrong = myWrongs.has(qnum);
            const isTop = topWrongs.has(qnum);

            let className = 'btn-q';
            if (isWrong && isTop) className += ' half';
            else if (isWrong) className += ' wrong';
            else if (isTop) className += ' top';

            return (
              <button key={qnum} className={className}>
                {qnum}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2>오답 패널</h2>
      {Object.entries(SESSION_COUNTS).map(([session, count]) =>
        renderSession(session, count)
      )}
    </div>
  );
}

export default WrongPanel;

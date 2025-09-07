// src/components/RoundCard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { fmt, pct, pill, chunk } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';

function RoundCard({ label, data, sid }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const flipCardRef = useRef(null);
  const frontRef = useRef(null);

  const {
    totalScore = 0,
    totalMax = 340,
    overallPass = false,
    meets60 = false,
    anyGroupFail = false,
    groupResults,
    subjectScores = {},
    status
  } = data || {};

  const overallRate = totalMax > 0 ? pct(totalScore, totalMax) : 0;

  useEffect(() => {
    const syncHeight = () => {
      if (flipCardRef.current && frontRef.current) {
        const frontHeight = frontRef.current.offsetHeight;
        flipCardRef.current.style.setProperty('--front-height', `${frontHeight}px`);
        flipCardRef.current.classList.add('height-synced');
      }
    };
    const timer = setTimeout(syncHeight, 100);
    window.addEventListener('resize', syncHeight);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', syncHeight);
    };
  }, []);

  const getReasonText = () => {
    if (overallPass) return '통과';
    if (!meets60 && anyGroupFail) return '과락 및 평락으로 인한 불합격';
    if (!meets60) return '평락으로 인한 불합격';
    return '과락으로 인한 불합격';
  };

  const renderGroupBoxes = () => {
    if (!groupResults) return null;
    return groupResults.map((group) => {
      const { label: groupLabel, subjects, layoutChunks, score, max, rate, pass } = group;

      let chipsHtml = null;
      if (layoutChunks && layoutChunks.length) {
        const rows = chunk(subjects, layoutChunks);
        chipsHtml = rows.map((row, rowIndex) => (
          <div key={rowIndex} className="subj-row">
            {row.map(subject => {
              const sScore = subjectScores[subject] || 0;
              const sMax = SUBJECT_MAX[subject] || 0;
              return (
                <span key={subject} className="subj-chip">
                  {subject} <span className="muted">{fmt(sScore)}/{fmt(sMax)}</span>
                </span>
              );
            })}
          </div>
        ));
      } else {
        chipsHtml = (
          <div className="subj-row">
            {subjects.map(subject => {
              const sScore = subjectScores[subject] || 0;
              const sMax = SUBJECT_MAX[subject] || 0;
              return (
                <span key={subject} className="subj-chip">
                  {subject} <span className="muted">{fmt(sScore)}/{fmt(sMax)}</span>
                </span>
              );
            })}
          </div>
        );
      }

      return (
        <div key={group.name} className={`group-box ${pass ? 'ok' : 'fail'} span-12`}>
          <div className="group-head">
            <div className="name" style={{ fontWeight: 800 }}>{groupLabel}</div>
            <div className="small">
              소계 {fmt(score)}/{fmt(max)} · 정답률 {rate}%{' '}
              {pass
                ? <span dangerouslySetInnerHTML={{ __html: pill('통과', 'ok') }} />
                : <span dangerouslySetInnerHTML={{ __html: pill('과락', 'red') }} />
              }
            </div>
          </div>
          {chipsHtml}
        </div>
      );
    });
  };

  const handleCardClick = (e) => {
    if (e.target.closest('button')) return;
    setIsFlipped(prev => !prev);
  };

  // invalid = 미응시/중도포기
  const isInvalid = status === 'absent' || status === 'dropout' || status === 'dropped';

  return (
    <div
      ref={flipCardRef}
      className="flip-card"
      onClick={handleCardClick}
    >
      <div className={`flip-inner ${isFlipped ? 'is-flipped' : ''}`}>

        {/* 앞면 */}
        <div ref={frontRef} className="flip-face flip-front card">
  <div
    className={`round ${
      isInvalid ? 'invalid' : overallPass ? 'pass' : 'fail'
    }`}
  >
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{label} 총점</h2>
              {!isInvalid && (
                <div className="kpi">
                  <div className="num">{fmt(totalScore)}</div>
                  <div className="sub">/ {fmt(totalMax)}</div>
                </div>
              )}
            </div>

            {isInvalid ? (
              <div className="small" style={{ marginTop: 12 }}>
                본 회차 {status === 'absent' ? '미응시' : '중도포기'}
              </div>
            ) : (
              <>
                <div className="progress" style={{ margin: '8px 0 2px 0' }}>
                  <div className="bar" style={{ width: `${overallRate}%` }} />
                  <div className="cutline" />
                </div>
                <div className="small" style={{ marginTop: 10 }}>
                  정답률 {overallRate}% (컷 60%: 204/340){' '}
                  {overallPass
                    ? <span dangerouslySetInnerHTML={{ __html: pill('통과', 'ok') }} />
                    : <span dangerouslySetInnerHTML={{ __html: pill('불합격', 'red') }} />
                  }
                  <div className="small" style={{ marginTop: 6, opacity: 0.9 }}>
                    {getReasonText()}
                  </div>
                </div>
              </>
            )}
          </div>

          {!isInvalid && (
            <div className="group-grid" style={{ marginTop: 12 }}>
              {renderGroupBoxes()}
            </div>
          )}
        </div>

        {/* 뒷면 */}
        <div className="flip-face flip-back card">
          {isInvalid ? (
            <div className="small" style={{ padding: 20, textAlign: 'center' }}>
              본 회차는 분석에서 제외됩니다.
            </div>
          ) : (
            <WrongAnswerPanel roundLabel={label} data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

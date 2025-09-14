// src/components/RoundCard.jsx
import React, { useState, useRef } from 'react';
import { fmt, pct, pill, chunk } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';

const INVALID_CARD_HEIGHT = 600;

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
  const isInvalid = status === 'absent' || status === 'dropout' || status === 'dropped';
  const statusClass = isInvalid ? 'rc-invalid' : (overallPass ? 'rc-pass' : 'rc-fail');

  const handleCardClick = (e) => {
    // ⬇️ 해설 버튼만 클릭 가로채기 (data-click-role="exp" 인 경우에만)
    const expBtn = e.target.closest('button[data-click-role="exp"]');
    if (expBtn) return;
    setIsFlipped(prev => !prev);
  };

  const getReasonText = () => {
    if (!meets60 && anyGroupFail) return '과락 및 평락으로 인한 불합격';
    if (!meets60) return '평락으로 인한 불합격';
    if (anyGroupFail) return '과락으로 인한 불합격';
    return '';
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
        <div key={groupLabel} className={`group-box ${pass ? 'ok' : 'fail'} span-12`}>
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

  const fixedHeightStyle = isInvalid ? { height: INVALID_CARD_HEIGHT } : undefined;

  return (
    <div
      ref={flipCardRef}
      className="flip-card"
      onClick={handleCardClick}
      style={fixedHeightStyle}
    >
      <div className={`flip-inner ${isFlipped ? 'is-flipped' : ''}`}>

        {/* 앞면 */}
        <div
          ref={frontRef}
          className={`flip-face flip-front card ${statusClass}`}
          style={fixedHeightStyle}
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
            <div
              style={{
                height: `calc(${INVALID_CARD_HEIGHT}px - 56px)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 12
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.6 }}>
                본 회차는 분석에서 제외됩니다.
                <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.9, marginTop: 6 }}>
                  ({status === 'absent' ? '미응시' : status === 'dropout' ? '중도포기' : '기타 무효'})
                </div>
              </div>
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

              <div className="group-grid" style={{ marginTop: 12 }}>
                {renderGroupBoxes()}
              </div>
            </>
          )}
        </div>

        {/* 뒷면 */}
        <div className={`flip-face flip-back card ${statusClass}`} style={fixedHeightStyle}>
          <WrongAnswerPanel roundLabel={label} data={data} sid={sid} />
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

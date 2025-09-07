// src/components/RoundCard.jsx
import React, { useState, useRef } from 'react';
import { fmt, pct, pill, chunk } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';

const INVALID_CARD_HEIGHT = 360; // ✅ 무효 카드 고정 높이(px) — 필요시 조절

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

  // invalid = 미응시/중도포기/기타 무효 판정
  const isInvalid = status === 'absent' || status === 'dropout' || status === 'dropped';
  const statusClass = isInvalid ? 'rc-invalid' : (overallPass ? 'rc-pass' : 'rc-fail');

  const handleCardClick = (e) => {
    // 내부 버튼 클릭 시 플립 방지
    if (e.target.closest('button')) return;
    setIsFlipped(prev => !prev);
  };

  const getReasonText = () => {
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

  // 무효 카드일 때만 고정 높이 적용 (앞/뒤 동일)
  const fixedHeightStyle = isInvalid ? { height: INVALID_CARD_HEIGHT } : undefined;

  return (
    <div
      ref={flipCardRef}
      className="flip-card"
      onClick={handleCardClick}
      style={fixedHeightStyle} // ✅ 무효 카드 고정 높이
    >
      <div className={`flip-inner ${isFlipped ? 'is-flipped' : ''}`}>

        {/* 앞면 */}
        <div
          ref={frontRef}
          className={`flip-face flip-front card ${statusClass}`}
          style={fixedHeightStyle} // ✅ 앞면도 동일 고정
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
            // ✅ 무효 카드: 중앙 정렬 큰 텍스트
            <div
              style={{
                height: `calc(${INVALID_CARD_HEIGHT}px - 56px)`, // 카드 패딩·헤더 여백 감안
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

        {/* 뒷면 — 무효 차수여도 오답 패널은 그대로 표시 */}
        <div className={`flip-face flip-back card ${statusClass}`} style={fixedHeightStyle}>
          <WrongAnswerPanel roundLabel={label} data={data} />
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

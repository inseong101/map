// src/components/RoundCard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { fmt, pct, pill, chunk, enrichRoundData } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';

function RoundCard({ label, data, sid }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const flipCardRef = useRef(null);
  const frontRef = useRef(null);

  // 🔥 data가 혹시 비어있거나 subjectScores/groupResults 누락된 경우 보강
  const safeData = enrichRoundData(data || {});
  const { totalScore, totalMax, overallPass, meets60, anyGroupFail, groupResults } = safeData;
  const overallRate = pct(totalScore, totalMax);

  // 높이 동기화
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
    if (overallPass) return "통과";
    if (!meets60 && anyGroupFail) return "과락 및 평락으로 인한 불합격";
    if (!meets60) return "평락으로 인한 불합격";
    return "과락으로 인한 불합격";
  };

  const renderGroupBoxes = () => {
    return groupResults.map((group) => {
      const { label: groupLabel, subjects, layoutChunks, score, max, rate, pass } = group;

      let chipsHtml = "";
      if (layoutChunks && layoutChunks.length) {
        const rows = chunk(subjects, layoutChunks);
        chipsHtml = rows.map((row, rowIndex) => (
          <div key={rowIndex} className="subj-row">
            {row.map(subject => {
              const subjectScore = safeData.subjectScores[subject] || 0;
              const subjectMax = SUBJECT_MAX[subject] || 0;
              return (
                <span key={subject} className="subj-chip">
                  {subject} <span className="muted">{fmt(subjectScore)}/{fmt(subjectMax)}</span>
                </span>
              );
            })}
          </div>
        ));
      } else {
        chipsHtml = (
          <div className="subj-row">
            {subjects.map(subject => {
              const subjectScore = safeData.subjectScores[subject] || 0;
              const subjectMax = SUBJECT_MAX[subject] || 0;
              return (
                <span key={subject} className="subj-chip">
                  {subject} <span className="muted">{fmt(subjectScore)}/{fmt(subjectMax)}</span>
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
              소계 {fmt(score)}/{fmt(max)} · 정답률 {rate}%
              {pass ? 
                <span dangerouslySetInnerHTML={{__html: pill("통과", "ok")}} /> : 
                <span dangerouslySetInnerHTML={{__html: pill("과락", "red")}} />
              }
            </div>
          </div>
          {chipsHtml}
        </div>
      );
    });
  };

  const handleCardClick = (e) => {
    if (e.target.closest('button')) return; // 버튼 클릭은 무시
    setIsFlipped(!isFlipped);
  };

  return (
    <div 
      ref={flipCardRef}
      className="flip-card" 
      onClick={handleCardClick}
    >
      <div className={`flip-inner ${isFlipped ? 'is-flipped' : ''}`}>
        {/* 앞면 - 성적 */}
        <div ref={frontRef} className="flip-face flip-front card">
          <div className={`round ${overallPass ? "" : "fail"}`}>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{label} 총점</h2>
              <div className="kpi">
                <div className="num">{fmt(totalScore)}</div>
                <div className="sub">/ {fmt(totalMax)}</div>
              </div>
            </div>
            
            <div className="progress" style={{ margin: '8px 0 2px 0' }}>
              <div className="bar" style={{ width: `${overallRate}%` }}></div>
              <div className="cutline"></div>
            </div>
            
            <div className="small" style={{ marginTop: 10 }}>
              정답률 {overallRate}% (컷 60%: 204/340) · 
              {overallPass ? 
                <span dangerouslySetInnerHTML={{__html: pill("통과", "ok")}} /> : 
                <span dangerouslySetInnerHTML={{__html: pill("불합격", "red")}} />
              }
              <div className="small" style={{ marginTop: '6px', opacity: 0.9 }}>
                {getReasonText()}
              </div>
            </div>
          </div>
          
          <div className="group-grid" style={{ marginTop: 12 }}>
            {renderGroupBoxes()}
          </div>
        </div>

        {/* 뒷면 - 오답 */}
        <div className="flip-face flip-back card">
          {/* safeData에 wrongBySession이 보강되어 있어도 그대로 전달 */}
          <WrongAnswerPanel roundLabel={label} data={safeData} />
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

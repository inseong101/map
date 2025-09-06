// src/components/RoundCard.jsx - 중도포기자도 보라색 표시
import React, { useState, useEffect, useRef } from 'react';
import { fmt, pct, pill, chunk, detectStudentAbsenceStatus } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';

function RoundCard({ label, data, sid }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const flipCardRef = useRef(null);
  const frontRef = useRef(null);

  // 기존 코드 구조 유지하되 미응시 감지 추가
  const { totalScore, totalMax, overallPass, meets60, anyGroupFail, groupResults, wrongBySession, percentile, rank } = data;
  const overallRate = pct(totalScore, totalMax);

  // 🎯 미응시/중도포기 상태 감지
  const absence = detectStudentAbsenceStatus(wrongBySession || {});
  const isNoAttendance = !!absence?.isNoAttendance;
  const isPartiallyAbsent = !!absence?.isPartiallyAbsent;
  const missedSessions = absence?.missedSessions || [];

  // 🎯 전체 카드 클래스 결정 (부모 카드에 색깔 적용)
  // 중도포기자도 보라색으로 표시
  const getCardClass = () => {
    let baseClass = 'flip-card';
    
    if (isNoAttendance || isPartiallyAbsent) {
      // 🎯 미응시자 + 중도포기자 모두 보라색
      return `${baseClass} card-absent`;
    } else if (overallPass) {
      return `${baseClass} card-pass`;
    } else {
      return `${baseClass} card-fail`;
    }
  };

  // 높이 동기화 함수 (기존 코드 유지)
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
    if (isNoAttendance) return '전체 미응시';
    if (isPartiallyAbsent) return `중도포기 (빠진 교시: ${missedSessions.join(', ')})`;
    if (overallPass) return "통과";
    if (!meets60 && anyGroupFail) return "과락 및 평락으로 인한 불합격";
    if (!meets60) return "평락으로 인한 불합격";
    return "과락으로 인한 불합격";
  };

  const renderGroupBoxes = () => {
    if (!groupResults || groupResults.length === 0) {
      return (
        <div className="small" style={{ textAlign: 'center', opacity: 0.7, padding: 20 }}>
          {isNoAttendance ? '미응시로 인해 과목별 데이터가 없습니다.' : 
           isPartiallyAbsent ? '중도포기로 인해 일부 과목 데이터가 없습니다.' : 
           '과목별 데이터를 불러오는 중입니다...'}
        </div>
      );
    }

    return groupResults.map((group) => {
      const { label: groupLabel, subjects, layoutChunks, score, max, rate, pass } = group;
      
      let chipsHtml = "";
      if (layoutChunks && layoutChunks.length) {
        const rows = chunk(subjects, layoutChunks);
        chipsHtml = rows.map((row, rowIndex) => (
          <div key={rowIndex} className="subj-row">
            {row.map(subject => {
              const subjectScore = data.subjectScores?.[subject] || 0;
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
            {(subjects || []).map(subject => {
              const subjectScore = data.subjectScores?.[subject] || 0;
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

      // 🎯 단순히 과락/통과만 표시 (초록/빨강)
      return (
        <div key={group.name || groupLabel} className={`group-box ${pass ? 'ok' : 'fail'} span-12`}>
          <div className="group-head">
            <div className="group-grid" style={{ marginTop: 12 }}>
              {renderGroupBoxes()}
            </div>
          </div>
        </div>

        {/* 🎯 뒷면 - 자녀카드에서 card 클래스 제거, 색깔은 부모가 담당 */}
        <div className="flip-face flip-back">
          <div className="card-content">
            <WrongAnswerPanel roundLabel={label} data={data} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default RoundCard; className="name" style={{ fontWeight: 800 }}>{groupLabel}</div>
            <div className="small">
              소계 {fmt(score)}/{fmt(max)} · 정답률 {rate}%{' '}
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
    // 버튼 클릭은 무시
    if (e.target.closest('button')) return;
    setIsFlipped(!isFlipped);
  };

  return (
    <div 
      ref={flipCardRef}
      className={getCardClass()}
      onClick={handleCardClick}
      style={{ cursor: 'pointer' }}
    >
      <div className={`flip-inner ${isFlipped ? 'is-flipped' : ''}`}>
        {/* 🎯 앞면 - 자녀카드에서 card 클래스 제거, 색깔은 부모가 담당 */}
        <div ref={frontRef} className="flip-face flip-front">
          <div className="card-content">
            <div className={`round ${overallPass ? "" : "fail"}`}>
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{label} 총점</h2>
                  {/* 🎯 미응시/중도포기 안내 */}
                  {isNoAttendance && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
                      <span className="badge absent" style={{ fontSize: 11 }}>
                        전체 미응시
                      </span>
                    </div>
                  )}
                  {(!isNoAttendance && isPartiallyAbsent) && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
                      <span className="badge absent" style={{ fontSize: 11 }}>
                        중도포기 (빠진 교시: {missedSessions.join(', ')})
                      </span>
                    </div>
                  )}
                </div>
                
                <div style={{ textAlign: 'right' }}>
                  <div className="kpi">
                    <div className="num">{fmt(totalScore)}</div>
                    <div className="sub">/ {fmt(totalMax)}</div>
                  </div>
                  {/* 🎯 상위 퍼센트 표시 */}
                  {percentile && !isNoAttendance && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--primary)' }}>
                      상위 {percentile}%
                    </div>
                  )}
                </div>
              </div>
              
              <div className="progress" style={{ margin: '8px 0 2px 0' }}>
                <div className="bar" style={{ width: `${actualRate}%` }}></div>
                <div className="cutline"></div>
              </div>
              
              <div className="small" style={{ marginTop: 10 }}>
                {/* 🎯 응시한 교시 기준으로 정답률 표시 */}
                정답률 {actualRate}% 
                {attendedSessions < 4 && (
                  <span style={{ color: 'var(--muted)' }}>
                    ({attendedSessions}/4교시 응시)
                  </span>
                )}
                {attendedSessions === 4 && ' (컷 60%: 204/340)'} ·{' '}
                {isNoAttendance
                  ? <span className="badge absent">미응시</span>
                  : (isPartiallyAbsent
                      ? <span className="badge absent">중도포기</span>
                      : (overallPass
                          ? <span dangerouslySetInnerHTML={{ __html: pill('통과', 'ok') }} />
                          : <span dangerouslySetInnerHTML={{ __html: pill('불합격', 'red') }} />))}
                <div className="small" style={{ marginTop: '6px', opacity: 0.9 }}>
                  {getReasonText()}
                </div>
              </div>
            </div>
            
            <div

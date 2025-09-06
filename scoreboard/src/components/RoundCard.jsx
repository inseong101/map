// src/components/RoundCard.jsx - 중도포기 배지 + 전체카드 색상 일관 적용 (ES 보수)
import React, { useState, useEffect, useRef } from 'react';
import { fmt, pct, pill, chunk, detectStudentAbsenceStatus } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';

function RoundCard({ label, data, sid, isPartialAbsent = false, attendedCount = 4 }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const flipCardRef = useRef(null);
  const frontRef = useRef(null);

  // 안전 접근(옵셔널 체이닝 제거)
  const totalScore   = data && data.totalScore != null ? data.totalScore : 0;
  const totalMax     = data && data.totalMax   != null ? data.totalMax   : 340;
  const overallPass  = !!(data && data.overallPass);
  const meets60      = !!(data && data.meets60);
  const anyGroupFail = !!(data && data.anyGroupFail);
  const groupResults = Array.isArray(data && data.groupResults) ? data.groupResults : [];
  const overallRate  = pct(totalScore, totalMax);

  // 응시 상태(중도포기/미응시 판정)
  const absence = detectStudentAbsenceStatus((data && data.wrongBySession) || {});
  const isPartiallyAbsentFinal = !!(isPartialAbsent || absence.isPartiallyAbsent);
  const missedSessions = absence.missedSessions || [];

  // 전체 카드 배경 상태 클래스 (합격=초록, 불합격=빨강, 미응시=보라)
  // - 미응시(0교시): 보라
  // - 중도포기(1~3교시) 또는 불합격: 빨강
  // - 합격: 초록
  let statusClass = 'card-pass';
  if (absence.isNoAttendance) {
    statusClass = 'card-absent';
  } else if (isPartiallyAbsentFinal || !overallPass) {
    statusClass = 'card-fail';
  }

  // 높이 동기화
  useEffect(() => {
    const syncHeight = () => {
      if (flipCardRef.current && frontRef.current) {
        const frontHeight = frontRef.current.offsetHeight;
        flipCardRef.current.style.setProperty('--front-height', frontHeight + 'px');
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
    if (isPartiallyAbsentFinal) return "중도포기";
    if (overallPass) return "통과";
    if (!meets60 && anyGroupFail) return "과락 및 평락으로 인한 불합격";
    if (!meets60) return "평락으로 인한 불합격";
    return "과락으로 인한 불합격";
  };

  const renderGroupBoxes = () => {
    return groupResults.map((group) => {
      const groupLabel = group.label || '';
      const subjects = Array.isArray(group.subjects) ? group.subjects : [];
      const layoutChunks = Array.isArray(group.layoutChunks) ? group.layoutChunks : null;
      const score = group.score != null ? group.score : 0;
      const max = group.max != null ? group.max : 0;
      const rate = group.rate != null ? group.rate : 0;
      const pass = !!group.pass;

      let chipsHtml = "";
      if (layoutChunks && layoutChunks.length) {
        const rows = chunk(subjects, layoutChunks);
        chipsHtml = rows.map((row, rowIndex) => (
          <div key={rowIndex} className="subj-row">
            {row.map((subject) => {
              const subjectScore = (data && data.subjectScores && data.subjectScores[subject]) || 0;
              const subjectMax = (SUBJECT_MAX && SUBJECT_MAX[subject]) || 0;
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
            {subjects.map((subject) => {
              const subjectScore = (data && data.subjectScores && data.subjectScores[subject]) || 0;
              const subjectMax = (SUBJECT_MAX && SUBJECT_MAX[subject]) || 0;
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
        <div key={groupLabel} className={'group-box ' + (pass ? 'ok' : 'fail') + ' span-12'}>
          <div className="group-head">
            <div className="name" style={{ fontWeight: 800 }}>
              {groupLabel}
              {/* 중도포기 표시 */}
              {isPartiallyAbsentFinal && (
                <span className="badge absent" style={{ marginLeft: '8px', fontSize: '10px' }}>
                  중도포기
                </span>
              )}
            </div>
            <div className="small">
              소계 {fmt(score)}/{fmt(max)} · 정답률 {rate}%
              {pass
                ? <span dangerouslySetInnerHTML={{ __html: pill("통과", "ok") }} />
                : <span dangerouslySetInnerHTML={{ __html: pill("과락", "red") }} />
              }
            </div>
          </div>
          {chipsHtml}
        </div>
      );
    });
  };

  const handleCardClick = (e) => {
    if (e.target.closest && e.target.closest('button')) return; // 버튼 클릭은 무시
    setIsFlipped(!isFlipped);
  };

  return (
    <div
      ref={flipCardRef}
      className={'flip-card ' + statusClass}
      onClick={handleCardClick}
    >
      <div className={'flip-inner ' + (isFlipped ? 'is-flipped' : '')}>
        {/* 앞면 - 성적 (상태 클래스 포함하여 배경 일관 적용) */}
        <div ref={frontRef} className={'flip-face flip-front card ' + statusClass}>
          <div className={'round ' + (overallPass ? '' : 'fail')}>
            {/* 헤더 - 중도포기 배지 */}
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: 0 }}>{label} 총점</h2>
                {isPartiallyAbsentFinal && (
                  <div className="small" style={{ marginTop: '4px', color: 'var(--muted)' }}>
                    <span className="badge absent" style={{ fontSize: '11px' }}>
                      중도포기 (빠진 교시: {missedSessions.join(", ")})
                    </span>
                  </div>
                )}
              </div>
              <div className="kpi">
                <div className="num">{fmt(totalScore)}</div>
                <div className="sub">/ {fmt(totalMax)}</div>
              </div>
            </div>

            <div className="progress" style={{ margin: '8px 0 2px 0' }}>
              <div className="bar" style={{ width: overallRate + '%' }}></div>
              <div className="cutline"></div>
            </div>

            <div className="small" style={{ marginTop: 10 }}>
              정답률 {overallRate}% (컷 60%: 204/340) ·
              {isPartiallyAbsentFinal
                ? <span dangerouslySetInnerHTML={{ __html: pill("중도포기", "red") }} />
                : (overallPass
                    ? <span dangerouslySetInnerHTML={{ __html: pill("통과", "ok") }} />
                    : <span dangerouslySetInnerHTML={{ __html: pill("불합격", "red") }} />
                  )
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

        {/* 뒷면 - 오답 (상태 클래스 포함하여 배경 일관 적용) */}
        <div className={'flip-face flip-back card ' + statusClass}>
          <WrongAnswerPanel roundLabel={label} data={data} />
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

// src/components/RoundCard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { fmt, pct, pill, chunk } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';

function RoundCard({ label, data, sid }) {
  const [isFlipped, setIsFlipped] = useState(false);

  const flipCardRef = useRef(null);
  const frontRef = useRef(null);
  const backRef  = useRef(null);

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

  // ✅ 카드 높이 동기화: 유효차수=앞면 기준, 무효차수=뒷면 기준
  useEffect(() => {
    const syncHeight = () => {
      const card   = flipCardRef.current;
      const target = isInvalid ? backRef.current : frontRef.current; // 핵심: 대상 전환
      if (!card || !target) return;

      const h = target.offsetHeight || 0;
      card.style.setProperty('--front-height', `${h}px`);
      card.classList.add('height-synced');
    };

    // 즉시 한 번
    syncHeight();

    // 리사이즈 대응
    const onResize = () => syncHeight();
    window.addEventListener('resize', onResize);

    // 대상 면의 내부 콘텐츠 변화에도 대응
    const target = isInvalid ? backRef.current : frontRef.current;
    const ro = target ? new ResizeObserver(syncHeight) : null;
    if (ro && target) ro.observe(target);

    // 폰트/레이아웃 지연 대비 보강 호출
    const t1 = setTimeout(syncHeight, 60);
    const t2 = requestAnimationFrame(syncHeight);

    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      clearTimeout(t1);
      cancelAnimationFrame(t2);
    };
  }, [isInvalid]); // 무효/유효 전환 시 재측정

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

  const handleCardClick = (e) => {
    // 내부 버튼 클릭 시 플립 방지
    if (e.target.closest('button')) return;
    setIsFlipped(prev => !prev);
  };

  return (
    <div
      ref={flipCardRef}
      className="flip-card"
      onClick={handleCardClick}
    >
      <div className={`flip-inner ${isFlipped ? 'is-flipped' : ''}`}>

        {/* 앞면 (유효/무효 모두 같은 골격, 내용만 다름) */}
        <div
          ref={frontRef}
          className={`flip-face flip-front card ${statusClass}`}
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
            // ✅ 무효 차수: 앞면엔 안내만
            <div className="small" style={{ marginTop: 12, fontWeight: 700 }}>
              본 회차는 분석에서 제외됩니다.
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

        {/* 뒷면 (무효라도 항상 오답 패널 표시) */}
        <div
          ref={backRef}
          className={`flip-face flip-back card ${statusClass}`}
        >
          <WrongAnswerPanel roundLabel={label} data={data} />
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

// src/components/RoundCard.jsx - 완전 수정본
import React, { useState, useEffect, useRef } from 'react';
import { fmt, pct, pill, chunk, detectStudentAbsenceStatus } from '../utils/helpers';
import { SUBJECT_MAX } from '../services/dataService';
import WrongAnswerPanel from './WrongAnswerPanel';



/**
 * 그룹(과목 묶음) 단위 "미응시" 판정:
 * - 해당 그룹의 모든 과목 점수가 비어있거나 숫자가 아니면 => 미응시(absent)로 간주
 * - 점수가 0이더라도 "0"이 실제 채점 결과일 수 있으므로, "undefined/null/NaN"만 미응시로 본다.
 */
function isGroupAbsent(subjects, subjectScores) {
  if (!Array.isArray(subjects) || !subjects.length) return false;
  return subjects.every((s) => {
    const val = subjectScores?.[s];
    return val == null || !Number.isFinite(Number(val));
  });
}

function RoundCard({ label, data, sid }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const flipCardRef = useRef(null);
  const frontRef = useRef(null);

  // 안전 가드 & 파생값
  const totalScore = Number.isFinite(data?.totalScore) ? Number(data.totalScore) : 0;
  const totalMax = Number.isFinite(data?.totalMax) ? Number(data.totalMax) : 340;
  const overallRate = pct(totalScore, totalMax);

  const overallPass = !!data?.overallPass;
  const meets60 = !!data?.meets60;
  const anyGroupFail = !!data?.anyGroupFail;
  const groupResults = Array.isArray(data?.groupResults) ? data.groupResults : [];
  const subjectScores = data?.subjectScores || {};
  const wrongBySession = data?.wrongBySession || {};

  // 응시 상태 감지 (미응시/중도포기/풀참여)
  const absence = detectStudentAbsenceStatus(wrongBySession);
  const isNoAttendance = !!absence?.isNoAttendance;
  const isPartiallyAbsent = !!absence?.isPartiallyAbsent;
  const missedSessions = absence?.missedSessions || [];

  // 전체 카드 배경 상태
  // - 미응시: 보라(card-absent)
  // - 중도포기: 빨강(card-fail)
  // - 정상응시: 합격=초록(card-pass) / 불합격=빨강(card-fail)
  const overallClass =
    isNoAttendance
      ? 'card card-absent'
      : (isPartiallyAbsent
          ? 'card card-fail'
          : (overallPass ? 'card card-pass' : 'card card-fail'));

  // 상단 사유 문구
  const getReasonText = () => {
    if (isNoAttendance) return '전체 미응시';
    if (isPartiallyAbsent) return '중도포기';
    if (overallPass) return '통과';
    if (!meets60 && anyGroupFail) return '과락 및 평락으로 인한 불합격';
    if (!meets60) return '평락으로 인한 불합격';
    return '과락으로 인한 불합격';
  };

  // 높이 동기화 (플립 카드 앞/뒤 동일 높이)
  useEffect(() => {
    const syncHeight = () => {
      if (flipCardRef.current && frontRef.current) {
        const frontHeight = frontRef.current.offsetHeight;
        flipCardRef.current.style.setProperty('--front-height', `${frontHeight}px`);
        flipCardRef.current.classList.add('height-synced');
      }
    };
    const t = setTimeout(syncHeight, 100);
    window.addEventListener('resize', syncHeight);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', syncHeight);
    };
  }, []);

  // 그룹(과목 묶음) 렌더링
  const renderGroupBoxes = () => {
    return groupResults.map((group) => {
      const {
        name,
        label: groupLabel,
        subjects = [],
        layoutChunks,
        score = 0,
        max = 0,
        rate = 0,
        pass = false,
      } = group || {};

      // 과목 칩 렌더링 (미응시 과목은 칩 자체는 동일하되 점수는 '-' 처리됨)
      let chipsNode = null;
      const renderChip = (subject) => {
        const sc = subjectScores?.[subject];
        const maxSc = SUBJECT_MAX?.[subject] ?? 0;
        const hasScore = sc != null && Number.isFinite(Number(sc));
        return (
          <span key={subject} className="subj-chip">
            {subject}{' '}
            <span className="muted">
              {hasScore ? fmt(sc) : '-'} / {fmt(maxSc)}
            </span>
          </span>
        );
      };

      if (Array.isArray(layoutChunks) && layoutChunks.length) {
        const rows = chunk(subjects, layoutChunks);
        chipsNode = rows.map((row, i) => (
          <div key={i} className="subj-row">
            {row.map((subject) => renderChip(subject))}
          </div>
        ));
      } else {
        chipsNode = (
          <div className="subj-row">
            {subjects.map((subject) => renderChip(subject))}
          </div>
        );
      }

      // ✅ 그룹 단위 미응시 판정 → 보라색 박스(.group-box.absent)
      const groupAbsent = isGroupAbsent(subjects, subjectScores);
      const groupClass = groupAbsent ? 'absent' : (pass ? 'ok' : 'fail');

      return (
        <div key={name || groupLabel} className={`group-box ${groupClass} span-12`}>
          <div className="group-head">
            <div className="name" style={{ fontWeight: 800 }}>
              {groupLabel}
              {/* 그룹 미응시 뱃지 */}
              {groupAbsent && (
                <span className="badge absent" style={{ marginLeft: 8, fontSize: 10 }}>
                  미응시
                </span>
              )}
            </div>
            <div className="small">
              소계 {fmt(score)}/{fmt(max)} · 정답률 {rate}%
              {!groupAbsent && ( // 미응시는 통과/과락 배지 대신 미응시 배지만
                pass
                  ? <span dangerouslySetInnerHTML={{ __html: pill('통과', 'ok') }} />
                  : <span dangerouslySetInnerHTML={{ __html: pill('과락', 'red') }} />
              )}
            </div>
          </div>
          {chipsNode}
        </div>
      );
    });
  };

  const handleCardClick = (e) => {
    // 내부 버튼 클릭은 무시
    if (e.target.closest('button')) return;
    setIsFlipped((v) => !v);
  };

  return (
    <div
      ref={flipCardRef}
      className={`flip-card ${overallClass}`}
      onClick={handleCardClick}
    >
      <div className={`flip-inner ${isFlipped ? 'is-flipped' : ''}`}>
        {/* 앞면 - 성적 요약 */}
        <div ref={frontRef} className="flip-face flip-front card">
          <div className={`round ${overallPass ? '' : 'fail'}`}>
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: 0 }}>{label} 총점</h2>

                {/* 회차 미응시 / 중도포기 안내 */}
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

              <div className="kpi">
                <div className="num">{fmt(totalScore)}</div>
                <div className="sub">/ {fmt(totalMax)}</div>
              </div>
            </div>

            {/* 진행바 + 컷라인 */}
            <div className="progress" style={{ margin: '8px 0 2px 0' }}>
              <div className="bar" style={{ width: `${overallRate}%` }} />
              <div className="cutline" />
            </div>

            {/* 상태 배지 & 사유 */}
            <div className="small" style={{ marginTop: 10 }}>
              정답률 {overallRate}% (컷 60%: 204/340) ·{' '}
              {isNoAttendance
                ? <span className="badge absent">미응시</span>
                : (isPartiallyAbsent
                    ? <span dangerouslySetInnerHTML={{ __html: pill('중도포기', 'red') }} />
                    : (overallPass
                        ? <span dangerouslySetInnerHTML={{ __html: pill('통과', 'ok') }} />
                        : <span dangerouslySetInnerHTML={{ __html: pill('불합격', 'red') }} />))}
              <div className="small" style={{ marginTop: 6, opacity: 0.9 }}>
                {getReasonText()}
              </div>
            </div>
          </div>

          {/* 그룹(과목 묶음) 박스들 */}
          <div className="group-grid" style={{ marginTop: 12 }}>
            {renderGroupBoxes()}
          </div>
        </div>

        {/* 뒷면 - 오답 패널 */}
        <div className="flip-face flip-back card">
          <WrongAnswerPanel roundLabel={label} data={data} />
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

// src/components/RoundCard.jsx
import React, { useMemo } from 'react';
import WrongAnswerPanel from './WrongAnswerPanel';

function RoundCard({ label, data = {}, sid }) {
  // 상태 감지
  const status = data?.status || 'completed'; // completed | absent | dropout | invalid ...
  const isPass = Number.isFinite(data?.totalScore) && Number.isFinite(data?.totalMax)
    ? (data.totalScore / data.totalMax) >= 0.6
    : false;

  // 카드 상태 클래스
  const rcClass =
    status === 'invalid' ? 'rc-invalid'
    : status === 'absent' || status === 'dropout' ? 'rc-fail'
    : isPass ? 'rc-pass'
    : 'rc-fail';

  // 배지/상태 텍스트
  const statusBadge = (() => {
    if (status === 'invalid') return <span className="badge invalid">무효</span>;
    if (status === 'absent') return <span className="badge fail">미응시</span>;
    if (status === 'dropout') return <span className="badge fail">중도포기</span>;
    return isPass ? <span className="badge pass">합격권</span> : <span className="badge fail">불합격권</span>;
  })();

  const totalScoreText = useMemo(() => {
    const s = Number.isFinite(data?.totalScore) ? data.totalScore : '-';
    const m = Number.isFinite(data?.totalMax)   ? data.totalMax   : '-';
    return `${s} / ${m}`;
  }, [data?.totalScore, data?.totalMax]);

  return (
    <div className={`flip-card`}>
      <div className="flip-inner">

        {/* ===== 앞면 ===== */}
        <div className={`card flip-face flip-front ${rcClass}`}>
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{label}</h2>
            {statusBadge}
          </div>

          <div className="kpi" style={{ marginTop: 8 }}>
            <div className="num">{totalScoreText}</div>
            <div className="sub">총점</div>
          </div>

          {/* 무효차수 안내는 '앞면'에만 */}
          {status === 'invalid' && (
            <div className="alert" style={{ marginTop: 12 }}>
              본 회차는 분석에서 제외됩니다.
            </div>
          )}

          {/* (예시) 진행바 */}
          {Number.isFinite(data?.totalScore) && Number.isFinite(data?.totalMax) && (
            <div className="progress" style={{ marginTop: 12 }}>
              <div
                className="bar"
                style={{ width: `${Math.max(0, Math.min(100, (data.totalScore / data.totalMax) * 100))}%` }}
              />
              <div className="cutline" />
            </div>
          )}
        </div>

        {/* ===== 뒷면 ===== */}
        <div className={`card flip-face flip-back ${rcClass}`}>
          {/* 무효차수라도 뒷면은 동일하게 오답 버튼 그리드 표시 */}
          <WrongAnswerPanel roundLabel={label} data={data} />
        </div>
      </div>
    </div>
  );
}

export default RoundCard;

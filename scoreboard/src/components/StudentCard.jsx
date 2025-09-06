// src/components/StudentCard.jsx - 안전 가드 + 미응시/중도포기 배지 처리
import React from 'react';
import { TOTAL_MAX } from '../services/dataService';
import { detectStudentAbsenceStatus } from '../utils/helpers';
import TrendChart from './TrendChart';

function StudentCard({ sid = '', school = '', rounds = [] }) {
  // rounds가 배열이 아닐 수 있는 상황 방어
  const safeRounds = Array.isArray(rounds) ? rounds : [];

  const renderBadges = () => {
    // map 사용 전 안전 가드
    return safeRounds.map(({ label = '', data = {} }, idx) => {
      const wrongBySession = data?.wrongBySession || {};
      const absenceStatus = detectStudentAbsenceStatus(wrongBySession);

      // 완전 미응시(0교시)
      if (absenceStatus.isNoAttendance) {
        return (
          <span key={label || idx} className="badge absent">
            {label} 미응시
          </span>
        );
      }

      // 중도포기(일부 교시만 응시)
      if (absenceStatus.isPartiallyAbsent) {
        const missed = (absenceStatus.missedSessions || []).join(', ');
        return (
          <span key={label || idx} className="badge absent">
            {label} 중도포기{missed ? ` (빠진 교시: ${missed})` : ''}
          </span>
        );
      }

      // 정상 응시자 → 합/불 판정
      const totalScore = Number.isFinite(data?.totalScore) ? Number(data.totalScore) : 0;
      const passOverall = totalScore >= (TOTAL_MAX * 0.6);
      const badgeClass = passOverall ? 'badge pass' : 'badge fail';
      const badgeText = passOverall ? '합격' : '불합격';

      return (
        <span key={label || idx} className={badgeClass}>
          {label} {badgeText}
        </span>
      );
    });
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="small">학수번호</div>
          <div className="kpi">
            <div className="num">{sid}</div>
          </div>
          <div className="small">{school}</div>
        </div>

        <div className="flex" style={{ gap: '8px', flexWrap: 'wrap' }}>
          {renderBadges()}
        </div>
      </div>

      <hr className="sep" />

      <div>
        <h2 style={{ marginTop: 0 }}>회차별 성적 추이</h2>
        <TrendChart rounds={safeRounds} school={school} />
        <div className="small" style={{ marginTop: '8px', opacity: 0.8 }}>
          회차별 본인/학교/전국 평균 비교
        </div>
      </div>
    </div>
  );
}

export default StudentCard;

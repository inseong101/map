// src/components/StudentCard.jsx - 중도포기 용어 변경
import React from 'react';
import { TOTAL_MAX } from '../services/dataService';
import { detectStudentAbsenceStatus } from '../utils/helpers';
import TrendChart from './TrendChart';

function StudentCard({ sid, school, rounds }) {
  const renderBadges = () => {
    return rounds.map(({ label, data }) => {
      // 미응시 상태 확인
      const absenceStatus = detectStudentAbsenceStatus(data);
      
      // 중도포기자 처리
      if (absenceStatus.isPartiallyAbsent) {
        return (
          <span key={label} className="badge absent">
            {label} 중도포기 ({absenceStatus.attendedCount}/4교시)
          </span>
        );
      }
      
      // 정상 응시자 처리
      const passOverall = data.totalScore >= TOTAL_MAX * 0.6;
      const badgeClass = passOverall ? 'badge pass' : 'badge fail';
      const badgeText = passOverall ? '합격' : '불합격';
      
      return (
        <span key={label} className={badgeClass}>
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
        <TrendChart rounds={rounds} school={school} />
        <div className="small" style={{ marginTop: '8px', opacity: 0.8 }}>
          회차별 본인/학교/전국 평균 비교
        </div>
      </div>
    </div>
  );
}

export default StudentCard;

// src/components/StudentCard.jsx - 회차별/학교별 토글 기능 추가
import React, { useState } from 'react';
import { TOTAL_MAX } from '../services/dataService';
import { detectStudentAbsenceStatus } from '../utils/helpers';
import TrendChart from './TrendChart';

function StudentCard({ sid, school, rounds }) {
  
  // 🎯 토글 상태 관리
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);
  const [viewMode, setViewMode] = useState('round'); // 'round' | 'school'
  
  // 🎯 최고 성적 회차 찾기 (상위% 표시용)
  const getBestRound = () => {
    let bestRound = null;
    let bestScore = -1;
    let bestPercentile = 101;

    rounds.forEach(round => {
      const { data } = round;
      const score = data.totalScore || 0;
      const percentile = data.percentile;
      
      // 점수가 더 높거나, 점수가 같으면 상위%가 더 좋은 것 선택
      if (score > bestScore || (score === bestScore && percentile && percentile < bestPercentile)) {
        bestRound = round;
        bestScore = score;
        bestPercentile = percentile || 101;
      }
    });

    return bestRound;
  };

  // 🎯 선택된 회차의 응시자 분류 통계
  const getSelectedRoundStats = () => {
    if (rounds.length === 0) return { totalTargets: 0, validAttendees: 0, absentees: 0, dropouts: 0 };
    
    const selectedRound = rounds[selectedRoundIndex] || rounds[0];
    return selectedRound?.data?.attendanceStats || {
      totalTargets: 0,
      validAttendees: 0,
      absentees: 0,
      dropouts: 0
    };
  };

  // 🎯 학교별 통계 (임시 - 실제로는 API 호출 필요)
  const getSchoolStats = () => {
    return {
      totalTargets: 120,
      validAttendees: 95,
      absentees: 15,
      dropouts: 10
    };
  };

  // 🎯 본인 상태 분류
  const getStudentStatus = () => {
    const hasAnyAttendance = rounds.some(round => {
      const absence = detectStudentAbsenceStatus(round.data?.wrongBySession || {});
      return !absence.isNoAttendance;
    });

    if (!hasAnyAttendance) {
      return { status: 'absent', label: '미응시자', color: '#a855f7' };
    }

    const hasFullAttendance = rounds.some(round => {
      const absence = detectStudentAbsenceStatus(round.data?.wrongBySession || {});
      return !absence.isNoAttendance && !absence.isPartiallyAbsent;
    });

    if (hasFullAttendance) {
      return { status: 'valid', label: '유효응시자', color: '#22c55e' };
    }

    return { status: 'dropout', label: '중도포기자', color: '#ef4444' };
  };

  const renderBadges = () => {
    return rounds.map(({ label, data }) => {
      const absence = detectStudentAbsenceStatus(data?.wrongBySession || {});
      
      // 🎯 미응시자 처리
      if (absence.isNoAttendance) {
        return (
          <span key={label} className="badge absent">
            {label} 미응시
          </span>
        );
      }
      
      // 🎯 중도포기자 처리  
      if (absence.isPartiallyAbsent) {
        return (
          <span key={label} className="badge absent">
            {label} 중도포기
          </span>
        );
      }
      
      // 정상 응시자 처리
      const passOverall = (data?.totalScore || 0) >= TOTAL_MAX * 0.6;
      const badgeClass = passOverall ? 'badge pass' : 'badge fail';
      const badgeText = passOverall ? '합격' : '불합격';
      
      return (
        <span key={label} className={badgeClass}>
          {label} {badgeText}
        </span>
      );
    });
  };

  const bestRound = getBestRound();
  const currentStats = viewMode === 'round' ? getSelectedRoundStats() : getSchoolStats();
  const studentStatus = getStudentStatus();

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      {/* 🎯 상단 - 학수번호 + 상위% */}
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="small">학수번호</div>
          <div className="kpi">
            <div className="num">{sid}</div>
          </div>
          <div className="small">{school}</div>
          
          {/* 🎯 본인 상태 표시 */}
          <div style={{ marginTop: 8 }}>
            <span 
              className="badge" 
              style={{ 
                backgroundColor: `${studentStatus.color}20`,
                borderColor: `${studentStatus.color}60`,
                color: studentStatus.color,
                fontSize: 11
              }}
            >
              {studentStatus.label}
            </span>
          </div>
        </div>
        
        {/* 🎯 최고 성적 + 상위% */}
        <div style={{ textAlign: 'right' }}>
          {bestRound && bestRound.data?.percentile && (
            <>
              <div className="small">최고 성적 상위</div>
              <div className="kpi">
                <div className="num" style={{ fontSize: 24, color: '#7ea2ff' }}>
                  {bestRound.data.percentile}%
                </div>
              </div>
              <div className="small">
                {bestRound.label} • {bestRound.data.totalScore || 0}점
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* 🎯 토글 버튼들 */}
      <div style={{ 
        marginTop: 16, 
        display: 'flex', 
        gap: 8, 
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        {/* 회차별/학교별 토글 */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button 
            className={`btn ${viewMode === 'round' ? 'active' : ''}`}
            onClick={() => setViewMode('round')}
            style={{ 
              padding: '4px 12px', 
              fontSize: 12,
              backgroundColor: viewMode === 'round' ? 'var(--primary)' : 'var(--surface-2)',
              color: viewMode === 'round' ? '#fff' : 'var(--ink)'
            }}
          >
            회차별
          </button>
          <button 
            className={`btn ${viewMode === 'school' ? 'active' : ''}`}
            onClick={() => setViewMode('school')}
            style={{ 
              padding: '4px 12px', 
              fontSize: 12,
              backgroundColor: viewMode === 'school' ? 'var(--primary)' : 'var(--surface-2)',
              color: viewMode === 'school' ? '#fff' : 'var(--ink)'
            }}
          >
            학교별
          </button>
        </div>

        {/* 🎯 회차별 모드일 때만 회차 선택 버튼들 */}
        {viewMode === 'round' && rounds.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {rounds.map((round, index) => (
              <button
                key={round.label}
                className={`btn ${selectedRoundIndex === index ? 'active' : ''}`}
                onClick={() => setSelectedRoundIndex(index)}
                style={{ 
                  padding: '4px 8px', 
                  fontSize: 11,
                  backgroundColor: selectedRoundIndex === index ? 'var(--ok)' : 'var(--surface)',
                  color: selectedRoundIndex === index ? '#fff' : 'var(--muted)',
                  border: `1px solid ${selectedRoundIndex === index ? 'var(--ok)' : 'var(--line)'}`
                }}
              >
                {round.label}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* 🎯 응시자 분류 통계 */}
      <div style={{ 
        marginTop: 12, 
        padding: 12, 
        background: 'rgba(126,162,255,0.08)', 
        borderRadius: 8,
        border: '1px solid rgba(126,162,255,0.2)'
      }}>
        <div className="small" style={{ marginBottom: 8, color: 'var(--muted)' }}>
          {viewMode === 'round' 
            ? `${rounds[selectedRoundIndex]?.label || '선택된 회차'} 응시자 현황`
            : `${school} 전체 응시자 현황`
          }
        </div>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(2, 1fr)', 
          gap: 8,
          fontSize: 12
        }}>
          <div>
            <strong style={{ color: 'var(--ink)' }}>
              {currentStats.totalTargets}명
            </strong>
            <span className="small"> 시험대상자</span>
          </div>
          <div>
            <strong style={{ color: '#22c55e' }}>
              {currentStats.validAttendees}명
            </strong>
            <span className="small"> 유효응시자</span>
          </div>
          <div>
            <strong style={{ color: '#a855f7' }}>
              {currentStats.absentees}명
            </strong>
            <span className="small"> 미응시자</span>
          </div>
          <div>
            <strong style={{ color: '#ef4444' }}>
              {currentStats.dropouts}명
            </strong>
            <span className="small"> 중도포기자</span>
          </div>
        </div>
      </div>

      {/* 🎯 회차별 배지 */}
      <div className="flex" style={{ gap: '8px', flexWrap: 'wrap', marginTop: 12 }}>
        {renderBadges()}
      </div>
      
      <hr className="sep" />
      
      {/* 🎯 성적 추이 차트 */}
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

// src/components/StudentCard.jsx
import React, { useEffect, useRef } from 'react';
import { TOTAL_MAX } from '../services/dataService';
import { drawLineChart, getAverages } from '../utils/helpers';

function StudentCard({ sid, school, rounds }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (rounds.length > 0 && canvasRef.current) {
      renderTrendChart();
    }
  }, [rounds]);

  const renderTrendChart = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const labels = rounds.map(r => r.label).sort((a, b) => parseInt(a) - parseInt(b));
    const meSeries = labels.map(label => {
      const round = rounds.find(r => r.label === label);
      return round ? round.data.totalScore : null;
    });

    const schoolAvgSeries = await Promise.all(
      labels.map(async (label) => {
        const { schoolAvg } = await getAverages(school, label);
        return schoolAvg;
      })
    );

    const nationalAvgSeries = await Promise.all(
      labels.map(async (label) => {
        const { nationalAvg } = await getAverages('all', label);
        return nationalAvg;
      })
    );

    const maxV = Math.max(
      ...meSeries.filter(v => v != null),
      ...schoolAvgSeries,
      ...nationalAvgSeries,
      1
    );

    drawLineChart(canvas, labels, [
      { name: '본인', values: meSeries },
      { name: '학교', values: schoolAvgSeries },
      { name: '전국', values: nationalAvgSeries },
    ], maxV);
  };

  const renderBadges = () => {
    return rounds.map(({ label, data }) => {
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
        <canvas 
          ref={canvasRef}
          width={360} 
          height={220}
        />
        <div className="small" style={{ marginTop: '8px', opacity: 0.8 }}>
          회차별 본인/학교/전국 평균 비교
        </div>
      </div>
    </div>
  );
}

export default StudentCard;

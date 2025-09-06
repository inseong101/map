// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution } from '../utils/helpers';

function TrendChart({ rounds, school, sid }) {
  const [selectedRound, setSelectedRound] = useState(0);
  const nationalCanvasRef = useRef(null);
  const schoolCanvasRef = useRef(null);
  const [histogramData, setHistogramData] = useState([]);

  useEffect(() => {
    prepareAndDrawHistograms();
  }, [rounds, selectedRound]);

  const prepareAndDrawHistograms = async () => {
    if (rounds.length === 0) return;
    
    const data = [];
    
    for (const round of rounds) {
      const { label, data: roundData } = round;
      const studentScore = roundData.totalScore || 0;
      
      // 평균 데이터 가져오기
      const averages = await getAverages(school, label);
      
      // 실제 점수 분포 데이터 가져오기
      const scoreDistribution = await getRealScoreDistribution(label);
      
      // 전국과 학교 각각의 실제 분포 생성
      const nationalBins = createRealBins(scoreDistribution.national, studentScore);
      const schoolBins = createRealBins(scoreDistribution.school, studentScore);
      
      data.push({
        label,
        studentScore,
        nationalAvg: averages.nationalAvg,
        schoolAvg: averages.schoolAvg,
        nationalBins,
        schoolBins,
        totalNational: scoreDistribution.national.length,
        totalSchool: scoreDistribution.school.length
      });
    }
    
    setHistogramData(data);
    drawBothHistograms(data);
  };

  const createRealBins = (scores, studentScore) => {
    const bins = [];
    const minScore = 180;
    const maxScore = 340;
    const binSize = 5;
    
    // 5점 단위로 구간 생성
    for (let score = minScore; score < maxScore; score += binSize) {
      const count = scores.filter(s => s >= score && s < score + binSize).length;
      
      bins.push({
        min: score,
        max: score + binSize,
        count: count,
        isStudent: score <= studentScore && studentScore < score + binSize,
        percentage: scores.length > 0 ? ((count / scores.length) * 100).toFixed(1) : '0.0'
      });
    }
    
    return bins;
  };

  const drawBothHistograms = (data) => {
    const currentData = data[selectedRound];
    if (!currentData) return;

    drawSingleHistogram(
      nationalCanvasRef.current, 
      currentData.nationalBins, 
      currentData.nationalAvg, 
      `전국 평균 (총 ${currentData.totalNational}명)`, 
      '#7ea2ff'
    );
    
    drawSingleHistogram(
      schoolCanvasRef.current, 
      currentData.schoolBins, 
      currentData.schoolAvg, 
      `${school} 평균 (총 ${currentData.totalSchool}명)`, 
      '#22c55e'
    );
  };

  const drawSingleHistogram = (canvas, bins, average, title, primaryColor) => {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const W = rect.width;
    const H = rect.height;
    
    ctx.clearRect(0, 0, W, H);

    const padding = { left: 50, right: 20, top: 50, bottom: 60 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;
    
    // 제목
    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 20);
    ctx.fillStyle = '#9db0d6';
    ctx.font = '12px system-ui';
    ctx.fillText(`평균: ${average}점`, W / 2, 35);
    
    // 축 그리기
    drawAxes(ctx, padding, chartW, chartH, bins);
    
    // 히스토그램 바 그리기
    drawBars(ctx, padding, chartW, chartH, bins, primaryColor);
    
    // 204점 컷오프 라인
    drawCutoffLine(ctx, padding, chartW, chartH);
  };

  const drawAxes = (ctx, padding, chartW, chartH, bins) => {
    ctx.strokeStyle = '#213056';
    ctx.lineWidth = 1;
    
    // Y축
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.stroke();
    
    // X축
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();
    
    // X축 라벨 (점수)
    ctx.fillStyle = '#9db0d6';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    
    const scoreStep = 30;
    for (let score = 180; score <= 340; score += scoreStep) {
      const x = padding.left + ((score - 180) / 160) * chartW;
      ctx.fillText(score.toString(), x, padding.top + chartH + 15);
      
      // 격자선
      if (score > 180 && score < 340) {
        ctx.strokeStyle = 'rgba(33, 48, 86, 0.2)';
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
      }
    }
    
    // Y축 라벨 (학생 수) - 실제 최대값 기준
    const maxCount = Math.max(...bins.map(b => b.count));
    const yStep = Math.max(1, Math.ceil(maxCount / 4));
    
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const count = i * yStep;
      const y = padding.top + chartH - (i / 4) * chartH;
      ctx.fillText(count.toString(), padding.left - 5, y + 3);
    }
    
    // 축 제목
    ctx.fillStyle = '#9db0d6';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('점수', padding.left + chartW / 2, padding.top + chartH + 35);
    
    ctx.save();
    ctx.translate(12, padding.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('학생 수', 0, 0);
    ctx.restore();
  };

  const drawBars = (ctx, padding, chartW, chartH, bins, primaryColor) => {
    const binWidth = chartW / bins.length;
    const maxCount = Math.max(1, Math.max(...bins.map(b => b.count))); // 0으로 나누기 방지
    
    bins.forEach((bin, index) => {
      const x = padding.left + index * binWidth;
      const barHeight = maxCount > 0 ? (bin.count / maxCount) * chartH : 0;
      const y = padding.top + chartH - barHeight;
      
      // 바 색상
      let fillColor;
      if (bin.isStudent) {
        fillColor = '#ef4444'; // 본인 위치
      } else {
        fillColor = primaryColor + '80'; // 투명도 추가
      }
      
      // 바 그리기 (학생 수가 0이어도 최소 높이 표시)
      const minHeight = bin.count > 0 ? Math.max(barHeight, 2) : 0;
      if (minHeight > 0) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(x + 1, y, binWidth - 2, minHeight);
        
        // 본인 위치 테두리
        if (bin.isStudent) {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y, binWidth - 2, minHeight);
        }
      }
      
      // 구간 라벨 (선택적으로)
      if (index % 6 === 0 && binWidth > 15) {
        ctx.fillStyle = '#9db0d6';
        ctx.font = '8px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`${bin.min}`, x + binWidth/2, padding.top + chartH + 25);
      }
    });
  };

  const drawCutoffLine = (ctx, padding, chartW, chartH) => {
    const cutoffScore = 204;
    const x = padding.left + ((cutoffScore - 180) / 160) * chartW;
    
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.stroke();
    
    ctx.setLineDash([]);
  };

  const handleCanvasClick = (event, chartType) => {
    const canvas = chartType === 'national' ? nationalCanvasRef.current : schoolCanvasRef.current;
    if (!canvas || histogramData.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const padding = { left: 50, right: 20, top: 50, bottom: 60 };
    const chartW = rect.width - padding.left - padding.right;
    const chartH = rect.height - padding.top - padding.bottom;
    const bins = chartType === 'national' ? histogramData[selectedRound].nationalBins : histogramData[selectedRound].schoolBins;
    const binWidth = chartW / bins.length;
    
    if (x >= padding.left && x <= padding.left + chartW && 
        y >= padding.top && y <= padding.top + chartH) {
      
      const binIndex = Math.floor((x - padding.left) / binWidth);
      const bin = bins[binIndex];
      
      if (bin) {
        const chartName = chartType === 'national' ? '전국' : school;
        alert(`${chartName} - ${bin.min}-${bin.max}점 구간\n학생 수: ${bin.count}명\n비율: ${bin.percentage}%`);
      }
    }
  };

  return (
    <div>
      {/* 회차 선택 버튼들 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center',
        marginBottom: '20px',
        gap: '8px',
        flexWrap: 'wrap'
      }}>
        {rounds.map((round, index) => (
          <button
            key={index}
            onClick={() => setSelectedRound(index)}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: selectedRound === index ? '2px solid var(--primary)' : '1px solid var(--line)',
              background: selectedRound === index ? 'var(--primary)' : 'var(--surface)',
              color: selectedRound === index ? '#fff' : 'var(--ink)',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
              minWidth: '60px'
            }}
          >
            {round.label}
          </button>
        ))}
      </div>
      
      {/* 현재 선택된 정보 */}
      {histogramData[selectedRound] && (
        <div style={{ 
          marginBottom: '16px', 
          padding: '12px', 
          background: 'rgba(21,29,54,0.5)', 
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '14px',
          color: 'var(--muted)'
        }}>
          <strong style={{ color: 'var(--ink)' }}>{rounds[selectedRound]?.label}</strong> - 
          본인 점수: <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{histogramData[selectedRound].studentScore}점</span>
        </div>
      )}
      
      {/* 좌우 분할 히스토그램 */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '16px',
        marginBottom: '16px'
      }}>
        {/* 전국 히스토그램 */}
        <div style={{ 
          background: 'rgba(0,0,0,0.1)',
          borderRadius: '8px',
          border: '1px solid var(--line)',
          overflow: 'hidden'
        }}>
          <canvas
            ref={nationalCanvasRef}
            onClick={(e) => handleCanvasClick(e, 'national')}
            style={{
              width: '100%',
              height: '350px',
              cursor: 'pointer',
              display: 'block'
            }}
          />
        </div>
        
        {/* 내 학교 히스토그램 */}
        <div style={{ 
          background: 'rgba(0,0,0,0.1)',
          borderRadius: '8px',
          border: '1px solid var(--line)',
          overflow: 'hidden'
        }}>
          <canvas
            ref={schoolCanvasRef}
            onClick={(e) => handleCanvasClick(e, 'school')}
            style={{
              width: '100%',
              height: '350px',
              cursor: 'pointer',
              display: 'block'
            }}
          />
        </div>
      </div>
      
      {/* 범례 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        gap: '24px',
        marginBottom: '12px',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ 
            width: '12px', 
            height: '12px', 
            background: '#7ea2ff80',
            borderRadius: '2px'
          }}></div>
          <span style={{ color: 'var(--muted)' }}>전국/학교 분포</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ 
            width: '12px', 
            height: '12px', 
            background: '#ef4444',
            borderRadius: '2px'
          }}></div>
          <span style={{ color: 'var(--muted)' }}>본인 위치</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ 
            width: '12px', 
            height: '2px', 
            background: '#f59e0b',
            borderRadius: '1px'
          }}></div>
          <span style={{ color: 'var(--muted)' }}>합격선 (204점)</span>
        </div>
      </div>
      
      {/* 설명 */}
      <div className="small" style={{ textAlign: 'center', opacity: 0.8 }}>
        막대를 클릭하면 해당 점수 구간의 실제 학생 수를 확인할 수 있습니다.
      </div>
    </div>
  );
}

export default TrendChart;

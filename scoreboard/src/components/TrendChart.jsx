// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages } from '../utils/helpers';

function TrendChart({ rounds, school, sid }) {
  const [viewMode, setViewMode] = useState('national'); // 'national' | 'school'
  const [selectedRound, setSelectedRound] = useState(0);
  const [hoveredBin, setHoveredBin] = useState(null);
  const canvasRef = useRef(null);
  const [histogramData, setHistogramData] = useState([]);

  useEffect(() => {
    prepareAndDrawHistogram();
  }, [rounds, viewMode, selectedRound]);

  const prepareAndDrawHistogram = async () => {
    if (rounds.length === 0) return;
    
    const data = [];
    
    for (const round of rounds) {
      const { label, data: roundData } = round;
      const studentScore = roundData.totalScore || 0;
      
      // 평균 데이터 가져오기
      const averages = await getAverages(school, label);
      const referenceAvg = viewMode === 'national' ? averages.nationalAvg : averages.schoolAvg;
      
      // 실제 점수 분포 시뮬레이션 (나중에 실제 데이터로 교체)
      const bins = generateScoreDistribution(referenceAvg, studentScore);
      
      data.push({
        label,
        studentScore,
        referenceAvg,
        bins,
        totalStudents: bins.reduce((sum, bin) => sum + bin.count, 0)
      });
    }
    
    setHistogramData(data);
    drawHistogram(data);
  };

  const generateScoreDistribution = (avg, studentScore) => {
    const bins = [];
    const minScore = 180;
    const maxScore = 340;
    const binSize = 5;
    const totalStudents = 1000; // 시뮬레이션용
    
    for (let score = minScore; score < maxScore; score += binSize) {
      const binCenter = score + binSize / 2;
      
      // 정규분포 기반 학생 수 계산
      const normalValue = calculateNormalDistribution(binCenter, avg, 25);
      const count = Math.max(1, Math.round(normalValue * totalStudents * 100));
      
      bins.push({
        min: score,
        max: score + binSize,
        center: binCenter,
        count: count,
        isStudent: score <= studentScore && studentScore < score + binSize,
        percentage: ((count / totalStudents) * 100).toFixed(1)
      });
    }
    
    return bins;
  };

  const calculateNormalDistribution = (x, mean, stdDev) => {
    const coefficient = 1 / (stdDev * Math.sqrt(2 * Math.PI));
    const exponent = -0.5 * Math.pow((x - mean) / stdDev, 2);
    return coefficient * Math.exp(exponent);
  };

  const drawHistogram = (data) => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const W = rect.width;
    const H = rect.height;
    
    ctx.clearRect(0, 0, W, H);

    const currentData = data[selectedRound];
    if (!currentData) return;

    const padding = { left: 60, right: 40, top: 40, bottom: 60 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;
    
    // 축 그리기
    drawAxes(ctx, padding, chartW, chartH, currentData);
    
    // 히스토그램 바 그리기
    drawBars(ctx, padding, chartW, chartH, currentData);
    
    // 204점 컷오프 라인
    drawCutoffLine(ctx, padding, chartW, chartH);
    
    // 범례
    drawLegend(ctx, W, H, padding);
  };

  const drawAxes = (ctx, padding, chartW, chartH, data) => {
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
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    
    const scoreStep = 20;
    for (let score = 180; score <= 340; score += scoreStep) {
      const x = padding.left + ((score - 180) / 160) * chartW;
      ctx.fillText(score.toString(), x, padding.top + chartH + 20);
      
      // 격자선
      if (score > 180 && score < 340) {
        ctx.strokeStyle = 'rgba(33, 48, 86, 0.3)';
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
      }
    }
    
    // Y축 라벨 (학생 수)
    const maxCount = Math.max(...data.bins.map(b => b.count));
    const yStep = Math.ceil(maxCount / 5);
    
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const count = i * yStep;
      const y = padding.top + chartH - (i / 5) * chartH;
      ctx.fillText(count.toString(), padding.left - 10, y + 4);
      
      // 격자선
      if (i > 0) {
        ctx.strokeStyle = 'rgba(33, 48, 86, 0.3)';
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartW, y);
        ctx.stroke();
      }
    }
    
    // 축 제목
    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('점수', padding.left + chartW / 2, padding.top + chartH + 45);
    
    ctx.save();
    ctx.translate(15, padding.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('학생 수', 0, 0);
    ctx.restore();
  };

  const drawBars = (ctx, padding, chartW, chartH, data) => {
    const binWidth = chartW / data.bins.length;
    const maxCount = Math.max(...data.bins.map(b => b.count));
    
    data.bins.forEach((bin, index) => {
      const x = padding.left + index * binWidth;
      const barHeight = (bin.count / maxCount) * chartH;
      const y = padding.top + chartH - barHeight;
      
      // 바 색상
      let fillColor;
      if (bin.isStudent) {
        fillColor = '#ef4444'; // 본인 위치
      } else {
        fillColor = viewMode === 'national' ? 'rgba(126, 162, 255, 0.7)' : 'rgba(34, 197, 94, 0.7)';
      }
      
      // 호버 효과
      if (hoveredBin === index) {
        fillColor = bin.isStudent ? '#dc2626' : (viewMode === 'national' ? '#5b8def' : '#16a34a');
      }
      
      // 바 그리기
      ctx.fillStyle = fillColor;
      ctx.fillRect(x + 1, y, binWidth - 2, barHeight);
      
      // 본인 위치 테두리
      if (bin.isStudent) {
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y, binWidth - 2, barHeight);
      }
      
      // 구간 라벨 (일부만)
      if (index % 4 === 0) {
        ctx.fillStyle = '#9db0d6';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`${bin.min}-${bin.max}`, x + binWidth/2, padding.top + chartH + 35);
      }
    });
  };

  const drawCutoffLine = (ctx, padding, chartW, chartH) => {
    const cutoffScore = 204;
    const x = padding.left + ((cutoffScore - 180) / 160) * chartW;
    
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.stroke();
    
    ctx.setLineDash([]);
    
    // 컷오프 라벨
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('합격선 (204점)', x + 5, padding.top + 15);
  };

  const drawLegend = (ctx, W, H, padding) => {
    const legendY = padding.top - 20;
    
    // 범례 항목
    const legendItems = [
      { color: viewMode === 'national' ? 'rgba(126, 162, 255, 0.7)' : 'rgba(34, 197, 94, 0.7)', label: '다른 학생' },
      { color: '#ef4444', label: '본인 위치' },
      { color: '#f59e0b', label: '합격선' }
    ];
    
    let legendX = W - 250;
    legendItems.forEach((item, index) => {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX + index * 80, legendY - 6, 10, 10);
      ctx.fillStyle = '#e8eeff';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, legendX + index * 80 + 14, legendY + 2);
    });
  };

  const handleCanvasClick = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || histogramData.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const padding = { left: 60, right: 40, top: 40, bottom: 60 };
    const chartW = rect.width - padding.left - padding.right;
    const binWidth = chartW / histogramData[selectedRound].bins.length;
    
    if (x >= padding.left && x <= padding.left + chartW && 
        y >= padding.top && y <= padding.top + (rect.height - padding.top - padding.bottom)) {
      
      const binIndex = Math.floor((x - padding.left) / binWidth);
      const bin = histogramData[selectedRound].bins[binIndex];
      
      if (bin) {
        alert(`${bin.min}-${bin.max}점 구간\n학생 수: ${bin.count}명\n전체 비율: ${bin.percentage}%`);
      }
    }
  };

  const handleCanvasMouseMove = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || histogramData.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    
    const padding = { left: 60, right: 40, top: 40, bottom: 60 };
    const chartW = rect.width - padding.left - padding.right;
    const binWidth = chartW / histogramData[selectedRound].bins.length;
    
    if (x >= padding.left && x <= padding.left + chartW) {
      const binIndex = Math.floor((x - padding.left) / binWidth);
      setHoveredBin(binIndex);
      canvas.style.cursor = 'pointer';
    } else {
      setHoveredBin(null);
      canvas.style.cursor = 'default';
    }
  };

  return (
    <div>
      {/* 회차 선택 + 전국/내학교 탭 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '16px',
        gap: '16px'
      }}>
        {/* 회차 선택 */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {rounds.map((round, index) => (
            <button
              key={index}
              onClick={() => setSelectedRound(index)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: selectedRound === index ? '2px solid var(--primary)' : '1px solid var(--line)',
                background: selectedRound === index ? 'var(--primary)' : 'transparent',
                color: selectedRound === index ? '#fff' : 'var(--muted)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {round.label}
            </button>
          ))}
        </div>
        
        {/* 전국/내학교 탭 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setViewMode('national')}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: viewMode === 'national' ? 'var(--primary)' : 'transparent',
              color: viewMode === 'national' ? '#fff' : 'var(--muted)',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            전국
          </button>
          <button
            onClick={() => setViewMode('school')}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: viewMode === 'school' ? 'var(--ok)' : 'transparent',
              color: viewMode === 'school' ? '#fff' : 'var(--muted)',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            내 학교
          </button>
        </div>
      </div>
      
      {/* 현재 선택된 정보 */}
      {histogramData[selectedRound] && (
        <div style={{ 
          marginBottom: '12px', 
          padding: '8px 12px', 
          background: 'rgba(21,29,54,0.5)', 
          borderRadius: '6px',
          fontSize: '13px',
          color: 'var(--muted)'
        }}>
          <strong style={{ color: 'var(--ink)' }}>{rounds[selectedRound]?.label}</strong> - 
          본인 점수: <span style={{ color: 'var(--primary)' }}>{histogramData[selectedRound].studentScore}점</span> | 
          {viewMode === 'national' ? '전국' : '내 학교'} 평균: <span style={{ color: 'var(--ok)' }}>{histogramData[selectedRound].referenceAvg}점</span>
        </div>
      )}
      
      {/* 히스토그램 캔버스 */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={() => setHoveredBin(null)}
        style={{
          width: '100%',
          height: '400px',
          background: 'rgba(0,0,0,0.1)',
          borderRadius: '8px',
          border: '1px solid var(--line)',
          cursor: 'default'
        }}
      />
      
      {/* 설명 */}
      <div className="small" style={{ marginTop: '12px', opacity: 0.8 }}>
        막대를 클릭하면 해당 점수 구간의 학생 수를 확인할 수 있습니다. 
        노란 선은 합격선(204점)입니다.
      </div>
    </div>
  );
}

export default TrendChart;

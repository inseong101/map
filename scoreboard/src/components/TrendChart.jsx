// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages } from '../utils/helpers';

function TrendChart({ rounds, school, sid }) {
  const [viewMode, setViewMode] = useState('national'); // 'national' | 'school'
  const canvasRef = useRef(null);

  useEffect(() => {
    drawHistogram();
  }, [rounds, viewMode]);

  const drawHistogram = async () => {
    const canvas = canvasRef.current;
    if (!canvas || rounds.length === 0) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width = 800;
    const H = canvas.height = 400;
    ctx.clearRect(0, 0, W, H);

    // 데이터 준비
    const histogramData = await prepareHistogramData();
    if (!histogramData || histogramData.length === 0) return;

    // 히스토그램 그리기
    drawHistogramBars(ctx, histogramData, W, H);
  };

  const prepareHistogramData = async () => {
    const data = [];
    
    for (const round of rounds) {
      const { label, data: roundData } = round;
      const studentScore = roundData.totalScore || 0;
      
      // 평균 데이터 가져오기
      const averages = await getAverages(school, label);
      const referenceAvg = viewMode === 'national' ? averages.nationalAvg : averages.schoolAvg;
      
      // 5점 단위로 히스토그램 생성 (200-340점 범위)
      const bins = createBins(referenceAvg, studentScore);
      
      data.push({
        label,
        studentScore,
        referenceAvg,
        bins,
        studentBinIndex: Math.floor((studentScore - 200) / 5)
      });
    }
    
    return data;
  };

  const createBins = (referenceAvg, studentScore) => {
    const bins = [];
    const minScore = 200;
    const maxScore = 340;
    const binSize = 5;
    
    // 정규분포 근사로 히스토그램 생성
    for (let score = minScore; score < maxScore; score += binSize) {
      const binCenter = score + binSize / 2;
      const height = calculateNormalDistribution(binCenter, referenceAvg, 30); // 표준편차 30 가정
      
      bins.push({
        min: score,
        max: score + binSize,
        height: height * 100, // 스케일 조정
        isStudent: score <= studentScore && studentScore < score + binSize
      });
    }
    
    return bins;
  };

  const calculateNormalDistribution = (x, mean, stdDev) => {
    const coefficient = 1 / (stdDev * Math.sqrt(2 * Math.PI));
    const exponent = -0.5 * Math.pow((x - mean) / stdDev, 2);
    return coefficient * Math.exp(exponent);
  };

  const drawHistogramBars = (ctx, histogramData, W, H) => {
    const padding = 60;
    const chartW = W - padding * 2;
    const chartH = H - padding * 2;
    const roundCount = histogramData.length;
    const roundWidth = chartW / roundCount;
    
    histogramData.forEach((roundData, roundIndex) => {
      const x = padding + roundIndex * roundWidth;
      const y = padding;
      const w = roundWidth - 20; // 라운드 간 간격
      const h = chartH - 40;
      
      drawSingleHistogram(ctx, roundData, x, y, w, h);
      
      // 라운드 라벨
      ctx.fillStyle = '#e8eeff';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(roundData.label, x + w/2, H - 10);
    });
    
    // 범례
    drawLegend(ctx, W, padding);
  };

  const drawSingleHistogram = (ctx, roundData, x, y, w, h) => {
    const { bins, studentBinIndex } = roundData;
    const maxHeight = Math.max(...bins.map(b => b.height));
    const binWidth = w / bins.length;
    
    bins.forEach((bin, index) => {
      const binX = x + index * binWidth;
      const binHeight = (bin.height / maxHeight) * h * 0.8;
      const binY = y + h - binHeight;
      
      // 막대 색상 결정
      let fillColor;
      if (bin.isStudent) {
        fillColor = '#ff6b6b'; // 본인 위치 - 빨간색
      } else {
        fillColor = viewMode === 'national' ? 'rgba(126, 162, 255, 0.7)' : 'rgba(34, 197, 94, 0.7)';
      }
      
      // 막대 그리기
      ctx.fillStyle = fillColor;
      ctx.fillRect(binX, binY, binWidth - 1, binHeight);
      
      // 테두리
      if (bin.isStudent) {
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 2;
        ctx.strokeRect(binX, binY, binWidth - 1, binHeight);
      }
    });
    
    // 점수 표시
    ctx.fillStyle = '#e8eeff';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${roundData.studentScore}점`, x + w/2, y - 5);
  };

  const drawLegend = (ctx, W, padding) => {
    const legendY = 20;
    
    // 전국/내 학교 표시
    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${viewMode === 'national' ? '전국' : '내 학교'} 평균 기준 분포`, padding, legendY);
    
    // 색상 범례
    const legendItems = [
      { color: viewMode === 'national' ? 'rgba(126, 162, 255, 0.7)' : 'rgba(34, 197, 94, 0.7)', label: '다른 학생' },
      { color: '#ff6b6b', label: '본인 위치' }
    ];
    
    legendItems.forEach((item, index) => {
      const x = W - 200 + index * 100;
      ctx.fillStyle = item.color;
      ctx.fillRect(x, legendY - 8, 12, 12);
      ctx.fillStyle = '#e8eeff';
      ctx.font = '11px system-ui';
      ctx.fillText(item.label, x + 16, legendY + 2);
    });
  };

  return (
    <div>
      {/* 탭 버튼 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'flex-end', 
        marginBottom: '12px',
        gap: '8px'
      }}>
        <button
          className={`tab-btn ${viewMode === 'national' ? 'active' : ''}`}
          onClick={() => setViewMode('national')}
          style={{
            padding: '6px 12px',
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
          className={`tab-btn ${viewMode === 'school' ? 'active' : ''}`}
          onClick={() => setViewMode('school')}
          style={{
            padding: '6px 12px',
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
      
      {/* 히스토그램 캔버스 */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '400px',
          background: 'rgba(0,0,0,0.1)',
          borderRadius: '8px',
          border: '1px solid var(--line)'
        }}
      />
      
      {/* 설명 */}
      <div className="small" style={{ marginTop: '8px', opacity: 0.8 }}>
        {viewMode === 'national' ? '전국' : '내 학교'} 평균 기준 점수 분포. 
        빨간색 막대가 본인 위치입니다.
      </div>
    </div>
  );
}

export default TrendChart;

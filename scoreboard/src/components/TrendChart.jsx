// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution } from '../utils/helpers';

function TrendChart({ rounds, school, sid }) {
  const [selectedRound, setSelectedRound] = useState(0);
  const nationalCanvasRef = useRef(null);
  const schoolCanvasRef = useRef(null);
  const [histogramData, setHistogramData] = useState([]);
  const [hoveredBin, setHoveredBin] = useState({ chart: null, bin: null });

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
      const schoolCode = getSchoolCode(school);
      const schoolScores = scoreDistribution.bySchool?.[schoolCode] || [];
      const schoolBins = createRealBins(schoolScores, studentScore);
      
      data.push({
        label,
        studentScore,
        nationalAvg: averages.nationalAvg,
        schoolAvg: averages.schoolAvg,
        nationalBins,
        schoolBins,
        totalNational: scoreDistribution.national.length,
        totalSchool: schoolScores.length
      });
    }
    
    setHistogramData(data);
    drawBothHistograms(data);
  };

  const getSchoolCode = (schoolName) => {
    const schoolMap = {
      "가천대": "01", "경희대": "02", "대구한": "03", "대전대": "04",
      "동국대": "05", "동신대": "06", "동의대": "07", "부산대": "08",
      "상지대": "09", "세명대": "10", "우석대": "11", "원광대": "12"
    };
    return schoolMap[schoolName] || "01";
  };

  const createRealBins = (scores, studentScore) => {
    // 유효한 학수번호만 필터링 (01~12로 시작하는 것만)
    const validScores = scores.filter(score => {
      // 점수가 아니라 학번으로부터 판단해야 하는데, 여기서는 점수만 있으므로
      // helpers.js의 getRealScoreDistribution에서 필터링하도록 수정 필요
      return true; // 임시로 모든 점수 포함
    });

    const bins = [];
    const minScore = 180;
    const maxScore = 340;
    const binSize = 5;
    
    // 5점 단위로 구간 생성
    for (let score = minScore; score < maxScore; score += binSize) {
      const count = validScores.filter(s => s >= score && s < score + binSize).length;
      
      bins.push({
        min: score,
        max: score + binSize,
        count: count,
        isStudent: score <= studentScore && studentScore < score + binSize,
        percentage: validScores.length > 0 ? ((count / validScores.length) * 100).toFixed(1) : '0.0'
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
      '#7ea2ff',
      'national'
    );
    
    drawSingleHistogram(
      schoolCanvasRef.current, 
      currentData.schoolBins, 
      currentData.schoolAvg, 
      `${school} 평균 (총 ${currentData.totalSchool}명)`, 
      '#22c55e',
      'school'
    );
  };

  const drawSingleHistogram = (canvas, bins, average, title, primaryColor, chartType) => {
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
    drawBars(ctx, padding, chartW, chartH, bins, primaryColor, chartType);
    
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

  const drawBars = (ctx, padding, chartW, chartH, bins, primaryColor, chartType) => {
    const binWidth = chartW / bins.length;
    const maxCount = Math.max(1, Math.max(...bins.map(b => b.count)));
    
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
      
      // 바 그리기
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
        
        // 호버된 막대의 데이터 레이블만 표시
        if (hoveredBin.chart === chartType && hoveredBin.bin === index && bin.count > 0) {
          ctx.fillStyle = bin.isStudent ? '#fff' : '#e8eeff';
          ctx.font = 'bold 10px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(bin.count.toString(), x + binWidth/2, y - 5);
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

  const handleCanvasMouseMove = (event, chartType) => {
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
      setHoveredBin({ chart: chartType, bin: binIndex });
    } else {
      setHoveredBin({ chart: null, bin: null });
    }
    
    // 호버 상태 변경시 재그리기
    drawBothHistograms(histogramData);
  };

  const handleCanvasMouseLeave = () => {
    setHoveredBin({ chart: null, bin: null });
    drawBothHistograms(histogramData);
  };

  return (
    <div>
      {/* 제목과 회차 선택 버튼들 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        gap: '16px'
      }}>
        <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--muted)', fontWeight: '700' }}>
          회차별 성적 추이
        </h2>
        
        <div style={{ 
          display: 'flex',
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
            onMouseMove={(e) => handleCanvasMouseMove(e, 'national')}
            onMouseLeave={handleCanvasMouseLeave}
            style={{
              width: '100%',
              height: '350px',
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
            onMouseMove={(e) => handleCanvasMouseMove(e, 'school')}
            onMouseLeave={handleCanvasMouseLeave}
            style={{
              width: '100%',
              height: '350px',
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
        막대에 마우스를 올리면 해당 구간의 학생 수를 확인할 수 있습니다.
      </div>
    </div>
  );
}

export default TrendChart;

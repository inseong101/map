// src/components/TrendChart.jsx - 등수 및 상세 정보 추가
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution, getAbsenceStatistics } from '../utils/helpers';

// 학교명 → 코드 변환
const nameToCode = (name) => ({
  '가천대': '01', '경희대': '02', '대구한': '03', '대전대': '04',
  '동국대': '05', '동신대': '06', '동의대': '07', '부산대': '08',
  '상지대': '09', '세명대': '10', '우석대': '11', '원광대': '12',
}[name] || '01');

// 축/범위 상수
const X_MIN = 0;
const X_MAX = 340;
const BIN_SIZE = 5;
const CUTOFF_SCORE = 204;

function TrendChart({ rounds = [], school = '', sid = '' }) {
  const canvasRef = useRef(null);
  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false);
  const [bundle, setBundle] = useState([]);

  // 본인 등수 계산 함수
  function calculateRank(scores, studentScore) {
    if (!Number.isFinite(studentScore) || !scores.length) return null;
    
    const betterScores = scores.filter(score => score > studentScore).length;
    const rank = betterScores + 1;
    const total = scores.length;
    const percentile = Math.round((1 - (rank - 1) / total) * 100);
    
    return { rank, total, percentile };
  }

  // 리사이즈시 리렌더링
  useEffect(() => {
    const onResize = () => drawCurrent(bundle);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bundle, isSchoolMode, selectedRoundIdx]);

  // 데이터 준비 + 그리기
  useEffect(() => {
    (async () => {
      if (!rounds.length) return;

      const schCode = nameToCode(school);
      const out = [];

      for (const round of rounds) {
        const { label, data: roundData } = round;
        
        const studentScore = Number.isFinite(roundData?.totalScore)
          ? Number(roundData.totalScore)
          : null;

        // 평균, 분포, 미응시자 통계 모두 가져오기
        const [averages, dist, absenceStats] = await Promise.all([
          getAverages(school, label),
          getRealScoreDistribution(label),
          getAbsenceStatistics(label)
        ]);
        
        const natScores = Array.isArray(dist?.national) ? dist.national : [];
        const schScores = dist?.bySchool && Array.isArray(dist.bySchool[schCode])
          ? dist.bySchool[schCode]
          : [];

        // 본인 등수 계산
        const nationalRank = calculateRank(natScores, studentScore);
        const schoolRank = calculateRank(schScores, studentScore);

        const nat = buildDistribution(natScores, studentScore);
        const sch = buildDistribution(schScores, studentScore);

        out.push({
          label,
          studentScore,
          nationalAvg: averages?.nationalAvg ?? '-',
          schoolAvg: averages?.schoolAvg ?? '-',
          nationalBins: nat,
          schoolBins: sch,
          totalNational: natScores.length,
          totalSchool: schScores.length,
          absenceStats,
          nationalRank,
          schoolRank
        });
      }

      setBundle(out);
      drawCurrent(out);
    })();
  }, [rounds, school, sid]);

  // 그리기 트리거
  useEffect(() => {
    drawCurrent(bundle);
  }, [bundle, selectedRoundIdx, isSchoolMode]);

  // 분포 생성
  function buildDistribution(scores, studentScore) {
    const bins = [];

    for (let x = X_MIN; x < X_MAX; x += BIN_SIZE) {
      const count = scores.filter(s => s >= x && s < x + BIN_SIZE).length;
      bins.push({
        min: x,
        max: x + BIN_SIZE,
        count,
        isStudent: studentScore != null && studentScore >= x && studentScore < x + BIN_SIZE,
        percentage: scores.length > 0 ? (count / scores.length) * 100 : 0
      });
    }

    const lastCount = scores.filter(s => s === X_MAX).length;
    bins.push({
      min: X_MAX,
      max: X_MAX,
      count: lastCount,
      isStudent: studentScore === X_MAX,
      percentage: scores.length > 0 ? (lastCount / scores.length) * 100 : 0
    });

    return bins;
  }

  // 현재 선택된 회차 그리기
  function drawCurrent(data) {
    const cur = data[selectedRoundIdx];
    if (!cur) return;

    const canvas = canvasRef.current;
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

    const padding = { left: 56, right: 20, top: 64, bottom: 64 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    // 제목 생성 (분포 표시는 응시자만)
    const createTitle = () => {
      if (isSchoolMode) {
        return `${school} 분포 (응시자 ${cur.totalSchool}명)`;
      } else {
        return `전국 분포 (응시자 ${cur.totalNational}명)`;
      }
    };

    const title = createTitle();
    const avg = isSchoolMode ? cur.schoolAvg : cur.nationalAvg;

    // 제목
    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 22);
    ctx.fillStyle = '#9db0d6';
    ctx.font = '12px system-ui';
    ctx.fillText(`평균: ${avg}점`, W / 2, 40);

    // 축/격자 + Y축 최대값 반환
    const activeBins = isSchoolMode ? cur.schoolBins : cur.nationalBins;
    const yMax = drawAxes(ctx, padding, chartW, chartH, activeBins);

    // 막대 그리기
    const color = isSchoolMode ? '#22c55e' : '#7ea2ff';
    drawBarsWithLabels(ctx, padding, chartW, chartH, activeBins, color, yMax);

    // 합격선
    drawCutoff(ctx, padding, chartW, chartH, CUTOFF_SCORE);
  }

  // 나머지 그리기 함수들은 기존과 동일 (drawAxes, drawBarsWithLabels, drawCutoff 등)
  function drawAxes(ctx, padding, chartW, chartH, bins) {
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

    // X축 라벨
    ctx.fillStyle = '#9db0d6';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';

    const xTickStep = 40;
    for (let s = X_MIN; s <= X_MAX; s += xTickStep) {
      const x = padding.left + ((s - X_MIN) / (X_MAX - X_MIN)) * chartW;
      ctx.fillText(String(s), x, padding.top + chartH + 16);
      if (s > X_MIN && s < X_MAX) {
        ctx.strokeStyle = 'rgba(33,48,86,0.2)';
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
      }
    }

    // Y축 눈금
    const maxCount = Math.max(1, ...bins.map(b => b.count));
    const steps = 4;
    const niceStep = makeNiceStep(maxCount / steps);
    const yStep = Math.max(1, niceStep);
    const yMax = yStep * steps;

    ctx.textAlign = 'right';
    ctx.fillStyle = '#9db0d6';
    ctx.font = '10px system-ui';

    for (let i = 0; i <= steps; i++) {
      const val = i * yStep;
      const y = padding.top + chartH - (val / yMax) * chartH;
      ctx.fillText(String(val), padding.left - 6, y + 3);

      if (i > 0 && i < steps) {
        ctx.strokeStyle = 'rgba(33,48,86,0.2)';
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartW, y);
        ctx.stroke();
      }
    }

    return yMax;
  }

  function makeNiceStep(rawStep) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
  }

  function drawBarsWithLabels(ctx, padding, chartW, chartH, bins, color, yMax) {
    const barCount = bins.length;
    const barWidth = chartW / barCount;

    bins.forEach((bin, i) => {
      const x = padding.left + i * barWidth;
      const barHeight = (bin.count / yMax) * chartH;
      const y = padding.top + chartH - barHeight;

      // 막대
      ctx.fillStyle = bin.isStudent ? '#ef4444' : color;
      ctx.fillRect(x + 1, y, barWidth - 2, barHeight);

      // 본인 위치 강조
      if (bin.isStudent) {
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y, barWidth - 2, barHeight);
      }
    });
  }

  function drawCutoff(ctx, padding, chartW, chartH, cutoffScore) {
    const cutoffX = padding.left + ((cutoffScore - X_MIN) / (X_MAX - X_MIN)) * chartW;
    
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cutoffX, padding.top);
    ctx.lineTo(cutoffX, padding.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('합격선', cutoffX + 4, padding.top + 14);
  }

  // 상단 컨트롤
  const TopControls = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
      flexWrap: 'wrap',
      gap: 12
    }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {bundle.map((item, idx) => (
          <button
            key={item.label}
            onClick={() => setSelectedRoundIdx(idx)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: selectedRoundIdx === idx ? 'var(--primary)' : 'transparent',
              color: selectedRoundIdx === idx ? '#fff' : 'var(--ink)',
              cursor: 'pointer'
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>전국</span>
        <label style={{
          position: 'relative',
          display: 'inline-block',
          width: 44,
          height: 24,
          cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={isSchoolMode}
            onChange={(e) => setIsSchoolMode(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: isSchoolMode ? '#22c55e55' : '#7ea2ff55',
            transition: '.2s',
            borderRadius: 24
          }} />
          <span style={{
            position: 'absolute',
            height: 18, width: 18,
            left: isSchoolMode ? 24 : 4, bottom: 3,
            backgroundColor: '#fff',
            transition: '.2s',
            borderRadius: '50%',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)'
          }} />
        </label>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>학교</span>
      </div>
    </div>
  );

  // 정보 패널 (왼쪽: 미응시자 정보, 오른쪽: 본인 등수)
  const InfoPanel = () => {
    const current = bundle[selectedRoundIdx];
    if (!current) return null;

    const stats = current.absenceStats;
    const rank = isSchoolMode ? current.schoolRank : current.nationalRank;

    return (
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
        padding: 10,
        background: 'rgba(21,29,54,0.5)',
        borderRadius: 8,
        fontSize: 12,
        gap: 16
      }}>
        {/* 왼쪽: 미응시자 정보 */}
        <div style={{ color: 'var(--muted)', flex: 1 }}>
          {stats && (
            <div>
              <div><strong style={{ color: 'var(--ink)' }}>전체 현황</strong></div>
              <div>• 전체 대상자: {stats.totalExpected}명</div>
              <div>• 정상 응시자: {stats.fullAttendees}명</div>
              <div>• 중도포기자: {stats.partialAttendees}명</div>
              <div>• 전체 미응시: {stats.fullAbsentees}명</div>
            </div>
          )}
        </div>

        {/* 오른쪽: 본인 등수 */}
        <div style={{ color: 'var(--muted)', textAlign: 'right' }}>
          <div><strong style={{ color: 'var(--ink)' }}>본인 순위</strong></div>
          {rank ? (
            <div>
              <div style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '14px' }}>
                {rank.rank}등 / {rank.total}명
              </div>
              <div>상위 {rank.percentile}%</div>
              <div style={{ fontSize: '11px', opacity: 0.8 }}>
                ({isSchoolMode ? school : '전국'} 기준)
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted)' }}>
              점수 정보 없음
            </div>
          )}
        </div>
      </div>
    );
  };

  const LegendRow = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 16,
      alignItems: 'center',
      margin: '0 0 8px 0',
      fontSize: 12
    }}>
      <LegendItem color="#7ea2ff" label="전국 분포" />
      <LegendItem color="#22c55e" label="학교 분포" />
      <LegendItem color="#ef4444" label="본인 위치" />
      <LegendLine color="#f59e0b" label="합격선(204)" />
    </div>
  );

  const LegendItem = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block',
        width: 12, height: 12,
        borderRadius: 2,
        background: color
      }} />
      <span style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  );

  const LegendLine = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block',
        width: 18, height: 0,
        borderTop: `2px dashed ${color}`
      }} />
      <span style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  );

  return (
    <div>
      <TopControls />
      <InfoPanel />
      <LegendRow />
      
      <div style={{
        background: 'rgba(0,0,0,0.1)',
        borderRadius: 8,
        border: '1px solid var(--line)',
        overflow: 'hidden'
      }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: 380, display: 'block' }} />
      </div>
    </div>
  );
}

export default TrendChart;

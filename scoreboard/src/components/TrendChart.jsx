// src/components/TrendChart.jsx - 중도포기 용어 변경
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution, getAbsenceStatistics } from '../utils/helpers';

// 학교명 → 코드 변환 (helpers의 bySchool 키와 일치시켜야 함)
const nameToCode = (name) => ({
  '가천대': '01', '경희대': '02', '대구한': '03', '대전대': '04',
  '동국대': '05', '동신대': '06', '동의대': '07', '부산대': '08',
  '상지대': '09', '세명대': '10', '우석대': '11', '원광대': '12',
}[name] || '01');

// 축/범위 상수
const X_MIN = 0;
const X_MAX = 340;
const BIN_SIZE = 5;     // 5점 간격
const CUTOFF_SCORE = 204;

// 0~340까지 5점 간격 + 마지막 340 단일 bin 개수
const BIN_COUNT = Math.floor((X_MAX - X_MIN) / BIN_SIZE) + 1; // (0~335 5점간격=68개) + 마지막 340 = 69

function TrendChart({ rounds = [], school = '', sid = '' }) {
  const canvasRef = useRef(null);

  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false); // false=전국(기본), true=학교
  const [bundle, setBundle] = useState([]); // 회차별 계산된 결과 집합

  // 리사이즈시 리렌더링(재그리기)
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
        // 본인 점수: roundData.totalScore가 숫자면 표시
        const studentScore = Number.isFinite(roundData?.totalScore)
          ? Number(roundData.totalScore)
          : null;

        // 평균
        const averages = await getAverages(school, label);

        // 실제 분포
        const dist = await getRealScoreDistribution(label);
        
        // 미응시자 통계 추가
        const absenceStats = await getAbsenceStatistics(label);
        
        const natScores = Array.isArray(dist?.national) ? dist.national : [];
        const schScores = dist?.bySchool && Array.isArray(dist.bySchool[schCode])
          ? dist.bySchool[schCode]
          : [];

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
          absenceStats // 미응시자 통계 추가
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

    // 0~335 (5점 간격)
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

    // 마지막 340점
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

    // 타이틀/평균 - 중도포기 용어 변경
    const createTitle = () => {
      if (isSchoolMode) {
        return `${school} 분포 (총 ${cur.totalSchool}명)`;
      } else {
        // 전국 모드에서 미응시자 정보 표시
        const stats = cur.absenceStats;
        if (stats) {
          return `전국 분포 (총 ${stats.totalExpected}명, 응시자 ${stats.attendees}명, 미응시자 ${stats.fullAbsentees}명, 중도포기 ${stats.partialAttendees}명)`;
        } else {
          return `전국 분포 (총 ${cur.totalNational}명)`; // fallback
        }
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

    // 막대 (Y축 최대값 사용)
    const color = isSchoolMode ? '#22c55e' : '#7ea2ff';
    drawBarsWithLabels(ctx, padding, chartW, chartH, activeBins, color, yMax);

    // 커트라인
    drawCutoff(ctx, padding, chartW, chartH, CUTOFF_SCORE);
  }

  // 축/격자 그리기 - 막대 스케일과 동일한 yMax를 반환
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

    // X축 라벨 (0~340, 40 간격)
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

    // Y축 눈금: bins 최대 count 기준으로 "보기 좋은" yMax 산출
    const maxCount = Math.max(1, ...bins.map(b => b.count));
    const steps = 4;

    // 예쁜 눈금 올림 (1,2,5 스텝)
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

      // 수평 그리드
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

  // 예쁜 스텝 계산 (1, 2, 5의 배수로 올림)
  function makeNiceStep(rawStep) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
  }

  // 막대 + 본인 위치 표시
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

      // 본인 위치 강조 (빨간 테두리)
      if (bin.isStudent) {
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y, barWidth - 2, barHeight);
      }
    });
  }

  // 합격선 (204점) 그리기
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

    // 라벨
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
      {/* 회차 선택 */}
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
              background: selectedRoundIdx === idx ? 'var(--accent)' : 'transparent',
              color: selectedRoundIdx === idx ? '#fff' : 'var(--ink)',
              cursor: 'pointer'
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 전국/학교 토글 */}
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
          <span
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: isSchoolMode ? '#22c55e55' : '#7ea2ff55',
              transition: '.2s',
              borderRadius: 24
            }}
          />
          <span
            style={{
              position: 'absolute',
              height: 18,
              width: 18,
              left: isSchoolMode ? 24 : 4,
              bottom: 3,
              backgroundColor: '#fff',
              transition: '.2s',
              borderRadius: '50%',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)'
            }}
          />
        </label>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>학교</span>
      </div>
    </div>
  );

  // 카드 내부, 캔버스 바깥에 놓는 범례
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
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          borderRadius: 2,
          background: color
        }}
      />
      <span style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  );

  const LegendLine = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          display: 'inline-block',
          width: 18,
          height: 0,
          borderTop: `2px dashed ${color}`
        }}
      />
      <span style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  );

  const current = bundle[selectedRoundIdx];

  return (
    <div>
      <TopControls />

      {/* 현재 선택된 회차 + 본인 점수 */}
      {current && (
        <div style={{
          marginBottom: 8,
          padding: 10,
          background: 'rgba(21,29,54,0.5)',
          borderRadius: 8,
          textAlign: 'center',
          fontSize: 14,
          color: 'var(--muted)'
        }}>
          <strong style={{ color: 'var(--ink)' }}>{rounds[selectedRoundIdx]?.label}</strong>
          {' '}— 본인 점수:{' '}
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
            {Number.isFinite(current.studentScore) ? `${current.studentScore}점` : '표시 안함'}
          </span>
        </div>
      )}

      {/* 범례: 카드 안(캔버스 바깥) */}
      <LegendRow />

      {/* 차트 캔버스 */}
      <div
        style={{
          background: 'rgba(0,0,0,0.1)',
          borderRadius: 8,
          border: '1px solid var(--line)',
          overflow: 'hidden'
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: 380, display: 'block' }} />
      </div>
    </div>
  );
}

export default TrendChart;

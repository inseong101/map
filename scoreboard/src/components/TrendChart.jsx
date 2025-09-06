// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution } from '../utils/helpers';

// 학교명 → 코드 변환
const nameToCode = (name) => ({
  "가천대":"01","경희대":"02","대구한":"03","대전대":"04",
  "동국대":"05","동신대":"06","동의대":"07","부산대":"08",
  "상지대":"09","세명대":"10","우석대":"11","원광대":"12"
}[name] || "01");

// 유효 학수번호 prefix (01~12)
const isValidSubjectPrefix = (sid) => typeof sid === 'string' && /^(0[1-9]|1[0-2])/.test(sid);

// 점수-픽셀 변환 공용 범위
const X_MIN = 0;
const X_MAX = 340;
const CUTOFF_SCORE = 204;

function TrendChart({ rounds = [], school = '', sid = '' }) {
  const canvasRef = useRef(null);

  const [selectedRound, setSelectedRound] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false); // false=전국(기본), true=학교
  const [histogramData, setHistogramData] = useState([]);

  useEffect(() => {
    prepareAndDraw();
  }, [rounds, selectedRound, isSchoolMode]);

  const prepareAndDraw = async () => {
    if (!rounds.length) return;

    const data = [];
    const schoolCode = nameToCode(school);

    for (const round of rounds) {
      const { label, data: roundData } = round;

      // 본인 점수 (sid 유효하지 않으면 표시 배제)
      const studentScore = isValidSubjectPrefix(sid) ? (roundData?.totalScore || 0) : null;

      // 평균
      const averages = await getAverages(school, label);

      // 실제 분포 (도메인 전체 집계는 helpers/백엔드에서 01~12 prefix로 필터되었다고 가정)
      const dist = await getRealScoreDistribution(label);
      const natScores = Array.isArray(dist.national) ? dist.national : [];
      const schScores = (dist.bySchool && dist.bySchool[schoolCode])
        ? dist.bySchool[schoolCode]
        : [];

      const nationalBins = createBins(natScores, studentScore);
      const schoolBins   = createBins(schScores, studentScore);

      data.push({
        label,
        studentScore,
        nationalAvg: averages.nationalAvg,
        schoolAvg: averages.schoolAvg,
        nationalBins,
        schoolBins,
        totalNational: natScores.length,
        totalSchool: schScores.length
      });
    }

    setHistogramData(data);
    drawCurrent(data);
  };

  const createBins = (_scores, studentScore) => {
    const scores = Array.isArray(_scores) ? _scores : [];
    the bins = [];
    const binSize = 5;

    for (let s = X_MIN; s < X_MAX; s += binSize) {
      const count = scores.filter(v => v >= s && v < s + binSize).length;
      bins.push({
        min: s,
        max: s + binSize,
        count,
        isStudent: studentScore != null ? (s <= studentScore && studentScore < s + binSize) : false,
        percentage: scores.length > 0 ? ((count / scores.length) * 100) : 0
      });
    }
    // 마지막 단일 340점 bin
    const lastCount = scores.filter(v => v === X_MAX).length;
    bins.push({
      min: X_MAX,
      max: X_MAX,
      count: lastCount,
      isStudent: studentScore === X_MAX,
      percentage: scores.length > 0 ? ((lastCount / scores.length) * 100) : 0
    });

    return bins;
  };

  const drawCurrent = (data) => {
    const cur = data[selectedRound];
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

    // 타이틀/평균
    const title = isSchoolMode
      ? `${school} 분포 (총 ${cur.totalSchool}명)`
      : `전국 분포 (총 ${cur.totalNational}명)`;
    const avg = isSchoolMode ? cur.schoolAvg : cur.nationalAvg;

    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 22);
    ctx.fillStyle = '#9db0d6';
    ctx.font = '12px system-ui';
    ctx.fillText(`평균: ${avg}점`, W / 2, 40);

    // 축/격자
    const activeBins = isSchoolMode ? cur.schoolBins : cur.nationalBins;
    drawAxes(ctx, padding, chartW, chartH, activeBins);

    // 막대
    const color = isSchoolMode ? '#22c55e' : '#7ea2ff';
    drawBarsWithLabels(ctx, padding, chartW, chartH, activeBins, color);

    // 커트라인
    drawCutoff(ctx, padding, chartW, chartH, CUTOFF_SCORE);

    // 레전드 (우측 상단)
    drawLegend(ctx, W, padding);
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

    // X축 라벨 (0~340)
    ctx.fillStyle = '#9db0d6';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';

    const xTickStep = 40; // 눈금 간격
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

    // Y축 라벨 (학생 수)
    const maxCount = Math.max(...bins.map(b => b.count), 1);
    const steps = 4;
    const yStep = Math.max(1, Math.ceil(maxCount / steps));
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9db0d6';
    ctx.font = '10px system-ui';

    for (let i = 0; i <= steps; i++) {
      const count = i * yStep;
      const y = padding.top + chartH - (i / steps) * chartH;
      ctx.fillText(String(count), padding.left - 6, y + 3);
    }

    // 축 제목
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('점수', padding.left + chartW / 2, padding.top + chartH + 36);

    ctx.save();
    ctx.translate(16, padding.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('학생 수', 0, 0);
    ctx.restore();
  };

  const drawBarsWithLabels = (ctx, padding, chartW, chartH, bins, primaryColor) => {
    const binWidth = chartW / bins.length;
    const maxCount = Math.max(1, Math.max(...bins.map(b => b.count)));

    bins.forEach((bin, i) => {
      const x = padding.left + i * binWidth;
      const h = (bin.count / maxCount) * chartH;
      const y = padding.top + chartH - h;

      const fill = bin.isStudent ? '#ef4444' : `${primaryColor}CC`; // 본인 bin=빨강
      if (bin.count > 0) {
        ctx.fillStyle = fill;
        const minH = Math.max(h, 2);
        ctx.fillRect(x + 1, padding.top + chartH - minH, binWidth - 2, minH);

        if (bin.isStudent) {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, padding.top + chartH - minH, binWidth - 2, minH);
        }
      }

      // 데이터 레이블: "N명↵(p%)"
      if (bin.count > 0) {
        const pct = typeof bin.percentage === 'number'
          ? bin.percentage
          : Number(bin.percentage) || 0;
        const ptxt = `${pct.toFixed(1)}%`;

        const cx = x + binWidth / 2;
        const ty = y - 6;

        ctx.fillStyle = '#d6def7';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';

        ctx.fillText(`${bin.count}명`, cx, ty);
        ctx.fillText(`(${ptxt})`, cx, ty + 12);
      }
    });
  };

  const drawCutoff = (ctx, padding, chartW, chartH, score) => {
    const x = padding.left + ((score - X_MIN) / (X_MAX - X_MIN)) * chartW;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const drawLegend = (ctx, W, padding) => {
    // 우측 상단 레전드 박스
    const items = [
      { color: '#7ea2ff', label: '전국 분포' },
      { color: '#22c55e', label: '학교 분포' },
      { color: '#ef4444', label: '본인 위치' },
      { color: '#f59e0b', label: '합격선(204)' },
    ];

    const x0 = W - 220;
    const y0 = 12;
    const lineH = 16;

    items.forEach((it, idx) => {
      const y = y0 + idx * lineH;

      if (it.label.startsWith('합격선')) {
        // 라인 표시
        const lx = x0 + 8;
        const ly = y - 6;
        const lw = 18;

        ctx.strokeStyle = it.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(lx, ly + 8);
        ctx.lineTo(lx + lw, ly + 8);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // 색상 박스
        ctx.fillStyle = it.color;
        ctx.fillRect(x0 + 8, y - 10, 12, 12);
      }

      ctx.fillStyle = '#c9d3f0';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(it.label, x0 + 28, y);
    });

    // 토글 상태 안내
    ctx.fillStyle = '#9db0d6';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`표시: ${isSchoolMode ? '학교' : '전국'}`, W - 12, y0 + items.length * lineH + 6);
  };

  // 상단 컨트롤(우측 정렬 + 토글)
  const TopControls = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '12px',
      flexWrap: 'wrap'
    }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {rounds.map((round, index) => (
          <button
            key={index}
            onClick={() => setSelectedRound(index)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: selectedRound === index ? '2px solid var(--primary)' : '1px solid var(--line)',
              background: selectedRound === index ? 'var(--primary)' : 'var(--surface)',
              color: selectedRound === index ? '#fff' : 'var(--ink)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              minWidth: 56
            }}
            title={round.label}
          >
            {round.label}
          </button>
        ))}
      </div>

      {/* 토글: 전국 <-> 학교 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>전국</span>
        <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 24 }}>
          <input
            type="checkbox"
            checked={isSchoolMode}
            onChange={(e) => setIsSchoolMode(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            style={{
              position: 'absolute',
              cursor: 'pointer',
              inset: 0,
              backgroundColor: isSchoolMode ? '#22c55e55' : '#7ea2ff55',
              transition: '.2s',
              borderRadius: 24,
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
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            }}
          />
        </label>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>학교</span>
      </div>
    </div>
  );

  return (
    <div>
      <TopControls />

      {/* 현재 선택된 정보 */}
      {histogramData[selectedRound] && (
        <div style={{
          marginBottom: 12,
          padding: 12,
          background: 'rgba(21,29,54,0.5)',
          borderRadius: 8,
          textAlign: 'center',
          fontSize: 14,
          color: 'var(--muted)'
        }}>
          <strong style={{ color: 'var(--ink)' }}>{rounds[selectedRound]?.label}</strong>
          {' '}— 본인 점수:{' '}
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
            {histogramData[selectedRound].studentScore != null ? `${histogramData[selectedRound].studentScore}점` : '표시 안함'}
          </span>
        </div>
      )}

      {/* 단일 캔버스 차트 */}
      <div
        style={{
          background: 'rgba(0,0,0,0.1)',
          borderRadius: 8,
          border: '1px solid var(--line)',
          overflow: 'hidden',
          marginBottom: 8
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 380, display: 'block' }}
        />
      </div>
    </div>
  );
}

export default TrendChart;

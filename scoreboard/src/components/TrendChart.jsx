// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  getPrebinnedDistribution,
  calcPercentileFromBins,
} from '../utils/helpers';

// 학교명 → 코드 변환
const nameToCode = (name) => ({
  '가천대': '01', '경희대': '02', '대구한': '03', '대전대': '04',
  '동국대': '05', '동신대': '06', '동의대': '07', '부산대': '08',
  '상지대': '09', '세명대': '10', '우석대': '11', '원광대': '12',
}[name] || '01');

const CUTOFF_SCORE = 204;

function TrendChart({ rounds = [], school = '', sid = '', onReady }) {
  const canvasRef = useRef(null);

  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false);
  const [bundle, setBundle] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // 리사이즈시 재그리기
  useEffect(() => {
    const onResize = () => drawCurrent(bundle, selectedRoundIdx, isSchoolMode);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bundle, isSchoolMode, selectedRoundIdx]);

  // 데이터 준비
  useEffect(() => {
    (async () => {
      if (!rounds.length) {
        setBundle([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const schCode = nameToCode(school);
      const out = [];

      for (const round of rounds) {
        const { label, data: roundData } = round;
        const studentScore = Number.isFinite(roundData?.totalScore)
          ? Number(roundData.totalScore)
          : null;

        // ✅ 사전집계 Functions 호출
        const distResp = await getPrebinnedDistribution(label);
        const d = distResp?.data || {};

        const nationalAvg = d?.averages?.nationalAvg ?? '-';
        const schoolAvg   = d?.averages?.bySchool?.[schCode] ?? '-';

        const natBinsRaw = Array.isArray(d.national) ? d.national : [];
        const schBinsRaw = d?.bySchool?.[schCode] ?? [];
        const minX = Number.isFinite(d?.range?.min) ? d.range.min : 0;
        const maxX = Number.isFinite(d?.range?.max) ? d.range.max : 340;
        const cutoff = Number.isFinite(d?.cutoff) ? d.cutoff : CUTOFF_SCORE;

        const tagStudent = (bins) => {
          if (!Number.isFinite(studentScore)) return bins;
          return bins.map(b => {
            const inRange =
              (b.min <= studentScore) &&
              (studentScore < b.max || (b.min === b.max && studentScore === b.max));
            return { ...b, isStudent: inRange };
          });
        };

        const totalNational = d?.stats?.national?.completed ?? 0;
        const totalSchool   = d?.stats?.bySchool?.[schCode]?.completed ?? 0;

        const myNatPct = calcPercentileFromBins(natBinsRaw, studentScore);
        const mySchPct = calcPercentileFromBins(schBinsRaw, studentScore);

        out.push({
          label,
          studentScore,

          nationalAvg,
          schoolAvg,

          nationalBins: { bins: tagStudent(natBinsRaw), min: minX, max: maxX },
          schoolBins:   { bins: tagStudent(schBinsRaw), min: minX, max: maxX },

          totalNational,
          totalSchool,

          cutoff,
          myNatPct,
          mySchPct,
        });
      }

      setBundle(out);
      requestAnimationFrame(() => {
        drawCurrent(out, 0, false);
        setIsLoading(false);
        if (typeof onReady === 'function') onReady(out);
      });
    })();
  }, [rounds, school, sid, onReady]);

  // 재그리기
  useEffect(() => {
    drawCurrent(bundle, selectedRoundIdx, isSchoolMode);
  }, [bundle, selectedRoundIdx, isSchoolMode]);

  // === 캔버스 그리기 함수들 ===
  function drawCurrent(data, roundIdx, schoolMode) {
    const cur = data?.[roundIdx];
    if (!cur) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const padding = { left: 56, right: 20, top: 64, bottom: 64 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    const title = schoolMode
      ? `학교 분포 (무효응시자 제외 총 ${cur.totalSchool}명)`
      : `전국 분포 (무효응시자 제외 총 ${cur.totalNational}명)`;
    const avg = schoolMode ? cur.schoolAvg : cur.nationalAvg;

    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 22);
    ctx.fillStyle = '#9db0d6';
    ctx.font = '12px system-ui';
    ctx.fillText(`평균: ${avg}점`, W / 2, 40);

    const active = schoolMode ? cur.schoolBins : cur.nationalBins;
    const { bins, min, max } = active || { bins: [], min: 0, max: 340 };

    const yMax = drawAxes(ctx, padding, chartW, chartH, bins, min, max);
    const color = schoolMode ? '#22c55e' : '#7ea2ff';
    drawBars(ctx, padding, chartW, chartH, bins, color, yMax, min, max);
    drawCutoff(ctx, padding, chartW, chartH, cur.cutoff, min, max);
  }

  function drawAxes(ctx, padding, chartW, chartH, bins, minX, maxX) {
    ctx.strokeStyle = '#213056';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    ctx.fillStyle = '#9db0d6';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    const xTickStep = 40;
    const start = Math.ceil(minX / xTickStep) * xTickStep;
    for (let s = start; s <= maxX; s += xTickStep) {
      const x = padding.left + ((s - minX) / (maxX - minX)) * chartW;
      ctx.fillText(String(s), x, padding.top + chartH + 16);
      if (s > minX && s < maxX) {
        ctx.strokeStyle = 'rgba(33,48,86,0.2)';
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
      }
    }

    const maxCount = Math.max(1, ...bins.map((b) => b.count));
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

  function makeNiceStep(raw) {
    if (raw <= 1) return 1;
    const pow = Math.floor(Math.log10(raw));
    const base = Math.pow(10, pow);
    const unit = raw / base;
    if (unit <= 1) return base * 1;
    if (unit <= 2) return base * 2;
    if (unit <= 5) return base * 5;
    return base * 10;
  }

  function drawBars(ctx, padding, chartW, chartH, bins, primaryColor, yMax, minX, maxX) {
    const barCount = bins.length;
    const binWidth = chartW / barCount;

    for (let i = 0; i < barCount; i++) {
      const b = bins[i];
      const x = padding.left + i * binWidth;
      const h = yMax > 0 ? (b.count / yMax) * chartH : 0;
      const y = padding.top + chartH - h;

      const fill = b.count > 0
        ? (b.isStudent ? '#ef4444' : `${primaryColor}CC`)
        : 'transparent';

      if (h > 0) {
        ctx.fillStyle = fill;
        const minH = Math.max(h, 1);
        const drawY = padding.top + chartH - minH;
        ctx.fillRect(x + 1, drawY, binWidth - 2, minH);

        if (b.isStudent) {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, drawY, binWidth - 2, minH);
        }
      }
    }
  }

  function drawCutoff(ctx, padding, chartW, chartH, score, minX, maxX) {
    if (score < minX || score > maxX) return;
    const x = padding.left + ((score - minX) / (maxX - minX)) * chartW;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // === 상단 컨트롤 UI ===
  const TopControls = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {rounds.map((round, idx) => (
          <button
            key={round.label ?? idx}
            onClick={() => setSelectedRoundIdx(idx)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: selectedRoundIdx === idx ? '2px solid var(--primary)' : '1px solid var(--line)',
              background: selectedRoundIdx === idx ? 'var(--primary)' : 'var(--surface)',
              color: selectedRoundIdx === idx ? '#fff' : 'var(--ink)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              minWidth: 56,
            }}
          >
            {round.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>전국</span>
        <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 24 }}>
          <input
            type="checkbox"
            checked={isSchoolMode}
            onChange={(e) => setIsSchoolMode(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{ position: 'absolute', inset: 0, cursor: 'pointer', backgroundColor: isSchoolMode ? '#22c55e55' : '#7ea2ff55', transition: '.2s', borderRadius: 24 }} />
          <span style={{ position: 'absolute', height: 18, width: 18, left: isSchoolMode ? 24 : 4, bottom: 3, backgroundColor: '#fff', transition: '.2s', borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.35)' }} />
        </label>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>학교</span>
      </div>
    </div>
  );

  const current = bundle[selectedRoundIdx];

  const SummaryLine = () => {
    if (!current) return null;
    const pct = isSchoolMode ? current.mySchPct : current.myNatPct;
    return (
      <div style={{ marginBottom: 8, padding: 10, background: 'rgba(21,29,54,0.5)', borderRadius: 8, fontSize: 14, color: 'var(--muted)', display: 'flex', justifyContent: 'center', gap: 60 }}>
        <div style={{ textAlign: 'center' }}>
          <strong style={{ color: 'var(--ink)' }}>{current.label}</strong>
          {' '}—{' '}
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
            {Number.isFinite(current.studentScore) ? `${current.studentScore}점` : '표시 안함'}
          </span>
          {pct != null && <div>(상위 {pct.toFixed(1)}%)</div>}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div>유효응시자: {isSchoolMode ? current.totalSchool : current.totalNational}</div>
        </div>
      </div>
    );
  };

  const LegendRow = () => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', margin: '0 0 8px 0', fontSize: 12 }}>
      <LegendItem color="#7ea2ff" label="전국 분포" />
      <LegendItem color="#22c55e" label="학교 분포" />
      <LegendItem color="#ef4444" label="본인 위치" />
      <LegendLine color="#f59e0b" label="합격선(204)" />
    </div>
  );

  const LegendItem = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: color }} />
      <span style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  );

  const LegendLine = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 18, height: 0, borderTop: `2px dashed ${color}` }} />
      <span style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  );

  return (
    <div>
      <TopControls />
      <SummaryLine />
      <LegendRow />
      <div style={{ position: 'relative', borderRadius: 8, border: '1px solid var(--line)', overflow: 'hidden', minHeight: 380 }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 380, display: 'block', opacity: isLoading ? 0 : 1, transition: 'opacity .25s ease' }}
        />
        {isLoading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>로딩 중...</div>}
      </div>
    </div>
  );
}

export default TrendChart;

// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  getAverages,
  getPrebinnedDistribution,
  calcPercentileFromBins,
} from '../utils/helpers';

const nameToCode = (name) => ({
  '가천대': '01','경희대': '02','대구한': '03','대전대': '04',
  '동국대': '05','동신대': '06','동의대': '07','부산대': '08',
  '상지대': '09','세명대': '10','우석대': '11','원광대': '12',
}[name] || '01');

const X_MIN_DEFAULT = 0;
const X_MAX_DEFAULT = 340;
const CUTOFF_DEFAULT = 204;

function TrendChart({ rounds = [], school = '', sid = '', onReady }) {
  const canvasRef = useRef(null);

  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false);
  const [bundle, setBundle] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const onResize = () => drawCurrent(bundle, selectedRoundIdx, isSchoolMode);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bundle, isSchoolMode, selectedRoundIdx]);

  useEffect(() => {
    (async () => {
      if (!rounds.length) { setBundle([]); setIsLoading(false); return; }

      setIsLoading(true);
      const schCode = nameToCode(school);
      const out = [];

      for (const round of rounds) {
        const { label, data: roundData } = round;
        const studentScore = Number.isFinite(roundData?.totalScore)
          ? Number(roundData.totalScore) : null;

        const averages = await getAverages(school, label);
        const prebinned = await getPrebinnedDistribution(label);
        const d = prebinned?.data || {};

        const minX  = Number.isFinite(d?.range?.min) ? d.range.min : X_MIN_DEFAULT;
        const maxX  = Number.isFinite(d?.range?.max) ? d.range.max : X_MAX_DEFAULT;
        const cutoff = Number.isFinite(d?.cutoff) ? d.cutoff : CUTOFF_DEFAULT;

        // 🔧 bins
        const natBinsRaw = Array.isArray(d?.national) ? d.national : [];
        const schBinsRaw = Array.isArray(d?.bySchool?.[schCode]) ? d.bySchool[schCode] : [];

        // 🔧 stats(정답) — functions에서 저장한 값 그대로 사용
        const natStatsRaw = d?.stats?.national || { total: 0, completed: 0, absent: 0, dropout: 0 };
        const schStatsRaw = d?.stats?.bySchool?.[schCode] || { total: 0, completed: 0, absent: 0, dropout: 0 };

        // 학생 위치 태깅
        const tagStudent = (bins) => {
          if (!Number.isFinite(studentScore)) return bins || [];
          return (bins || []).map(b => {
            const inRange =
              (b.min <= studentScore) &&
              (studentScore < b.max || (b.min === b.max && studentScore === b.max));
            return { ...b, isStudent: inRange };
          });
        };

        const myNatPct = Number.isFinite(studentScore)
          ? calcPercentileFromBins(natBinsRaw, studentScore) : null;
        const mySchPct = Number.isFinite(studentScore)
          ? calcPercentileFromBins(schBinsRaw, studentScore) : null;

        out.push({
          label,
          studentScore,

          nationalAvg: averages?.nationalAvg ?? '-',
          schoolAvg:   averages?.schoolAvg ?? '-',

          nationalBins: { bins: tagStudent(natBinsRaw), min: minX, max: maxX },
          schoolBins:   { bins: tagStudent(schBinsRaw), min: minX, max: maxX },

          // ✅ functions가 저장한 실제 통계 그대로 표시
          natStats: natStatsRaw,   // { total, completed, absent, dropout }
          schStats: schStatsRaw,   // { total, completed, absent, dropout }

          // 편의용(타이틀 등에서 사용)
          totalNational: natStatsRaw.total,
          totalSchool:   schStatsRaw.total,

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

  useEffect(() => {
    drawCurrent(bundle, selectedRoundIdx, isSchoolMode);
  }, [bundle, selectedRoundIdx, isSchoolMode]);

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
      ? `학교 분포 (무효응시자 제외 총 ${cur.schStats.completed}명 / 전체 ${cur.schStats.total}명)`
      : `전국 분포 (무효응시자 제외 총 ${cur.natStats.completed}명 / 전체 ${cur.natStats.total}명)`;
    const avg = schoolMode ? cur.schoolAvg : cur.nationalAvg;

    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 22);
    ctx.fillStyle = '#9db0d6';
    ctx.font = '12px system-ui';
    ctx.fillText(`평균: ${avg}점`, W / 2, 40);

    const active = schoolMode ? cur.schoolBins : cur.nationalBins;
    const { bins, min, max } = active || { bins: [], min: X_MIN_DEFAULT, max: X_MAX_DEFAULT };

    const yMax = drawAxes(ctx, padding, chartW, chartH, bins, min, max);

    const color = schoolMode ? '#22c55e' : '#7ea2ff';
    drawBarsWithLabels(ctx, padding, chartW, chartH, bins, color, yMax);

    drawCutoff(ctx, padding, chartW, chartH, cur.cutoff ?? CUTOFF_DEFAULT, min, max);
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
    const span = Math.max(1, (maxX - minX));
    const xTickStep = 40;
    const start = Math.ceil(minX / xTickStep) * xTickStep;
    for (let s = start; s <= maxX; s += xTickStep) {
      const ratio = (s - minX) / span;
      const x = padding.left + ratio * chartW;
      ctx.fillText(String(s), x, padding.top + chartH + 16);
      if (s > minX && s < maxX) {
        ctx.strokeStyle = 'rgba(33,48,86,0.2)';
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
      }
    }

    const maxCount = Math.max(1, ...bins.map((b) => b?.count || 0));
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

  function drawBarsWithLabels(ctx, padding, chartW, chartH, bins, primaryColor, yMax) {
    const barCount = Math.max(1, (bins?.length || 0));
    const binWidth = chartW / barCount;

    for (let i = 0; i < barCount; i++) {
      const b = bins[i] || { count: 0 };
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
    if (!Number.isFinite(score)) return;
    if (!(maxX > minX)) return;
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

  const TopControls = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {rounds.map((round, idx) => (
          <button
            key={round.label ?? idx}
            onClick={() => setSelectedRoundIdx(idx)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: selectedRoundIdx === idx ? '2px solid var(--primary)' : '1px solid var(--line)',
              background: selectedRoundIdx === idx ? 'var(--primary)' : 'var(--surface)',
              color: selectedRoundIdx === idx ? '#fff' : 'var(--ink)',
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              position: 'absolute', inset: 0, cursor: 'pointer',
              backgroundColor: isSchoolMode ? '#22c55e55' : '#7ea2ff55',
              transition: '.2s', borderRadius: 24
            }}
          />
          <span
            style={{
              position: 'absolute', height: 18, width: 18,
              left: isSchoolMode ? 24 : 4, bottom: 3,
              backgroundColor: '#fff', transition: '.2s',
              borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.35)'
            }}
          />
        </label>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>학교</span>
      </div>
    </div>
  );

  const current = bundle[selectedRoundIdx];

  const SummaryLine = () => {
    if (!current) return null;
    const isNat = !isSchoolMode;
    const pct = isNat ? current.myNatPct : current.mySchPct;
    const stats = isNat ? current.natStats : current.schStats; // ✅ 여기서 stats 사용

    return (
      <div
        style={{
          marginBottom: 8, padding: 10,
          background: 'rgba(21,29,54,0.5)', borderRadius: 8,
          fontSize: 14, color: 'var(--muted)',
          display: 'flex', justifyContent: 'center', gap: 60,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div>
            <strong style={{ color: 'var(--ink)' }}>
              {rounds[selectedRoundIdx]?.label}
            </strong>
            {' '}—{' '}
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
              {Number.isFinite(current.studentScore) ? `${current.studentScore}점` : '표시 안함'}
            </span>
            <br />
            {pct != null && <span>(상위 {pct.toFixed(1)}%)</span>}
          </div>
          <div style={{ marginTop: 4 }}>
            응시대상자: {stats?.total ?? 0}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div>유효응시자: {stats?.completed ?? 0}</div>
          <div>
            무효응시자: {(stats?.absent ?? 0) + (stats?.dropout ?? 0)}
            <br />
            (<span>미응시자: {stats?.absent ?? 0}</span>
            <br />
            <span>중도포기: {stats?.dropout ?? 0}</span>)
          </div>
        </div>
      </div>
    );
  };

  const LegendRow = () => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', margin: '0 0 8px 0', fontSize: 12 }}>
      <LegendItem color="#7ea2ff" label="전국 분포" />
      <LegendItem color="#22c55e" label="학교 분포" />
      <LegendItem color="#ef4444" label="본인 위치" />
      <LegendLine color="#f59e0b" label={`합격선(${bundle?.[selectedRoundIdx]?.cutoff ?? CUTOFF_DEFAULT})`} />
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

      <div
        style={{
          position: 'relative',
          background: 'rgba(0,0,0,0.1)',
          borderRadius: 8,
          border: '1px solid var(--line)',
          overflow: 'hidden',
          minHeight: 380,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 380, display: 'block', opacity: isLoading ? 0 : 1, transition: 'opacity .25s ease' }}
        />
        {isLoading && (
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
              backgroundSize: '200% 100%',
              animation: 'chart-skeleton 1.2s ease-in-out infinite',
            }}
          >
            <div
              style={{
                width: 28, height: 28, borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.2)',
                borderTopColor: 'var(--primary)',
                animation: 'spin 0.9s linear infinite',
              }}
              aria-label="차트 로딩 중"
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes chart-skeleton { 0% { background-position: 0% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}

export default TrendChart;

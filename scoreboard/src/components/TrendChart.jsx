// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getPrebinnedDistribution, calcPercentileFromBins } from '../utils/helpers';
const nameToCode = (name) => ({
  '가천대': '01', '경희대': '02', '대구한': '03', '대전대': '04',
  '동국대': '05', '동신대': '06', '동의대': '07', '부산대': '08',
  '상지대': '09', '세명대': '10', '우석대': '11', '원광대': '12',
}[name] || '01');

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

        // ── 사전집계 호출 ─────────────────────────────────────────────
        const res = await getPrebinnedDistribution(label);
        const d = res?.data || {};

        // 평균
        const nationalAvg = d?.averages?.nationalAvg ?? '-';
        const schoolAvg   = d?.averages?.bySchool?.[schCode] ?? '-';

        // 분포 bins
        const natBinsRaw = Array.isArray(d?.national) ? d.national : [];
        const schBinsRaw = Array.isArray(d?.bySchool?.[schCode]) ? d.bySchool[schCode] : [];

        // 범위/컷오프(응답에 없으면 기본값)
        const minX   = Number.isFinite(d?.range?.min) ? d.range.min : 0;
        const maxX   = Number.isFinite(d?.range?.max) ? d.range.max : 340;
        const cutoff = Number.isFinite(d?.cutoff)      ? d.cutoff    : 204;

        // 내 점수 표시 플래그
        const tagStudent = (bins) => {
          if (!Number.isFinite(studentScore)) return bins || [];
          return (bins || []).map(b => {
            const inRange =
              (b.min <= studentScore) &&
              (studentScore < b.max || (b.min === b.max && studentScore === b.max));
            return { ...b, isStudent: inRange };
          });
        };

        // 인원수(유효응시자)
        const totalNational = d?.stats?.national?.completed ?? 0;
        const totalSchool   = d?.stats?.bySchool?.[schCode]?.completed ?? 0;

        // 백분위(상위%)
        const myNatPct = Number.isFinite(studentScore)
          ? calcPercentileFromBins(natBinsRaw, studentScore)
          : null;
        const mySchPct = Number.isFinite(studentScore)
          ? calcPercentileFromBins(schBinsRaw, studentScore)
          : null;

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

      // 최초 그리기
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

  // === 캔버스 그리기 ===
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

    // 타이틀(원형 유지: 유효표기)
    const title = schoolMode
      ? `학교 분포 (유효 ${cur.totalSchool}명)`
      : `전국 분포 (유효 ${cur.totalNational}명)`;
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
    drawBarsWithLabels(ctx, padding, chartW, chartH, bins, color, yMax, min, max);
    drawCutoff(ctx, padding, chartW, chartH, cur.cutoff, min, max);
  }

  function drawAxes(ctx, padding, chartW, chartH, bins, minX, maxX) {
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

    // X 라벨
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

    // Y 눈금
    const maxCount = Math.max(1, ...bins.map((b) => b.count || 0));
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

  // minX, maxX 파라미터는 호출부와 시그니처를 맞추기 위해 유지(내부에선 bins/yMax로 충분)
  function drawBarsWithLabels(ctx, padding, chartW, chartH, bins, primaryColor, yMax, _minX, _maxX) {
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
    if (!(maxX > minX)) return; // 0분모 가드
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

  // ------ 상단 컨트롤/요약/범례 (원형 유지) ------
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
      <div>
        <button
          onClick={() => setIsSchoolMode(false)}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: !isSchoolMode ? '2px solid var(--primary)' : '1px solid var(--line)',
            background: !isSchoolMode ? 'var(--primary)' : 'var(--surface)',
            color: !isSchoolMode ? '#fff' : 'var(--ink)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          전국
        </button>
        <button
          onClick={() => setIsSchoolMode(true)}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: isSchoolMode ? '2px solid var(--primary)' : '1px solid var(--line)',
            background: isSchoolMode ? 'var(--primary)' : 'var(--surface)',
            color: isSchoolMode ? '#fff' : 'var(--ink)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {school}
        </button>
      </div>
    </div>
  );

  const SummaryLine = ({ cur }) => {
    if (!cur) return null;
    return (
      <div style={{ fontSize: 13, marginBottom: 6, opacity: .9 }}>
        내 점수: <b>{cur.studentScore ?? '-'}</b>점 |{' '}
        전국 백분위: <b>{cur.myNatPct != null ? `${cur.myNatPct.toFixed(1)}%` : '-'}</b> |{' '}
        학교 백분위: <b>{cur.mySchPct != null ? `${cur.mySchPct.toFixed(1)}%` : '-'}</b>
      </div>
    );
  };

  const LegendRow = () => (
    <div style={{ fontSize: 12, opacity: .7, marginBottom: 8 }}>
      <span style={{ color: '#7ea2ff', marginRight: 12 }}>■ 전국 분포</span>
      <span style={{ color: '#22c55e', marginRight: 12 }}>■ 학교 분포</span>
      <span style={{ color: '#ef4444' }}>■ 내 위치</span>
      <span style={{ color: '#f59e0b', marginLeft: 12 }}>─ 컷오프</span>
    </div>
  );

  const cur = bundle[selectedRoundIdx];

  return (
    <div style={{ marginTop: 16 }}>
      <TopControls />
      <SummaryLine cur={cur} />
      <LegendRow />
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 380,
          display: 'block',
          opacity: isLoading ? 0 : 1,
          transition: 'opacity .25s ease',
        }}
      />
      {isLoading && <div>로딩 중...</div>}
    </div>
  );
}

export default TrendChart;

// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  getAverages,
  getRealScoreDistribution,
  getParticipationStats,
  calcPercentileFromScores,
} from '../utils/helpers';

// 학교명 → 코드 변환
const nameToCode = (name) => ({
  '가천대': '01', '경희대': '02', '대구한': '03', '대전대': '04',
  '동국대': '05', '동신대': '06', '동의대': '07', '부산대': '08',
  '상지대': '09', '세명대': '10', '우석대': '11', '원광대': '12',
}[name] || '01');

// 축/범위 상수 (기본값)
const X_MIN_DEFAULT = 0;
const X_MAX_DEFAULT = 340;
const BIN_SIZE = 5;
const CUTOFF_SCORE = 204;

/**
 * props:
 * - rounds, school, sid (기존)
 * - onReady?: (bundle) => void   // 첫 데이터 준비 + 최초 렌더 완료 시 호출
 */
function TrendChart({ rounds = [], school = '', sid = '', onReady }) {
  const canvasRef = useRef(null);

  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false); // false=전국, true=학교
  const [bundle, setBundle] = useState([]);                 // 회차별 계산 결과
  const [isLoading, setIsLoading] = useState(true);         // 내부 로딩(스피너/스켈레톤)

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

        // 평균
        const averages = await getAverages(school, label);

        // 실제 분포 (배열)
        const dist = await getRealScoreDistribution(label);
        const natScores = Array.isArray(dist?.national) ? dist.national : [];
        const schScores =
          dist?.bySchool && Array.isArray(dist.bySchool[schCode])
            ? dist.bySchool[schCode]
            : [];

        // 참여 통계 (유효 = 4교시 completed만)
        const natStats = await getParticipationStats(label, null);
        const schStats = await getParticipationStats(label, schCode);

        // 본인 백분율 (1등=0.0%, 꼴등=100.0%)
        const myNatPct =
          studentScore != null && natStats.completedScores?.length > 0
            ? calcPercentileFromScores(natStats.completedScores, studentScore)
            : null;

        const mySchPct =
          studentScore != null && schStats.completedScores?.length > 0
            ? calcPercentileFromScores(schStats.completedScores, studentScore)
            : null;

        // ✅ 동적 X축으로 분포 만들기 (bins + min/max 함께 보관)
        const natBins = buildDistribution(natScores, studentScore);
        const schBins = buildDistribution(schScores, studentScore);

        out.push({
          label,
          studentScore,

          nationalAvg: averages?.nationalAvg ?? '-',
          schoolAvg: averages?.schoolAvg ?? '-',

          nationalBins: natBins, // { bins, min, max }
          schoolBins: schBins,   // { bins, min, max }

          // 분포 인원 (유효 응시자 수와 동일하도록 helpers에서 보장)
          totalNational: natScores.length,
          totalSchool: schScores.length,

          // 참여 통계
          natStats, // {total, completed, absent, dropout, completedScores}
          schStats, // {total, completed, absent, dropout, completedScores}

          // 본인 백분율
          myNatPct,
          mySchPct,
        });
      }

      setBundle(out);
      // 최초 그리기
      requestAnimationFrame(() => {
        drawCurrent(out, 0, false);
        setIsLoading(false);
        // 외부 onReady 알림
        if (typeof onReady === 'function') onReady(out);
      });
    })();
  }, [rounds, school, sid, onReady]);

  // 재그리기 트리거
  useEffect(() => {
    drawCurrent(bundle, selectedRoundIdx, isSchoolMode);
  }, [bundle, selectedRoundIdx, isSchoolMode]);

  /** 점수 배열 기반 동적 X범위 계산 */
  function getDynamicRange(scores, studentScore) {
    const source = scores && scores.length ? scores : (Number.isFinite(studentScore) ? [studentScore] : []);
    if (!source.length) return { min: X_MIN_DEFAULT, max: X_MAX_DEFAULT };

    const minScore = Math.min(...source);
    const maxScore = Math.max(...source);

    // 같은 값만 있을 경우 최소 폭 확보
    let dynMin = Math.floor(minScore / BIN_SIZE) * BIN_SIZE;
    let dynMax = Math.ceil(maxScore / BIN_SIZE) * BIN_SIZE;

    if (dynMin === dynMax) {
      dynMin = Math.max(X_MIN_DEFAULT, dynMin - BIN_SIZE * 3);
      dynMax = Math.min(X_MAX_DEFAULT, dynMax + BIN_SIZE * 3);
    }

    // 너무 좁으면 살짝 여유
    if (dynMax - dynMin < 60) {
      const extra = Math.floor((60 - (dynMax - dynMin)) / 2);
      dynMin = Math.max(X_MIN_DEFAULT, dynMin - extra);
      dynMax = Math.min(X_MAX_DEFAULT, dynMax + extra);
    }

    // 커트라인이 범위 밖이면 살짝 포함해주기
    if (CUTOFF_SCORE < dynMin) dynMin = Math.max(X_MIN_DEFAULT, Math.floor(CUTOFF_SCORE / BIN_SIZE) * BIN_SIZE - BIN_SIZE * 2);
    if (CUTOFF_SCORE > dynMax) dynMax = Math.min(X_MAX_DEFAULT, Math.ceil(CUTOFF_SCORE / BIN_SIZE) * BIN_SIZE + BIN_SIZE * 2);

    return { min: dynMin, max: dynMax };
  }

  /** 분포 생성 (동적 X범위) */
  function buildDistribution(scores, studentScore) {
    const { min, max } = getDynamicRange(scores, studentScore);
    const bins = [];

    for (let x = min; x < max; x += BIN_SIZE) {
      const count = scores.filter((s) => s >= x && s < x + BIN_SIZE).length;
      bins.push({
        min: x,
        max: x + BIN_SIZE,
        count,
        isStudent:
          studentScore != null && studentScore >= x && studentScore < x + BIN_SIZE,
        percentage: scores.length > 0 ? (count / scores.length) * 100 : 0,
      });
    }
    // 끝 값(== max)에 딱 들어맞는 케이스
    const lastCount = scores.filter((s) => s === max).length;
    bins.push({
      min: max,
      max: max,
      count: lastCount,
      isStudent: studentScore === max,
      percentage: scores.length > 0 ? (lastCount / scores.length) * 100 : 0,
    });

    return { bins, min, max };
  }

  // 현재 회차 그리기
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

    // 타이틀/평균
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

    // 활성 분포 (동적 min/max)
    const active = schoolMode ? cur.schoolBins : cur.nationalBins; // { bins, min, max }
    const { bins, min, max } = active || { bins: [], min: X_MIN_DEFAULT, max: X_MAX_DEFAULT };

    const yMax = drawAxes(ctx, padding, chartW, chartH, bins, min, max);

    // 막대
    const color = schoolMode ? '#22c55e' : '#7ea2ff';
    drawBarsWithLabels(ctx, padding, chartW, chartH, bins, color, yMax, data, roundIdx, schoolMode, min, max);

    // 커트라인 (동적 min/max 좌표계 사용)
    drawCutoff(ctx, padding, chartW, chartH, CUTOFF_SCORE, min, max);
  }

  function drawAxes(ctx, padding, chartW, chartH, bins, minX, maxX) {
    ctx.strokeStyle = '#213056';
    ctx.lineWidth = 1;

    // Y
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.stroke();

    // X
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    // X 라벨 (동적 범위)
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

    // Y 눈금
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

  function drawBarsWithLabels(ctx, padding, chartW, chartH, bins, primaryColor, yMax, data, roundIdx, schoolMode, minX, maxX) {
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
    if (score < minX || score > maxX) return; // 범위 밖이면 표시 안함
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

  // 컨트롤/범례/헤더
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

  const current = bundle[selectedRoundIdx];

  // 상단 상태 라인(토글에 따라 바뀜) — 중앙 배치 + 내부 좌/우 2열
  const SummaryLine = () => {
    if (!current) return null;
    const isNat = !isSchoolMode;
    const pct = isNat ? current.myNatPct : current.mySchPct;
    const stats = isNat ? current.natStats : current.schStats;

    return (
      <div
        style={{
          marginBottom: 8,
          padding: 10,
          background: 'rgba(21,29,54,0.5)',
          borderRadius: 8,
          fontSize: 14,
          color: 'var(--muted)',
          display: 'flex',
          justifyContent: 'center',
          gap: 60,
        }}
      >
        {/* 좌측 블록 */}
        <div style={{ textAlign: 'center' }}>
          <div>
            <strong style={{ color: 'var(--ink)' }}>{rounds[selectedRoundIdx]?.label}</strong>
            {' '}— {' '}
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
              {Number.isFinite(current.studentScore) ? `${current.studentScore}점` : '표시 안함'}
            </span>
            {' '}{pct != null ? `(상위 ${pct.toFixed(1)}%)` : ''}
          </div>
          <div style={{ marginTop: 4 }}>응시대상자: {stats?.total ?? 0}</div>
        </div>

        {/* 우측 블록 */}
        <div style={{ textAlign: 'center' }}>
          <div>유효응시자: {stats?.completed ?? 0}</div>
          <div>
            무효응시자: {(stats?.absent ?? 0) + (stats?.dropout ?? 0)}
            {' '}(미응시자: {stats?.absent ?? 0}
            {' '}중도포기: {stats?.dropout ?? 0})
          </div>
        </div>
      </div>
    );
  };

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
        {/* 캔버스 */}
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 380, display: 'block', opacity: isLoading ? 0 : 1, transition: 'opacity .25s ease' }}
        />

        {/* 로딩 스켈레톤/스피너 */}
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

      {/* 키프레임 (인라인) */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes chart-skeleton { 0% { background-position: 0% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}

export default TrendChart;

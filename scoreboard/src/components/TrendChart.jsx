// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution } from '../utils/helpers';

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
          national: nat,
          school: sch,
        });
      }

      setBundle(out);
      drawCurrent(out);
    })();
  }, [rounds, selectedRoundIdx, isSchoolMode, school, sid]);

  // 단일 라운드 그리기
  const drawCurrent = (data) => {
    const cur = data[selectedRoundIdx];
    if (!cur) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale + reset

    const W = rect.width;
    const H = rect.height;

    ctx.clearRect(0, 0, W, H);

    const padding = { left: 56, right: 20, top: 16, bottom: 56 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    const active = isSchoolMode ? cur.school : cur.national;
    const title = isSchoolMode
      ? `${school} 분포 (총 ${active.total.toLocaleString()}명, 평균 ${cur.schoolAvg})`
      : `전국 분포 (총 ${active.total.toLocaleString()}명, 평균 ${cur.nationalAvg})`;

    // 타이틀
    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 14);

    // 축 + 눈금 (yMax 반환받아 막대와 공유)
    const yMax = drawAxes(ctx, padding, chartW, chartH, active.bins);

    // 막대 + 레이블
    const color = isSchoolMode ? '#22c55e' : '#7ea2ff';
    drawBarsWithLabels(ctx, padding, chartW, chartH, active.bins, color, yMax);

    // 커트라인
    drawCutoff(ctx, padding, chartW, chartH, CUTOFF_SCORE);
  };

  // 점수 배열 → 분포(bins) 계산
  function buildDistribution(scoresArray, studentScore) {
    const scores = Array.isArray(scoresArray) ? scoresArray : [];
    const bins = new Array(BIN_COUNT).fill(0).map((_, i) => {
      const min = X_MIN + i * BIN_SIZE;
      const max = (i < BIN_COUNT - 1) ? min + BIN_SIZE : X_MAX; // 마지막 bin은 340 단일
      return { min, max, count: 0, isStudent: false, percentage: 0 };
    });

    let total = 0;
    for (const v of scores) {
      const s = Number(v);
      if (!Number.isFinite(s)) continue;
      if (s < X_MIN || s > X_MAX) continue; // 0~340 범위 밖 제외
      total += 1;

      if (s === X_MAX) {
        // 마지막 단일 340 bin
        bins[BIN_COUNT - 1].count += 1;
      } else {
        const idx = Math.floor((s - X_MIN) / BIN_SIZE); // 0~335까지 5점 단위
        bins[idx].count += 1;
      }
    }

    // 본인 점수 마킹
    if (Number.isFinite(studentScore)) {
      if (studentScore === X_MAX) {
        bins[BIN_COUNT - 1].isStudent = true;
      } else if (studentScore >= X_MIN && studentScore < X_MAX) {
        const idx = Math.floor((studentScore - X_MIN) / BIN_SIZE);
        bins[idx].isStudent = true;
      }
    }

    // 퍼센트 계산
    if (total > 0) {
      for (const b of bins) {
        b.percentage = (b.count / total) * 100;
      }
    }

    return { bins, total };
  }

  // 축과 눈금(그리드). 막대 스케일과 동일한 yMax를 반환
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

    // Y축 눈금: bins 최대 count 기준으로 “보기 좋은” yMax 산출
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

    // 축 제목
    ctx.textAlign = 'center';
    ctx.font = '11px system-ui';
    ctx.fillText('점수', padding.left + chartW / 2, padding.top + chartH + 36);

    ctx.save();
    ctx.translate(16, padding.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('학생 수', 0, 0);
    ctx.restore();

    return yMax;
  }

  // 보기 좋은(y nice) 스텝 만들기 (1-2-5 스케일)
  function makeNiceStep(raw) {
    if (raw <= 1) return 1;
    const pow = Math.floor(Math.log10(raw));
    const base = Math.pow(10, pow);
    const unit = raw / base; // 1~10

    if (unit <= 1) return base * 1;
    if (unit <= 2) return base * 2;
    if (unit <= 5) return base * 5;
    return base * 10;
  }

  // 막대 + 데이터 레이블 (yMax 공유)
  function drawBarsWithLabels(ctx, padding, chartW, chartH, bins, primaryColor, yMax) {
    const barCount = bins.length;
    const binWidth = chartW / barCount;

    for (let i = 0; i < barCount; i++) {
      const b = bins[i];
      const x = padding.left + i * binWidth;
      const h = yMax > 0 ? (b.count / yMax) * chartH : 0;
      const y = padding.top + chartH - h;

      // 본인 bin 강조: 빨강
      const fill = b.isStudent ? '#ef4444' : `${primaryColor}CC`;

      if (b.count > 0) {
        ctx.fillStyle = fill;
        const minH = Math.max(h, 1); // 최소 1px만 보정
        const drawY = padding.top + chartH - minH;
        ctx.fillRect(x + 1, drawY, binWidth - 2, minH);

        if (b.isStudent) {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, drawY, binWidth - 2, minH);
        }

        // 데이터 레이블: "N명" / "(p%)"
        const pctText = `${b.percentage.toFixed(1)}%`;
        const cx = x + binWidth / 2;
        const ty = drawY - 6;

        ctx.fillStyle = '#d6def7';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';

        ctx.fillText(`${b.count}명`, cx, ty);
        ctx.fillText(`(${pctText})`, cx, ty + 12);
      }
    }
  }

  // 합격선
  function drawCutoff(ctx, padding, chartW, chartH, score) {
    const x = padding.left + ((score - X_MIN) / (X_MAX - X_MIN)) * chartW;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 우측 상단 컨트롤(회차 + 토글)
  const TopControls = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: '8px',
      marginBottom: 12,
      flexWrap: 'wrap'
    }}>
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
              inset: 0,
              cursor: 'pointer',
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
      <LegendItem color="#ef4444" label="본인 위치" square />
      <LegendLine color="#f59e0b" label="합격선(204)" />
    </div>
  );

  const LegendItem = ({ color, label, square = true }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          borderRadius: square ? 2 : 6,
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

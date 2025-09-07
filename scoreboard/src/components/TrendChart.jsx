// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution } from '../utils/helpers';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

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

/**
 * 전국 상위 백분율 (1등=0.0%, 꼴등=100.0%)
 * - 유효응시자(scores 배열)만 대상으로 계산
 * - 동점자는 같은 퍼센트
 * - 소수점 1자리 고정
 */
function percentileStrict(scores, myScore) {
  if (!Array.isArray(scores) || scores.length === 0 || myScore == null) return null;

  const sorted = [...scores].sort((a, b) => b - a); // 내림차순
  // rank = 첫번째로 myScore 이하가 나오는 인덱스
  let rank = sorted.findIndex(s => s <= myScore);
  if (rank === -1) {
    // 내 점수가 최소보다 더 낮은 이상 상황이면 꼴등 취급
    rank = sorted.length - 1;
  }

  if (sorted.length === 1) return 0.0; // 혼자 응시 → 1등
  if (rank <= 0) return 0.0;           // 공동 1등 포함
  if (rank >= sorted.length - 1) return 100.0; // 공동 꼴등 포함

  const pct = (rank / (sorted.length - 1)) * 100;
  // 안전하게 0~100 클램프 + 소수점 1자리
  return Math.max(0, Math.min(100, +pct.toFixed(1)));
}

/** Firestore: analytics/{roundLabel}_overall_status 불러오기 */
async function fetchOverallStatus(roundLabel) {
  try {
    const db = getFirestore();
    const ref = doc(db, 'analytics', `${roundLabel}_overall_status`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.error('fetchOverallStatus failed:', e);
    return null;
  }
}

function TrendChart({ rounds = [], school = '', sid = '' }) {
  const canvasRef = useRef(null);

  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false); // false=전국(기본), true=학교
  const [bundle, setBundle] = useState([]); // 회차별 계산된 결과 집합
  const [statusMap, setStatusMap] = useState({}); // { roundLabel: overall_status }

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
      const statusTmp = { ...statusMap };

      for (const round of rounds) {
        const { label, data: roundData } = round;

        // 본인 점수 (이미 합산된 총점이라고 가정)
        const studentScore = Number.isFinite(roundData?.totalScore)
          ? Number(roundData.totalScore)
          : null;

        // 평균
        const averages = await getAverages(school, label);

        // 실제 분포 (helpers에서 유효응시자만 들어오도록 구성되어 있어야 함)
        const dist = await getRealScoreDistribution(label);
        const natScores = Array.isArray(dist?.national) ? dist.national : [];
        const schScores = dist?.bySchool && Array.isArray(dist.bySchool[schCode])
          ? dist.bySchool[schCode]
          : [];

        const nat = buildDistribution(natScores, studentScore);
        const sch = buildDistribution(schScores, studentScore);

        // 전국 상위 백분율 (1등=0.0%, 꼴등=100.0%)
        const topPercent = percentileStrict(natScores, studentScore);

        // overall_status 로드(없으면 읽어오기)
        if (!statusTmp[label]) {
          statusTmp[label] = await fetchOverallStatus(label);
        }

        out.push({
          label,
          studentScore,
          nationalAvg: averages?.nationalAvg ?? '-',
          schoolAvg: averages?.schoolAvg ?? '-',
          nationalBins: nat,
          schoolBins: sch,
          totalNational: natScores.length, // 유효응시자 수
          totalSchool: schScores.length,
          topPercent,                      // 전국 상위 %
        });
      }

      setStatusMap(statusTmp);
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

    // 타이틀/평균
    const title = isSchoolMode
      ? `${school} 분포 (총 ${cur.totalSchool}명)`
      : `전국 분포 (총 ${cur.totalNational}명)`;
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

  // 막대 + 데이터 레이블 (yMax 공유) - 호버시에만 레이블 표시
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
      }
    }

    // 마우스 호버 이벤트 처리 (캔버스에 이벤트 리스너 추가)
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        
        // 어떤 bin 위에 있는지 계산
        const binIndex = Math.floor((mouseX - padding.left) / binWidth);
        
        if (binIndex >= 0 && binIndex < bins.length) {
          const b = bins[binIndex];
          
          // 기존 캔버스 다시 그리기
          drawCurrent(bundle);
          
          // 호버된 bin의 레이블만 표시
          if (b.count > 0) {
            const x = padding.left + binIndex * binWidth;
            const h = yMax > 0 ? (b.count / yMax) * chartH : 0;
            const y = padding.top + chartH - h;
            
            const pctText = `${b.percentage.toFixed(1)}%`;
            const cx = x + binWidth / 2;
            const ty = y - 6;

            ctx.fillStyle = '#d6def7';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';

            ctx.fillText(`${b.count}명`, cx, ty);
            ctx.fillText(`(${pctText})`, cx, ty + 12);
          }
        }
      };
      
      canvas.onmouseleave = () => {
        // 마우스가 벗어나면 레이블 제거
        drawCurrent(bundle);
      };
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
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      marginBottom: 12,
      flexWrap: 'wrap'
    }}>
      {/* 회차 버튼들 */}
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

  // 카드 상단: 본인 점수 + 상위% + 응시현황
  const CurrentHeader = () => {
    const cur = bundle[selectedRoundIdx];
    const label = rounds[selectedRoundIdx]?.label;
    const status = statusMap[label] || null;

    // 응시현황 안전 파싱
    const totalStudents = status?.totalStudents ?? 0;
    const bySession = status?.bySession || {};
    const byStatus = status?.byStatus || {};
    // 유효응시자 = (여기선 회차 전체에서 최대 attended 세기보다 ‘전국 분포 인원’이 더 직관적)
    const valid = cur?.totalNational ?? 0;

    const absent = Object.values(bySession).reduce((sum, s) => sum + (s?.absent ?? 0), 0);
    const attended = Object.values(bySession).reduce((sum, s) => sum + (s?.attended ?? 0), 0);
    // “중도포기자”는 overall_status.byStatus.dropout 사용
    const dropout = byStatus?.dropout ?? 0;

    // 화면 표시값: roundData.totalScore + 전국 상위 %
    const myScoreText = Number.isFinite(cur?.studentScore) ? `${cur.studentScore}점` : '표시 안함';
    const topPctText  = Number.isFinite(cur?.topPercent) ? ` (전국 상위 ${cur.topPercent}%)` : '';

    return (
      <div style={{
        marginBottom: 8,
        padding: 10,
        background: 'rgba(21,29,54,0.5)',
        borderRadius: 8,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          <strong style={{ color: 'var(--ink)' }}>{label}</strong>
          {' '}— 본인 점수:{' '}
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
            {myScoreText}
          </span>
          <span style={{ color: 'var(--muted)' }}>{topPctText}</span>
        </div>

        <div style={{
          display: 'flex', gap: 12, flexWrap: 'wrap',
          fontSize: 12, color: 'var(--muted)'
        }}>
          <span>전체응시자: <b style={{ color: 'var(--ink)' }}>{totalStudents}</b></span>
          <span>유효응시자: <b style={{ color: 'var(--ink)' }}>{valid}</b></span>
          <span>미응시자: <b style={{ color: 'var(--ink)' }}>{totalStudents - attended}</b></span>
          <span>중도포기자: <b style={{ color: 'var(--ink)' }}>{dropout}</b></span>
        </div>
      </div>
    );
  };

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

  return (
    <div>
      <TopControls />

      {/* 현재 선택된 회차 + 본인 점수 + 상위% + 응시현황 */}
      {bundle[selectedRoundIdx] && <CurrentHeader />}

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

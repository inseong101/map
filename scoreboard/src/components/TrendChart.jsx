// src/components/TrendChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getAverages, getRealScoreDistribution } from '../utils/helpers';

// Firestore 직접 조회(참가자 통계용)
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';

// 학교명 → 코드 변환 (helpers의 bySchool 키와 일치)
const nameToCode = (name) => ({
  '가천대': '01', '경희대': '02', '대구한': '03', '대전대': '04',
  '동국대': '05', '동신대': '06', '동의대': '07', '부산대': '08',
  '상지대': '09', '세명대': '10', '우석대': '11', '원광대': '12',
}[name] || '01');

// 유효 학수번호(01~12 시작 6자리)
function isValidStudentId(sid) {
  if (!sid || typeof sid !== 'string' || sid.length !== 6) return false;
  const code = sid.slice(0, 2);
  return ['01','02','03','04','05','06','07','08','09','10','11','12'].includes(code);
}

// 축/범위 상수
const X_MIN = 0;
const X_MAX = 340;
const BIN_SIZE = 5;
const CUTOFF_SCORE = 204;
const BIN_COUNT = Math.floor((X_MAX - X_MIN) / BIN_SIZE) + 1; // (0~335)/5 + 1(340)

// 상위 백분위(1등=0.0, 꼴등=100.0)
function calculatePercentile(scores, myScore) {
  if (!scores || scores.length === 0 || myScore == null) return null;
  const sorted = [...scores].sort((a, b) => b - a); // 내림차순
  const rank = sorted.findIndex(s => s <= myScore);
  if (rank < 0) return 100.0;              // 모든 점수보다 낮은 경우
  if (rank === 0) return 0.0;              // 1등
  if (rank === sorted.length - 1) return 100.0; // 꼴등
  return +((rank / (sorted.length - 1)) * 100).toFixed(1);
}

// 라운드별 참가자 통계(전체/유효/미응시/중도포기)
// - 유효응시자: 4교시 모두 status === 'completed'
// - 미응시자: 4교시 모두 completed 아님 & 4교시 모두 'absent' (또는 completed=0)
// - 중도포기자: completed 1~3
async function getParticipationStats(roundLabel) {
  const sessions = ['1교시', '2교시', '3교시', '4교시'];
  const perStudent = {}; // sid -> { completedCount, anySeen }

  for (const sess of sessions) {
    const snap = await getDocs(collection(db, 'scores_raw', roundLabel, sess));
    snap.forEach(doc => {
      const sid = doc.id;
      if (!isValidStudentId(sid)) return;
      const data = doc.data();
      const status = data?.status || 'absent';
      if (!perStudent[sid]) perStudent[sid] = { completedCount: 0, seen: false };
      perStudent[sid].seen = true;
      if (status === 'completed') perStudent[sid].completedCount += 1;
    });
  }

  let total = 0, valid = 0, absent = 0, dropout = 0;
  Object.values(perStudent).forEach(st => {
    if (!st.seen) return;
    total += 1;
    if (st.completedCount === 4) valid += 1;
    else if (st.completedCount === 0) absent += 1;
    else dropout += 1;
  });

  return { total, valid, absent, dropout };
}

function TrendChart({ rounds = [], school = '', sid = '' }) {
  const canvasRef = useRef(null);
  const [selectedRoundIdx, setSelectedRoundIdx] = useState(0);
  const [isSchoolMode, setIsSchoolMode] = useState(false);
  const [bundle, setBundle] = useState([]); // 회차별 계산 결과 집합

  // 리사이즈시 재그리기
  useEffect(() => {
    const onResize = () => drawCurrent(bundle);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bundle, isSchoolMode, selectedRoundIdx]);

  // 데이터 준비
  useEffect(() => {
    (async () => {
      if (!rounds.length) return;

      const schCode = nameToCode(school);
      const out = [];

      for (const round of rounds) {
        const { label, data: roundData } = round;

        // 본인 점수(이미 계산되어 넘어온 값 사용 권장)
        const studentScore = Number.isFinite(roundData?.totalScore)
          ? Number(roundData.totalScore)
          : null;

        // 평균(helpers: 유효응시자만 기준)
        const averages = await getAverages(school, label);

        // 실제 분포(helpers: 유효응시자만 기준)
        const dist = await getRealScoreDistribution(label);
        const natScores = Array.isArray(dist?.national) ? dist.national : [];
        const schScores = dist?.bySchool && Array.isArray(dist.bySchool[schCode])
          ? dist.bySchool[schCode]
          : [];

        // 상위 % (유효응시자 기준 전국)
        const percentile = calculatePercentile(natScores, studentScore);

        // 분포(bin)
        const nationalBins = buildDistribution(natScores, studentScore);
        const schoolBins = buildDistribution(schScores, studentScore);

        // 참가자 통계(전부 직접 집계)
        const stats = await getParticipationStats(label);

        out.push({
          label,
          studentScore,
          nationalAvg: averages?.nationalAvg ?? '-',
          schoolAvg: averages?.schoolAvg ?? '-',
          nationalBins,
          schoolBins,
          totalNational: natScores.length,         // 유효응시자 수
          totalSchool: schScores.length,           // 해당 학교 유효응시자 수
          percentile,                              // 상위 %
          participants: stats                      // { total, valid, absent, dropout }
        });
      }

      setBundle(out);
      drawCurrent(out);
    })();
  }, [rounds, school, sid]);

  // 상태 변경 시 재그리기
  useEffect(() => {
    drawCurrent(bundle);
  }, [bundle, selectedRoundIdx, isSchoolMode]);

  // --- 분포(bin) 생성 ---
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

  // --- 그리기 ---
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

    // 타이틀
    const title = isSchoolMode
      ? `${school} 분포 (총 ${cur.totalSchool}명)`
      : `전국 분포 (총 ${cur.totalNational}명)`; // 둘 다 유효응시자 수

    const avg = isSchoolMode ? cur.schoolAvg : cur.nationalAvg;

    ctx.fillStyle = '#e8eeff';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 22);
    ctx.fillStyle = '#9db0d6';
    ctx.font = '12px system-ui';
    ctx.fillText(`평균: ${avg}점`, W / 2, 40);

    const activeBins = isSchoolMode ? cur.schoolBins : cur.nationalBins;
    const yMax = drawAxes(ctx, padding, chartW, chartH, activeBins);

    const color = isSchoolMode ? '#22c55e' : '#7ea2ff';
    drawBars(ctx, padding, chartW, chartH, activeBins, color, yMax);
    drawCutoff(ctx, padding, chartW, chartH, CUTOFF_SCORE);
  }

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
    }

    // Y축 눈금: bins 최대 count 기준으로 보기 좋은 yMax
    const maxCount = Math.max(1, ...bins.map(b => b.count));
    const steps = 4;
    const niceStep = makeNiceStep(maxCount / steps);
    const yStep = Math.max(1, niceStep);
    const yMax = yStep * steps;

    ctx.textAlign = 'right';
    for (let i = 0; i <= steps; i++) {
      const val = i * yStep;
      const y = padding.top + chartH - (val / yMax) * chartH;
      ctx.fillText(String(val), padding.left - 6, y + 3);
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

  function drawBars(ctx, padding, chartW, chartH, bins, primaryColor, yMax) {
    const barCount = bins.length;
    const binWidth = chartW / barCount;
    for (let i = 0; i < barCount; i++) {
      const b = bins[i];
      const x = padding.left + i * binWidth;
      const h = yMax > 0 ? (b.count / yMax) * chartH : 0;
      const y = padding.top + chartH - h;

      const fill = b.isStudent ? '#ef4444' : `${primaryColor}CC`;
      if (b.count > 0) {
        ctx.fillStyle = fill;
        const minH = Math.max(h, 1); // 최소 보이기
        const drawY = padding.top + chartH - minH;
        ctx.fillRect(x + 1, drawY, binWidth - 2, minH);
      }
    }
  }

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

  const current = bundle[selectedRoundIdx];

  return (
    <div>
      {/* 상단 회차 버튼 & 전국/학교 토글은 기존 카드 외부에서 처리하는 경우가 많아 생략 */}
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
          <strong style={{ color: 'var(--ink)' }}>
            {rounds[selectedRoundIdx]?.label}
          </strong>
          {' '}— 본인 점수:{' '}
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
            {Number.isFinite(current.studentScore)
              ? `${current.studentScore}점 (전국 상위 ${current.percentile}%)`
              : '표시 안함'}
          </span>

          {/* 참가자 통계 */}
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
            전체응시자: <b>{current.participants.total}</b>{' '}
            유효응시자: <b>{current.participants.valid}</b>{' '}
            미응시자: <b>{current.participants.absent}</b>{' '}
            중도포기자: <b>{current.participants.dropout}</b>
          </div>
        </div>
      )}

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

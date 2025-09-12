import React, { useMemo, useState, useRef, useEffect } from 'react';
import './WrongPanel.css';

// 교시별 문항 수
const SESSION_LENGTH = { '1교시': 80, '2교시': 100, '3교시': 80, '4교시': 80 };

/** 가장 큰 셀 면적(=여백 최소)을 만드는 cols/rows 계산 */
function bestGrid(n, W, H, gap = 5, aspect = 1) {
  if (!n || !W || !H) return { cols: 1, rows: 1, cellW: 0, cellH: 0 };
  let best = { cols: 1, rows: n, cellW: 0, cellH: 0, score: -1 };

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);

    const totalGapW = gap * (cols - 1);
    const totalGapH = gap * (rows - 1);
    const maxCellW = Math.floor((W - totalGapW) / cols);
    const maxCellH = Math.floor((H - totalGapH) / rows);

    // 정사각형 기준(aspect=1). 비율 바꾸려면 aspect 조정.
    const fitW = Math.min(maxCellW, Math.floor(maxCellH * aspect));
    const fitH = Math.min(maxCellH, Math.floor(maxCellW / aspect));
    const score = fitW * fitH;

    if (score > best.score) best = { cols, rows, cellW: fitW, cellH: fitH, score };
  }
  return best;
}

export default function WrongAnswerPanel({ roundLabel, data }) {
  const [activeSession, setActiveSession] = useState('1교시');
  const gridWrapRef = useRef(null);
  const [gridStyle, setGridStyle] = useState({ cols: 1, cellW: 30, cellH: 30 });

  // 내 오답(교시별 Set)
  const wrongBySession = useMemo(() => {
    const out = { '1교시': new Set(), '2교시': new Set(), '3교시': new Set(), '4교시': new Set() };
    if (data?.wrongBySession) {
      for (const [sess, arr] of Object.entries(data.wrongBySession)) {
        if (Array.isArray(arr)) arr.forEach(n => out[sess]?.add(Number(n)));
      }
    }
    return out;
  }, [data]);

  // 🔥 특별 해설 제공(교시별 Set) — 다양한 키명 지원
  const fireBySession = useMemo(() => {
    const out = { '1교시': new Set(), '2교시': new Set(), '3교시': new Set(), '4교시': new Set() };
    const source = data?.fireBySession || data?.featuredBySession || data?.hotBySession || data?.specialBySession || {};
    for (const [sess, arr] of Object.entries(source)) {
      if (Array.isArray(arr)) arr.forEach(n => out[sess]?.add(Number(n)));
    }
    return out;
  }, [data]);

  // 레이아웃 자동 계산(컨테이너 크기 변동/탭 전환 시)
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;

    const compute = () => {
      const { width, height } = el.getBoundingClientRect();
      const total = SESSION_LENGTH[activeSession] || 80;
      const gap = 5;
      const aspect = 1; // 정사각
      const { cols, cellW, cellH } = bestGrid(total, Math.max(0, width), Math.max(0, height), gap, aspect);
      setGridStyle({
        cols: Math.max(1, cols),
        cellW: Math.max(22, cellW),
        cellH: Math.max(22, cellH),
      });
    };

    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute(); // 최초 1회

    return () => ro.disconnect();
  }, [activeSession]);

  const renderButtons = (session) => {
    const total = SESSION_LENGTH[session] || 80;
    const { cols, cellW, cellH } = gridStyle;

    return (
      <div
        className="btn-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
          gridTemplateRows: `repeat(${Math.ceil(total / cols)}, ${cellH}px)`,
        }}
      >
        {Array.from({ length: total }, (_, i) => {
          const qNum = i + 1;
          const isWrong = wrongBySession[session]?.has(qNum);
          const isFire = fireBySession[session]?.has(qNum);
          const cls = `qbtn${isWrong ? ' red' : ''}${isFire ? ' fire' : ''}`;
          const label = `문항 ${qNum}${isWrong ? ' (내 오답)' : ''}${isFire ? ' · 특별 해설 제공' : ''}`;

          return (
            <button key={qNum} type="button" className={cls} title={label} aria-label={label}>
              {qNum}
              {isFire && <span className="flame-emoji" aria-hidden>🔥</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="wrong-panel-root">
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 보기</h2>

      {/* 설명 줄 — 실제 🔥 예시 버튼 포함 */}
      <div className="legend-line">
        <span>색상: <b className="legend-red">빨강</b>=내 오답, 회색=정답(또는 데이터 없음), </span>
        <span className="legend-example">
          <button type="button" className="qbtn fire" aria-label="특별 해설 제공 예시">
            -예시-<span className="flame-emoji" aria-hidden>🔥</span>
          </button>
          = 특별 해설 제공
        </span>
      </div>

      {/* 상단 탭 */}
      <div className="session-tabs" role="tablist" aria-label="교시 선택">
        {['1교시', '2교시', '3교시', '4교시'].map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={activeSession === s}
            className={`tab-btn ${activeSession === s ? 'active' : ''}`}
            onClick={() => setActiveSession(s)}
            type="button"
          >
            {s}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 — 카드 높이 내에서만 꽉 채움(내부 스크롤 없음) */}
      <div className="tab-content" role="tabpanel" aria-label={`${activeSession} 문항`} ref={gridWrapRef}>
        {renderButtons(activeSession)}
      </div>
    </div>
  );
}
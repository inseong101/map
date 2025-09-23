// src/components/ControversialPanel.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import PdfModalPdfjs from "./PdfModalPdfjs";
import { getFunctions, httpsCallable } from "firebase/functions";
import "./WrongPanel.css";

const SESSIONS = ["1교시", "2교시", "3교시", "4교시"];
const SESSION_LENGTH = { "1교시": 80, "2교시": 100, "3교시": 80, "4교시": 80 };

function bestGrid(n, W, H, gap = 3, aspect = 1) { // 🔧 gap을 3으로 줄여 더 촘촘하게
  if (!n || !W || !H) return { cols: 1, rows: 1, cellW: 0, cellH: 0 };
  let best = { cols: 1, rows: n, cellW: 0, cellH: 0, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const totalGapW = gap * (cols - 1);
    const totalGapH = gap * (rows - 1);
    const maxCellW = Math.floor((W - totalGapW) / cols);
    const maxCellH = Math.floor((H - totalGapH) / rows);
    const fitW = Math.min(maxCellW, Math.floor(maxCellH * aspect));
    const fitH = Math.min(maxCellH, Math.floor(maxCellW / aspect));
    const score = fitW * fitH;
    if (score > best.score) best = { cols, rows, cellW: fitW, cellH: fitH, score };
  }
  return best;
}

export default function ControversialPanel({ allRoundLabels, roundLabel, onRoundChange, sid, onBack }) {
  const [activeSession, setActiveSession] = useState("1교시");
  const gridWrapRef = useRef(null);
  const [gridStyle, setGridStyle] = useState({ cols: 1, cellW: 24, cellH: 24 }); // 🔧 cellW/H 기본값 24로 작게 설정
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPath, setPdfPath] = useState(null);

  const [highErrorQuestions, setHighErrorQuestions] = useState({});
  const [fireBySession, setFireBySession] = useState({
    "1교시": new Set(), "2교시": new Set(), "3교시": new Set(), "4교시": new Set(),
  });

  const getHighErrorRateQuestions = useCallback(async (rLabel) => {
    try {
      const functions = getFunctions(undefined, "us-central1");
      const getHighError = httpsCallable(functions, "getHighErrorRateQuestions");
      const res = await getHighError({ roundLabel: rLabel });
      return res.data?.data || {};
    } catch (e) {
      console.error("고오답률 문항 조회 실패:", e);
      return {};
    }
  }, []);

  const getExplanationIndex = useCallback(async (rLabel) => {
    try {
      const functions = getFunctions(undefined, "us-central1");
      const getIndex = httpsCallable(functions, "getExplanationIndex");
      const res = await getIndex({ roundLabel: rLabel });
      return res.data || {};
    } catch (e) {
      console.error("해설 인덱스 조회 실패:", e);
      return {};
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [highErrors, explanationIndex] = await Promise.all([
        getHighErrorRateQuestions(roundLabel),
        getExplanationIndex(roundLabel)
      ]);
      if (!cancelled) {
        setHighErrorQuestions(highErrors);
        setFireBySession({
          "1교시": new Set(explanationIndex["1교시"] || []),
          "2교시": new Set(explanationIndex["2교시"] || []),
          "3교시": new Set(explanationIndex["3교시"] || []),
          "4교시": new Set(explanationIndex["4교시"] || []),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [roundLabel, getHighErrorRateQuestions, getExplanationIndex]);

  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const compute = () => {
      const { width, height } = el.getBoundingClientRect();
      const total = SESSION_LENGTH[activeSession] || 80;
      const { cols, cellW, cellH } = bestGrid(total, Math.max(0, width), Math.max(0, height), 3, 1);
      setGridStyle({ cols: Math.max(1, cols), cellW: Math.max(22, cellW), cellH: Math.max(22, cellH) });
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [activeSession]);

  const openExplanation = (session, qNum) => {
    const rNum = parseInt(String(roundLabel).replace(/\D/g, ""), 10) || 1;
    const sNum = parseInt(String(session).replace(/\D/g, ""), 10) || 1;
    const path = `explanation/${rNum}-${sNum}-${qNum}.pdf`;
    setPdfPath(path);
    setPdfOpen(true);
  };

  const renderButtons = (session) => {
    const total = SESSION_LENGTH[session] || 80;
    const { cols, cellW, cellH } = gridStyle;
    const questionsWithHighError = new Set(Object.values(highErrorQuestions).flat().map(q => q.questionNum));

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
          const isHighError = questionsWithHighError.has(qNum);
          const hasExp = fireBySession[session]?.has(qNum);
          const cls = `qbtn${isHighError ? " red" : ""}${hasExp ? " fire" : ""}`;
          const label = `문항 ${qNum}${isHighError ? " (논란 문제)" : ""}${hasExp ? " · 특별 해설" : ""}`;

          return (
            <button
              key={qNum}
              type="button"
              className={cls}
              title={label}
              aria-label={label}
              data-click-role={hasExp ? "exp" : undefined}
              onClick={
                hasExp
                  ? (e) => { e.stopPropagation(); openExplanation(session, qNum); }
                  : undefined
              }
              style={{
                width: `${cellW}px`,
                height: `${cellH}px`,
                cursor: hasExp ? "pointer" : "default",
              }}
            >
              {qNum}
              {hasExp && <span className="flame-emoji" aria-hidden>🔥</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="wrong-panel-root">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>논란 문제 해설</h2>
        <button onClick={onBack} className="btn secondary" style={{ fontSize: 13 }}>뒤로가기</button>
      </div>

      <div className="legend-line">
        <span>색상: <b className="legend-red">빨강</b>=논란 문제, 회색=일반 문제</span>
        <span className="legend-example">
          <button
            type="button"
            className="qbtn fire sample"
            aria-label="특별 해설 제공 예시"
            style={{ width: `${gridStyle.cellW}px`, height: `${gridStyle.cellH}px` }}
            tabIndex={-1}
          >
            해설<br />제공<br /><span className="flame-emoji" aria-hidden>🔥</span>
          </button>
          <span className="legend-label">특별 해설 제공</span>
        </span>
      </div>

      {/* ✅ 회차 선택 탭 추가 */}
      <div className="round-tabs" role="tablist" aria-label="회차 선택">
        {allRoundLabels.map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={roundLabel === r}
            className={`tab-btn ${roundLabel === r ? "active" : ""}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRoundChange(r);
            }}
          >
            {r}
          </button>
        ))}
      </div>
      
      <div className="session-tabs" role="tablist" aria-label="교시 선택">
        {SESSIONS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={activeSession === s}
            className={`tab-btn ${activeSession === s ? "active" : ""}`}
            type="button"
            data-click-role="tab"
            onClick={(e) => {
              e.stopPropagation();
              setActiveSession(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="tab-content" role="tabpanel" aria-label={`${activeSession} 문항`} ref={gridWrapRef}>
        {renderButtons(activeSession)}
      </div>

      <PdfModalPdfjs
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        filePath={pdfPath}
        sid={sid}
        title={`${roundLabel} ${activeSession} 특별해설`}
      />
    </div>
  );
}

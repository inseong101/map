// src/components/WrongAnswerPanel.jsx
import React, { useMemo, useState, useRef, useEffect } from "react";
import "./WrongPanel.css";
import PdfModalPdfjs from "./PdfModalPdfjs";
import { getFunctions, httpsCallable } from "firebase/functions";

const SESSION_LENGTH = { "1교시": 80, "2교시": 100, "3교시": 80, "4교시": 80 };

function bestGrid(n, W, H, gap = 5, aspect = 1) {
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

export default function WrongAnswerPanel({ roundLabel, data, sid }) {
  const [activeSession, setActiveSession] = useState("1교시");
  const gridWrapRef = useRef(null);
  const [gridStyle, setGridStyle] = useState({ cols: 1, cellW: 30, cellH: 30 });

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPath, setPdfPath] = useState(null);

  const wrongBySession = useMemo(() => {
    const out = { "1교시": new Set(), "2교시": new Set(), "3교시": new Set(), "4교시": new Set() };
    if (data?.wrongBySession) {
      for (const [sess, arr] of Object.entries(data.wrongBySession)) {
        if (Array.isArray(arr)) arr.forEach((n) => out[sess]?.add(Number(n)));
      }
    }
    return out;
  }, [data]);

  const [fireBySession, setFireBySession] = useState({
    "1교시": new Set(), "2교시": new Set(), "3교시": new Set(), "4교시": new Set(),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const functions = getFunctions(undefined, "us-central1");
        const getIndex = httpsCallable(functions, "getExplanationIndex");
        const res = await getIndex({ roundLabel });
        const idx = res.data || {};
        const mapped = {
          "1교시": new Set(idx["1교시"] || []),
          "2교시": new Set(idx["2교시"] || []),
          "3교시": new Set(idx["3교시"] || []),
          "4교시": new Set(idx["4교시"] || []),
        };
        if (!cancelled) setFireBySession(mapped);
      } catch (e) {
        console.error("해설 인덱스 조회 실패:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [roundLabel]);

  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const compute = () => {
      const { width, height } = el.getBoundingClientRect();
      const total = SESSION_LENGTH[activeSession] || 80;
      const { cols, cellW, cellH } = bestGrid(total, Math.max(0, width), Math.max(0, height), 5, 1);
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
          const hasExp = fireBySession[session]?.has(qNum);
          const cls = `qbtn${isWrong ? " red" : ""}${hasExp ? " fire" : ""}`;
          const label = `문항 ${qNum}${isWrong ? " (내 오답)" : ""}${hasExp ? " · 특별 해설" : ""}`;

          return (
            <button
              key={qNum}
              type="button"
              className={cls}
              title={label}
              aria-label={label}
              data-click-role={hasExp ? "exp" : undefined}   // 해설 있을 때만 플립 가로채기
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
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 보기</h2>

      <div className="legend-line">
        <span>색상: <b className="legend-red">빨강</b>=내 오답, 회색=정답/없음,</span>
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

      <div className="session-tabs" role="tablist" aria-label="교시 선택">
  {["1교시", "2교시", "3교시", "4교시"].map((s) => (
    <button
      key={s}
      role="tab"
      aria-selected={activeSession === s}
      className={`tab-btn ${activeSession === s ? "active" : ""}`}
      type="button"
      data-click-role="tab"                 // ✅ 플립 방지 식별자
      onClick={(e) => {                    // ✅ 플립 버블링 차단
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

// src/components/ControversialPanel.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import PdfModalPdfjs from "./PdfModalPdfjs";
import { getFunctions, httpsCallable } from "firebase/functions";
import "./WrongPanel.css";

const SESSIONS = ["1교시", "2교시", "3교시", "4교시"];
const SESSION_LENGTH = { "1교시": 80, "2교시": 100, "3교시": 80, "4교시": 80 };

function bestGrid(n, W, H, gap = 3, aspect = 1) {
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

export default function ControversialPanel({ allRoundLabels, roundLabel, onRoundChange, sid }) {
  const [activeSession, setActiveSession] = useState("1교시");
  const [activeSubject, setActiveSubject] = useState(null);
  const gridWrapRef = useRef(null);
  const [gridStyle, setGridStyle] = useState({ cols: 1, cellW: 24, cellH: 24 });
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPath, setPdfPath] = useState(null);

  const [highErrorQuestions, setHighErrorQuestions] = useState({});
  const [fireBySession, setFireBySession] = useState({
    "1교시": new Set(), "2교시": new Set(), "3교시": new Set(), "4교시": new Set(),
  });
  const [hasErrorData, setHasErrorData] = useState(false);

  const getHighErrorRateQuestions = useCallback(async (rLabel) => {
    try {
      const functions = getFunctions(undefined, "us-central1");
      const getHighError = httpsCallable(functions, "getHighErrorRateQuestions");
      const res = await getHighError({ roundLabel: rLabel });
      return res.data?.data || {};
    } catch (e) {
      console.error("많이 틀린 문항 조회 실패:", e);
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
        const hasData = Object.keys(highErrors).some(s => Object.keys(highErrors[s]).length > 0);
        setHasErrorData(hasData);
        if(hasData && !activeSubject) {
          setActiveSubject(Object.keys(highErrors)[0] || null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roundLabel, getHighErrorRateQuestions, getExplanationIndex]);

  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const compute = () => {
      const total = activeSubject ? highErrorQuestions[activeSubject].length : 0;
      const { width, height } = el.getBoundingClientRect();
      const { cols, cellW, cellH } = bestGrid(total, Math.max(0, width), Math.max(0, height), 3, 1);
      setGridStyle({ cols: Math.max(1, cols), cellW: Math.max(22, cellW), cellH: Math.max(22, cellH) });
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [activeSubject, highErrorQuestions]);

  const openExplanation = (session, qNum) => {
    const rNum = parseInt(String(roundLabel).replace(/\D/g, ""), 10) || 1;
    const sNum = parseInt(String(session).replace(/\D/g, ""), 10) || 1;
    const path = `explanation/${rNum}-${sNum}-${qNum}.pdf`;
    setPdfPath(path);
    setPdfOpen(true);
  };

  const renderButtons = () => {
    if (!activeSubject || !highErrorQuestions[activeSubject]) return null;
    const questions = highErrorQuestions[activeSubject];
    const { cols, cellW, cellH } = gridStyle;
    return (
      <div
        className="btn-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
          gridTemplateRows: `repeat(${Math.ceil(questions.length / cols)}, ${cellH}px)`,
        }}
      >
        {questions.map((q) => {
          const qNum = q.questionNum;
          const session = findSessionByQuestionNum(qNum);
          const hasExp = fireBySession[session]?.has(qNum);
          const cls = `qbtn red${hasExp ? " fire" : ""}`;
          const label = `문항 ${qNum}${hasExp ? " · 특별 해설" : ""}`;

          return (
            <button
              key={qNum}
              type="button"
              className={cls}
              title={label}
              aria-label={label}
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

  const getSubjectsBySession = (session) => {
    const subjects = [];
    Object.entries(highErrorQuestions).forEach(([subj, questions]) => {
      if (questions.some(q => findSessionByQuestionNum(q.questionNum) === session)) {
        subjects.push(subj);
      }
    });
    return subjects;
  };

  const findSessionByQuestionNum = (qNum) => {
    const ranges = {
      "1교시": { min: 1, max: 80 },
      "2교시": { min: 1, max: 100 },
      "3교시": { min: 1, max: 80 },
      "4교시": { min: 1, max: 80 }
    };
    if (qNum >= 1 && qNum <= 80) return "1교시";
    if (qNum >= 81 && qNum <= 100) return "2교시";
    return null;
  };

  return (
    <div className="wrong-panel-root">
      <h2 style={{ marginTop: 0 }}>많이 틀린 문항 해설</h2>

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
            onClick={(e) => {
              e.stopPropagation();
              setActiveSession(s);
              const subjects = getSubjectsBySession(s);
              setActiveSubject(subjects[0] || null);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {activeSession && getSubjectsBySession(activeSession).length > 0 && (
        <div className="subject-tabs" role="tablist" aria-label="과목 선택">
          {getSubjectsBySession(activeSession).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={activeSubject === s}
              className={`tab-btn ${activeSubject === s ? "active" : ""}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveSubject(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {renderButtons()}

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

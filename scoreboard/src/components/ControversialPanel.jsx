// src/components/ControversialPanel.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import PdfModalPdfjs from "./PdfModalPdfjs";
import { getFunctions, httpsCallable } from "firebase/functions";
import "./WrongPanel.css";

const SESSIONS = ["1교시", "2교시", "3교시", "4교시"];

// ✅ 정확한 과목 매핑 정의 (회차별로 다름)
const SUBJECT_MAPPINGS = {
  "1차": {
    "1교시": [
      "신", "신", "폐", "심", "심", "간", "폐", "폐", "폐", "간",
      "비", "폐", "신", "신", "신", "간", "비", "비", "비", "비",
      "심", "심", "심", "심", "간", "비", "비", "심", "심", "심",
      "신", "신", "심", "폐", "심", "비", "비", "비", "비", "비",
      "비", "폐", "폐", "폐", "폐", "간", "신", "간", "신", "간",
      "간", "간", "폐", "신", "간", "심", "심", "심", "심", "심",
      "폐", "폐", "폐", "폐", "비", "비", "비", "비", "간", "간",
      "간", "간", "간", "신", "신", "신", "신", "신", "신", "간"
    ],
    "2교시": [
      // 1-16: 상한
      "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한", "상한",
      // 17-32: 사상
      "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상", "사상",
      // 33-80: 침구
      "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구",
      "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구",
      "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구", "침구",
      // 81-100: 법규
      "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규", "법규"
    ],
    "3교시": [
      // 1-16: 외과
      "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과", "외과",
      // 17-32: 신정
      "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정", "신정",
      // 33-48: 안이비
      "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비", "안이비",
      // 49-80: 부인
      "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인",
      "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인", "부인"
    ],
    "4교시": [
      // 1-24: 소아
      "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아", "소아",
      // 25-48: 예방
      "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방", "예방",
      // 49-64: 생리
      "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리", "생리",
      // 65-80: 본초
      "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초", "본초"
    ]
  }
  // TODO: 2차, 3차, 4차, 5차, 6차, 7차, 8차 매핑 추가 예정
};

// ✅ 수정된 과목 매핑 함수
function getSubjectByQuestion(qNum, session, roundLabel) {
  const mapping = SUBJECT_MAPPINGS[roundLabel]?.[session];
  if (mapping && qNum >= 1 && qNum <= mapping.length) {
    return mapping[qNum - 1];
  }
  return "기타";
}

// ✅ 수정된 세션 찾기 함수 - 데이터에서 session 정보 사용
function findSessionByQuestionNum(qNum, questionData) {
  // questionData에 session 정보가 있으면 그것을 사용
  if (questionData && questionData.session) {
    return questionData.session;
  }
  
  // 기본값 (실제로는 사용되지 않아야 함)
  return "1교시";
}

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
      console.log("데이터 로딩 시작:", roundLabel);
      const [highErrors, explanationIndex] = await Promise.all([
        getHighErrorRateQuestions(roundLabel),
        getExplanationIndex(roundLabel)
      ]);
      
      if (!cancelled) {
        console.log("받은 데이터:", { highErrors, explanationIndex });
        setHighErrorQuestions(highErrors);
        setFireBySession({
          "1교시": new Set(explanationIndex["1교시"] || []),
          "2교시": new Set(explanationIndex["2교시"] || []),
          "3교시": new Set(explanationIndex["3교시"] || []),
          "4교시": new Set(explanationIndex["4교시"] || []),
        });
        
        // 첫 번째 과목을 활성화
        const subjectKeys = Object.keys(highErrors);
        if (subjectKeys.length > 0) {
          setActiveSubject(subjectKeys[0]);
          console.log("활성 과목 설정:", subjectKeys[0]);
        } else {
          setActiveSubject(null);
          console.log("과목 데이터 없음");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roundLabel, getHighErrorRateQuestions, getExplanationIndex]);

  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const compute = () => {
      const total = activeSubject ? (highErrorQuestions[activeSubject]?.length || 0) : 0;
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
    console.log("PDF 열기:", path);
    setPdfPath(path);
    setPdfOpen(true);
  };

  const renderButtons = () => {
    if (!activeSubject || !highErrorQuestions[activeSubject]) {
      console.log("버튼 렌더링 불가:", { activeSubject, hasData: !!highErrorQuestions[activeSubject] });
      return null;
    }
    
    const questions = highErrorQuestions[activeSubject];
    console.log("버튼 렌더링:", { activeSubject, questions: questions.length });
    
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
          // ✅ 문제 데이터에서 직접 세션 정보 사용
          const session = q.session;
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
                  ? (e) => { 
                      e.stopPropagation(); 
                      openExplanation(session, qNum); 
                    }
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
    if (highErrorQuestions) {
      Object.entries(highErrorQuestions).forEach(([subj, questions]) => {
        // 해당 과목의 문제 중 선택된 세션에 속하는 것이 있는지 확인
        if (questions.some(q => q.session === session)) {
          subjects.push(subj);
        }
      });
    }
    console.log(`${session} 과목들:`, subjects);
    return subjects;
  };

  // 세션이 변경될 때 해당 세션의 첫 번째 과목으로 설정
  useEffect(() => {
    const subjects = getSubjectsBySession(activeSession);
    if (subjects.length > 0 && !subjects.includes(activeSubject)) {
      setActiveSubject(subjects[0]);
      console.log(`${activeSession} 첫 번째 과목으로 변경:`, subjects[0]);
    }
  }, [activeSession, highErrorQuestions]);

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
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {getSubjectsBySession(activeSession).length > 0 && (
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

      <div className="tab-content" ref={gridWrapRef}>
        {renderButtons()}
      </div>

      <PdfModalPdfjs
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        filePath={pdfPath}
        sid={sid}
        title={`${roundLabel} ${activeSession} 많이 틀린 문항 해설`}
      />
    </div>
  );
}

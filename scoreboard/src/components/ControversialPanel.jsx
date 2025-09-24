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
      "간", "간", "심", "심", "심", "간", "심", "심", "심", "간",
      "비", "심", "간", "간", "간", "간", "비", "비", "비", "비",
      "심", "심", "심", "심", "간", "비", "비", "심", "심", "심",
      "간", "간", "심", "심", "심", "비", "비", "비", "비", "비",
      "비", "심", "심", "심", "심", "간", "간", "간", "간", "간",
      "간", "간", "심", "간", "간", "심", "심", "심", "심", "심",
      "심", "심", "심", "심", "비", "비", "비", "비", "간", "간",
      "간", "간", "간", "간", "간", "간", "간", "간", "간", "간"
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

// ✅ 과목 순서 정의 (간심비폐신 순)
const SUBJECT_ORDER = ["간", "심", "비", "폐", "신", "상한", "사상", "침구", "법규", "외과", "신정", "안이비", "부인", "소아", "예방", "생리", "본초"];

// ✅ 해당 회차의 교시가 매핑이 있는지 확인
function isSessionAvailable(roundLabel, session) {
  return !!(SUBJECT_MAPPINGS[roundLabel]?.[session]);
}

// ✅ 해당 회차가 전체적으로 매핑이 있는지 확인
function isRoundAvailable(roundLabel) {
  return !!(SUBJECT_MAPPINGS[roundLabel]);
}

function bestGrid(n, W, H, gap = 2, aspect = 1) {
  if (!n || !W || !H) return { cols: 10, rows: 1, cellW: 60, cellH: 60 };
  
  // 가로로 10개를 우선시
  let best = { cols: 10, rows: Math.ceil(n / 10), cellW: 0, cellH: 0, score: -1 };
  
  // 10개 열 기준으로 크기 계산
  const preferredCols = 10;
  const rows = Math.ceil(n / preferredCols);
  const totalGapW = gap * (preferredCols - 1);
  const totalGapH = gap * (rows - 1);
  const maxCellW = Math.floor((W - totalGapW) / preferredCols);
  const maxCellH = Math.floor((H - totalGapH) / rows);
  
  // 정사각형에 가깝게 만들되 적당한 크기로
  const targetSize = Math.min(maxCellW, maxCellH, 80); // 최대 80px
  const finalW = Math.max(40, Math.min(80, targetSize)); // 40-80px 범위
  const finalH = finalW; // 정사각형
  
  best = { cols: preferredCols, rows, cellW: finalW, cellH: finalH, score: finalW * finalH };
  
  return best;
}

export default function ControversialPanel({ allRoundLabels, roundLabel, onRoundChange, sid }) {
  const [activeSession, setActiveSession] = useState("1교시");
  const [activeSubject, setActiveSubject] = useState(null);
  const gridWrapRef = useRef(null);
  const [gridStyle, setGridStyle] = useState({ cols: 10, cellW: 60, cellH: 60 });
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPath, setPdfPath] = useState(null);
  const [highErrorQuestions, setHighErrorQuestions] = useState({});
  const [fireBySession, setFireBySession] = useState({
    "1교시": new Set(), "2교시": new Set(), "3교시": new Set(), "4교시": new Set(),
  });
  const [loading, setLoading] = useState(false); // 로딩 상태 추가

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
      setLoading(true); // 로딩 시작
      
      // 해당 회차가 매핑되어 있지 않으면 데이터 로딩 중단
      if (!isRoundAvailable(roundLabel)) {
        console.log("매핑되지 않은 회차:", roundLabel);
        if (!cancelled) {
          setHighErrorQuestions({});
          setFireBySession({
            "1교시": new Set(), "2교시": new Set(), "3교시": new Set(), "4교시": new Set(),
          });
          setActiveSubject(null);
          setLoading(false);
        }
        return;
      }
      
      try {
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
          
          // 첫 번째 과목을 활성화 (순서대로)
          const subjectKeys = Object.keys(highErrors);
          if (subjectKeys.length > 0) {
            // SUBJECT_ORDER에 따라 정렬된 첫 번째 과목 선택
            const sortedSubjects = subjectKeys.sort((a, b) => {
              const aIndex = SUBJECT_ORDER.indexOf(a);
              const bIndex = SUBJECT_ORDER.indexOf(b);
              return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
            });
            setActiveSubject(sortedSubjects[0]);
            console.log("활성 과목 설정:", sortedSubjects[0]);
          } else {
            setActiveSubject(null);
            console.log("과목 데이터 없음");
          }
        }
      } catch (error) {
        console.error("데이터 로딩 실패:", error);
      } finally {
        if (!cancelled) {
          setLoading(false); // 로딩 완료
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roundLabel, getHighErrorRateQuestions, getExplanationIndex]);

  // 그리드 크기 재계산 (디바운스 추가로 크기 오류 방지)
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    
    let timeoutId = null;
    
    const compute = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const total = activeSubject ? (highErrorQuestions[activeSubject]?.length || 0) : 0;
        if (total === 0) {
          setGridStyle({ cols: 10, cellW: 60, cellH: 60 });
          return;
        }
        
        const rect = el.getBoundingClientRect();
        const { width, height } = rect;
        
        if (width > 0 && height > 0) {
          const { cols, cellW, cellH } = bestGrid(total, width, height, 2, 1);
          setGridStyle({ 
            cols: Math.max(1, cols), 
            cellW: Math.max(40, Math.min(80, cellW)),
            cellH: Math.max(40, Math.min(80, cellH)) 
          });
        }
      }, 100);
    };
    
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    
    return () => {
      ro.disconnect();
      clearTimeout(timeoutId);
    };
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
    
    // 문제 번호 순으로 정렬 (작은 번호부터 왼쪽에서 오른쪽으로)
    const sortedQuestions = [...questions].sort((a, b) => a.questionNum - b.questionNum);
    
    const { cols, cellW, cellH } = gridStyle;
    return (
      <div
        className="btn-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
          gridTemplateRows: `repeat(${Math.ceil(sortedQuestions.length / cols)}, ${cellH}px)`,
        }}
      >
        {sortedQuestions.map((q) => {
          const qNum = q.questionNum;
          const session = q.session;
          const hasExp = fireBySession[session]?.has(qNum);
          
          const cls = hasExp 
            ? `qbtn red fire` 
            : `qbtn no-explanation`;
          
          const label = hasExp 
            ? `문항 ${qNum} · 특별 해설`
            : `문항 ${qNum}`;

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
        if (questions.some(q => q.session === session)) {
          subjects.push(subj);
        }
      });
    }
    
    subjects.sort((a, b) => {
      const aIndex = SUBJECT_ORDER.indexOf(a);
      const bIndex = SUBJECT_ORDER.indexOf(b);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
    
    console.log(`${session} 과목들:`, subjects);
    return subjects;
  };

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
        {allRoundLabels.map((r) => {
          const isAvailable = isRoundAvailable(r);
          return (
            <button
              key={r}
              role="tab"
              aria-selected={roundLabel === r}
              className={`tab-btn ${roundLabel === r ? "active" : ""}`}
              type="button"
              disabled={!isAvailable}
              onClick={(e) => {
                e.stopPropagation();
                if (isAvailable) {
                  onRoundChange(r);
                }
              }}
            >
              {r}
            </button>
          );
        })}
      </div>

      <div className="session-tabs" role="tablist" aria-label="교시 선택">
        {SESSIONS.map((s) => {
          const isAvailable = isSessionAvailable(roundLabel, s);
          return (
            <button
              key={s}
              role="tab"
              aria-selected={activeSession === s}
              className={`tab-btn ${activeSession === s ? "active" : ""}`}
              type="button"
              disabled={!isAvailable}
              onClick={(e) => {
                e.stopPropagation();
                if (isAvailable) {
                  setActiveSession(s);
                }
              }}
            >
              {s}
            </button>
          );
        })}
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
        {loading ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '200px',
            gap: '12px'
          }}>
            <div className="spinner"></div>
            <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
              문항 데이터를 불러오고 있습니다...
            </div>
          </div>
        ) : (
          renderButtons()
        )}
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

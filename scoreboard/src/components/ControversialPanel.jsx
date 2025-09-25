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

// ✅ 과목 순서 정의 (간심비폐신 순)
const SUBJECT_ORDER = ["간", "심", "비", "폐", "신", "상한", "사상", "침구", "법규", "외과", "신정", "안이비", "부인", "소아", "예방", "생리", "본초"];

// ✅ 과목 매핑 함수
function getSubjectByQuestion(qNum, session, roundLabel) {
  const mapping = SUBJECT_MAPPINGS[roundLabel]?.[session];
  if (mapping && qNum >= 1 && qNum <= mapping.length) {
    return mapping[qNum - 1];
  }
  return "기타";
}

// ✅ 해당 회차의 교시가 매핑이 있는지 확인
function isSessionAvailable(roundLabel, session) {
  return !!(SUBJECT_MAPPINGS[roundLabel]?.[session]);
}

// ✅ 해당 회차가 전체적으로 매핑이 있는지 확인
function isRoundAvailable(roundLabel) {
  return !!(SUBJECT_MAPPINGS[roundLabel]);
}

// 안정화된 그리드 계산 함수 - 깜빡임 방지
function calculateOptimalGrid(questionCount, containerWidth, containerHeight) {
  if (!questionCount || !containerWidth || !containerHeight) {
    return { cols: 8, rows: 1, cellW: 50, cellH: 50 };
  }
  
  const isMobile = containerWidth < 600;
  const isTablet = containerWidth >= 600 && containerWidth < 900;
  
  // 문제 개수 구간별로 고정된 레이아웃 사용 (깜빡임 방지)
  let targetCols;
  
  if (isMobile) {
    // 모바일: 문제 수에 따른 고정 열 수
    if (questionCount <= 12) targetCols = 6;      // 1-12개: 6열
    else if (questionCount <= 16) targetCols = 8; // 13-16개: 8열  
    else if (questionCount <= 24) targetCols = 8; // 17-24개: 8열
    else if (questionCount <= 32) targetCols = 8; // 25-32개: 8열
    else if (questionCount <= 48) targetCols = 8; // 33-48개: 8열
    else targetCols = 10; // 49개 이상: 10열
  } else if (isTablet) {
    // 태블릿: 안정적인 열 수
    if (questionCount <= 20) targetCols = 10;     // 1-20개: 10열
    else if (questionCount <= 32) targetCols = 12; // 21-32개: 12열
    else if (questionCount <= 48) targetCols = 12; // 33-48개: 12열
    else targetCols = 14; // 49개 이상: 14열
  } else {
    // 데스크톱: 큰 화면 최적화
    if (questionCount <= 20) targetCols = 10;     // 1-20개: 10열
    else if (questionCount <= 32) targetCols = 12; // 21-32개: 12열
    else if (questionCount <= 48) targetCols = 14; // 33-48개: 14열
    else if (questionCount <= 80) targetCols = 16; // 49-80개: 16열
    else targetCols = 20; // 81개 이상: 20열
  }
  
  const rows = Math.ceil(questionCount / targetCols);
  const gap = isMobile ? 2 : 3;
  
  // 여백 계산
  const padding = isMobile ? 8 : 12;
  const totalGapW = gap * (targetCols - 1);
  const totalGapH = gap * (rows - 1);
  const availableW = containerWidth - totalGapW - (padding * 2);
  const availableH = containerHeight - totalGapH - (padding * 2);
  
  // 버튼 크기 계산
  const maxPossibleW = Math.floor(availableW / targetCols);
  const maxPossibleH = Math.floor(availableH / rows);
  
  // 크기 제한
  const minSize = isMobile ? 32 : 38;
  const maxSize = isMobile ? 58 : isTablet ? 68 : 78;
  
  let cellSize = Math.min(maxPossibleW, maxPossibleH);
  cellSize = Math.max(minSize, Math.min(cellSize, maxSize));
  
  return {
    cols: targetCols,
    rows: rows,
    cellW: cellSize,
    cellH: cellSize,
    questionCount: questionCount,
    containerWidth: Math.floor(containerWidth) // 정수화로 안정성 증대
  };
}

export default function ControversialPanel({ allRoundLabels, roundLabel, onRoundChange, sid }) {
  const [activeSession, setActiveSession] = useState("1교시");
  const [activeSubject, setActiveSubject] = useState(null);
  const gridWrapRef = useRef(null);
  const [gridStyle, setGridStyle] = useState({ cols: 8, cellW: 50, cellH: 50 });
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPath, setPdfPath] = useState(null);
  const [highErrorQuestions, setHighErrorQuestions] = useState({});
  const [fireBySession, setFireBySession] = useState({
    "1교시": new Set(), "2교시": new Set(), "3교시": new Set(), "4교시": new Set(),
  });
  const [loading, setLoading] = useState(false);

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
      setLoading(true);
      
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
        // 해설 인덱스만 가져옴 (Functions의 더미 데이터는 사용하지 않음)
        const explanationIndex = await getExplanationIndex(roundLabel);
        
        if (!cancelled) {
          // 프론트엔드에서 모든 문항 생성
          const allQuestions = {};
          
          // 모든 교시의 모든 문항을 생성
          const sessions = {
            "1교시": { min: 1, max: 80 },
            "2교시": { min: 1, max: 100 },
            "3교시": { min: 1, max: 80 },
            "4교시": { min: 1, max: 80 }
          };

          Object.entries(sessions).forEach(([session, range]) => {
            for (let qNum = range.min; qNum <= range.max; qNum++) {
              const subject = getSubjectByQuestion(qNum, session, roundLabel);
              if (!allQuestions[subject]) {
                allQuestions[subject] = [];
              }
              
              allQuestions[subject].push({
                questionNum: qNum,
                session: session,
                errorRate: Math.random() * 0.7 + 0.3 // 더미 오답률
              });
            }
          });

          // 각 과목별로 문항번호 순 정렬
          Object.keys(allQuestions).forEach(subject => {
            allQuestions[subject].sort((a, b) => a.questionNum - b.questionNum);
          });
          
          console.log("생성된 모든 문항:", allQuestions);
          setHighErrorQuestions(allQuestions);
          setFireBySession({
            "1교시": new Set(explanationIndex["1교시"] || []),
            "2교시": new Set(explanationIndex["2교시"] || []),
            "3교시": new Set(explanationIndex["3교시"] || []),
            "4교시": new Set(explanationIndex["4교시"] || []),
          });
          
          // 첫 번째 과목 활성화
          const subjectKeys = Object.keys(allQuestions).filter(subject => 
            allQuestions[subject].length > 0
          );
          if (subjectKeys.length > 0) {
            const sortedSubjects = subjectKeys.sort((a, b) => {
              const aIndex = SUBJECT_ORDER.indexOf(a);
              const bIndex = SUBJECT_ORDER.indexOf(b);
              return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
            });
            setActiveSubject(sortedSubjects[0]);
            console.log("활성 과목 설정:", sortedSubjects[0]);
          } else {
            setActiveSubject(null);
          }
        }
      } catch (error) {
        console.error("데이터 로딩 실패:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roundLabel, getExplanationIndex]);

  // 안정화된 그리드 크기 재계산 (깜빡임 방지)
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    
    let timeoutId = null;
    let lastCalculation = null;
    
    const computeGrid = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const currentQuestions = activeSubject ? (highErrorQuestions[activeSubject] || []) : [];
        const questionCount = currentQuestions.length;
        
        if (questionCount === 0) {
          setGridStyle({ cols: 8, cellW: 50, cellH: 50 });
          return;
        }
        
        const rect = el.getBoundingClientRect();
        const { width, height } = rect;
        
        if (width > 0 && height > 0) {
          // 현재 계산 키 생성 (반올림으로 안정화)
          const currentKey = `${questionCount}-${Math.round(width/20)*20}-${Math.round(height/20)*20}`;
          
          // 동일한 조건이면 재계산하지 않음 (깜빡임 방지)
          if (lastCalculation && lastCalculation.key === currentKey) {
            return;
          }
          
          const optimalGrid = calculateOptimalGrid(questionCount, width, height);
          
          // 이전 그리드와 큰 차이가 없으면 변경하지 않음 (안정화)
          if (lastCalculation && 
              Math.abs(lastCalculation.grid.cols - optimalGrid.cols) <= 1 && 
              Math.abs(lastCalculation.grid.cellW - optimalGrid.cellW) <= 5) {
            return;
          }
          
          console.log(`그리드 계산: ${questionCount}개 문제 → ${optimalGrid.cols}x${optimalGrid.rows} (${optimalGrid.cellW}px)`);
          setGridStyle(optimalGrid);
          
          // 마지막 계산 결과 저장
          lastCalculation = {
            key: currentKey,
            grid: optimalGrid,
            timestamp: Date.now()
          };
        }
      }, 300); // 디바운스 시간 증가
    };
    
    // ResizeObserver로 크기 변화 감지 (과도한 실행 방지)
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      
      const { width, height } = entry.contentRect;
      
      // 크기 변화가 충분히 클 때만 재계산 (깜빡임 방지)
      if (lastCalculation) {
        const widthDiff = Math.abs(width - (lastCalculation.containerWidth || 0));
        const heightDiff = Math.abs(height - (lastCalculation.containerHeight || 0));
        
        if (widthDiff < 30 && heightDiff < 30) {
          return; // 작은 크기 변화는 무시
        }
      }
      
      computeGrid();
    });
    
    resizeObserver.observe(el);
    
    // 초기 계산 (지연 실행)
    setTimeout(computeGrid, 100);
    
    return () => {
      resizeObserver.disconnect();
      clearTimeout(timeoutId);
    };
  }, [activeSubject, highErrorQuestions]);

  // 윈도우 리사이즈는 더 보수적으로 처리 (모바일 회전시만)
  useEffect(() => {
    let timeoutId = null;
    let lastOrientation = window.orientation;
    
    const handleResize = () => {
      // 방향 변경이 있을 때만 처리 (모바일 회전)
      if (window.orientation !== undefined && window.orientation !== lastOrientation) {
        lastOrientation = window.orientation;
        
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          const el = gridWrapRef.current;
          if (!el) return;
          
          const currentQuestions = activeSubject ? (highErrorQuestions[activeSubject] || []) : [];
          const questionCount = currentQuestions.length;
          
          if (questionCount > 0) {
            const rect = el.getBoundingClientRect();
            const { width, height } = rect;
            
            if (width > 0 && height > 0) {
              const optimalGrid = calculateOptimalGrid(questionCount, width, height);
              setGridStyle(optimalGrid);
            }
          }
        }, 500); // 방향 변경 후 충분한 대기
      }
    };
    
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
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
    console.log("버튼 렌더링:", { activeSubject, questions: questions.length, gridStyle });
    
    // 문제 번호 순으로 정렬 (작은 번호부터 왼쪽에서 오른쪽으로)
    const sortedQuestions = [...questions].sort((a, b) => a.questionNum - b.questionNum);
    
    const { cols, rows, cellW, cellH } = gridStyle;
    
    return (
      <div
        className="btn-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
          gridTemplateRows: `repeat(${rows}, ${cellH}px)`,
          gap: `${window.innerWidth < 600 ? 2 : 3}px`,
          justifyContent: 'center',
          alignContent: 'start',
          width: '100%',
          maxWidth: '100%',
          overflow: 'visible'
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
                fontSize: `${Math.max(8, Math.min(12, cellW / 5))}px`, // 버튼 크기에 따른 폰트 조절
                minWidth: 0,
                minHeight: 0,
                boxSizing: 'border-box'
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

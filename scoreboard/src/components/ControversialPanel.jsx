// src/components/ControversialPanel.jsx (수정된 코드 전체)
import React, { useState, useEffect, useRef, useCallback } from "react";
import PdfModalPdfjs from "./PdfModalPdfjs";
import { getFunctions, httpsCallable } from "firebase/functions";
import "./WrongPanel.css";

const SESSIONS = ["1교시", "2교시", "3교시", "4교시"];

// ✅ 정식 과목 명칭 매핑 추가
const FORMAL_SUBJECT_MAPPING = {
  "간": "간계내과학",
  "심": "심계내과학",
  "비": "비계내과학",
  "폐": "폐계내과학",
  "신": "신계내과학",
  "상한": "상한론",
  "사상": "사상의학",
  "침구": "침구의학",
  "법규": "보건의약관계법규",
  "외과": "외과학",
  "신정": "신경정신과학",
  "안이비": "안이비인후과학",
  "부인": "부인과학",
  "소아": "소아과학",
  "예방": "예방의학",
  "생리": "한방생리학",
  "본초": "본초학",
  "기타": "기타 과목"
};

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

// 단순화된 그리드 계산 함수 - 고정 크기, 세로 확장
function calculateSimpleGrid(questionCount, containerWidth) {
  if (!questionCount || !containerWidth) {
    return { cols: 8, rows: 1, cellW: 50, cellH: 50 };
  }
  
  const isMobile = containerWidth < 600;
  const isTablet = containerWidth >= 600 && containerWidth < 900;
  
  // 고정된 버튼 크기
  const cellSize = isMobile ? 45 : isTablet ? 55 : 60;
  const gap = isMobile ? 2 : 3;
  const padding = isMobile ? 8 : 12;
  
  // 고정된 열 수 (화면 크기별)
  let cols;
  if (isMobile) {
    cols = Math.floor((containerWidth - padding * 2) / (cellSize + gap));
    cols = Math.max(6, Math.min(cols, 8)); // 6-8열로 제한
  } else if (isTablet) {
    cols = Math.floor((containerWidth - padding * 2) / (cellSize + gap));
    cols = Math.max(8, Math.min(cols, 12)); // 8-12열로 제한
  } else {
    cols = Math.floor((containerWidth - padding * 2) / (cellSize + gap));
    cols = Math.max(10, Math.min(cols, 16)); // 10-16열로 제한
  }
  
  const rows = Math.ceil(questionCount / cols);
  
  return {
    cols: cols,
    rows: rows,
    cellW: cellSize,
    cellH: cellSize,
    questionCount: questionCount
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
  // ✅ MODIFIED: Set 대신 { qNum, rate } 객체 배열로 변경
  const [fireBySession, setFireBySession] = useState({
    "1교시": [], "2교시": [], "3교시": [], "4교시": [],
  });
  const [loading, setLoading] = useState(false);

  // ✅ 모달 제목을 구성하는 함수 추가 (정식 명칭 + "특별 해설")
  const getModalTitle = useCallback(() => {
    // activeSubject가 FORMAL_SUBJECT_MAPPING에 있으면 정식 명칭을, 없으면 원래 이름을 사용합니다.
    const formalSubject = FORMAL_SUBJECT_MAPPING[activeSubject] || activeSubject || '';
    // 요청하신 형식: "1차 1교시 간계내과학 특별 해설"
    return `${roundLabel} ${activeSession} ${formalSubject} 특별 해설`;
  }, [roundLabel, activeSession, activeSubject]);


  const getHighErrorRateQuestions = useCallback(async (rLabel) => {
    try {
      const functions = getFunctions(undefined, "asia-northeast3"); // ✅ FIX: 지역 통일
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
      const functions = getFunctions(undefined, "asia-northeast3"); // ✅ FIX: 지역 통일
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
          // ✅ MODIFIED: 배열로 초기화
          setFireBySession({
            "1교시": [], "2교시": [], "3교시": [], "4교시": [],
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
          // ✅ MODIFIED: 배열 객체를 그대로 저장
          setFireBySession({
            "1교시": explanationIndex["1교시"] || [],
            "2교시": explanationIndex["2교시"] || [],
            "3교시": explanationIndex["3교시"] || [],
            "4교시": explanationIndex["4교시"] || [],
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

  // 단순화된 그리드 크기 계산 (한 번만 계산)
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    
    let timeoutId = null;
    
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
        const { width } = rect;
        
        if (width > 0) {
          const simpleGrid = calculateSimpleGrid(questionCount, width);
          console.log(`단순 그리드: ${questionCount}개 문제 → ${simpleGrid.cols}x${simpleGrid.rows} (${simpleGrid.cellW}px)`);
          setGridStyle(simpleGrid);
        }
      }, 200);
    };
    
    // 초기 계산만 실행
    computeGrid();
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, [activeSubject, highErrorQuestions]); // ResizeObserver 제거

  // 윈도우 리사이즈는 방향 전환시에만 처리
  useEffect(() => {
    let timeoutId = null;
    let lastOrientation = window.orientation;
    
    const handleOrientationChange = () => {
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
            const { width } = rect;
            
            if (width > 0) {
              const simpleGrid = calculateSimpleGrid(questionCount, width);
              setGridStyle(simpleGrid);
            }
          }
        }, 500);
      }
    };
    
    window.addEventListener('orientationchange', handleOrientationChange);
    
    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      clearTimeout(timeoutId);
    };
  }, [activeSubject, highErrorQuestions]);

  // ✅ MODIFIED: rate 인자 추가 및 파일 경로에 rate 포함
  const openExplanation = (session, qNum, rate) => {
    const rNum = parseInt(String(roundLabel).replace(/\D/g, ""), 10) || 1;
    const sNum = parseInt(String(session).replace(/\D/g, ""), 10) || 1;
    // 파일명에 정답률 포함
    const path = `explanation/${rNum}-${sNum}-${qNum}-${rate}.pdf`;
    
    console.log("PDF 열기:", path);
    
    // 모달을 먼저 열고 잠시 기다린 후 PDF 경로 설정
    setPdfOpen(true);
    setTimeout(() => {
      setPdfPath(path);
    }, 100); // 100ms 지연
  };

  // ✅ MODIFIED: renderButtons 함수 전체 수정 (색상 차이 최대화 로직 적용)
  const renderButtons = () => {
    if (!activeSubject || !highErrorQuestions[activeSubject]) {
      console.log("버튼 렌더링 불가:", { activeSubject, hasData: !!highErrorQuestions[activeSubject] });
      return null;
    }
    
    const questions = highErrorQuestions[activeSubject];
    const expQuestions = fireBySession[activeSession] || []; // { qNum, rate } 배열
    
    // 현재 과목의 모든 문항을 렌더링하도록 수정 (필터링 제거)
    const sortedQuestions = questions
        .map(q => {
            // 정답률 객체 찾기
            const exp = expQuestions.find(exp => exp.qNum === q.questionNum);
            // rate는 number이거나 null
            return exp 
                ? { ...q, rate: exp.rate, hasExp: true } 
                : { ...q, rate: null, hasExp: false };
        })
        .sort((a, b) => a.questionNum - b.questionNum); // 순서대로 정렬 유지
    
    console.log("버튼 렌더링:", { activeSubject, questions: sortedQuestions.length, gridStyle });
    
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
        {sortedQuestions.map((q) => { // Loop over ALL questions
          const qNum = q.questionNum;
          const session = q.session;
          const hasExp = q.hasExp;
          const rate = q.rate; // This is a number or null

          // ✅ FIX: rate를 숫자로 변환하여 계산 오류 방지
          const numericRate = (typeof rate === 'number' && !isNaN(rate)) ? rate : Number(rate);

          let color, shadowColor, bgColor, cursor, clickHandler, rateText, styleMods = {};
          let cls = `qbtn`;
          
          if (hasExp) {
              // Dynamic Red Styling (Difficulty)
              const clampedRate = Math.min(100, Math.max(0, numericRate)); 
              const clampedDifficulty = 100 - clampedRate; // 0 (쉬움) to 100 (어려움)

              const hue = 0; // Red Hue (Fixed)
              
              // **난이도 변화에 따른 극단적 대비를 위한 HSL 계산**
              
              // FIX 1: 채도 (Saturation): 30% (쉬움) ~ 100% (어려움)
              const saturation = Math.min(100, Math.max(30, Math.round(30 + clampedDifficulty * 0.7))); 

              // FIX 2: 배경 밝기 (Background Lightness): 15% (쉬움) -> 1% (어려움)
              // 난이도가 높을수록 배경이 어두워져 발광 대비가 극대화됩니다.
              const bgLightness = Math.min(15, Math.Max(1, Math.round(15 - clampedDifficulty * 0.14)));
              
              // FIX 3: 강조 밝기 (Accent Lightness): 30% (쉬움) -> 95% (어려움)
              // 난이도가 높을수록 발광이 밝아져 시각적 자극이 극대화됩니다.
              const accentLightness = Math.min(95, Math.Max(30, Math.round(30 + clampedDifficulty * 0.65)));
              
              // Text Lightness: 80% 고정 (가독성 확보)
              const textLightness = 80; 
              
              color = `hsl(${hue}, ${saturation}%, ${textLightness}%)`; // 텍스트 색상
              shadowColor = `hsl(${hue}, ${saturation}%, ${accentLightness}%)`; // 테두리/그림자 색상
              bgColor = `hsl(${hue}, ${saturation}%, ${bgLightness}%)`; // 배경 색상
              
              cursor = "pointer";
              // openExplanation 함수에 rate를 그대로 전달 (toFixed는 표시용)
              clickHandler = (e) => { e.stopPropagation(); openExplanation(session, qNum, rate); };
              rateText = `${numericRate.toFixed(1)}%`; // 소수점 한 자리 표시
              
              // Apply dynamic styles
              styleMods = {
                color: color,
                borderColor: shadowColor,
                background: bgColor,
                // 그림자 강도를 난이도에 비례하게 설정 (어려울수록 더 밝게 빛남)
                boxShadow: `0 0 ${8 + clampedDifficulty * 0.25}px ${shadowColor}, 0 0 ${16 + clampedDifficulty * 0.5}px ${shadowColor}40`,
                cursor: cursor,
              };
              cls += ` qbtn-rate`; 

          } else {
              // Default "No Explanation" Style
              color = 'var(--muted)';
              shadowColor = 'var(--line)'; // Default border
              bgColor = 'rgba(255,255,255,0.02)'; // Lighter background for no exp
              cursor = "default";
              clickHandler = undefined;
              rateText = null; 
              
              // Apply static styles
              styleMods = {
                color: color,
                borderColor: shadowColor,
                background: bgColor,
                opacity: 0.7, 
                cursor: cursor,
                boxShadow: 'none',
              };
              cls += ` no-explanation`; 
          }
          
          const label = hasExp 
              ? `문항 ${qNum} · 정답률 ${rateText} · 특별 해설`
              : `문항 ${qNum}`; // 툴팁에서 해설 없음 문구 제거

          return (
            <button
              key={qNum}
              type="button"
              className={cls}
              title={label}
              aria-label={label}
              onClick={clickHandler}
              disabled={!hasExp} // 해설 없는 문항은 비활성화
              // ✅ Apply combined styles and hover property
              style={{
                width: `${cellW}px`,
                height: `${cellH}px`,
                fontSize: `${Math.max(8, Math.min(12, cellW / 5))}px`,
                position: 'relative', 
                fontWeight: 700,
                transition: 'all 0.2s ease',
                minWidth: 0,
                minHeight: 0,
                boxSizing: 'border-box',
                ...styleMods // Apply calculated styles
              }}
              // CSS-in-JS로 hover 효과 적용
              onMouseEnter={(e) => {
                  if (hasExp) {
                      e.currentTarget.style.transform = 'translateY(-1px) scale(1.02)';
                      // Hover 시 그림자 강도를 동적으로 더 강하게
                      const clampedDifficulty = 100 - Math.min(100, Math.max(0, numericRate)); 
                      e.currentTarget.style.boxShadow = `0 0 ${12 + clampedDifficulty * 0.1}px ${shadowColor}, 0 0 ${24 + clampedDifficulty * 0.2}px ${shadowColor}60`;
                  }
              }}
              onMouseLeave={(e) => {
                  if (hasExp) {
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.boxShadow = styleMods.boxShadow;
                  }
              }}
            >
              {qNum}
              {/* ✅ 정답률 텍스트 표시 (해설 있는 경우) */}
              {hasExp && (
                  <span style={{ 
                    position: 'absolute', 
                    bottom: '2px', 
                    fontSize: '10px', 
                    fontWeight: 600,
                    color: color,
                    opacity: 0.9,
                    lineHeight: 1 
                  }}>
                    {rateText}
                  </span>
              )}
              
              {/* 해설 없는 문항은 하단 텍스트를 표시하지 않음 */}
              
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
      <h2 style={{ marginTop: 0 }}>2025 전국모의고사</h2>

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
        // 👇 수정된 모달 제목 사용
        title={getModalTitle()}
      />
    </div>
  );
}

import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);
  const renderedRef = useRef(false);

  // 터치/줌 상태 관리
  const [isZoomed, setIsZoomed] = useState(false);
  const touchState = useRef({
    scale: 1,
    translateX: 0,
    translateY: 0,
    initialDistance: 0,
    lastTouchX: 0,
    lastTouchY: 0,
    isScaling: false,
    isDragging: false
  });
  
  // 마우스 상태 관리 (웹 드래그용)
  const mouseState = useRef({
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0
  });

  const getContainerSize = () => {
    const el = holderRef.current;
    if (!el) return { width: 600, height: 400 };
    const rect = el.getBoundingClientRect();
    // 모달 패딩(15px)을 고려하여 컨테이너 너비를 계산
    return { 
      width: Math.max(320, Math.floor(rect.width - 30)), // 15px * 2 (패딩)
      height: Math.max(300, Math.floor(rect.height - 30))
    };
  };

  // 터치 헬퍼 함수들
  const getTouchDistance = (touch1, touch2) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 캔버스 transform 직접 적용 (CSS 우선순위 무시)
  const applyCanvasTransform = useCallback((scale, translateX, translateY) => {
    if (!canvasRef.current) return;
    
    const transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    const canvas = canvasRef.current;
    
    // CSS 규칙을 완전히 무시하고 직접 적용
    canvas.style.setProperty('transform', transform, 'important');
    // [MODIFICATION 1]: transform-origin을 '0% 0%'로 변경하여 계산된 translateX/Y를 기반으로 줌이 적용되도록 수정
    canvas.style.setProperty('transform-origin', '0% 0%', 'important'); 
    // 드래그 중이 아닐 때만 transition 적용
    const isInteracting = touchState.current.isScaling || touchState.current.isDragging || mouseState.current.isDragging;
    canvas.style.setProperty('transition', isInteracting ? 'none' : 'transform 0.3s ease', 'important');
    
    setIsZoomed(scale > 1.1);
  }, []);

  const handleTouchStart = useCallback((e) => {
    e.preventDefault();
    const touches = e.touches;
    const state = touchState.current;
    
    if (touches.length === 2) {
      // 핀치 시작
      state.isScaling = true;
      state.isDragging = false;
      state.initialDistance = getTouchDistance(touches[0], touches[1]);
    } else if (touches.length === 1 && state.scale > 1) {
      // 드래그 시작
      state.isDragging = true;
      state.isScaling = false;
      state.lastTouchX = touches[0].clientX;
      state.lastTouchY = touches[0].clientY;
      if(canvasRef.current) canvasRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const touches = e.touches;
    const state = touchState.current;
    
    if (touches.length === 2 && state.isScaling) {
      // 핀치 줌
      const currentDistance = getTouchDistance(touches[0], touches[1]);
      const scaleChange = currentDistance / state.initialDistance;
      const prevScale = state.scale; // 이전 스케일 저장
      let newScale = prevScale * scaleChange;
      
      // ✅ [MODIFICATION 2]: 최소 비율을 1로 제한하고 최대 비율은 100으로 유지 (사실상 무제한)
      newScale = Math.max(1, newScale); 
      newScale = Math.min(100, newScale); 
      
      if (Math.abs(newScale - prevScale) > 0.01) {
        
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // 줌 중심 (캔버스 좌표계, 현재 변환/스케일 적용 후) 계산
        const centerClientX = (touches[0].clientX + touches[1].clientX) / 2;
        const centerClientY = (touches[0].clientY + touches[1].clientY) / 2;

        // 핀치 중심이 캔버스 내부의 언스케일드 좌표 (0,0 기준)에서 얼마나 떨어져 있는지 계산
        // (Client Position - Canvas Top-Left) - Current Translation / Current Scale
        const pointX = (centerClientX - rect.left - state.translateX) / prevScale;
        const pointY = (centerClientY - rect.top - state.translateY) / prevScale;
        
        // [MODIFICATION 3]: 변환 값 업데이트 (줌 중심 고정)
        // 새 위치 = 이전 위치 - (새 스케일 - 이전 스케일) * 중심점
        state.translateX -= (newScale - prevScale) * pointX;
        state.translateY -= (newScale - prevScale) * pointY;

        // ✅ [MODIFICATION 4]: 1배로 축소될 경우, 위치를 (0,0)으로 재설정하여 중앙 정렬 유지
        if (newScale === 1) {
            state.translateX = 0;
            state.translateY = 0;
        } 
        
        state.scale = newScale;
        applyCanvasTransform(state.scale, state.translateX, state.translateY);
        state.initialDistance = currentDistance;
      }
      
    } else if (touches.length === 1 && state.isDragging && state.scale > 1) {
      // 드래그 이동
      const deltaX = touches[0].clientX - state.lastTouchX;
      const deltaY = touches[0].clientY - state.lastTouchY;
      
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        state.translateX += deltaX;
        state.translateY += deltaY;
        state.lastTouchX = touches[0].clientX;
        state.lastTouchY = touches[0].clientY;
        
        applyCanvasTransform(state.scale, state.translateX, state.translateY);
      }
    }
  }, [applyCanvasTransform]);

  const handleTouchEnd = useCallback(() => {
    const state = touchState.current;
    state.isScaling = false;
    state.isDragging = false;
    state.initialDistance = 0;
    if(canvasRef.current) canvasRef.current.style.transition = 'transform 0.3s ease';
  }, []);
  
  // 웹/노트북 마우스 드래그 핸들러
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0 || touchState.current.scale <= 1.1) return; 

    e.preventDefault();
    const state = mouseState.current;
    state.isDragging = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    
    if(canvasRef.current) canvasRef.current.style.transition = 'none';
  }, []);

  const handleMouseMove = useCallback((e) => {
    const mState = mouseState.current;
    const tState = touchState.current;
    
    if (!mState.isDragging) return;
    
    const deltaX = e.clientX - mState.lastMouseX;
    const deltaY = e.clientY - mState.lastMouseY;
    
    tState.translateX += deltaX;
    tState.translateY += deltaY;
    mState.lastMouseX = e.clientX;
    mState.lastMouseY = e.clientY;
    
    applyCanvasTransform(tState.scale, tState.translateX, tState.translateY);
  }, [applyCanvasTransform]);

  const handleMouseUp = useCallback(() => {
    const mState = mouseState.current;
    if (!mState.isDragging) return;
    
    mState.isDragging = false;
    
    if(canvasRef.current) canvasRef.current.style.transition = 'transform 0.3s ease';
  }, []);


  const handleDoubleClick = useCallback(() => {
    const state = touchState.current;
    
    if (state.scale > 1.1) {
      // 줌 아웃 (리셋)
      state.scale = 1;
      state.translateX = 0;
      state.translateY = 0;
    } else {
      // 2배 확대
      state.scale = 2;
      state.translateX = 0;
      state.translateY = 0;
    }
    
    applyCanvasTransform(state.scale, state.translateX, state.translateY);
  }, [applyCanvasTransform]);

  const resetZoom = useCallback(() => {
    const state = touchState.current;
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;
    applyCanvasTransform(1, 0, 0);
  }, [applyCanvasTransform]);
  
  // ✅ [FIX]: Ctrl + Wheel을 PDF 모달 내부 줌 기능으로 재정의 (노트북 핀치 줌 활성화)
  const handleWheel = useCallback((e) => {
    const isZoomGesture = e.ctrlKey || e.metaKey; // Ctrl 또는 Meta 키가 눌렸는지 확인 (윈도우/맥)
    
    if (isZoomGesture) {
        e.preventDefault(); // 브라우저의 전역 확대/축소 기본 동작 차단
        e.stopPropagation();
        
        const state = touchState.current;
        const zoomSpeed = 0.05; // 줌 속도 설정
        
        const prevScale = state.scale;
        let newScale = prevScale;
        
        // 휠 방향에 따라 확대/축소
        if (e.deltaY < 0) {
            newScale += zoomSpeed; // 확대
        } else if (e.deltaY > 0) {
            newScale -= zoomSpeed; // 축소
        }
        
        // ✅ [MODIFICATION 5]: 최소 비율을 1로 제한
        newScale = Math.max(1, newScale); 
        // 최대 확대 제한은 100배로 유지 (사실상 무제한)
        newScale = Math.min(100, newScale); 
        
        if (newScale !== prevScale) {
            const canvas = canvasRef.current;
            const rect = canvas.getBoundingClientRect();
            
            // 줌 중심 (캔버스 좌표계, 현재 변환/스케일 적용 후) 계산
            // 마우스 커서 위치를 캔버스 내부의 언스케일드 좌표 (0,0 기준)에서 얼마나 떨어져 있는지 계산
            const pointX = (e.clientX - rect.left - state.translateX) / prevScale;
            const pointY = (e.clientY - rect.top - state.translateY) / prevScale;
            
            // [MODIFICATION 6]: 변환 값 업데이트 (줌 중심 고정)
            // 새 위치 = 이전 위치 - (새 스케일 - 이전 스케일) * 중심점
            state.translateX -= (newScale - prevScale) * pointX;
            state.translateY -= (newScale - prevScale) * pointY;
            
            // ✅ [MODIFICATION 7]: 1배로 축소될 경우, 위치를 (0,0)으로 재설정하여 중앙 정렬 유지
            if (newScale === 1) {
                state.translateX = 0;
                state.translateY = 0;
            }
            
            state.scale = newScale;
            applyCanvasTransform(state.scale, state.translateX, state.translateY);
        }
    }
  }, [applyCanvasTransform]);

  // 고화질 렌더링 (화질 문제 해결)
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
    
    try {
      renderedRef.current = true;
      
      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: containerWidth } = getContainerSize();
      const baseViewport = page.getViewport({ scale: 1 });
      
      // ✅ [FIX]: 화면 맞춤 스케일 계산 - 폭 기준으로만 계산 (세로 스크롤 허용)
      const baseFitScale = containerWidth / baseViewport.width;
      
      // 고해상도 렌더링을 위한 스케일
      const isMobile = window.innerWidth <= 768;
      const qualityMultiplier = isMobile ? 3.0 : 4.0;
      const renderScale = baseFitScale * qualityMultiplier;
      
      // 렌더링 뷰포트
      const renderViewport = page.getViewport({ scale: renderScale });
      
      // 캔버스 크기 설정 (고해상도)
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      
      // 표시 크기 설정 (화면에 맞춤 - 폭은 100%, 높이는 실제 높이)
      const displayWidth = Math.floor(baseViewport.width * baseFitScale);
      const displayHeight = Math.floor(baseViewport.height * baseFitScale);
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      
      // 컨텍스트 초기화
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // 고해상도로 렌더링
      await page.render({ 
        canvasContext: ctx, 
        viewport: renderViewport,
        intent: 'display',
        renderInteractiveForms: false
      }).promise;

      // 줌 상태 초기화 (페이지 변경 시)
      resetZoom();
      
    } catch (error) {
      console.error("PDF 렌더링 오류:", error);
    } finally {
      setTimeout(() => {
        renderedRef.current = false;
      }, 100);
    }
  }, [resetZoom]);

  const renderFirstPage = useCallback(async (doc) => {
    if (!doc) return;
    await renderPage(doc, 1);
  }, [renderPage]);

  // PDF 로딩
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open || !filePath || !sid) {
        renderedRef.current = false;
        return;
      }
      
      setLoading(true);
      setErr(null);
      renderedRef.current = false;

      try {
        const key = `${filePath}::${sid}`;
        
        if (pdfDoc && lastKeyRef.current === key) {
          setLoading(false);
          // DOM에 PDF Modal이 완전히 렌더링되도록 잠시 대기 후 고화질 렌더링
          setTimeout(async () => {
            if (!cancelled) {
              await renderFirstPage(pdfDoc);
            }
          }, 50);
          return;
        }

        const functions = getFunctions(undefined, "asia-northeast3"); // FIX: 지역 통일
        const serve = httpsCallable(functions, "serveWatermarkedPdf");
        const res = await serve({ filePath, sid });
        const base64 = res?.data;
        if (!base64) throw new Error("빈 응답");

        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const task = getDocument({ 
          data: bytes,
          useSystemFonts: true,
          disableFontFace: false
        });
        const doc = await task.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
        lastKeyRef.current = key;

        // DOM에 PDF Modal이 완전히 렌더링되도록 잠시 대기 후 고화질 렌더링
        setTimeout(async () => {
          if (!cancelled) {
            await renderFirstPage(doc);
          }
        }, 50); // 50ms 지연
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderedRef.current = false;
    };
  }, [open, filePath, sid, renderFirstPage, pdfDoc]);

  // 키보드 이벤트 (Esc 키 닫기 기능만 유지)
  useEffect(() => {
    if (!open) return;
    
    const handler = (e) => {
      if (e.key === "Escape" && !loading) {
        onClose();
      }
      
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    // 마우스 이벤트를 전역에서 감지하여 드래그를 처리합니다.
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    
    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
  }, [open, onClose, loading, handleMouseMove, handleMouseUp]);
  
  if (!open) return null;

  return (
    <div style={backdropStyle} onClick={loading ? undefined : onClose}>
      <div
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={headerStyle}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">
            ✕
          </button>
        </div>

        <div ref={holderRef} style={viewerStyleScrollable}> {/* ✅ [FIX]: 스크롤 가능 스타일 적용 */}
          {loading && (
            <div style={centerStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                
                <div style={{ 
                  width: '50px', 
                  height: '50px', 
                  border: '4px solid #333', 
                  borderTop: '4px solid var(--primary)', 
                  borderRadius: '50%', 
                  animation: 'spin 1s linear infinite' 
                }}></div>
                <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--ink)' }}>
                  불러오는 중
                </div>
              </div>
            </div>
          )}
          {err && <div style={{ ...centerStyle, color: "var(--bad)" }}>{String(err)}</div>}
          {!loading && !err && (
            <canvas
              ref={canvasRef}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown} // <-- 마우스 드래그 시작
              onWheel={handleWheel} // ✅ 휠 이벤트 핸들러 추가
              onMouseLeave={handleMouseUp}  // <-- 마우스가 영역을 벗어나면 드래그 해제
              onDoubleClick={handleDoubleClick}
              style={{
                display: "block",
                margin: "0 auto",
                userSelect: "none",
                maxWidth: "100%", // 폭을 100%로 설정하여 캔버스가 컨테이너 폭을 채움
                maxHeight: "none", // 높이 제한을 해제하여 세로 스크롤 가능
                objectFit: "contain",
                imageRendering: "high-quality",
                touchAction: "none",
                cursor: isZoomed ? 'grab' : 'pointer',
                // transformOrigin: 'top center', // (제거됨)
              }}
            />
          )}
        </div>

        {numPages > 1 && !loading && (
          <div style={footerStyle}>
            <button
              style={{...navBtnStyle, opacity: renderedRef.current || pageNum <= 1 ? 0.5 : 1}}
              disabled={renderedRef.current || pageNum <= 1}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum <= 1) return;
                const prev = pageNum - 1;
                setPageNum(prev);
                await renderPage(pdfDoc, prev);
              }}
            >
              ← 이전
            </button>
            <span style={{ fontWeight: 700 }}>Page {pageNum} / {numPages}</span>
            <button
              style={{...navBtnStyle, opacity: renderedRef.current || pageNum >= numPages ? 0.5 : 1}}
              disabled={renderedRef.current || pageNum >= numPages}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum >= numPages) return;
                const next = pageNum + 1;
                setPageNum(next);
                await renderPage(pdfDoc, next);
              }}
            >
              다음 →
            </button>
          </div>
        )}

        {/* 확대 상태 표시 */}
        {isZoomed && (
          <div style={{
            position: 'absolute',
            top: '60px',
            right: '12px',
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '16px',
            fontSize: '12px',
            fontWeight: '600',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span>확대 중</span>
            <button
              onClick={resetZoom}
              style={{
                background: 'rgba(255,255,255,0.3)',
                border: 'none',
                color: 'white',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '10px'
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @media print { 
          .pdf-modal-root { display: none !important; } 
        }
      `}</style>
    </div>
  );
}

const backdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.65)",
  display: "flex",
  alignItems: "center", // 중앙 정렬 유지
  justifyContent: "center",
  zIndex: 9999,
};

const modalStyle = {
  width: "min(95vw, 900px)",
  height: "min(80vh, 800px)", // 80% 높이 제한 유지
  background: "#1c1f24",
  color: "#e5e7eb",
  border: "1px solid #2d333b",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 15px 50px rgba(0,0,0,.5)",
  position: 'relative'
};

const headerStyle = {
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 12px",
  borderBottom: "1px solid #2d333b",
  background: "linear-gradient(#1c1f24, #1a1d22)",
  flexShrink: 0
};

const closeBtnStyle = {
  border: "1px solid #2d333b",
  borderRadius: 6,
  background: "transparent",
  padding: "4px 10px",
  cursor: "pointer",
  color: "#e5e7eb",
  fontSize: 16,
  lineHeight: 1,
};

// 🚨 [FIX]: 스크롤 가능하도록 overflow-y: auto, align-items: flex-start으로 변경
const viewerStyleScrollable = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflowY: "auto", /* 세로 스크롤 허용 */
  overflowX: "hidden", /* 가로 스크롤 방지 */
  padding: "15px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center", /* 캔버스가 중앙에 오도록 함 */
  justifyContent: "flex-start",
  touchAction: "none"
};

const viewerStyle = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "hidden",
  padding: "15px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  touchAction: "none"
};

const centerStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
};

const footerStyle = {
  borderTop: "1px solid #2d333b",
  padding: "8px 12px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#15181c",
  fontSize: 14,
  flexShrink: 0
};

const navBtnStyle = {
  border: "1px solid #2d333b",
  background: "transparent",
  color: "#e5e7eb",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 600,
};

// src/components/PdfModalPdfjs.jsx
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
    return { 
      width: Math.max(320, Math.floor(rect.width - 20)), 
      height: Math.max(300, Math.floor(rect.height - 20))
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
    canvas.style.setProperty('transform-origin', 'center center', 'important');
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
      let newScale = state.scale * scaleChange;
      newScale = Math.max(1, Math.min(4, newScale));
      
      if (Math.abs(newScale - state.scale) > 0.01) {
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
      // 줌 아웃
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

  // ✅ [NEW] 휠 이벤트 핸들러: 터치패드 핀치 줌(전역 줌) 방지
  const handleWheel = useCallback((e) => {
    // Ctrl 또는 Meta 키와 함께 휠 이벤트가 발생하면 (주로 브라우저 줌) 기본 동작을 막습니다.
    // 이는 macOS 등에서 터치패드 핀치 줌을 브라우저가 전역 줌으로 해석하는 것을 방지합니다.
    if (e.ctrlKey || e.metaKey || e.deltaY % 1 !== 0) {
        e.preventDefault();
        e.stopPropagation();
    }
    // (선택 사항: e.deltaY와 e.deltaX를 사용하여 여기서 모달 줌 로직을 구현할 수 있음)
  }, []);

  // 고화질 렌더링 (화질 문제 해결)
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
    
    try {
      renderedRef.current = true;
      
      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: containerWidth, height: containerHeight } = getContainerSize();
      const baseViewport = page.getViewport({ scale: 1 });
      
      // 화면 맞춤 스케일 계산
      const scaleX = containerWidth / baseViewport.width;
      const scaleY = containerHeight / baseViewport.height;
      const baseFitScale = Math.min(scaleX, scaleY);
      
      // 고해상도 렌더링을 위한 스케일
      const isMobile = window.innerWidth <= 768;
      const qualityMultiplier = isMobile ? 3.0 : 4.0;
      const renderScale = baseFitScale * qualityMultiplier;
      
      // 렌더링 뷰포트
      const renderViewport = page.getViewport({ scale: renderScale });
      
      // 캔버스 크기 설정 (고해상도)
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      
      // 표시 크기 설정 (화면에 맞춤)
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
  useEffect(() => { /* ... (PDF 로딩 로직은 동일) ... */ }, [open, filePath, sid, renderFirstPage, pdfDoc]);

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
  
  // 뒤로가기 히스토리 조작 로직은 완전히 제거됩니다.
  // 이로 인해 모달이 늦게 꺼지는 문제가 해결됩니다.

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

        <div ref={holderRef} style={viewerStyle}>
          {loading && (
            <div style={centerStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ 
                  width: '50px', 
                  height: '50px', 
                  border: '4px solid #333', 
                  borderTop: '4px solid #7ea2ff', 
                  borderRadius: '50%', 
                  animation: 'spin 1s linear infinite' 
                }}></div>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#7ea2ff' }}>
                  고화질 PDF를 준비하는 중...
                </div>
                <div style={{ fontSize: '14px', textAlign: 'center', lineHeight: '1.4' }}>
                  처음 접속 시 1-2분 정도 소요될 수 있습니다.<br/>
                  잠시만 기다려주세요.
                </div>
              </div>
            </div>
          )}
          {err && <div style={{ ...centerStyle, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && (
            <canvas
              ref={canvasRef}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown} // <-- 마우스 드래그 시작
              onMouseMove={handleMouseMove} // <-- 마우스 이동 (드래그)
              onMouseUp={handleMouseUp}     // <-- 마우스 버튼 해제
              onMouseLeave={handleMouseUp}  // <-- 마우스가 영역을 벗어나면 드래그 해제
              onDoubleClick={handleDoubleClick}
              onWheel={handleWheel} // 🚨 [NEW] 휠 이벤트 핸들러 추가
              style={{
                display: "block",
                margin: "0 auto",
                userSelect: "none",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                imageRendering: "high-quality",
                touchAction: "none",
                cursor: isZoomed ? 'grab' : 'pointer'
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

// ... (const backdropStyle, modalStyle, headerStyle, etc. remain the same)
// ... (omitting the style block for brevity)
// ...

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

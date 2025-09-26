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

  // 모바일 확대/축소 상태 관리
  const [isZoomed, setIsZoomed] = useState(false);
  const [canvasStyle, setCanvasStyle] = useState({});
  const touchStateRef = useRef({
    initialDistance: 0,
    lastScale: 1,
    currentScale: 1,
    isScaling: false,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    lastTouchX: 0,
    lastTouchY: 0
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

  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
    
    try {
      renderedRef.current = true;
      
      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: containerWidth, height: containerHeight } = getContainerSize();
      const baseViewport = page.getViewport({ scale: 1 });
      
      // 모바일에서는 더 높은 해상도로 렌더링 (확대 대비)
      const scaleX = containerWidth / baseViewport.width;
      const scaleY = containerHeight / baseViewport.height;
      const baseFitScale = Math.min(scaleX, scaleY);
      
      const isMobile = window.innerWidth <= 768;
      const pixelRatio = window.devicePixelRatio || 1;
      
      // 모바일에서는 더 높은 품질로 렌더링 (확대 시 선명도 유지)
      const qualityMultiplier = isMobile ? 4.0 : 3.0;
      let targetScale = baseFitScale * qualityMultiplier;
      targetScale = Math.min(targetScale, 6.0); // 최대 6배까지
      
      // 초기 표시 크기는 컨테이너에 맞게
      const displayScale = baseFitScale;
      const displayViewport = page.getViewport({ scale: displayScale });
      
      // 고해상도로 렌더링하되 표시는 원래 크기로
      const renderViewport = page.getViewport({ scale: targetScale });
      
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      
      // 표시 크기 설정 (확대 가능하도록)
      const initialWidth = Math.floor(displayViewport.width);
      const initialHeight = Math.floor(displayViewport.height);
      
      setCanvasStyle({
        width: `${initialWidth}px`,
        height: `${initialHeight}px`,
        maxWidth: 'none', // 확대를 위해 maxWidth 제거
        maxHeight: 'none',
        transform: 'translate(0, 0) scale(1)',
        transformOrigin: 'center center',
        transition: 'none' // 터치 줌 시 부드러운 전환
      });
      
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      await page.render({ 
        canvasContext: ctx, 
        viewport: renderViewport,
        intent: 'display',
        renderInteractiveForms: false,
        optionalContentConfigPromise: null
      }).promise;
      
      // 터치 상태 초기화
      touchStateRef.current = {
        initialDistance: 0,
        lastScale: 1,
        currentScale: 1,
        isScaling: false,
        translateX: 0,
        translateY: 0,
        isDragging: false,
        lastTouchX: 0,
        lastTouchY: 0
      };
      setIsZoomed(false);
      
    } catch (error) {
      console.error("PDF 렌더링 오류:", error);
    } finally {
      setTimeout(() => {
        renderedRef.current = false;
      }, 300);
    }
  }, []);

  const renderFirstPage = useCallback(async (doc) => {
    if (!doc) return;
    await new Promise(resolve => setTimeout(resolve, 150));
    await renderPage(doc, 1);
  }, [renderPage]);

  // 터치 이벤트 헬퍼 함수들
  const getDistance = (touch1, touch2) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getCenter = (touch1, touch2) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2
    };
  };

  // 터치 이벤트 핸들러들
  const handleTouchStart = (e) => {
    if (!canvasRef.current) return;
    
    const touches = e.touches;
    const state = touchStateRef.current;
    
    if (touches.length === 2) {
      // 핀치 시작
      state.isScaling = true;
      state.isDragging = false;
      state.initialDistance = getDistance(touches[0], touches[1]);
      
      const center = getCenter(touches[0], touches[1]);
      const rect = canvasRef.current.getBoundingClientRect();
      state.centerX = center.x - rect.left;
      state.centerY = center.y - rect.top;
      
    } else if (touches.length === 1 && state.currentScale > 1) {
      // 확대된 상태에서 드래그 시작
      state.isDragging = true;
      state.isScaling = false;
      state.lastTouchX = touches[0].clientX;
      state.lastTouchY = touches[0].clientY;
    }
  };

  const handleTouchMove = (e) => {
    e.preventDefault(); // 페이지 스크롤 방지
    if (!canvasRef.current) return;
    
    const touches = e.touches;
    const state = touchStateRef.current;
    
    if (touches.length === 2 && state.isScaling) {
      // 핀치 줌
      const currentDistance = getDistance(touches[0], touches[1]);
      const scaleChange = currentDistance / state.initialDistance;
      let newScale = state.lastScale * scaleChange;
      
      // 줌 범위 제한
      newScale = Math.max(0.5, Math.min(5, newScale));
      state.currentScale = newScale;
      
      const transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${newScale})`;
      
      setCanvasStyle(prev => ({
        ...prev,
        transform,
        transition: 'none'
      }));
      
      setIsZoomed(newScale > 1.1);
      
    } else if (touches.length === 1 && state.isDragging && state.currentScale > 1) {
      // 확대된 상태에서 드래그
      const deltaX = touches[0].clientX - state.lastTouchX;
      const deltaY = touches[0].clientY - state.lastTouchY;
      
      state.translateX += deltaX;
      state.translateY += deltaY;
      state.lastTouchX = touches[0].clientX;
      state.lastTouchY = touches[0].clientY;
      
      const transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.currentScale})`;
      
      setCanvasStyle(prev => ({
        ...prev,
        transform,
        transition: 'none'
      }));
    }
  };

  const handleTouchEnd = (e) => {
    const state = touchStateRef.current;
    
    if (state.isScaling) {
      state.lastScale = state.currentScale;
      state.isScaling = false;
      
      // 너무 작게 축소된 경우 원래 크기로 복원
      if (state.currentScale < 0.8) {
        state.currentScale = 1;
        state.lastScale = 1;
        state.translateX = 0;
        state.translateY = 0;
        
        setCanvasStyle(prev => ({
          ...prev,
          transform: 'translate(0, 0) scale(1)',
          transition: 'transform 0.3s ease'
        }));
        
        setIsZoomed(false);
      }
    }
    
    if (state.isDragging) {
      state.isDragging = false;
      
      // 경계 제한 적용
      if (canvasRef.current && holderRef.current) {
        const canvas = canvasRef.current;
        const container = holderRef.current;
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        let newTranslateX = state.translateX;
        let newTranslateY = state.translateY;
        
        // 확대된 캔버스가 컨테이너를 벗어나지 않도록 제한
        const scaledWidth = canvas.offsetWidth * state.currentScale;
        const scaledHeight = canvas.offsetHeight * state.currentScale;
        
        const maxTranslateX = Math.max(0, (scaledWidth - containerRect.width) / 2);
        const maxTranslateY = Math.max(0, (scaledHeight - containerRect.height) / 2);
        
        newTranslateX = Math.max(-maxTranslateX, Math.min(maxTranslateX, newTranslateX));
        newTranslateY = Math.max(-maxTranslateY, Math.min(maxTranslateY, newTranslateY));
        
        if (newTranslateX !== state.translateX || newTranslateY !== state.translateY) {
          state.translateX = newTranslateX;
          state.translateY = newTranslateY;
          
          const transform = `translate(${newTranslateX}px, ${newTranslateY}px) scale(${state.currentScale})`;
          
          setCanvasStyle(prev => ({
            ...prev,
            transform,
            transition: 'transform 0.3s ease'
          }));
        }
      }
    }
  };

  // 더블탭으로 줌 토글
  const handleDoubleClick = (e) => {
    if (!canvasRef.current) return;
    
    const state = touchStateRef.current;
    
    if (state.currentScale > 1.1) {
      // 줌 아웃
      state.currentScale = 1;
      state.lastScale = 1;
      state.translateX = 0;
      state.translateY = 0;
      
      setCanvasStyle(prev => ({
        ...prev,
        transform: 'translate(0, 0) scale(1)',
        transition: 'transform 0.4s ease'
      }));
      
      setIsZoomed(false);
    } else {
      // 줌 인 (2배)
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      
      // 클릭 지점을 중심으로 줌인
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      state.currentScale = 2;
      state.lastScale = 2;
      state.translateX = (centerX - clickX) * 1;
      state.translateY = (centerY - clickY) * 1;
      
      const transform = `translate(${state.translateX}px, ${state.translateY}px) scale(2)`;
      
      setCanvasStyle(prev => ({
        ...prev,
        transform,
        transition: 'transform 0.4s ease'
      }));
      
      setIsZoomed(true);
    }
  };

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
          await renderFirstPage(pdfDoc);
          return;
        }

        const functions = getFunctions(undefined, "us-central1");
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
          disableFontFace: false,
          cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
          cMapPacked: true
        });
        const doc = await task.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
        lastKeyRef.current = key;

        await renderFirstPage(doc);
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

  // 키보드 단축키 (ESC로 모달 닫기, 인쇄 차단)
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
    
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [open, onClose, loading]);

  // 개선된 뒤로가기 처리
  useEffect(() => {
    if (!open) return;

    let isHistorySetup = false;
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // 히스토리 설정
    const setupHistory = () => {
      const modalState = { 
        modal: 'pdf-open', 
        timestamp: Date.now(),
        filePath,
        sid 
      };
      
      try {
        // 현재 상태가 PDF 모달이 아닌 경우에만 새로운 히스토리 추가
        if (window.history.state?.modal !== 'pdf-open') {
          window.history.pushState(modalState, '', window.location.href);
          isHistorySetup = true;
        }
      } catch (error) {
        console.warn('History API 설정 실패:', error);
      }
    };
    
    // 모바일에서는 약간 지연 후 설정
    const setupTimer = setTimeout(setupHistory, isMobile ? 200 : 100);
    
    const handlePopstate = (e) => {
      // 로딩 중이거나 히스토리가 설정되지 않은 경우 무시
      if (loading || !isHistorySetup) return;
      
      // PDF 모달 상태가 아닌 경우 모달 닫기
      if (!e.state || e.state.modal !== 'pdf-open') {
        console.log('뒤로가기로 PDF 모달 닫기');
        onClose();
      }
    };
    
    window.addEventListener('popstate', handlePopstate);
    
    return () => {
      clearTimeout(setupTimer);
      window.removeEventListener('popstate', handlePopstate);
      
      // 컴포넌트 언마운트 시 히스토리 정리
      if (isHistorySetup) {
        try {
          // 현재 상태가 PDF 모달인 경우에만 뒤로 이동
          if (window.history.state?.modal === 'pdf-open') {
            window.history.back();
          }
        } catch (error) {
          console.warn('History cleanup 실패:', error);
        }
      }
    };
  }, [open, onClose, loading, filePath, sid]);

  if (!open) return null;

  return (
    <div 
      style={backdropStyle} 
      onClick={loading ? undefined : onClose}
      onTouchStart={(e) => {
        // 백드롭 터치는 모달 닫기로 처리 (로딩 중이 아닐 때만)
        if (!loading && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <style>{`
        @media print { 
          .pdf-modal-root { display: none !important; } 
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        className="pdf-modal-root"
        style={modalStyle}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={headerStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }} 
            style={closeBtnStyle} 
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div 
          ref={holderRef} 
          style={viewerStyle} 
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()} // 뷰어 터치는 백드롭 이벤트 방지
        >
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
                <div style={{ fontSize: '12px', color: '#999', textAlign: 'center', lineHeight: '1.3' }}>
                  전졸협 자료는 법적으로 저작권이 보호됩니다.<br/>
                  무단 복제 및 배포는 법적으로 처벌받을 수 있습니다.
                </div>
              </div>
            </div>
          )}
          {err && <div style={{ ...centerStyle, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && (
            <canvas
              ref={canvasRef}
              style={{
                display: "block",
                margin: "0 auto",
                userSelect: "none",
                imageRendering: "high-quality",
                cursor: isZoomed ? 'grab' : 'pointer',
                touchAction: 'none', // 기본 터치 동작 완전 비활성화
                ...canvasStyle
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onDoubleClick={handleDoubleClick}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>

        {numPages > 1 && !loading && (
          <div style={footerStyle} onClick={(e) => e.stopPropagation()}>
            <button
              style={{...navBtnStyle, opacity: renderedRef.current || pageNum <= 1 ? 0.5 : 1}}
              disabled={renderedRef.current || pageNum <= 1}
              onClick={async (e) => {
                e.stopPropagation();
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
              onClick={async (e) => {
                e.stopPropagation();
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
        
        {/* 확대 상태 표시 및 리셋 버튼 (모바일에서만) */}
        {window.innerWidth <= 768 && isZoomed && (
          <div style={{
            position: 'absolute',
            top: '60px',
            right: '12px',
            background: 'rgba(0,0,0,0.7)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: '600',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>확대 중</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const state = touchStateRef.current;
                state.currentScale = 1;
                state.lastScale = 1;
                state.translateX = 0;
                state.translateY = 0;
                
                setCanvasStyle(prev => ({
                  ...prev,
                  transform: 'translate(0, 0) scale(1)',
                  transition: 'transform 0.4s ease'
                }));
                
                setIsZoomed(false);
              }}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                borderRadius: '50%',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const backdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modalStyle = {
  width: "min(95vw, 900px)",
  height: "min(95vh, 800px)",
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
  position: "sticky",
  top: 0,
  zIndex: 2,
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 12px",
  borderBottom: "1px solid #2d333b",
  background: "linear-gradient(#1c1f24, #1a1d22)",
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
  transition: "background 0.2s ease",
};

const viewerStyle = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "hidden", // auto에서 hidden으로 변경 (스크롤 방지)
  padding: "15px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  touchAction: "none", // 기본 터치 동작 비활성화
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
};

const navBtnStyle = {
  border: "1px solid #2d333b",
  background: "transparent",
  color: "#e5e7eb",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  transition: "background 0.2s ease",
  fontWeight: 600,
};

// src/components/PdfModalPdfjs.jsx (Full Code - X축 중앙 고정 핀치줌)
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const FIXED_ZOOM_STEP = 0.05;
  const MIN_ZOOM_HARD_CAP = 0.1;
  
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const modalRef = useRef(null); // ✅ 모달 ref 추가
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);
  const renderedRef = useRef(false);
  const initialScaleRef = useRef(1);
  const minScaleRef = useRef(MIN_ZOOM_HARD_CAP);

  const [isZoomed, setIsZoomed] = useState(false);
  const touchState = useRef({
    scale: 1,
    translateY: 0, // X축 제거
    initialDistance: 0,
    lastTouchY: 0,
    isScaling: false,
    isDragging: false
  });
  
  const mouseState = useRef({
    isDragging: false,
    lastMouseY: 0
  });

  const getContainerSize = () => {
    const el = holderRef.current;
    if (!el) return { width: 600, height: 400 };
    const rect = el.getBoundingClientRect();
    return { 
      width: Math.max(320, Math.floor(rect.width - 30)),
      height: Math.max(300, Math.floor(rect.height - 30))
    };
  };

  const getTouchDistance = (touch1, touch2) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // ✅ X축 중앙 고정 transform (translateX 계산)
  const applyCanvasTransform = useCallback((scale, translateY) => {
    if (!canvasRef.current || !holderRef.current) return;
    
    const canvas = canvasRef.current;
    const container = holderRef.current;
    
    // 캔버스 원본 너비
    const canvasWidth = parseFloat(canvas.style.width);
    
    // scale 적용 후 너비
    const scaledWidth = canvasWidth * scale;
    
    // 컨테이너 너비
    const containerWidth = container.getBoundingClientRect().width;
    
    // 중앙 정렬을 위한 translateX 계산
    const translateX = (containerWidth - scaledWidth) / 2;
    
    const transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    
    canvas.style.setProperty('transform', transform, 'important');
    canvas.style.setProperty('transform-origin', 'top left', 'important');
    
    const isInteracting = touchState.current.isScaling || touchState.current.isDragging || mouseState.current.isDragging;
    canvas.style.setProperty('transition', isInteracting ? 'none' : 'transform 0.3s ease', 'important');
    
    setIsZoomed(scale > 1.001);
  }, []);

  const handleTouchStart = useCallback((e) => {
    e.preventDefault();
    const touches = e.touches;
    const state = touchState.current;
    
    if (touches.length === 2) {
      state.isScaling = true;
      state.isDragging = false;
      state.initialDistance = getTouchDistance(touches[0], touches[1]);
    } else if (touches.length === 1 && state.scale > minScaleRef.current) {
      state.isDragging = true;
      state.isScaling = false;
      state.lastTouchY = touches[0].clientY;
      if(canvasRef.current) canvasRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!e) return; 
    e.preventDefault();
    e.stopPropagation();
    
    const touches = e.touches;
    const state = touchState.current;
    const currentMaxScale = 1.0;
    const currentMinScale = minScaleRef.current / initialScaleRef.current;

    if (touches.length === 2 && state.isScaling) {
      const currentDistance = getTouchDistance(touches[0], touches[1]);
      const scaleChange = currentDistance / state.initialDistance;
      const prevScale = state.scale;
      let newScale = prevScale * scaleChange;
      
      newScale = Math.max(currentMinScale, newScale); 
      newScale = Math.min(currentMaxScale, newScale); 
      
      if (Math.abs(newScale - prevScale) > 0.01) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        
        // ✅ Y축만 핀치 중심 계산
        const centerClientY = (touches[0].clientY + touches[1].clientY) / 2;
        const pointY = (centerClientY - rect.top - state.translateY) / prevScale;
        
        // ✅ Y축만 업데이트
        state.translateY -= (newScale - prevScale) * pointY;

        if (newScale >= currentMaxScale - 0.001 || newScale <= currentMinScale + 0.001) {
          state.translateY = 0; 
        }
        
        state.scale = newScale;
        applyCanvasTransform(state.scale, state.translateY);
        state.initialDistance = currentDistance;
      }
      
    } else if (touches.length === 1 && state.isDragging && state.scale > currentMinScale) {
      const deltaY = touches[0].clientY - state.lastTouchY;
      
      if (Math.abs(deltaY) > 1) {
        state.translateY += deltaY;
        state.lastTouchY = touches[0].clientY;
        
        applyCanvasTransform(state.scale, state.translateY);
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
  
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0 || touchState.current.scale <= minScaleRef.current) return; 

    e.preventDefault();
    const state = mouseState.current;
    state.isDragging = true;
    state.lastMouseY = e.clientY;
    
    if(canvasRef.current) canvasRef.current.style.transition = 'none';
  }, []);

  const handleMouseMove = useCallback((e) => {
    const mState = mouseState.current;
    const tState = touchState.current;
    
    if (!mState.isDragging || tState.scale <= minScaleRef.current) return;
    
    const deltaY = e.clientY - mState.lastMouseY;
    
    tState.translateY += deltaY;
    mState.lastMouseY = e.clientY;
    
    applyCanvasTransform(tState.scale, tState.translateY);
  }, [applyCanvasTransform]);

  const handleMouseUp = useCallback(() => {
    const mState = mouseState.current;
    if (!mState.isDragging) return;
    
    mState.isDragging = false;
    
    if(canvasRef.current) canvasRef.current.style.transition = 'transform 0.3s ease';
  }, []);

  const handleDoubleClick = useCallback(() => {
    const state = touchState.current;
    state.scale = 1.0;
    state.translateY = 0;
    
    if (canvasRef.current) {
      canvasRef.current.style.removeProperty('transform');
      canvasRef.current.style.removeProperty('transform-origin');
    }
  }, []);

  const resetZoom = useCallback(() => {
    const state = touchState.current;
    state.scale = 1.0;
    state.translateY = 0;
    
    if (canvasRef.current) {
      canvasRef.current.style.removeProperty('transform');
      canvasRef.current.style.removeProperty('transform-origin');
    }
  }, []);
  
  const handleWheel = useCallback((e) => {
    const isZoomGesture = e.ctrlKey || e.metaKey;
    
    if (isZoomGesture) {
        // ✅ 브라우저 줌 완전 차단
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const state = touchState.current;
        const zoomStep = FIXED_ZOOM_STEP;
        const prevScale = state.scale;
        let newScale = prevScale;
        
        if (e.deltaY < 0) {
            newScale += zoomStep; 
        } else if (e.deltaY > 0) {
            newScale -= zoomStep; 
        }
        
        const currentMaxScale = 1.0;
        const currentMinScale = minScaleRef.current / initialScaleRef.current;

        if (newScale > currentMaxScale) newScale = currentMaxScale;
        if (newScale < currentMinScale) newScale = currentMinScale;
        
        // ✅ 최대/최소 줌 도달 시에도 preventDefault 유지 (브라우저 줌 방지)
        if (newScale !== prevScale) {
            const canvas = canvasRef.current;
            const rect = canvas.getBoundingClientRect();
            
            const pointY = (e.clientY - rect.top - state.translateY) / prevScale;
            
            state.translateY -= (newScale - prevScale) * pointY;
            
            if (newScale >= currentMaxScale - 0.001 || newScale <= currentMinScale + 0.001) { 
                state.translateY = 0;
            } 
            
            state.scale = newScale;
            applyCanvasTransform(state.scale, state.translateY);
        }
        
        return false;
    }
  }, [applyCanvasTransform, FIXED_ZOOM_STEP]);

  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
    
    try {
      renderedRef.current = true;
      
      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: containerWidth, height: containerHeight } = getContainerSize();
      const baseViewport = page.getViewport({ scale: 1 });
      
      const widthFitScale = containerWidth / baseViewport.width;
      const heightFitScale = containerHeight / baseViewport.height;
      
      initialScaleRef.current = widthFitScale;
      minScaleRef.current = Math.max(MIN_ZOOM_HARD_CAP, heightFitScale);
      
      const isMobile = window.innerWidth <= 768;
      const qualityMultiplier = isMobile ? 3.0 : 4.0;
      const renderScale = widthFitScale * qualityMultiplier;
      const renderViewport = page.getViewport({ scale: renderScale });
      
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${Math.floor(baseViewport.height * widthFitScale)}px`;
      
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      await page.render({ 
        canvasContext: ctx, 
        viewport: renderViewport,
        intent: 'display',
        renderInteractiveForms: false
      }).promise;

      touchState.current.scale = 1.0;
      touchState.current.translateY = 0;
      
      if (canvasRef.current) {
        canvasRef.current.style.removeProperty('transform');
        canvasRef.current.style.removeProperty('transform-origin');
      }
      
    } catch (error) {
      console.error("PDF 렌더링 오류:", error);
    } finally {
      setTimeout(() => {
        renderedRef.current = false;
      }, 100);
    }
  }, [MIN_ZOOM_HARD_CAP]);

  const renderFirstPage = useCallback(async (doc) => {
    if (!doc) return;
    await renderPage(doc, 1);
  }, [renderPage]);

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
          setTimeout(async () => {
            if (!cancelled) {
              await renderFirstPage(pdfDoc);
            }
          }, 50);
          return;
        }

        const functions = getFunctions(undefined, "asia-northeast3");
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

        setTimeout(async () => {
          if (!cancelled) {
            await renderFirstPage(doc);
          }
        }, 50);
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
        ref={modalRef}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleWheel}
      >
        <div style={headerStyle}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">
            ✕
          </button>
        </div>

        <div ref={holderRef} style={viewerStyleScrollable} onWheel={handleWheel}>
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
              onMouseDown={handleMouseDown}
              onWheel={handleWheel}
              onMouseLeave={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              style={{
                display: "block",
                margin: "0 auto",
                userSelect: "none",
                maxWidth: "100%",
                maxHeight: "none",
                objectFit: "contain",
                imageRendering: "high-quality",
                touchAction: "none",
                cursor: isZoomed ? 'grab' : 'pointer',
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
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modalStyle = {
  width: "min(95vw, 900px)",
  height: "min(80vh, 800px)",
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

const viewerStyleScrollable = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflowY: "auto",
  overflowX: "hidden",
  padding: "15px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
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
  background: "rgb(21, 29, 54)",
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

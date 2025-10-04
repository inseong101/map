// src/components/PdfModalPdfjs.jsx - 완전 수정본
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const MIN_ZOOM_HARD_CAP = 0.1;
  
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);
  const renderedRef = useRef(false);
  const initialScaleRef = useRef(1);
  const minScaleRef = useRef(MIN_ZOOM_HARD_CAP);

  const [zoom, setZoom] = useState(0.5);
  const touchState = useRef({
    translateY: 0,
    lastTouchY: 0,
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

  const clampTranslateY = useCallback((translateY, zoom) => {
    if (!canvasRef.current || !holderRef.current) return translateY;
    
    const canvas = canvasRef.current;
    const container = holderRef.current;
    
    const actualScale = zoom * initialScaleRef.current;
    
    const canvasHeight = parseFloat(canvas.style.height);
    const scaledHeight = canvasHeight * actualScale;
    const containerHeight = container.getBoundingClientRect().height;
    
    if (scaledHeight <= containerHeight) {
      return 0;
    }
    
    const maxTranslateY = 0;
    const minTranslateY = containerHeight - scaledHeight;
    
    return Math.max(minTranslateY, Math.min(maxTranslateY, translateY));
  }, []);

  const applyCanvasTransform = useCallback((zoom, translateY) => {
    if (!canvasRef.current || !holderRef.current) return;
    
    const canvas = canvasRef.current;
    const container = holderRef.current;
    
    const actualScale = zoom * initialScaleRef.current;
    
    const canvasWidth = parseFloat(canvas.style.width);
    const scaledWidth = canvasWidth * actualScale;
    const containerWidth = container.getBoundingClientRect().width;
    const translateX = (containerWidth - scaledWidth) / 2;
    
    const clampedTranslateY = clampTranslateY(translateY, zoom);
    touchState.current.translateY = clampedTranslateY;
    
    const transform = `translate(${translateX}px, ${clampedTranslateY}px) scale(${actualScale})`;
    
    canvas.style.setProperty('transform', transform, 'important');
    canvas.style.setProperty('transform-origin', 'top left', 'important');
    canvas.style.setProperty('transition', 'transform 0.3s ease', 'important');
  }, [clampTranslateY]);

  const handleZoomIn = useCallback(() => {
    const maxZoom = 1.0;
    const newZoom = Math.min(zoom + 0.1, maxZoom);
    
    if (!holderRef.current || !canvasRef.current) {
      setZoom(newZoom);
      applyCanvasTransform(newZoom, 0);
      return;
    }
    
    const container = holderRef.current;
    const containerRect = container.getBoundingClientRect();
    const viewportCenterY = containerRect.height / 2;
    
    const currentY = touchState.current.translateY;
    const currentScale = zoom * initialScaleRef.current;
    const pointY = (viewportCenterY - currentY) / currentScale;
    
    const newScale = newZoom * initialScaleRef.current;
    const newTranslateY = viewportCenterY - pointY * newScale;
    
    touchState.current.translateY = newTranslateY;
    setZoom(newZoom);
    applyCanvasTransform(newZoom, newTranslateY);
  }, [zoom, applyCanvasTransform]);

  const handleZoomOut = useCallback(() => {
    const minZoom = minScaleRef.current;
    const newZoom = Math.max(zoom - 0.1, minZoom);
    
    if (!holderRef.current || !canvasRef.current) {
      setZoom(newZoom);
      applyCanvasTransform(newZoom, 0);
      return;
    }
    
    const container = holderRef.current;
    const containerRect = container.getBoundingClientRect();
    const viewportCenterY = containerRect.height / 2;
    
    const currentY = touchState.current.translateY;
    const currentScale = zoom * initialScaleRef.current;
    const pointY = (viewportCenterY - currentY) / currentScale;
    
    const newScale = newZoom * initialScaleRef.current;
    const newTranslateY = viewportCenterY - pointY * newScale;
    
    touchState.current.translateY = newTranslateY;
    setZoom(newZoom);
    applyCanvasTransform(newZoom, newTranslateY);
  }, [zoom, applyCanvasTransform]);

  const handleTouchStart = useCallback((e) => {
    const touches = e.touches;
    if (touches.length === 1) {
      touchState.current.isDragging = true;
      touchState.current.lastTouchY = touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchState.current.isDragging) return;
    
    const touches = e.touches;
    if (touches.length === 1) {
      const deltaY = touches[0].clientY - touchState.current.lastTouchY;
      touchState.current.translateY += deltaY;
      touchState.current.lastTouchY = touches[0].clientY;
      
      applyCanvasTransform(zoom, touchState.current.translateY);
    }
  }, [zoom, applyCanvasTransform]);

  const handleTouchEnd = useCallback(() => {
    touchState.current.isDragging = false;
  }, []);
  
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    
    mouseState.current.isDragging = true;
    mouseState.current.lastMouseY = e.clientY;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!mouseState.current.isDragging) return;
    
    const deltaY = e.clientY - mouseState.current.lastMouseY;
    touchState.current.translateY += deltaY;
    mouseState.current.lastMouseY = e.clientY;
    
    applyCanvasTransform(zoom, touchState.current.translateY);
  }, [zoom, applyCanvasTransform]);

  const handleMouseUp = useCallback(() => {
    mouseState.current.isDragging = false;
  }, []);

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
      
      const minZoom = heightFitScale / widthFitScale;
      minScaleRef.current = Math.max(MIN_ZOOM_HARD_CAP, minZoom);
      
      const initialZoom = Math.max(0.5, minScaleRef.current);
      
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

      setZoom(initialZoom);
      touchState.current.translateY = 0;
      applyCanvasTransform(initialZoom, 0);
      
    } catch (error) {
      console.error("PDF 렌더링 오류:", error);
    } finally {
      setTimeout(() => {
        renderedRef.current = false;
      }, 100);
    }
  }, [applyCanvasTransform, MIN_ZOOM_HARD_CAP]);

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
    
    const preventAllZoom = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };
    
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("wheel", preventAllZoom, { passive: false, capture: true });
    
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("wheel", preventAllZoom, { capture: true });
    }
  }, [open, onClose, loading, handleMouseMove, handleMouseUp]);
  
  if (!open) return null;

  const maxScale = 1.0;
  const minScale = minScaleRef.current;

  return (
    <div 
      style={backdropStyle} 
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading && !mouseState.current.isDragging) {
          onClose();
        }
      }}
    >
      <div
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={headerStyle}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              onClick={handleZoomOut}
              disabled={zoom <= minScale}
              style={{
                ...zoomBtnStyle,
                opacity: zoom <= minScale ? 0.3 : 1,
                cursor: zoom <= minScale ? 'not-allowed' : 'pointer'
              }}
            >
              −
            </button>
            <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '45px', textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button 
              onClick={handleZoomIn}
              disabled={zoom >= maxScale}
              style={{
                ...zoomBtnStyle,
                opacity: zoom >= maxScale ? 0.3 : 1,
                cursor: zoom >= maxScale ? 'not-allowed' : 'pointer'
              }}
            >
              +
            </button>
          </div>
          
          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">
            ✕
          </button>
        </div>

        <div ref={holderRef} style={viewerStyleScrollable}>
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
              onMouseLeave={handleMouseUp}
              style={{
                display: "block",
                margin: "0 auto",
                userSelect: "none",
                maxWidth: "100%",
                maxHeight: "none",
                objectFit: "contain",
                imageRendering: "high-quality",
                touchAction: "pan-y",
                cursor: 'grab',
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
  flexShrink: 0,
  gap: '12px'
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

const zoomBtnStyle = {
  border: "1px solid #2d333b",
  borderRadius: 6,
  background: "rgba(126,162,255,.12)",
  padding: "4px 10px",
  cursor: "pointer",
  color: "#e5e7eb",
  fontSize: 18,
  lineHeight: 1,
  fontWeight: 'bold',
  minWidth: '32px',
  height: '32px'
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
  touchAction: "pan-y"
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

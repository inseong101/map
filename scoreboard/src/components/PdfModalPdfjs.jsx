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
  
  // 최소 줌 레벨 (Fit-to-Height 기준)
  const minScaleRef = useRef(MIN_ZOOM_HARD_CAP); 

  const [zoom, setZoom] = useState(1.0); // 줌 1.0 = Fit-to-Width (모달 가로 = 문서 가로)
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

  const clampTranslateY = useCallback((translateY, currentZoom) => {
    if (!canvasRef.current || !holderRef.current) return 0;
    
    const canvas = canvasRef.current;
    const container = holderRef.current;
    
    // 캔버스의 CSS 높이는 이미 Fit-to-Width 상태의 높이
    const canvasBaseHeight = parseFloat(canvas.style.height);
    // 현재 줌을 적용한 실제 높이
    const scaledHeight = canvasBaseHeight * currentZoom;
    const containerHeight = container.getBoundingClientRect().height - 30;
    
    if (scaledHeight <= containerHeight) {
      // 캔버스가 컨테이너보다 작으면 상단 고정
      return 0;
    }
    
    // 위쪽 한계: 0 (캔버스 상단이 컨테이너 상단보다 위로 갈 수 없음)
    const maxTranslateY = 0; 
    // 아래쪽 한계: 캔버스 하단이 컨테이너 하단과 일치할 때
    // translateY + scaledHeight = containerHeight
    // translateY = containerHeight - scaledHeight
    const minTranslateY = containerHeight - scaledHeight;
    
    // 엄격하게 클램핑
    const clamped = Math.max(minTranslateY, Math.min(maxTranslateY, translateY));
    return clamped;
  }, []);

  const applyCanvasTransform = useCallback((currentZoom, translateY, withTransition = true) => {
    if (!canvasRef.current || !holderRef.current) return;
    
    const canvas = canvasRef.current;
    const container = holderRef.current;
    
    // X축 중앙 정렬
    const canvasWidth = parseFloat(canvas.style.width);
    const scaledWidth = canvasWidth * currentZoom;
    const containerWidth = container.getBoundingClientRect().width - 30; 
    const translateX = (containerWidth - scaledWidth) / 2;
    
    // transform 적용: scale은 currentZoom만 사용 (CSS 크기가 이미 Fit-to-Width 기준)
    const transform = `translate(${translateX}px, ${translateY}px) scale(${currentZoom})`;
    
    canvas.style.setProperty('transform', transform, 'important');
    canvas.style.setProperty('transform-origin', 'top left', 'important');
    canvas.style.setProperty('transition', withTransition ? 'transform 0.3s ease' : 'none', 'important');
  }, []);

  const handleZoomChange = useCallback((newZoom) => {
    if (!holderRef.current || !canvasRef.current) {
      const clamped = clampTranslateY(0, newZoom);
      touchState.current.translateY = clamped;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, clamped, true);
      return;
    }

    const container = holderRef.current;
    const canvas = canvasRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerHeight = containerRect.height - 30;
    
    // 최소 줌일 때는 무조건 상단 정렬
    if (newZoom <= minScaleRef.current) {
      touchState.current.translateY = 0;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, 0, true);
      return;
    }
    
    // 현재 상태
    const canvasBaseHeight = parseFloat(canvas.style.height) || 0;
    if (canvasBaseHeight === 0) {
      touchState.current.translateY = 0;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, 0, true);
      return;
    }
    
    const oldScaledHeight = canvasBaseHeight * zoom;
    const newScaledHeight = canvasBaseHeight * newZoom;
    const currentTranslateY = touchState.current.translateY;
    
    // 뷰포트 중앙 Y 좌표
    const viewportCenterY = containerHeight / 2;
    
    // 현재 뷰포트 중앙이 가리키는 문서상의 Y 좌표 (픽셀 단위)
    const documentY = viewportCenterY - currentTranslateY;
    
    // 문서 내 비율 (0~1)
    const ratio = documentY / oldScaledHeight;
    
    // 새 줌에서 같은 비율 지점의 문서 Y 좌표
    const newDocumentY = ratio * newScaledHeight;
    
    // 그 지점이 뷰포트 중앙에 오도록 translateY 계산
    let newTranslateY = viewportCenterY - newDocumentY;
    
    // 클램핑
    newTranslateY = clampTranslateY(newTranslateY, newZoom);
    
    touchState.current.translateY = newTranslateY;
    setZoom(newZoom);
    applyCanvasTransform(newZoom, newTranslateY, true);
  }, [zoom, applyCanvasTransform, clampTranslateY]);

  const handleZoomIn = useCallback(() => {
    const maxZoom = 1.0; // 1.0 = Fit-to-Width (100%)
    const newZoom = Math.min(Math.floor((zoom * 10 + 1.01) * 10) / 100, maxZoom); 
    handleZoomChange(newZoom);
  }, [zoom, handleZoomChange]);

  const handleZoomOut = useCallback(() => {
    const minZoom = minScaleRef.current;
    const newZoom = Math.max(Math.ceil((zoom * 10 - 0.99) * 10) / 100, minZoom); 
    handleZoomChange(newZoom);
  }, [zoom, handleZoomChange]);

  const handleTouchStart = useCallback((e) => {
    const touches = e.touches;
    if (touches.length === 1) {
      if (zoom > minScaleRef.current) {
        touchState.current.isDragging = true;
      }
      touchState.current.lastTouchY = touches[0].clientY;
    }
  }, [zoom]);

  const handleTouchMove = useCallback((e) => {
    if (!touchState.current.isDragging) return;
    
    const touches = e.touches;
    if (touches.length === 1) {
      const deltaY = touches[0].clientY - touchState.current.lastTouchY;
      let newTranslateY = touchState.current.translateY + deltaY;
      
      // 드래그 중 클램핑
      newTranslateY = clampTranslateY(newTranslateY, zoom);
      touchState.current.translateY = newTranslateY;
      touchState.current.lastTouchY = touches[0].clientY;
      
      applyCanvasTransform(zoom, newTranslateY, false);
    }
  }, [zoom, applyCanvasTransform, clampTranslateY]);

  const handleTouchEnd = useCallback(() => {
    touchState.current.isDragging = false;
  }, []);
  
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    
    if (zoom > minScaleRef.current) {
      mouseState.current.isDragging = true;
    }
    mouseState.current.lastMouseY = e.clientY;
  }, [zoom]);

  const handleMouseMove = useCallback((e) => {
    if (!mouseState.current.isDragging) return;
    
    const deltaY = e.clientY - mouseState.current.lastMouseY;
    let newTranslateY = touchState.current.translateY + deltaY;
    
    // 드래그 중 클램핑
    newTranslateY = clampTranslateY(newTranslateY, zoom);
    touchState.current.translateY = newTranslateY;
    mouseState.current.lastMouseY = e.clientY;
    
    applyCanvasTransform(zoom, newTranslateY, false);
  }, [zoom, applyCanvasTransform, clampTranslateY]);

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
      
      // Fit-to-Width 스케일 계산
      const fitWidthScale = containerWidth / baseViewport.width; 
      
      // 캔버스 CSS 크기를 Fit-to-Width 상태로 설정
      // 이것이 줌 1.0 (100%)의 기준이 됨
      const cssWidth = containerWidth;
      const cssHeight = baseViewport.height * fitWidthScale;
      
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      
      // 최소 줌 계산: 높이가 컨테이너 높이와 일치하는 줌 레벨
      // cssHeight * minZoom = containerHeight
      const minZoom = containerHeight / cssHeight;
      minScaleRef.current = Math.max(MIN_ZOOM_HARD_CAP, minZoom);
      
      // 렌더링 품질 향상을 위한 내부 스케일
      const isMobile = window.innerWidth <= 768;
      const qualityMultiplier = isMobile ? 3.0 : 4.0;
      const renderScale = fitWidthScale * qualityMultiplier;
      const renderViewport = page.getViewport({ scale: renderScale });
      
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      await page.render({ 
        canvasContext: ctx, 
        viewport: renderViewport,
        intent: 'display',
        renderInteractiveForms: false
      }).promise;

      // 초기 줌은 무조건 1.0 (Fit-to-Width)
      const initialZoom = 1.0;
      setZoom(initialZoom);
      touchState.current.translateY = 0;
      applyCanvasTransform(initialZoom, 0, true);
      
    } catch (error) {
      console.error("PDF 렌더링 오류:", error);
    } finally {
      setTimeout(() => {
        renderedRef.current = false;
      }, 100);
    }
  }, [applyCanvasTransform]);

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
                cursor: mouseState.current.isDragging || touchState.current.isDragging ? 'grabbing' : 'grab',
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

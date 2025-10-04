// src/components/PdfModalPdfjs.jsx
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

  const minScaleRef = useRef(MIN_ZOOM_HARD_CAP);
  const [zoom, setZoom] = useState(1.0);

  // 렌더된 CSS 크기 캐시
  const baseCssHeightRef = useRef(0);
  const baseCssWidthRef = useRef(0);

  const touchState = useRef({ translateY: 0, lastTouchY: 0, isDragging: false });
  const mouseState = useRef({ isDragging: false, lastMouseY: 0 });

  // 강제 리렌더
  const [, forceRender] = useState(0);
  const tick = useCallback(() => forceRender(v => v + 1), []);

  // ---------- utils ----------
  function getInnerSize(el) {
    if (!el) return { width: 600, height: 400, padX: 0, padY: 0 };
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
    const padY = parseFloat(cs.paddingTop || "0") + parseFloat(cs.paddingBottom || "0");
    return {
      width: Math.max(320, Math.floor(rect.width - padX)),
      height: Math.max(300, Math.floor(rect.height - padY)),
      padX, padY
    };
  }
  const getContainerSize = () => holderRef.current ? getInnerSize(holderRef.current) : { width: 600, height: 400, padX: 0, padY: 0 };

  // ---------- 진행도(0~1) : translateY 기반 ----------
  const progressRatio = useCallback(() => {
    const holder = holderRef.current;
    if (!holder) return 0;
    const { height: viewH } = getInnerSize(holder);
    const scaledH = baseCssHeightRef.current * zoom;
    if (!scaledH || scaledH <= viewH) return 0;

    const minY = viewH - scaledH;              // 최하단 한계(음수)
    const ty = touchState.current.translateY;  // [minY, 0]
    const r = (0 - ty) / (0 - minY);           // 위=0, 아래=1
    return Math.min(1, Math.max(0, r));
  }, [zoom]);

  const isScrollableNow = () => {
    const holder = holderRef.current;
    if (!holder) return false;
    const { height: viewH } = getInnerSize(holder);
    const scaledH = baseCssHeightRef.current * zoom;
    return scaledH > viewH + 0.5;
  };

  // ---------- Y 이동 클램프 ----------
  const clampTranslateY = useCallback((translateY, currentZoom) => {
    const container = holderRef.current;
    if (!container) return 0;

    const { height: viewH } = getInnerSize(container);
    const scaledH = baseCssHeightRef.current * currentZoom;
    if (!scaledH || scaledH <= viewH) return 0;

    const maxY = 0;
    const minY = viewH - scaledH; // 음수
    return Math.max(minY, Math.min(maxY, translateY));
  }, []);

  // ---------- 변환 적용: ★ scale → translate (이동이 스케일에 영향받지 않음) ----------
  const applyCanvasTransform = useCallback((currentZoom, translateY, withTransition = true) => {
    const container = holderRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const { width: containerWidth } = getInnerSize(container);
    const scaledWidth = baseCssWidthRef.current * currentZoom;
    const translateX = (containerWidth - scaledWidth) / 2; // X 중앙 정렬

    // 순서를 scale → translate 로 변경
    const transform = `scale(${currentZoom}) translate(${translateX}px, ${translateY}px)`;
    canvas.style.setProperty("transform-origin", "top left", "important");
    canvas.style.setProperty("transform", transform, "important");
    canvas.style.setProperty("transition", withTransition ? "transform 0.18s ease" : "none", "important");
  }, []);

  // ---------- 줌 (Y-중앙 기준 유지) ----------
  const handleZoomChange = useCallback((nextZoomRaw) => {
    const container = holderRef.current;
    const minAllowed = Math.min(1, minScaleRef.current);
    const newZoom = Math.max(minAllowed, Math.min(1.0, nextZoomRaw));

    if (!container) {
      const clamped = clampTranslateY(0, newZoom);
      touchState.current.translateY = clamped;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, clamped, true);
      tick();
      return;
    }

    const { height: viewH } = getInnerSize(container);
    const oldScaled = baseCssHeightRef.current * zoom;
    const newScaled = baseCssHeightRef.current * newZoom;

    if (!oldScaled) {
      touchState.current.translateY = 0;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, 0, true);
      tick();
      return;
    }

    const viewportCenterY = viewH / 2;
    const currentTY = touchState.current.translateY;

    // 화면 중앙이 문서 내 어느 지점이었는지 비율로 환산
    const oldDocY = viewportCenterY - currentTY;          // 화면 중앙의 문서 좌표(px)
    const ratio = Math.min(1, Math.max(0, oldDocY / oldScaled));

    // 새 스케일에서 같은 비율 지점이 중앙에 오도록 TY 재계산
    const newDocY = ratio * newScaled;
    let newTY = viewportCenterY - newDocY;
    newTY = clampTranslateY(newTY, newZoom);

    touchState.current.translateY = newTY;
    setZoom(newZoom);
    applyCanvasTransform(newZoom, newTY, true);
    tick();
  }, [zoom, applyCanvasTransform, clampTranslateY, tick]);

  const handleZoomIn = useCallback(() => {
    const step = 0.1;
    handleZoomChange(Math.min(1.0, Math.round((zoom + step) * 100) / 100));
  }, [zoom, handleZoomChange]);

  const handleZoomOut = useCallback(() => {
    const step = 0.1;
    const minAllowed = Math.min(1, minScaleRef.current);
    handleZoomChange(Math.max(minAllowed, Math.round((zoom - step) * 100) / 100));
  }, [zoom, handleZoomChange]);

  // ---------- 터치/드래그 ----------
  const handleTouchStart = useCallback((e) => {
    const t = e.touches;
    if (t.length === 1) {
      if (zoom > Math.min(1, minScaleRef.current)) touchState.current.isDragging = true;
      touchState.current.lastTouchY = t[0].clientY;
    }
  }, [zoom]);

  const handleTouchMove = useCallback((e) => {
    if (!touchState.current.isDragging) return;
    const t = e.touches;
    if (t.length === 1) {
      const deltaY = t[0].clientY - touchState.current.lastTouchY;
      let newY = touchState.current.translateY + deltaY;
      newY = clampTranslateY(newY, zoom);
      touchState.current.translateY = newY;
      touchState.current.lastTouchY = t[0].clientY;
      applyCanvasTransform(zoom, newY, false);
      tick();
    }
  }, [zoom, applyCanvasTransform, clampTranslateY, tick]);

  const handleTouchEnd = useCallback(() => { touchState.current.isDragging = false; }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (zoom > Math.min(1, minScaleRef.current)) mouseState.current.isDragging = true;
    mouseState.current.lastMouseY = e.clientY;
  }, [zoom]);

  const handleMouseMove = useCallback((e) => {
    if (!mouseState.current.isDragging) return;
    const deltaY = e.clientY - mouseState.current.lastMouseY;
    let newY = touchState.current.translateY + deltaY;
    newY = clampTranslateY(newY, zoom);
    touchState.current.translateY = newY;
    mouseState.current.lastMouseY = e.clientY;
    applyCanvasTransform(zoom, newY, false);
    tick();
  }, [zoom, applyCanvasTransform, clampTranslateY, tick]);

  const handleMouseUp = useCallback(() => { mouseState.current.isDragging = false; }, []);

  // ---------- 페이지 렌더 ----------
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;

    try {
      renderedRef.current = true;

      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: containerWidth, height: containerHeight } = getContainerSize();
      const baseViewport = page.getViewport({ scale: 1 });

      const fitWidthScale = containerWidth / baseViewport.width;
      const cssWidth = containerWidth;
      const cssHeight = baseViewport.height * fitWidthScale;

      baseCssWidthRef.current = cssWidth;
      baseCssHeightRef.current = cssHeight;

      // CSS 크기
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      // 최소 배율 (높이 기준)
      const minZoomFitHeight = containerHeight / cssHeight;
      minScaleRef.current = Math.min(1, Math.max(MIN_ZOOM_HARD_CAP, minZoomFitHeight));

      // 렌더 해상도
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
        intent: "display",
        renderInteractiveForms: false
      }).promise;

      // 초기 상태
      touchState.current.translateY = 0;
      setZoom(1.0);
      applyCanvasTransform(1.0, 0, false);
      tick();
    } catch (error) {
      console.error("PDF 렌더링 오류:", error);
    } finally {
      setTimeout(() => { renderedRef.current = false; }, 100);
    }
  }, [applyCanvasTransform, tick]);

  const renderFirstPage = useCallback(async (doc) => { if (doc) await renderPage(doc, 1); }, [renderPage]);

  // ---------- PDF 로드 ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !filePath || !sid) { renderedRef.current = false; return; }
      setLoading(true); setErr(null); renderedRef.current = false;

      try {
        const key = `${filePath}::${sid}`;
        if (pdfDoc && lastKeyRef.current === key) {
          setLoading(false);
          setTimeout(async () => { if (!cancelled) await renderFirstPage(pdfDoc); }, 50);
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

        const task = getDocument({ data: bytes, useSystemFonts: true, disableFontFace: false });
        const doc = await task.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
        lastKeyRef.current = key;

        setTimeout(async () => { if (!cancelled) await renderFirstPage(doc); }, 50);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; renderedRef.current = false; };
  }, [open, filePath, sid, renderFirstPage, pdfDoc]);

  // ---------- 전역 키/줌 차단 ----------
  useEffect(() => {
    if (!open) return;

    const handler = (e) => {
      if (e.key === "Escape" && !loading) onClose();
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) { e.preventDefault(); e.stopPropagation(); }

      const unit = 60, pageUnit = 400;
      const minAllowed = Math.min(1, minScaleRef.current);
      if (zoom <= minAllowed) return;

      let moved = false;
      let ty = touchState.current.translateY;

      switch (e.key) {
        case "ArrowDown": ty = clampTranslateY(ty - unit, zoom); moved = true; break;
        case "ArrowUp":   ty = clampTranslateY(ty + unit, zoom); moved = true; break;
        case "PageDown":  ty = clampTranslateY(ty - pageUnit, zoom); moved = true; break;
        case "PageUp":    ty = clampTranslateY(ty + pageUnit, zoom); moved = true; break;
        case "Home":      ty = clampTranslateY(0, zoom); moved = true; break;
        case "End": {
          const { height: viewH } = getInnerSize(holderRef.current);
          const scaledH = baseCssHeightRef.current * zoom;
          ty = clampTranslateY(viewH - scaledH, zoom);
          moved = true;
          break;
        }
        default: break;
      }

      if (moved) {
        e.preventDefault();
        touchState.current.translateY = ty;
        applyCanvasTransform(zoom, ty, false);
        tick();
      }
    };

    const preventAllZoom = (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); return false; }
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
    };
  }, [open, onClose, loading, handleMouseMove, handleMouseUp, applyCanvasTransform, clampTranslateY, zoom, tick]);

  // ---------- 비-패시브 wheel 리스너 ----------
  useEffect(() => {
    if (!open || !holderRef.current) return;
    const el = holderRef.current;

    const wheelHandler = (e) => {
      if (e.ctrlKey || e.metaKey) return; // 브라우저 줌은 전역에서 차단됨
      e.preventDefault();
      let ty = touchState.current.translateY - e.deltaY;
      ty = clampTranslateY(ty, zoom);
      touchState.current.translateY = ty;
      applyCanvasTransform(zoom, ty, false);
      tick();
    };

    el.addEventListener("wheel", wheelHandler, { passive: false });
    return () => el.removeEventListener("wheel", wheelHandler, { passive: false });
  }, [open, zoom, clampTranslateY, applyCanvasTransform, tick]);

  if (!open) return null;

  const maxScale = 1.0;
  const minScale = Math.min(1, minScaleRef.current);

  // ---- 썸 계산 ----
  const { height: viewH } = getContainerSize();
  const scaledH = baseCssHeightRef.current * zoom;
  const showProgress = !loading && !err && scaledH > viewH + 0.5;

  const visibleRatio = showProgress ? Math.min(1, viewH / scaledH) : 1;
  const trackHeight = viewH;
  const minThumbPx = 24;
  const thumbHeight = showProgress ? Math.max(minThumbPx, Math.round(trackHeight * visibleRatio)) : 0;
  const pr = showProgress ? progressRatio() : 0; // 0~1
  const thumbTop = showProgress ? Math.round((trackHeight - thumbHeight) * pr) : 0;

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !loading && !mouseState.current.isDragging) onClose(); }}
      className="pdf-modal-root"
    >
      <div style={modalStyle} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={handleZoomOut} disabled={zoom <= minScale}
              style={{ ...zoomBtnStyle, opacity: zoom <= minScale ? 0.3 : 1, cursor: zoom <= minScale ? "not-allowed" : "pointer" }}>
              −
            </button>
            <span style={{ fontSize: "12px", fontWeight: 600, minWidth: "45px", textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={handleZoomIn} disabled={zoom >= maxScale}
              style={{ ...zoomBtnStyle, opacity: zoom >= maxScale ? 0.3 : 1, cursor: zoom >= maxScale ? "not-allowed" : "pointer" }}>
              +
            </button>
          </div>

          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">✕</button>
        </div>

        {/* 뷰어 */}
        <div ref={holderRef} style={viewerStyleScrollable}>
          {loading && (
            <div style={centerStyle}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <div style={{ width: 50, height: 50, border: "4px solid #333", borderTop: "4px solid var(--primary)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>불러오는 중</div>
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
                touchAction: "none",
                cursor: mouseState.current.isDragging || touchState.current.isDragging ? "grabbing" : "grab"
              }}
            />
          )}

          {/* 위치 표시: 우측 트랙 + thumb */}
          {showProgress && (
            <div style={progressWrapInHolder}>
              <div style={progressTrackStyle} />
              <div style={{ ...progressThumbStyle, height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }} />
            </div>
          )}
        </div>

        {/* 페이지 네비 */}
        {numPages > 1 && !loading && (
          <div style={footerStyle}>
            <button
              style={{ ...navBtnStyle, opacity: renderedRef.current || pageNum <= 1 ? 0.5 : 1 }}
              disabled={renderedRef.current || pageNum <= 1}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum <= 1) return;
                const prev = pageNum - 1;
                setPageNum(prev);
                await renderPage(pdfDoc, prev);
              }}
            >← 이전</button>
            <span style={{ fontWeight: 700 }}>Page {pageNum} / {numPages}</span>
            <button
              style={{ ...navBtnStyle, opacity: renderedRef.current || pageNum >= numPages ? 0.5 : 1 }}
              disabled={renderedRef.current || pageNum >= numPages}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum >= numPages) return;
                const next = pageNum + 1;
                setPageNum(next);
                await renderPage(pdfDoc, next);
              }}
            >다음 →</button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media print { .pdf-modal-root { display: none !important; } }
      `}</style>
    </div>
  );
}

// ---------- styles ----------
const backdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  overscrollBehavior: "contain",
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
  position: "relative"
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
  gap: "12px"
};

const closeBtnStyle = {
  border: "1px solid #2d333b",
  borderRadius: 6,
  background: "transparent",
  padding: "4px 10px",
  cursor: "pointer",
  color: "#e5e7eb",
  fontSize: 16,
  lineHeight: 1
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
  fontWeight: "bold",
  minWidth: "32px",
  height: "32px"
};

const viewerStyleScrollable = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "hidden",
  padding: "15px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
  touchAction: "none",
  overscrollBehavior: "contain",
};

const centerStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center"
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
  fontWeight: 600
};

// 진행 표시(우측 트랙 + thumb) — viewer padding(15px) 반영
const progressWrapInHolder = {
  position: "absolute",
  top: 15,
  bottom: 15,
  right: 6,
  width: 8,
  pointerEvents: "none",
  zIndex: 2,
};

const progressTrackStyle = {
  position: "absolute",
  top: 0,
  bottom: 0,
  right: 0,
  width: 4,
  background: "rgba(255,255,255,0.10)",
  borderRadius: 2
};

const progressThumbStyle = {
  position: "absolute",
  right: 0,
  width: 4,
  background: "rgba(126,162,255,0.95)",
  borderRadius: 2,
  boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
  pointerEvents: "none",
  userSelect: "none",
  willChange: "transform,height",
  transition: "transform .08s linear, height .08s linear"
};

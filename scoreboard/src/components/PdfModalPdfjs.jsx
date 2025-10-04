// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const MIN_ZOOM_HARD_CAP = 0.1;

  const holderRef = useRef(null);
  const canvasRef = useRef(null);

  // 진행바 DOM refs (상태 의존 없이 직접 업데이트)
  const trackRef = useRef(null);
  const thumbRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);
  const renderedRef = useRef(false);

  const minScaleRef = useRef(MIN_ZOOM_HARD_CAP);
  const [zoom, setZoom] = useState(1.0);

  // 스크롤 원천값(소스 오브 트루스)
  const translateYRef = useRef(0);

  const touchState = useRef({ lastTouchY: 0, isDragging: false });
  const mouseState = useRef({ lastMouseY: 0, isDragging: false });

  // ---------- utils ----------
  function getInnerSize(el) {
    if (!el) return { width: 600, height: 400, padX: 0, padY: 0 };
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padX =
      parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
    const padY =
      parseFloat(cs.paddingTop || "0") + parseFloat(cs.paddingBottom || "0");
    return {
      width: Math.max(320, Math.floor(rect.width - padX)),
      height: Math.max(300, Math.floor(rect.height - padY)),
      padX,
      padY,
    };
  }
  const getContainerSize = () =>
    holderRef.current
      ? getInnerSize(holderRef.current)
      : { width: 600, height: 400, padX: 0, padY: 0 };

  const isScrollableNow = useCallback(() => {
    const holder = holderRef.current,
      canvas = canvasRef.current;
    if (!holder || !canvas) return false;
    const { height: h } = getInnerSize(holder);
    const baseCssHeight = parseFloat(canvas.style.height || "0");
    return baseCssHeight * zoom > h + 0.5;
  }, [zoom]);

  // ---------- Y 이동 클램프 ----------
  const clampTranslateY = useCallback((translateY, currentZoom) => {
    const canvas = canvasRef.current;
    const container = holderRef.current;
    if (!canvas || !container) return 0;

    const { height: containerHeight } = getInnerSize(container);
    const baseCssHeight = parseFloat(canvas.style.height) || 0;
    if (!baseCssHeight) return 0;

    const scaledHeight = baseCssHeight * currentZoom;
    if (scaledHeight <= containerHeight) return 0;

    const maxTranslateY = 0;
    const minTranslateY = containerHeight - scaledHeight;
    return Math.max(minTranslateY, Math.min(maxTranslateY, translateY));
  }, []);

  // ---------- 캔버스 변환 적용 ----------
  const applyCanvasTransform = useCallback(
    (currentZoom, translateY, withTransition = false) => {
      const canvas = canvasRef.current;
      const container = holderRef.current;
      if (!canvas || !container) return;

      const { width: containerWidth } = getInnerSize(container);
      const baseCssWidth = parseFloat(canvas.style.width) || 0;
      const scaledWidth = baseCssWidth * currentZoom;
      const translateX = (containerWidth - scaledWidth) / 2;

      canvas.style.setProperty("transform-origin", "top left", "important");
      canvas.style.setProperty(
        "transform",
        `translate(${translateX}px, ${translateY}px) scale(${currentZoom})`,
        "important"
      );
      canvas.style.setProperty(
        "transition",
        withTransition ? "transform 0.18s ease" : "none",
        "important"
      );
    },
    []
  );

  // ---------- 진행바(rAF) 업데이트 ----------
  const rafIdRef = useRef(0);
  const updateThumbOnce = useCallback(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!holder || !canvas || !track || !thumb) return;

    const { height: viewH } = getInnerSize(holder);
    const baseCssHeight = parseFloat(canvas.style.height || "0");
    const scaled = baseCssHeight * zoom;

    // 보일 필요 없으면 숨김
    if (!scaled || scaled <= viewH + 0.5) {
      track.style.opacity = "0";
      thumb.style.opacity = "0";
      return;
    }
    track.style.opacity = "1";
    thumb.style.opacity = "1";

    // 썸 높이
    const MIN_THUMB = 18;
    const thumbH = Math.max(
      MIN_THUMB,
      Math.round((viewH / scaled) * viewH)
    );
    thumb.style.height = `${thumbH}px`;

    // 진행 비율 0~1 (위=0, 아래=1)
    const minY = viewH - scaled; // 최하단(음수)
    const curY = translateYRef.current; // [minY, 0]
    const pr = Math.min(1, Math.max(0, 1 - (curY - minY) / (0 - minY)));

    const travel = Math.max(0, viewH - thumbH);
    const top = Math.round(pr * travel);
    thumb.style.transform = `translateY(${top}px)`;
  }, [zoom]);

  const startThumbRaf = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
    const loop = () => {
      updateThumbOnce();
      rafIdRef.current = requestAnimationFrame(loop);
    };
    rafIdRef.current = requestAnimationFrame(loop);
  }, [updateThumbOnce]);

  const stopThumbRaf = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
  }, []);

  // ---------- 공통 스크롤 함수 ----------
  const performScroll = useCallback(
    (deltaY) => {
      let ty = translateYRef.current - deltaY;
      ty = clampTranslateY(ty, zoom);
      translateYRef.current = ty;
      applyCanvasTransform(zoom, ty, false);
      // rAF가 알아서 썸 반영
    },
    [zoom, clampTranslateY, applyCanvasTransform]
  );

  // ---------- 확대/축소 (Y-중앙 유지) ----------
  const handleZoomChange = useCallback(
    (nextZoomRaw) => {
      const container = holderRef.current;
      const canvas = canvasRef.current;

      const minAllowed = Math.min(1, minScaleRef.current);
      const newZoom = Math.max(minAllowed, Math.min(1.0, nextZoomRaw));

      if (!container || !canvas) {
        const clampedY = clampTranslateY(0, newZoom);
        translateYRef.current = clampedY;
        setZoom(newZoom);
        applyCanvasTransform(newZoom, clampedY, true);
        updateThumbOnce();
        return;
      }

      const { height: containerHeight } = getInnerSize(container);
      const baseCssHeight = parseFloat(canvas.style.height) || 0;
      if (!baseCssHeight) {
        translateYRef.current = 0;
        setZoom(newZoom);
        applyCanvasTransform(newZoom, 0, true);
        updateThumbOnce();
        return;
      }

      const oldScaled = baseCssHeight * zoom;
      const newScaled = baseCssHeight * newZoom;
      const viewportCenterY = containerHeight / 2;

      const currentTranslateY = translateYRef.current;
      let docY = viewportCenterY - currentTranslateY;
      docY = Math.max(0, Math.min(oldScaled, docY));

      const ratio = oldScaled > 0 ? docY / oldScaled : 0;
      const newDocY = ratio * newScaled;

      let newTranslateY = viewportCenterY - newDocY;
      newTranslateY = clampTranslateY(newTranslateY, newZoom);

      translateYRef.current = newTranslateY;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, newTranslateY, true);
      updateThumbOnce();
    },
    [zoom, applyCanvasTransform, clampTranslateY, updateThumbOnce]
  );

  const handleZoomIn = useCallback(() => {
    const step = 0.1;
    handleZoomChange(Math.min(1.0, Math.round((zoom + step) * 100) / 100));
  }, [zoom, handleZoomChange]);

  const handleZoomOut = useCallback(() => {
    const step = 0.1;
    const minAllowed = Math.min(1, minScaleRef.current);
    handleZoomChange(Math.max(minAllowed, Math.round((zoom - step) * 100) / 100));
  }, [zoom, handleZoomChange]);

  // ---------- 터치/마우스 드래그 ----------
  const handleTouchStart = useCallback(
    (e) => {
      const t = e.touches;
      if (t.length === 1) {
        if (zoom > Math.min(1, minScaleRef.current)) touchState.current.isDragging = true;
        touchState.current.lastTouchY = t[0].clientY;
      }
    },
    [zoom]
  );

  const handleTouchMove = useCallback(
    (e) => {
      if (!touchState.current.isDragging) return;
      const t = e.touches;
      if (t.length === 1) {
        const deltaY = t[0].clientY - touchState.current.lastTouchY;
        touchState.current.lastTouchY = t[0].clientY;
        if (e.cancelable) e.preventDefault();
        performScroll(deltaY * -1);
      }
    },
    [performScroll]
  );

  const handleTouchEnd = useCallback(() => {
    touchState.current.isDragging = false;
  }, []);

  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (zoom > Math.min(1, minScaleRef.current)) mouseState.current.isDragging = true;
      mouseState.current.lastMouseY = e.clientY;
    },
    [zoom]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!mouseState.current.isDragging) return;
      const deltaY = e.clientY - mouseState.current.lastMouseY;
      mouseState.current.lastMouseY = e.clientY;
      performScroll(deltaY * -1);
    },
    [performScroll]
  );

  const handleMouseUp = useCallback(() => {
    mouseState.current.isDragging = false;
  }, []);

  // ---------- 페이지 렌더 ----------
  const renderPage = useCallback(
    async (doc, num) => {
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

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        const minZoomFitHeight = containerHeight / cssHeight;
        minScaleRef.current = Math.min(1, Math.max(MIN_ZOOM_HARD_CAP, minZoomFitHeight));

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
          renderInteractiveForms: false,
        }).promise;

        // 초기 상태
        translateYRef.current = 0;
        setZoom(1.0);
        applyCanvasTransform(1.0, 0, false);
        updateThumbOnce();
      } catch (error) {
        console.error("PDF 렌더링 오류:", error);
      } finally {
        setTimeout(() => {
          renderedRef.current = false;
        }, 100);
      }
    },
    [applyCanvasTransform, updateThumbOnce]
  );

  const renderFirstPage = useCallback(async (doc) => {
    if (!doc) return;
    await renderPage(doc, 1);
  }, [renderPage]);

  // ---------- PDF 로드 ----------
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
            if (!cancelled) await renderFirstPage(pdfDoc);
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
          disableFontFace: false,
        });
        const doc = await task.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
        lastKeyRef.current = key;

        setTimeout(async () => {
          if (!cancelled) await renderFirstPage(doc);
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

  // ---------- 전역 키보드 ----------
  useEffect(() => {
    if (!open) return;

    const handler = (e) => {
      if (e.key === "Escape" && !loading) onClose();
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
      }

      const unit = 60;
      const pageUnit = 400;
      const minAllowed = Math.min(1, minScaleRef.current);
      if (zoom <= minAllowed) return;

      let moved = false;
      let ty = translateYRef.current;

      switch (e.key) {
        case "ArrowDown":
          ty = clampTranslateY(ty - unit, zoom);
          moved = true;
          break;
        case "ArrowUp":
          ty = clampTranslateY(ty + unit, zoom);
          moved = true;
          break;
        case "PageDown":
          ty = clampTranslateY(ty - pageUnit, zoom);
          moved = true;
          break;
        case "PageUp":
          ty = clampTranslateY(ty + pageUnit, zoom);
          moved = true;
          break;
        case "Home":
          ty = clampTranslateY(0, zoom);
          moved = true;
          break;
        case "End": {
          const canvas = canvasRef.current;
          const { height: h } = getContainerSize();
          const baseCssHeight = parseFloat(canvas?.style.height || "0");
          const scaled = baseCssHeight * zoom;
          ty = clampTranslateY(h - scaled, zoom);
          moved = true;
          break;
        }
        default:
          break;
      }

      if (moved) {
        e.preventDefault();
        translateYRef.current = ty;
        applyCanvasTransform(zoom, ty, false);
        // 썸은 rAF로 자동 반영
      }
    };

    // 전역 줌(CTRL/⌘ + 휠) 차단
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
    window.addEventListener("wheel", preventAllZoom, {
      passive: false,
      capture: true,
    });

    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("wheel", preventAllZoom, {
        capture: true,
      });
    };
  }, [open, onClose, loading, handleMouseMove, handleMouseUp, applyCanvasTransform, clampTranslateY, zoom]);

  // ---------- 전역 wheel 캡처 (holder 안만 가로채기) ----------
  useEffect(() => {
    if (!open) return;
    const wheelCapture = (e) => {
      const holder = holderRef.current;
      if (!holder) return;
      if (!holder.contains(e.target)) return;
      if (!isScrollableNow()) return; // 내용 없으면 통과(배경 스크롤 허용)
      if (e.cancelable) e.preventDefault();
      performScroll(e.deltaY);
    };
    window.addEventListener("wheel", wheelCapture, { passive: false, capture: true });
    return () =>
      window.removeEventListener("wheel", wheelCapture, { capture: true });
  }, [open, isScrollableNow, performScroll]);

  // ---------- rAF로 진행바 항상 동기화 ----------
  useEffect(() => {
    if (!open) return;
    startThumbRaf();
    return () => stopThumbRaf();
  }, [open, startThumbRaf, stopThumbRaf]);

  // 리사이즈 시에도 즉시 반영
  useEffect(() => {
    const onResize = () => updateThumbOnce();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateThumbOnce]);

  if (!open) return null;

  const maxScale = 1.0;
  const minScale = Math.min(1, minScaleRef.current);

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading && !mouseState.current.isDragging) onClose();
      }}
      className="pdf-modal-root"
    >
      <div
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 헤더 */}
        <div style={headerStyle}>
          <div
            style={{
              fontWeight: 800,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title || "특별해설"}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={handleZoomOut}
              disabled={zoom <= minScale}
              style={{
                ...zoomBtnStyle,
                opacity: zoom <= minScale ? 0.3 : 1,
                cursor: zoom <= minScale ? "not-allowed" : "pointer",
              }}
            >
              −
            </button>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                minWidth: "45px",
                textAlign: "center",
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= maxScale}
              style={{
                ...zoomBtnStyle,
                opacity: zoom >= maxScale ? 0.3 : 1,
                cursor: zoom >= maxScale ? "not-allowed" : "pointer",
              }}
            >
              +
            </button>
          </div>

          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 뷰어 + 진행바 오버레이(holder 내부) */}
        <div
          ref={holderRef}
          style={viewerStyleScrollable}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseUp}
        >
          {/* 캔버스 */}
          <canvas
            ref={canvasRef}
            style={{
              display: "block",
              margin: "0 auto",
              userSelect: "none",
              maxWidth: "100%",
              maxHeight: "none",
              objectFit: "contain",
              imageRendering: "high-quality",
              touchAction: "none",
              cursor:
                mouseState.current.isDragging || touchState.current.isDragging
                  ? "grabbing"
                  : "grab",
            }}
          />

          {/* 진행바 */}
          <div ref={trackRef} style={progressWrapInsideHolder}>
            <div style={progressTrackStyle} />
            <div ref={thumbRef} style={progressThumbStyle} />
          </div>

          {/* 상태 표시 */}
          {loading && (
            <div style={centerStyle}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    width: "50px",
                    height: "50px",
                    border: "4px solid #333",
                    borderTop: "4px solid var(--primary)",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: "700",
                    color: "var(--ink)",
                  }}
                >
                  불러오는 중
                </div>
              </div>
            </div>
          )}
          {err && (
            <div style={{ ...centerStyle, color: "var(--bad)" }}>
              {String(err)}
            </div>
          )}
        </div>

        {/* 페이지 네비게이션 */}
        {numPages > 1 && !loading && (
          <div style={footerStyle}>
            <button
              style={{
                ...navBtnStyle,
                opacity: renderedRef.current || pageNum <= 1 ? 0.5 : 1,
              }}
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
            <span style={{ fontWeight: 700 }}>
              Page {pageNum} / {numPages}
            </span>
            <button
              style={{
                ...navBtnStyle,
                opacity: renderedRef.current || pageNum >= numPages ? 0.5 : 1,
              }}
              disabled={renderedRef.current || pageNum >= numPages}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum >= numPages)
                  return;
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
          to {
            transform: rotate(360deg);
          }
        }
        @media print {
          .pdf-modal-root {
            display: none !important;
          }
        }
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
  position: "relative",
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
  gap: "12px",
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
  fontWeight: "bold",
  minWidth: "32px",
  height: "32px",
};

const viewerStyleScrollable = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "hidden",
  overscrollBehavior: "contain",
  padding: "15px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
  touchAction: "none",
};

const progressWrapInsideHolder = {
  position: "absolute",
  top: 0,
  bottom: 0,
  right: 6,
  width: 10,
  pointerEvents: "none",
  zIndex: 3,
};

const progressTrackStyle = {
  position: "absolute",
  top: 0,
  bottom: 0,
  right: 3,
  width: 4,
  background: "rgba(255,255,255,0.10)",
  borderRadius: 2,
  transition: "opacity .08s linear",
};

const progressThumbStyle = {
  position: "absolute",
  right: 3,
  width: 4,
  background: "rgba(126,162,255,0.95)",
  borderRadius: 2,
  boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
  pointerEvents: "none",
  userSelect: "none",
  willChange: "transform,height",
  transition: "opacity .08s linear",
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
  flexShrink: 0,
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

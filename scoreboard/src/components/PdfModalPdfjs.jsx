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

  const touchState = useRef({
    translateY: 0,
    lastTouchY: 0,
    isDragging: false
  });

  const mouseState = useRef({
    isDragging: false,
    lastMouseY: 0
  });

  // -------- utils: 컨테이너 패딩을 고려한 실제 내부 크기 ----------
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
      padY
    };
  }

  const getContainerSize = () => {
    if (!holderRef.current)
      return { width: 600, height: 400, padX: 0, padY: 0 };
    return getInnerSize(holderRef.current);
  };

  // -------- Y 이동 클램프(여백 밑으로 내려가지 않게) ----------
  const clampTranslateY = useCallback((translateY, currentZoom) => {
    const canvas = canvasRef.current;
    const container = holderRef.current;
    if (!canvas || !container) return 0;

    const { height: containerHeight } = getInnerSize(container);

    const baseCssHeight = parseFloat(canvas.style.height) || 0; // transform 전 CSS 높이
    if (!baseCssHeight) return 0;

    const scaledHeight = baseCssHeight * currentZoom;

    // 문서가 컨테이너보다 짧으면 이동 필요 없음
    if (scaledHeight <= containerHeight) return 0;

    const maxTranslateY = 0;
    const minTranslateY = containerHeight - scaledHeight;

    return Math.max(minTranslateY, Math.min(maxTranslateY, translateY));
  }, []);

  // -------- 변환 적용(X 중앙 고정 + Y는 주어진 값) ----------
  const applyCanvasTransform = useCallback(
    (currentZoom, translateY, withTransition = true) => {
      const canvas = canvasRef.current;
      const container = holderRef.current;
      if (!canvas || !container) return;

      const { width: containerWidth } = getInnerSize(container);

      const baseCssWidth = parseFloat(canvas.style.width) || 0; // transform 전 CSS 폭
      const scaledWidth = baseCssWidth * currentZoom;
      const translateX = (containerWidth - scaledWidth) / 2; // 항상 X 중앙 정렬

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

  // -------- 확대/축소 (뷰포트 중앙 Y 기준 유지) ----------
  const handleZoomChange = useCallback(
    (nextZoomRaw) => {
      const container = holderRef.current;
      const canvas = canvasRef.current;

      // minScale는 절대 1.0을 넘지 않게 (컨테이너가 더 커도 축소 상한은 100%)
      const minAllowed = Math.min(1, minScaleRef.current);
      const newZoom = Math.max(minAllowed, Math.min(1.0, nextZoomRaw));

      if (!container || !canvas) {
        const clampedY = clampTranslateY(0, newZoom);
        touchState.current.translateY = clampedY;
        setZoom(newZoom);
        applyCanvasTransform(newZoom, clampedY, true);
        return;
      }

      const { height: containerHeight } = getInnerSize(container);
      const baseCssHeight = parseFloat(canvas.style.height) || 0;
      if (!baseCssHeight) {
        touchState.current.translateY = 0;
        setZoom(newZoom);
        applyCanvasTransform(newZoom, 0, true);
        return;
      }

      const oldScaled = baseCssHeight * zoom;
      const newScaled = baseCssHeight * newZoom;

      // 현재 뷰포트 중앙이 문서의 어디였는지 계산
      const viewportCenterY = containerHeight / 2;
      const currentTranslateY = touchState.current.translateY;

      // 문서 좌표(구 스케일 기준)
      let docY = viewportCenterY - currentTranslateY;
      docY = Math.max(0, Math.min(oldScaled, docY)); // 안전 범위

      // 같은 비율의 지점을 신 스케일에서 유지
      const ratio = oldScaled > 0 ? docY / oldScaled : 0;
      const newDocY = ratio * newScaled;

      // 새 translateY = 뷰포트중앙 - 새 문서좌표
      let newTranslateY = viewportCenterY - newDocY;
      newTranslateY = clampTranslateY(newTranslateY, newZoom);

      touchState.current.translateY = newTranslateY;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, newTranslateY, true);
    },
    [zoom, applyCanvasTransform, clampTranslateY]
  );

  const handleZoomIn = useCallback(() => {
    const step = 0.1;
    const target = Math.min(1.0, Math.round((zoom + step) * 100) / 100);
    handleZoomChange(target);
  }, [zoom, handleZoomChange]);

  const handleZoomOut = useCallback(() => {
    const step = 0.1;
    const minAllowed = Math.min(1, minScaleRef.current);
    const target = Math.max(minAllowed, Math.round((zoom - step) * 100) / 100);
    handleZoomChange(target);
  }, [zoom, handleZoomChange]);

  // -------- 드래그/터치로 Y 이동 ----------
  const handleTouchStart = useCallback(
    (e) => {
      const touches = e.touches;
      if (touches.length === 1) {
        if (zoom > Math.min(1, minScaleRef.current)) {
          touchState.current.isDragging = true;
        }
        touchState.current.lastTouchY = touches[0].clientY;
      }
    },
    [zoom]
  );

  const handleTouchMove = useCallback(
    (e) => {
      if (!touchState.current.isDragging) return;

      const touches = e.touches;
      if (touches.length === 1) {
        const deltaY = touches[0].clientY - touchState.current.lastTouchY;
        let newTranslateY = touchState.current.translateY + deltaY;

        newTranslateY = clampTranslateY(newTranslateY, zoom);

        touchState.current.translateY = newTranslateY;
        touchState.current.lastTouchY = touches[0].clientY;

        applyCanvasTransform(zoom, newTranslateY, false);
      }
    },
    [zoom, applyCanvasTransform, clampTranslateY]
  );

  const handleTouchEnd = useCallback(() => {
    touchState.current.isDragging = false;
  }, []);

  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();

      if (zoom > Math.min(1, minScaleRef.current)) {
        mouseState.current.isDragging = true;
      }
      mouseState.current.lastMouseY = e.clientY;
    },
    [zoom]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!mouseState.current.isDragging) return;

      const deltaY = e.clientY - mouseState.current.lastMouseY;
      let newTranslateY = touchState.current.translateY + deltaY;

      newTranslateY = clampTranslateY(newTranslateY, zoom);

      touchState.current.translateY = newTranslateY;
      mouseState.current.lastMouseY = e.clientY;

      applyCanvasTransform(zoom, newTranslateY, false);
    },
    [zoom, applyCanvasTransform, clampTranslateY]
  );

  const handleMouseUp = useCallback(() => {
    mouseState.current.isDragging = false;
  }, []);

  // -------- 페이지 렌더링 ----------
  const renderPage = useCallback(
    async (doc, num) => {
      if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current)
        return;

      try {
        renderedRef.current = true;

        const page = await doc.getPage(num);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { alpha: false });

        const { width: containerWidth, height: containerHeight } = getContainerSize();
        const baseViewport = page.getViewport({ scale: 1 });

        // 컨테이너 폭에 맞춰 CSS 사이즈 결정
        const fitWidthScale = containerWidth / baseViewport.width;

        const cssWidth = containerWidth;
        const cssHeight = baseViewport.height * fitWidthScale;

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        // 컨테이너가 더 커도 minScale이 1을 넘어가지 않게 보정
        const minZoomFitHeight = containerHeight / cssHeight;
        minScaleRef.current = Math.min(
          1,
          Math.max(MIN_ZOOM_HARD_CAP, minZoomFitHeight)
        );

        // 실제 렌더링 해상도 (품질)
        const isMobile = window.innerWidth <= 768;
        const qualityMultiplier = isMobile ? 3.0 : 4.0;
        const renderScale = fitWidthScale * qualityMultiplier;
        const renderViewport = page.getViewport({ scale: renderScale });

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);

        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page
          .render({
            canvasContext: ctx,
            viewport: renderViewport,
            intent: "display",
            renderInteractiveForms: false
          })
          .promise;

        const initialZoom = 1.0;
        const initialTranslateY = 0;

        touchState.current.translateY = initialTranslateY;
        setZoom(initialZoom);

        applyCanvasTransform(initialZoom, initialTranslateY, false);
      } catch (error) {
        console.error("PDF 렌더링 오류:", error);
      } finally {
        setTimeout(() => {
          renderedRef.current = false;
        }, 100);
      }
    },
    [applyCanvasTransform]
  );

  const renderFirstPage = useCallback(
    async (doc) => {
      if (!doc) return;
      await renderPage(doc, 1);
    },
    [renderPage]
  );

  // -------- PDF 로드 ----------
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

  // -------- 키/휠 등 전역 이벤트 ----------
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

    // 브라우저 전역 줌(CTRL/⌘ + 휠) 차단
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
    };
  }, [open, onClose, loading, handleMouseMove, handleMouseUp]);

  if (!open) return null;

  const maxScale = 1.0;
  const minScale = Math.min(1, minScaleRef.current);

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading && !mouseState.current.isDragging) {
          onClose();
        }
      }}
      className="pdf-modal-root"
    >
      <div
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={headerStyle}>
          <div
            style={{
              fontWeight: 800,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
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
                cursor: zoom <= minScale ? "not-allowed" : "pointer"
              }}
            >
              −
            </button>
            <span style={{ fontSize: "12px", fontWeight: 600, minWidth: "45px", textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= maxScale}
              style={{
                ...zoomBtnStyle,
                opacity: zoom >= maxScale ? 0.3 : 1,
                cursor: zoom >= maxScale ? "not-allowed" : "pointer"
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
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "50px",
                    height: "50px",
                    border: "4px solid #333",
                    borderTop: "4px solid var(--primary)",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite"
                  }}
                ></div>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--ink)" }}>불러오는 중</div>
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
                // 브라우저 제스처는 끄고(우리가 처리), 드래그 느낌 유지
                touchAction: "none",
                cursor:
                  mouseState.current.isDragging || touchState.current.isDragging ? "grabbing" : "grab"
              }}
            />
          )}
        </div>

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
            >
              ← 이전
            </button>
            <span style={{ fontWeight: 700 }}>
              Page {pageNum} / {numPages}
            </span>
            <button
              style={{ ...navBtnStyle, opacity: renderedRef.current || pageNum >= numPages ? 0.5 : 1 }}
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
  zIndex: 9999
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
  overflow: "hidden", // ⬅️ auto → hidden (브라우저 스크롤 제거)
  padding: "15px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
  touchAction: "none" // ⬅️ 기본 제스처 제거(우리가 처리)
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

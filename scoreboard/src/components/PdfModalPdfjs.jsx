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

  // 진행바 갱신용 더미 렌더 트리거
  const [, forceRender] = useState(0);
  const tick = useCallback(() => forceRender(v => v + 1), []);

  // ---------- utils: 컨테이너 패딩 고려한 내부 크기 ----------
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

  const getContainerSize = () => {
    if (!holderRef.current) return { width: 600, height: 400, padX: 0, padY: 0 };
    return getInnerSize(holderRef.current);
  };

  // ---------- Y 이동 클램프(여백 밑 노출 방지) ----------
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

  // ---------- 변환 적용(X 중앙 고정 + 주어진 Y) ----------
  const applyCanvasTransform = useCallback((currentZoom, translateY, withTransition = true) => {
    const canvas = canvasRef.current;
    const container = holderRef.current;
    if (!canvas || !container) return;

    const { width: containerWidth } = getInnerSize(container);
    const baseCssWidth = parseFloat(canvas.style.width) || 0; // transform 전 CSS 폭
    const scaledWidth = baseCssWidth * currentZoom;
    const translateX = (containerWidth - scaledWidth) / 2;    // 항상 X 중앙

    canvas.style.setProperty("transform-origin", "top left", "important");
    canvas.style.setProperty("transform", `translate(${translateX}px, ${translateY}px) scale(${currentZoom})`, "important");
    canvas.style.setProperty("transition", withTransition ? "transform 0.18s ease" : "none", "important");
  }, []);

  // ---------- 위치 진행바 비율(0~1) ----------
  const progressRatio = useCallback(() => {
    const canvas = canvasRef.current;
    const holder = holderRef.current;
    if (!canvas || !holder) return 0;
    const { height: h } = getInnerSize(holder);
    const baseCssHeight = parseFloat(canvas.style.height || "0");
    const scaled = baseCssHeight * zoom;
    if (!scaled || scaled <= h) return 0; // 스크롤 불필요
    const minY = h - scaled;              // 최하단 translateY
    const curY = touchState.current.translateY; // [minY, 0]
    // curY: minY→0  ⇒ ratio: 1→0  (위에 있을수록 0, 아래로 갈수록 1)
    return Math.min(1, Math.max(0, 1 - (curY - minY) / (0 - minY)));
  }, [zoom]);

  // ---------- 확대/축소 (뷰포트 Y-중앙 유지) ----------
  const handleZoomChange = useCallback((nextZoomRaw) => {
    const container = holderRef.current;
    const canvas = canvasRef.current;

    // minScale은 절대 1.0을 넘지 않음(컨테이너가 더 커도 100% 이하 축소만 허용)
    const minAllowed = Math.min(1, minScaleRef.current);
    const newZoom = Math.max(minAllowed, Math.min(1.0, nextZoomRaw));

    if (!container || !canvas) {
      const clampedY = clampTranslateY(0, newZoom);
      touchState.current.translateY = clampedY;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, clampedY, true);
      tick();
      return;
    }

    const { height: containerHeight } = getInnerSize(container);
    const baseCssHeight = parseFloat(canvas.style.height) || 0;
    if (!baseCssHeight) {
      touchState.current.translateY = 0;
      setZoom(newZoom);
      applyCanvasTransform(newZoom, 0, true);
      tick();
      return;
    }

    const oldScaled = baseCssHeight * zoom;
    const newScaled = baseCssHeight * newZoom;

    // 현재 뷰포트 중앙의 문서좌표 계산(구 스케일 기준)
    const viewportCenterY = containerHeight / 2;
    const currentTranslateY = touchState.current.translateY;
    let docY = viewportCenterY - currentTranslateY;
    docY = Math.max(0, Math.min(oldScaled, docY)); // 안전 범위

    // 같은 비율 지점을 신 스케일에서 유지
    const ratio = oldScaled > 0 ? (docY / oldScaled) : 0;
    const newDocY = ratio * newScaled;

    // 새 translateY = 뷰포트중앙 - 새 문서좌표
    let newTranslateY = viewportCenterY - newDocY;
    newTranslateY = clampTranslateY(newTranslateY, newZoom);

    touchState.current.translateY = newTranslateY;
    setZoom(newZoom);
    applyCanvasTransform(newZoom, newTranslateY, true);
    tick();
  }, [zoom, applyCanvasTransform, clampTranslateY, tick]);

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

  // ---------- 가상 스크롤(휠/트랙패드) ----------
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) return; // 브라우저 줌은 전역에서 차단 중
    e.preventDefault();

    const step = e.deltaY; // 트랙패드/휠 모두 들어옴
    let ty = touchState.current.translateY - step;
    ty = clampTranslateY(ty, zoom);

    touchState.current.translateY = ty;
    applyCanvasTransform(zoom, ty, false);
    tick();
  }, [zoom, applyCanvasTransform, clampTranslateY, tick]);

  // ---------- 드래그/터치로 Y 이동 ----------
  const handleTouchStart = useCallback((e) => {
    const t = e.touches;
    if (t.length === 1) {
      if (zoom > Math.min(1, minScaleRef.current)) {
        touchState.current.isDragging = true;
      }
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

  const handleTouchEnd = useCallback(() => {
    touchState.current.isDragging = false;
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    if (zoom > Math.min(1, minScaleRef.current)) {
      mouseState.current.isDragging = true;
    }
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

  const handleMouseUp = useCallback(() => {
    mouseState.current.isDragging = false;
  }, []);

  // ---------- 페이지 렌더링 ----------
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;

    try {
      renderedRef.current = true;

      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: containerWidth, height: containerHeight } = getContainerSize();
      const baseViewport = page.getViewport({ scale: 1 });

      // 폭 맞춤
      const fitWidthScale = containerWidth / baseViewport.width;

      const cssWidth = containerWidth;
      const cssHeight = baseViewport.height * fitWidthScale;

      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      // minScale 보정(절대 1.0 초과 금지)
      const minZoomFitHeight = containerHeight / cssHeight;
      minScaleRef.current = Math.min(1, Math.max(MIN_ZOOM_HARD_CAP, minZoomFitHeight));

      // 실제 렌더 해상도(품질)
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

      const initialZoom = 1.0;
      const initialTranslateY = 0;

      touchState.current.translateY = initialTranslateY;
      setZoom(initialZoom);
      applyCanvasTransform(initialZoom, initialTranslateY, false);
      tick(); // 진행바 초기화
    } catch (error) {
      console.error("PDF 렌더링 오류:", error);
    } finally {
      setTimeout(() => {
        renderedRef.current = false;
      }, 100);
    }
  }, [applyCanvasTransform, tick]);

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
          disableFontFace: false
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

  // ---------- 전역 키/휠 등 ----------
  useEffect(() => {
    if (!open) return;

    const handler = (e) => {
      // 닫기 & 인쇄 차단
      if (e.key === "Escape" && !loading) onClose();
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault(); e.stopPropagation();
      }

      // 키보드 스크롤
      const unit = 60;      // Arrow 이동량
      const pageUnit = 400; // PageUp/Down 이동량
      const minAllowed = Math.min(1, minScaleRef.current);
      if (zoom <= minAllowed) return; // 축소 한계면 이동 불필요

      let moved = false;
      let ty = touchState.current.translateY;

      switch (e.key) {
        case "ArrowDown": ty = clampTranslateY(ty - unit, zoom); moved = true; break;
        case "ArrowUp":   ty = clampTranslateY(ty + unit, zoom); moved = true; break;
        case "PageDown":  ty = clampTranslateY(ty - pageUnit, zoom); moved = true; break;
        case "PageUp":    ty = clampTranslateY(ty + pageUnit, zoom); moved = true; break;
        case "Home":      ty = clampTranslateY(0, zoom); moved = true; break;
        case "End": {
          const canvas = canvasRef.current;
          const { height: h } = getInnerSize(holderRef.current);
          const baseCssHeight = parseFloat(canvas?.style.height || "0");
          const scaled = baseCssHeight * zoom;
          ty = clampTranslateY(h - scaled, zoom);
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
  }, [open, onClose, loading, handleMouseMove, handleMouseUp, applyCanvasTransform, clampTranslateY, zoom, tick]);

  if (!open) return null;

  const maxScale = 1.0;
  const minScale = Math.min(1, minScaleRef.current);
  const pr = progressRatio(); // 진행바 퍼센트(0~1)

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
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={handleZoomOut}
              disabled={zoom <= minScale}
              style={{ ...zoomBtnStyle, opacity: zoom <= minScale ? 0.3 : 1, cursor: zoom <= minScale ? "not-allowed" : "pointer" }}
            >
              −
            </button>
            <span style={{ fontSize: "12px", fontWeight: 600, minWidth: "45px", textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= maxScale}
              style={{ ...zoomBtnStyle, opacity: zoom >= maxScale ? 0.3 : 1, cursor: zoom >= maxScale ? "not-allowed" : "pointer" }}
            >
              +
            </button>
          </div>

          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">✕</button>
        </div>

        {/* 뷰어(네이티브 스크롤 없음, 가상 스크롤 onWheel) */}
        <div ref={holderRef} style={viewerStyleScrollable} onWheel={handleWheel}>
          {loading && (
            <div style={centerStyle}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "50px", height: "50px",
                    border: "4px solid #333", borderTop: "4px solid var(--primary)",
                    borderRadius: "50%", animation: "spin 1s linear infinite"
                  }}
                />
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
                touchAction: "none", // 제스처는 우리가 처리
                cursor: mouseState.current.isDragging || touchState.current.isDragging ? "grabbing" : "grab"
              }}
            />
          )}
        </div>

        {/* 위치 진행바(오른쪽 얇은 바) */}
        <div style={{
          position: "absolute",
          top: 56, bottom: 56, right: 6,
          width: 4,
          background: "rgba(255,255,255,0.08)",
          borderRadius: 2,
          pointerEvents: "none"
        }}>
          <div style={{
            width: "100%",
            height: `${Math.max(8, pr * 100)}%`, // 최소 8px 느낌
            background: "rgba(126,162,255,0.9)",
            borderRadius: 2,
            transition: "height .08s linear"
          }} />
        </div>

        {/* 페이지 네비게이션 */}
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
            >
              다음 →
            </button>
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
  overflow: "hidden",  // 네이티브 스크롤 제거
  padding: "15px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
  touchAction: "none"  // 제스처는 우리가 처리
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

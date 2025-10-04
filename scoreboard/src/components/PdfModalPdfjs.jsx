// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  // --- 설정 ---
  const MIN_ZOOM_HARD_CAP = 0.1;  // 최소 배율 하드캡(먹통 방지)
  const MAX_ZOOM = 1.0;           // 최대 100%(가로맞춤)

  // --- refs ---
  const holderRef = useRef(null); // 스크롤 영역(overflow hidden, 휠로 이동)
  const stageRef  = useRef(null); // Y-translate 전용
  const scaledRef = useRef(null); // X-중앙 + scale
  const canvasRef = useRef(null);

  const lastKeyRef   = useRef(null);
  const renderedRef  = useRef(false);
  const minScaleRef  = useRef(MIN_ZOOM_HARD_CAP); // 동적 하한 (필요 시만 수정)
  const baseCssWRef  = useRef(0); // zoom=1 기준 CSS 폭
  const baseCssHRef  = useRef(0); // zoom=1 기준 CSS 높이

  // --- state ---
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.0);

  // 입력 상태
  const touchState = useRef({ isDragging: false, lastY: 0, translateY: 0 });
  const mouseState = useRef({ isDragging: false, lastY: 0 });

  // 진행 썸 상태 (우측 작은 스크롤바)
  const [progress, setProgress] = useState({ show:false, thumbH:0, thumbTop:0 });

  // ---------- 컨테이너 내부 사이즈(패딩 제외) ----------
  const getInnerBox = useCallback(() => {
    const el = holderRef.current;
    if (!el) return { innerW: 600, innerH: 400 };
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
    const padY = parseFloat(cs.paddingTop  || "0") + parseFloat(cs.paddingBottom || "0");
    return {
      innerW: Math.max(320, el.clientWidth  - padX),
      innerH: Math.max(300, el.clientHeight - padY),
    };
  }, []);

  // ---------- 세로 이동 클램프 ----------
  const clampTranslateY = useCallback((ty, z) => {
    const { innerH } = getInnerBox();
    const scaledH = baseCssHRef.current * z;
    if (scaledH <= innerH + 0.5) return 0; // 한 화면이면 이동 불필요
    const minY = innerH - scaledH; // 음수
    return Math.max(minY, Math.min(0, ty));
  }, [getInnerBox]);

  // ---------- 진행 썸 갱신(translateY, zoom 기반) ----------
  const updateProgress = useCallback((ty, z) => {
    const { innerH } = getInnerBox();
    const scaledH = baseCssHRef.current * z;
    if (scaledH <= innerH + 0.5) {
      setProgress(p => (p.show ? { show:false, thumbH:0, thumbTop:0 } : p));
      return;
    }
    const minY = innerH - scaledH;            // 음수
    const travel = 0 - minY;                  // 전체 이동 가능 거리(양수)
    const offset = 0 - ty;                    // 현재 위에서부터 이동(양수)
    const ratio = travel > 0 ? offset / travel : 0; // 0~1

    const trackH = innerH - 30;               // 상/하 여백 조금 띄움(시각)
    const minThumb = 24;
    const visibleRatio = innerH / scaledH;
    const thumbH = Math.max(minThumb, Math.round(trackH * visibleRatio));
    const thumbTop = Math.round((trackH - thumbH) * ratio) + 15;

    setProgress({ show:true, thumbH, thumbTop });
  }, [getInnerBox]);

  // ---------- 변환 적용: stage(Y), scaled(X+scale) ----------
  const applyTransforms = useCallback((z, ty, withTransition = false) => {
    const stage  = stageRef.current;
    const scaled = scaledRef.current;
    if (!stage || !scaled) return;

    // 1) 세로 이동
    stage.style.setProperty("transform", `translateY(${ty}px)`, "important");
    stage.style.setProperty("transition", withTransition ? "transform .16s ease" : "none", "important");

    // 2) 가로 중앙 + 스케일
    const { innerW } = getInnerBox();
    const scaledW = baseCssWRef.current * z;
    const tx = (innerW - scaledW) / 2; // 항상 가운데
    scaled.style.setProperty("transform-origin", "top left", "important");
    scaled.style.setProperty("transform", `translateX(${tx}px) scale(${z})`, "important");
    scaled.style.setProperty("transition", withTransition ? "transform .16s ease" : "none", "important");
  }, [getInnerBox]);

  const syncApply = useCallback((z, ty, withTransition = false) => {
    applyTransforms(z, ty, withTransition);
    updateProgress(ty, z); // ✅ 변환 적용할 때마다 진행 썸 갱신
  }, [applyTransforms, updateProgress]);

  // ---------- 줌 변경(현재 시야 중앙 고정) ----------
  const handleZoomChange = useCallback((nextZoomRaw) => {
    const newZoom = Math.min(MAX_ZOOM, Math.max(minScaleRef.current, nextZoomRaw));
    const { innerH } = getInnerBox();

    const oldScaledH = baseCssHRef.current * zoom;
    const newScaledH = baseCssHRef.current * newZoom;

    const viewportCenter = innerH / 2;
    const oldTY = touchState.current.translateY;
    const oldDocY = viewportCenter - oldTY;                            // 문서 좌표
    const ratio  = oldScaledH > 0 ? Math.min(1, Math.max(0, oldDocY / oldScaledH)) : 0.5;
    const newDocY = ratio * newScaledH;
    let newTY = viewportCenter - newDocY;
    newTY = clampTranslateY(newTY, newZoom);

    touchState.current.translateY = newTY;
    setZoom(newZoom);
    syncApply(newZoom, newTY, true);
  }, [zoom, clampTranslateY, getInnerBox, syncApply]);

  const handleZoomIn  = useCallback(() => handleZoomChange(Math.round((zoom + 0.1) * 100) / 100), [zoom, handleZoomChange]);
  const handleZoomOut = useCallback(() => handleZoomChange(Math.round((zoom - 0.1) * 100) / 100), [zoom, handleZoomChange]);

  // ---------- 터치/마우스 드래그 ----------
  const onTouchStart = useCallback((e) => {
    const t = e.touches;
    if (t.length !== 1) return;
    touchState.current.isDragging = true;
    touchState.current.lastY = t[0].clientY;
  }, []);
  const onTouchMove = useCallback((e) => {
    if (!touchState.current.isDragging) return;
    const t = e.touches;
    if (t.length !== 1) return;
    const dy = t[0].clientY - touchState.current.lastY;
    let ty = touchState.current.translateY + dy;
    ty = clampTranslateY(ty, zoom);
    touchState.current.translateY = ty;
    touchState.current.lastY = t[0].clientY;
    syncApply(zoom, ty, false);
  }, [zoom, clampTranslateY, syncApply]);
  const onTouchEnd = useCallback(() => { touchState.current.isDragging = false; }, []);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    mouseState.current.isDragging = true;
    mouseState.current.lastY = e.clientY;
  }, []);
  const onMouseMove = useCallback((e) => {
    if (!mouseState.current.isDragging) return;
    const dy = e.clientY - mouseState.current.lastY;
    let ty = touchState.current.translateY + dy;
    ty = clampTranslateY(ty, zoom);
    touchState.current.translateY = ty;
    mouseState.current.lastY = e.clientY;
    syncApply(zoom, ty, false);
  }, [zoom, clampTranslateY, syncApply]);
  const onMouseUp = useCallback(() => { mouseState.current.isDragging = false; }, []);

  // ---------- 휠 스크롤(Y 이동) ----------
  useEffect(() => {
    if (!open || !holderRef.current) return;
    const el = holderRef.current;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return; // 브라우저 줌은 전역에서 따로 차단
      e.preventDefault();
      let ty = touchState.current.translateY - e.deltaY;
      ty = clampTranslateY(ty, zoom);
      touchState.current.translateY = ty;
      syncApply(zoom, ty, false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel, { passive: false });
  }, [open, zoom, clampTranslateY, syncApply]);

  // ---------- 전역 키보드 ----------
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !loading) onClose();
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) { e.preventDefault(); e.stopPropagation(); }
      const unit = 60, pageUnit = 400;
      let moved = false;
      let ty = touchState.current.translateY;
      switch (e.key) {
        case "ArrowDown": ty = clampTranslateY(ty - unit, zoom); moved = true; break;
        case "ArrowUp":   ty = clampTranslateY(ty + unit, zoom); moved = true; break;
        case "PageDown":  ty = clampTranslateY(ty - pageUnit, zoom); moved = true; break;
        case "PageUp":    ty = clampTranslateY(ty + pageUnit, zoom); moved = true; break;
        case "Home":      ty = clampTranslateY(0, zoom); moved = true; break;
        case "End": {
          const { innerH } = getInnerBox();
          const scaledH = baseCssHRef.current * zoom;
          ty = clampTranslateY(innerH - scaledH, zoom);
          moved = true;
          break;
        }
        default: break;
      }
      if (moved) {
        e.preventDefault();
        touchState.current.translateY = ty;
        syncApply(zoom, ty, false);
      }
    };

    // 브라우저 줌 차단
    const preventPageZoom = (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("wheel", preventPageZoom, { passive: false, capture: true });

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("wheel", preventPageZoom, { capture: true });
    };
  }, [open, onMouseMove, onMouseUp, clampTranslateY, syncApply, getInnerBox, zoom, loading, onClose]);

  // ---------- 페이지 렌더 ----------
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;

    try {
      renderedRef.current = true;

      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { innerW } = getInnerBox();
      const baseViewport = page.getViewport({ scale: 1 });

      // zoom=1에서 가로 꽉차게
      const fitWidthScale = innerW / baseViewport.width;
      const cssW = innerW;
      const cssH = baseViewport.height * fitWidthScale;

      baseCssWRef.current = cssW;
      baseCssHRef.current = cssH;

      // CSS 기준 크기
      canvas.style.width  = `${Math.round(cssW)}px`;
      canvas.style.height = `${Math.round(cssH)}px`;

      // 렌더 해상도 (고품질)
      const isMobile = window.innerWidth <= 768;
      const q = isMobile ? 3.0 : 4.0;
      const renderScale = fitWidthScale * q;
      const renderViewport = page.getViewport({ scale: renderScale });

      canvas.width  = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);

      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport: renderViewport,
        intent: "display",
        renderInteractiveForms: false
      }).promise;

      // 하한은 하드캡만
      minScaleRef.current = MIN_ZOOM_HARD_CAP;

      // 초기 상태: 100%, 맨 위
      touchState.current.translateY = 0;
      setZoom(1.0);
      syncApply(1.0, 0, false);
    } catch (err) {
      console.error("PDF 렌더 오류:", err);
    } finally {
      setTimeout(() => { renderedRef.current = false; }, 100);
    }
  }, [getInnerBox, syncApply]);

  const renderFirstPage = useCallback(async (doc) => { if (doc) await renderPage(doc, 1); }, [renderPage]);

  // ---------- PDF 로드 ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !filePath || !sid) { renderedRef.current = false; return; }
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

        const functions = getFunctions(undefined, "asia-northeast3");
        const serve = httpsCallable(functions, "serveWatermarkedPdf");

        const res = await serve({ filePath, sid }).catch((e) => {
          const msg = (e?.message || "").toLowerCase();
          if (msg.includes("internal") || msg.includes("500")) {
            throw new Error("서버(PDF 생성) 내부 오류(500). 파일 경로/권한/서버 로그를 확인하세요.");
          }
          throw e;
        });

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

        await renderFirstPage(doc);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; renderedRef.current = false; };
  }, [open, filePath, sid, pdfDoc, renderFirstPage]);

  if (!open) return null;

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

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={handleZoomOut} style={zoomBtnStyle}>−</button>
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 45, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={handleZoomIn} disabled={zoom >= MAX_ZOOM}
              style={{ ...zoomBtnStyle, opacity: zoom >= MAX_ZOOM ? 0.3 : 1, cursor: zoom >= MAX_ZOOM ? "not-allowed" : "pointer" }}>
              +
            </button>
          </div>

          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">✕</button>
        </div>

        {/* 뷰어: stage(Y) → scaled(X+scale) → canvas */}
        <div ref={holderRef} style={viewerStyle}>
          <div ref={stageRef} style={stageStyle}>
            <div ref={scaledRef} style={scaledStyle}>
              {loading && (
                <div style={centerStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 50, height: 50, border: '4px solid #333', borderTop: '4px solid var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>불러오는 중</div>
                  </div>
                </div>
              )}
              {err && <div style={{ ...centerStyle, color: "var(--bad)" }}>{String(err)}</div>}
              {!loading && !err && (
                <canvas
                  ref={canvasRef}
                  onTouchStart={onTouchStart}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                  onMouseDown={onMouseDown}
                  onMouseLeave={onMouseUp}
                  style={{
                    display: "block",
                    userSelect: "none",
                    maxWidth: "100%",
                    maxHeight: "none",
                    objectFit: "contain",
                    imageRendering: "high-quality",
                    touchAction: "none",
                    cursor: mouseState.current.isDragging || touchState.current.isDragging ? 'grabbing' : 'grab',
                  }}
                />
              )}
            </div>
          </div>

          {/* 우측 진행 썸(작은 스크롤바) */}
          {progress.show && (
            <div style={progressWrap}>
              <div style={progressTrack} />
              <div style={{ ...progressThumb, height: `${progress.thumbH}px`, transform: `translateY(${progress.thumbTop}px)` }} />
            </div>
          )}
        </div>

        {/* 페이지 네비(여러 페이지일 때) */}
        {numPages > 1 && !loading && (
          <div style={footerStyle}>
            <button
              style={navBtnStyle}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum <= 1) return;
                const prev = pageNum - 1;
                setPageNum(prev);
                await renderPage(pdfDoc, prev);
              }}
            >← 이전</button>
            <span style={{ fontWeight: 700 }}>Page {pageNum} / {numPages}</span>
            <button
              style={navBtnStyle}
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
  gap: 12,
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
  minWidth: 32,
  height: 32,
};

const viewerStyle = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "hidden",
  padding: "15px",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  justifyContent: "flex-start",
  touchAction: "none",
  overscrollBehavior: "contain",
};

// 세로 이동 전용(stage)
const stageStyle = {
  position: "relative",
  willChange: "transform",
  minHeight: 0,
};

// 가로 중앙 + scale 전용(scaled)
const scaledStyle = {
  position: "relative",
  willChange: "transform",
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

// 진행 썸(우측 작은 스크롤바)
const progressWrap = {
  position: "absolute",
  top: 15,
  bottom: 15,
  right: 6,
  width: 8,
  pointerEvents: "none",
  zIndex: 2,
};
const progressTrack = {
  position: "absolute",
  top: 0,
  bottom: 0,
  right: 0,
  width: 4,
  background: "rgba(255,255,255,0.10)",
  borderRadius: 2,
};
const progressThumb = {
  position: "absolute",
  right: 0,
  width: 4,
  background: "rgba(126,162,255,0.95)",
  borderRadius: 2,
  boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
  pointerEvents: "none",
  userSelect: "none",
  willChange: "transform,height",
};

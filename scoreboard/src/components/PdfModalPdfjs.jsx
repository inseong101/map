// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const MIN_ZOOM_HARD_CAP = 0.1;

  const holderRef = useRef(null);
  const wrapperRef = useRef(null); // 레이아웃 높이를 줌에 맞게 바꿔 줄 래퍼
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

  // 진행바 DOM
  const thumbRef = useRef(null);
  const trackRef = useRef(null);

  const mouseDrag = useRef({ active: false, lastY: 0 });

  const getInnerSize = (el) => {
    if (!el) return { width: 600, height: 400, padX: 0, padY: 0 };
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
    const padY = parseFloat(cs.paddingTop || "0") + parseFloat(cs.paddingBottom || "0");
    return {
      width: Math.max(320, Math.floor(rect.width - padX)),
      height: Math.max(300, Math.floor(rect.height - padY)),
      padX, padY,
    };
  };

  const applyLayoutForZoom = useCallback((z) => {
    const holder = holderRef.current;
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!holder || !wrapper || !canvas) return;

    const { width: vw } = getInnerSize(holder);
    const baseCssWidth = parseFloat(canvas.style.width || "0");   // 렌더 직후 세팅됨
    const baseCssHeight = parseFloat(canvas.style.height || "0"); // 렌더 직후 세팅됨

    // 래퍼의 높이를 "실제 스크롤 높이"로 사용 (네이티브 스크롤)
    wrapper.style.height = `${baseCssHeight * z}px`;
    wrapper.style.width = "100%";
    wrapper.style.position = "relative";

    // 캔버스는 래퍼 안에서 스케일로만 키우고 (레이아웃엔 영향 X),
    // 좌우는 가운데 정렬되도록 left를 계산
    const scaledW = baseCssWidth * z;
    const left = (vw - scaledW) / 2;
    canvas.style.position = "absolute";
    canvas.style.top = "0px";
    canvas.style.left = `${left}px`;
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = `scale(${z})`;
    canvas.style.transition = "transform 0.18s ease"; // 줌 애니메이션
  }, []);

  // 진행바 업데이트
  const updateThumb = useCallback(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    const thumb = thumbRef.current;
    const track = trackRef.current;
    if (!holder || !canvas || !thumb || !track) return;

    const { height: viewH } = getInnerSize(holder);
    const baseCssHeight = parseFloat(canvas.style.height || "0");
    const scrollH = baseCssHeight * zoom; // wrapper height
    if (!scrollH || scrollH <= viewH + 0.5) {
      track.style.opacity = "0";
      thumb.style.opacity = "0";
      return;
    }
    track.style.opacity = "1";
    thumb.style.opacity = "1";

    const MIN_THUMB = 18;
    const thumbH = Math.max(MIN_THUMB, Math.round((viewH / scrollH) * viewH));
    thumb.style.height = `${thumbH}px`;

    const maxScroll = scrollH - viewH;
    const ratio = Math.min(1, Math.max(0, holder.scrollTop / maxScroll));
    const travel = Math.max(0, viewH - thumbH);
    thumb.style.transform = `translateY(${Math.round(travel * ratio)}px)`;
  }, [zoom]);

  // 줌 변경 (뷰포트 중앙 고정)
  const changeZoom = useCallback((nextZoomRaw) => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;

    const minAllowed = Math.min(1, Math.max(MIN_ZOOM_HARD_CAP, minScaleRef.current));
    const newZoom = Math.max(minAllowed, Math.min(1.0, nextZoomRaw));

    const { height: viewH } = getInnerSize(holder);
    const baseCssHeight = parseFloat(canvas.style.height || "0");
    const oldZoom = zoom;

    // 현재 뷰포트 중앙의 문서 좌표(베이스 좌표계)
    const centerDocY = (holder.scrollTop + viewH / 2) / oldZoom;

    setZoom(newZoom);
    applyLayoutForZoom(newZoom);

    // 새 줌 기준 중앙이 같은 문서 좌표를 바라보도록 scrollTop 재계산
    const newScrollTop = Math.max(
      0,
      Math.min(centerDocY * newZoom - viewH / 2, baseCssHeight * newZoom - viewH)
    );
    holder.scrollTop = newScrollTop;

    // 진행바 갱신
    requestAnimationFrame(updateThumb);
  }, [zoom, applyLayoutForZoom, updateThumb]);

  const handleZoomIn = useCallback(() => {
    changeZoom(Math.round((zoom + 0.1) * 100) / 100);
  }, [zoom, changeZoom]);

  const handleZoomOut = useCallback(() => {
    changeZoom(Math.round((zoom - 0.1) * 100) / 100);
  }, [zoom, changeZoom]);

  // 페이지 렌더
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
    try {
      renderedRef.current = true;

      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: vw, height: vh } = getInnerSize(holderRef.current);
      const baseViewport = page.getViewport({ scale: 1 });

      // 뷰 너비에 맞추는 기본 비율
      const fitWidthScale = vw / baseViewport.width;
      const cssWidth = vw;
      const cssHeight = baseViewport.height * fitWidthScale;

      // CSS 레이아웃 크기(줌=1 기준)
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

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

      // 최소 줌: 문서가 뷰 높이보다 길면 "화면높이에 맞춤"까지 축소 허용,
      // 짧으면 하드캡(0.1)까지 허용
      const fitHeightMin = vh / cssHeight;
      minScaleRef.current = fitHeightMin < 1 ? Math.max(MIN_ZOOM_HARD_CAP, fitHeightMin) : MIN_ZOOM_HARD_CAP;

      // 초기 배치
      setZoom(1.0);
      applyLayoutForZoom(1.0);
      holderRef.current.scrollTop = 0;
      requestAnimationFrame(updateThumb);
    } catch (e) {
      console.error("PDF 렌더링 오류:", e);
    } finally {
      setTimeout(() => { renderedRef.current = false; }, 100);
    }
  }, [applyLayoutForZoom, updateThumb]);

  const renderFirstPage = useCallback(async (doc) => {
    if (!doc) return;
    await renderPage(doc, 1);
  }, [renderPage]);

  // PDF 로드
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

  // 스크롤 시 진행바 업데이트
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const onScroll = () => updateThumb();
    holder.addEventListener("scroll", onScroll, { passive: true });
    return () => holder.removeEventListener("scroll", onScroll);
  }, [updateThumb]);

  // 마우스 드래그로 스크롤(네이티브 scrollTop 사용)
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    mouseDrag.current.active = true;
    mouseDrag.current.lastY = e.clientY;
    e.preventDefault();
  }, []);
  const onMouseMove = useCallback((e) => {
    if (!mouseDrag.current.active) return;
    const holder = holderRef.current;
    if (!holder) return;
    const dy = e.clientY - mouseDrag.current.lastY;
    mouseDrag.current.lastY = e.clientY;
    holder.scrollTop -= dy; // 드래그 방향대로 스크롤
  }, []);
  const onMouseUp = useCallback(() => { mouseDrag.current.active = false; }, []);

  // 키보드 스크롤
  useEffect(() => {
    if (!open) return;
    const holder = holderRef.current;
    if (!holder) return;

    const onKey = (e) => {
      if (e.key === "Escape" && !loading) onClose();
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) { e.preventDefault(); e.stopPropagation(); }

      const unit = 60, pageUnit = 400;
      let handled = true;
      switch (e.key) {
        case "ArrowDown": holder.scrollTop += unit; break;
        case "ArrowUp":   holder.scrollTop -= unit; break;
        case "PageDown":  holder.scrollTop += pageUnit; break;
        case "PageUp":    holder.scrollTop -= pageUnit; break;
        case "Home":      holder.scrollTop = 0; break;
        case "End":       holder.scrollTop = holder.scrollHeight; break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); updateThumb(); }
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose, loading, updateThumb]);

  // 리사이즈 시 레이아웃/썸 재계산
  useEffect(() => {
    const onResize = () => {
      applyLayoutForZoom(zoom);
      updateThumb();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [zoom, applyLayoutForZoom, updateThumb]);

  if (!open) return null;

  const maxScale = 1.0;
  const minScale = Math.min(1, Math.max(MIN_ZOOM_HARD_CAP, minScaleRef.current));

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
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

          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">✕</button>
        </div>

        {/* 뷰어(네이티브 스크롤, 스크롤바는 CSS로 숨김) */}
        <div
          ref={holderRef}
          className="scrollHost"
          style={viewerStyle}
          onScroll={updateThumb}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {/* 진행바(오버레이) */}
          <div style={progressWrapStyle} ref={trackRef}>
            <div style={progressTrackStyle} />
            <div style={progressThumbStyle} ref={thumbRef} />
          </div>

          {/* 높이를 줌에 맞게 바꿔주는 래퍼 안에 캔버스 */}
          <div ref={wrapperRef} style={{ width: "100%", position: "relative" }}>
            <canvas
              ref={canvasRef}
              style={{
                display: "block",
                margin: "0 auto",
                userSelect: "none",
                imageRendering: "high-quality"
              }}
            />
          </div>

          {loading && (
            <div style={centerStyle}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "50px", height: "50px",
                  border: "4px solid #333", borderTop: "4px solid var(--primary)",
                  borderRadius: "50%", animation: "spin 1s linear infinite"
                }} />
                <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--ink)" }}>불러오는 중</div>
              </div>
            </div>
          )}
          {err && <div style={{ ...centerStyle, color: "var(--bad)" }}>{String(err)}</div>}
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

      {/* 스크롤바 숨김 (글로벌) */}
      <style jsx global>{`
        .scrollHost { overscroll-behavior: contain; }
        .scrollHost { scrollbar-width: none; }             /* Firefox */
        .scrollHost::-webkit-scrollbar { display: none; }  /* WebKit */
        @keyframes spin { to { transform: rotate(360deg); } }
        @media print { .pdf-modal-root { display: none !important; } }
      `}</style>
    </div>
  );
}

/* --- styles --- */
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

const viewerStyle = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflowY: "auto",     // 네이티브 스크롤 (안 보이게만 함)
  overflowX: "hidden",
  padding: "15px"
};

const progressWrapStyle = {
  position: "absolute",
  top: 15,
  bottom: 15,
  right: 6,
  width: 10,
  pointerEvents: "none",
  zIndex: 3
};

const progressTrackStyle = {
  position: "absolute",
  top: 0,
  bottom: 0,
  right: 3,
  width: 4,
  background: "rgba(255,255,255,0.10)",
  borderRadius: 2
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
  willChange: "transform,height"
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

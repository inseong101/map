// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const MIN_ZOOM_HARD_CAP = 0.1;

  const holderRef = useRef(null);   // 네이티브 스크롤 컨테이너 (우측 스크롤바는 숨김)
  const wrapperRef = useRef(null);  // 레이아웃 높이를 zoom에 맞게 조절
  const canvasRef  = useRef(null);  // PDF 렌더 타깃

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);
  const renderedRef = useRef(false);

  const [zoom, setZoom] = useState(1.0);
  const minScaleRef = useRef(MIN_ZOOM_HARD_CAP); // 동적 최소 배율

  // 진행바(썸)
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const thumbRafRef = useRef(0);

  // 마우스 드래그 스크롤 보조
  const dragRef = useRef({ active: false, lastY: 0 });

  // ---------- utils ----------
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

  // ---------- 레이아웃(zoom 적용) ----------
  const applyLayoutForZoom = useCallback((z) => {
    const holder  = holderRef.current;
    const wrapper = wrapperRef.current;
    const canvas  = canvasRef.current;
    if (!holder || !wrapper || !canvas) return;

    const { width: vw } = getInnerSize(holder);
    const baseCssWidth  = parseFloat(canvas.style.width  || "0"); // 렌더 직후 세팅
    const baseCssHeight = parseFloat(canvas.style.height || "0");

    // 스크롤 영역 높이 갱신 (네이티브 스크롤)
    wrapper.style.height = `${baseCssHeight * z}px`;
    wrapper.style.width  = "100%";
    wrapper.style.position = "relative";

    // 캔버스는 scale만 하고 레이아웃엔 영향 안 주도록 절대배치
    const scaledW = baseCssWidth * z;
    const left = (vw - scaledW) / 2; // X축 중앙(음수 가능, overflowX는 숨김)
    canvas.style.position = "absolute";
    canvas.style.top = "0px";
    canvas.style.left = `${left}px`;
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = `scale(${z})`;
    canvas.style.transition = "transform 0.18s ease";
  }, []);

  // ---------- 진행바 업데이트 ----------
  const updateThumb = useCallback(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    const track  = trackRef.current;
    const thumb  = thumbRef.current;
    if (!holder || !canvas || !track || !thumb) return;

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

    const maxScroll = Math.max(1, scrollH - viewH);
    const ratio = Math.min(1, Math.max(0, holder.scrollTop / maxScroll));
    const travel = Math.max(0, viewH - thumbH);
    thumb.style.transform = `translateY(${Math.round(travel * ratio)}px)`;
  }, [zoom]);

  const startThumbLoop = useCallback(() => {
    cancelAnimationFrame(thumbRafRef.current);
    const loop = () => {
      updateThumb(); // 프레임마다 보정 → 어떤 환경에서도 썸은 따라옴
      thumbRafRef.current = requestAnimationFrame(loop);
    };
    thumbRafRef.current = requestAnimationFrame(loop);
  }, [updateThumb]);

  const stopThumbLoop = useCallback(() => {
    cancelAnimationFrame(thumbRafRef.current);
  }, []);

  // ---------- 줌(뷰포트 중앙 유지) ----------
  const changeZoom = useCallback((nextZoomRaw) => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;

    const minAllowed = Math.max(MIN_ZOOM_HARD_CAP, Math.min(1, minScaleRef.current));
    const newZoom = Math.max(minAllowed, Math.min(1.0, nextZoomRaw));
    const oldZoom = zoom;

    const { height: viewH } = getInnerSize(holder);
    const baseCssHeight = parseFloat(canvas.style.height || "0");

    // 현재 뷰포트 중앙의 문서 좌표(줌=1 기준 좌표계)
    const centerDocY = (holder.scrollTop + viewH / 2) / Math.max(0.0001, oldZoom);

    setZoom(newZoom);
    applyLayoutForZoom(newZoom);

    // 같은 문서좌표가 중앙에 오도록 scrollTop 재계산
    const targetScroll = centerDocY * newZoom - viewH / 2;
    const maxScroll = Math.max(0, baseCssHeight * newZoom - viewH);
    holder.scrollTop = Math.max(0, Math.min(targetScroll, maxScroll));

    // 썸 갱신
    requestAnimationFrame(updateThumb);
  }, [zoom, applyLayoutForZoom, updateThumb]);

  const handleZoomIn = useCallback(() => {
    changeZoom(Math.round((zoom + 0.1) * 100) / 100);
  }, [zoom, changeZoom]);

  const handleZoomOut = useCallback(() => {
    changeZoom(Math.round((zoom - 0.1) * 100) / 100);
  }, [zoom, changeZoom]);

  // ---------- 페이지 렌더 ----------
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;

    try {
      renderedRef.current = true;

      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: vw, height: vh } = getInnerSize(holderRef.current);
      const baseViewport = page.getViewport({ scale: 1 });

      // 폭 맞춤
      const fitWidthScale = vw / baseViewport.width;
      const cssWidth  = vw;
      const cssHeight = baseViewport.height * fitWidthScale;

      canvas.style.width  = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      // 고해상도 렌더
      const isMobile = window.innerWidth <= 768;
      const qualityMultiplier = isMobile ? 3.0 : 4.0;
      const renderScale = fitWidthScale * qualityMultiplier;
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

      // 최소 배율 계산:
      // 문서가 화면보다 길면 '화면높이에 맞춤'까지 축소 허용, 짧으면 하드캡(0.1)
      const fitHeightMin = vh / cssHeight;
      minScaleRef.current = fitHeightMin < 1
        ? Math.max(MIN_ZOOM_HARD_CAP, fitHeightMin)
        : MIN_ZOOM_HARD_CAP;

      // 초기 상태
      setZoom(1.0);
      applyLayoutForZoom(1.0);
      holderRef.current.scrollTop = 0;
      requestAnimationFrame(updateThumb);
    } catch (e) {
      console.error("PDF 렌더링 오류:", e);
    } finally {
      setTimeout(() => { renderedRef.current = false; }, 80);
    }
  }, [applyLayoutForZoom, updateThumb]);

  // ---------- PDF 로드 (파일/열림 바뀔 때만) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !filePath || !sid) { renderedRef.current = false; return; }

      setLoading(true);
      setErr(null);
      renderedRef.current = false;

      try {
        const key = `${filePath}::${sid}`;
        lastKeyRef.current = key;

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

        await renderPage(doc, 1);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; renderedRef.current = false; };
  }, [open, filePath, sid]); // ✅ 의존성 고정: 파일/열림 바뀔 때만 실행

  // ---------- 스크롤/키보드/드래그 ----------
  // 썸: onScroll + rAF 보정
  useEffect(() => {
    if (!open) return;
    const holder = holderRef.current;
    if (!holder) return;

    const onScroll = () => updateThumb();
    holder.addEventListener("scroll", onScroll, { passive: true });

    startThumbLoop(); // rAF 보정
    return () => {
      holder.removeEventListener("scroll", onScroll);
      stopThumbLoop();
    };
  }, [open, updateThumb, startThumbLoop, stopThumbLoop]);

  // 마우스 드래그로 스크롤 (캔버스는 선택 안 되니 안전)
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current.active = true;
    dragRef.current.lastY = e.clientY;
    e.preventDefault();
  }, []);
  const onMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    const holder = holderRef.current;
    if (!holder) return;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastY = e.clientY;
    holder.scrollTop -= dy;
  }, []);
  const onMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

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
        case "Home":      holder.scrollTop  = 0; break;
        case "End":       holder.scrollTop  = holder.scrollHeight; break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); }
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose, loading]);

  // 리사이즈 시 현재 줌 유지한 채 레이아웃/썸 보정
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
  const minScale = Math.max(MIN_ZOOM_HARD_CAP, Math.min(1, minScaleRef.current));

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

        {/* 뷰어(네이티브 스크롤, 우측 스크롤바는 숨김) */}
        <div
          ref={holderRef}
          className="scrollHost"
          style={viewerStyle}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {/* 진행바 오버레이 */}
          <div style={progressWrapStyle} ref={trackRef}>
            <div style={progressTrackStyle} />
            <div style={progressThumbStyle} ref={thumbRef} />
          </div>

          {/* 스크롤 레이아웃 래퍼 + 캔버스 */}
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

          {/* 상태 표시 */}
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

      {/* CRA 호환: 일반 <style> 사용 (styled-jsx 아님) */}
      <style>{`
        .scrollHost { overscroll-behavior: contain; }
        .scrollHost { scrollbar-width: none; }             /* Firefox */
        .scrollHost::-webkit-scrollbar { display: none; }  /* WebKit */

        @keyframes spin { to { transform: rotate(360deg); } }
        @media print { .pdf-modal-root { display: none !important; } }
      `}</style>
    </div>
  );
}

/* ---------- styles ---------- */
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
  overflowY: "auto",   // 네이티브 스크롤 (우측 바는 CSS로 숨김)
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

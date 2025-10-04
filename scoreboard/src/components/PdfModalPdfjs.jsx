// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const MIN_ZOOM_HARD_CAP = 0.1;        // 하드 하한만 유지
  const MAX_ZOOM = 1.0;                 // 최대는 1 (폭 맞춤)

  const holderRef = useRef(null);       // 스크롤 컨테이너 (네이티브 스크롤)
  const sizerRef  = useRef(null);       // 레이아웃 높이/너비를 갖는 박스(스크롤 범위 제공)
  const canvasRef = useRef(null);       // 실제 PDF 그려지는 캔버스(absolute)

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);

  // 렌더 기준(CSS) 크기 (zoom=1.0 일 때)
  const baseCss = useRef({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1.0);

  // 썸(진행바) UI 상태
  const [thumb, setThumb] = useState({ show: false, top: 0, height: 0 });

  // --------- helpers ----------
  const getHolderBox = useCallback(() => {
    const el = holderRef.current;
    if (!el) return { cw: 600, ch: 400, padTop: 0, padBottom: 0 };
    const cs = getComputedStyle(el);
    const padTop = parseFloat(cs.paddingTop || "0");
    const padBottom = parseFloat(cs.paddingBottom || "0");
    return { cw: el.clientWidth, ch: el.clientHeight, padTop, padBottom };
  }, []);

  const getScaledSize = useCallback(() => {
    // 실제 보이는 문서 크기(스케일 반영)
    return {
      width: baseCss.current.width * zoom,
      height: baseCss.current.height * zoom,
    };
  }, [zoom]);

  // 진행 썸 업데이트 (네이티브 스크롤 값으로)
  const updateThumbFromScroll = useCallback(() => {
    const holder = holderRef.current;
    if (!holder) return;

    const scrollH = holder.scrollHeight;
    const clientH = holder.clientHeight;
    const scrollTop = holder.scrollTop;

    if (scrollH <= clientH + 0.5) {
      setThumb((t) => (t.show ? { show: false, top: 0, height: 0 } : t));
      return;
    }

    const ratio = scrollTop / (scrollH - clientH); // 0~1
    const trackH = clientH;
    const visibleRatio = clientH / scrollH;
    const minThumb = 24;
    const thumbH = Math.max(minThumb, Math.round(trackH * visibleRatio));
    const top = Math.round((trackH - thumbH) * ratio);

    setThumb({ show: true, top, height: thumbH });
  }, []);

  // 캔버스 위치/크기 적용 (가로 중앙 + 스케일)
  const applyLayout = useCallback(() => {
    const holder = holderRef.current;
    const sizer  = sizerRef.current;
    const canvas = canvasRef.current;
    if (!holder || !sizer || !canvas) return;

    const { cw } = getHolderBox();
    const { width: scaledW, height: scaledH } = getScaledSize();

    // 스크롤 범위 제공: sizer의 레이아웃 크기를 스케일링된 문서 크기로
    const sizerW = Math.max(cw, Math.ceil(scaledW)); // 가로 중앙 정렬 위해 최소 컨테이너 폭 보장
    sizer.style.width  = `${sizerW}px`;
    sizer.style.height = `${Math.ceil(scaledH)}px`;
    sizer.style.position = "relative";

    // 캔버스는 sizer 안에서 절대 위치 + scale로 그려짐
    const left = Math.round((sizerW - scaledW) / 2);
    canvas.style.position = "absolute";
    canvas.style.top = "0px";
    canvas.style.left = `${left}px`;
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = `scale(${zoom})`;

    // 진행 썸 갱신
    updateThumbFromScroll();
  }, [getHolderBox, getScaledSize, updateThumbFromScroll, zoom]);

  // 줌 변경 (화면 중앙 고정)
  const changeZoomKeepingCenter = useCallback((nextZoomRaw) => {
    const holder = holderRef.current;
    if (!holder) return;

    const newZoom = Math.max(MIN_ZOOM_HARD_CAP, Math.min(MAX_ZOOM, nextZoomRaw));

    const oldScaledH = baseCss.current.height * zoom;
    const newScaledH = baseCss.current.height * newZoom;

    const viewportCenter = holder.clientHeight / 2;
    // scrollTop은 "스케일 반영된" 좌표
    const centerAbs = holder.scrollTop + viewportCenter;   // 현재 화면 중앙의 절대 위치(스케일 반영)
    const ratio = oldScaledH > 0 ? centerAbs / oldScaledH : 0.5;

    setZoom(newZoom);

    // 레이아웃 먼저 갱신 → scrollTop 재설정
    requestAnimationFrame(() => {
      applyLayout();
      const newCenterAbs = ratio * newScaledH;
      const newScrollTop = Math.max(0, Math.min(newCenterAbs - viewportCenter, holder.scrollHeight - holder.clientHeight));
      holder.scrollTop = newScrollTop;
      updateThumbFromScroll();
    });
  }, [applyLayout, updateThumbFromScroll, zoom]);

  const handleZoomIn  = useCallback(() => changeZoomKeepingCenter( Math.round((zoom + 0.1) * 100) / 100 ), [zoom, changeZoomKeepingCenter]);
  const handleZoomOut = useCallback(() => changeZoomKeepingCenter( Math.round((zoom - 0.1) * 100) / 100 ), [zoom, changeZoomKeepingCenter]);

  // 스크롤 이벤트로 썸 갱신
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !open) return;
    const onScroll = () => updateThumbFromScroll();
    holder.addEventListener("scroll", onScroll, { passive: true });
    return () => holder.removeEventListener("scroll", onScroll);
  }, [open, updateThumbFromScroll]);

  // 리사이즈 시 레이아웃 재적용
  useEffect(() => {
    if (!open) return;
    const onResize = () => applyLayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, applyLayout]);

  // Ctrl/⌘ + Wheel 브라우저 줌 방지 (우리 줌만 쓰기)
  useEffect(() => {
    if (!open) return;
    const preventPageZoom = (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("wheel", preventPageZoom, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", preventPageZoom, { capture: true });
  }, [open]);

  // 페이지 렌더
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current) return;
    const page = await doc.getPage(num);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: false });

    // 기준 사이즈(zoom=1에서 컨테이너 폭에 맞춤)
    const holder = holderRef.current;
    const cw = holder.clientWidth - 30; // 내부 padding 15px*2 고려(아래 style과 일치)
    const baseViewport = page.getViewport({ scale: 1 });
    const fitWidthScale = cw / baseViewport.width;

    const cssW = cw;
    const cssH = baseViewport.height * fitWidthScale;
    baseCss.current = { width: cssW, height: cssH };

    // 캔버스 CSS 크기(기준)
    canvas.style.width  = `${Math.floor(cssW)}px`;
    canvas.style.height = `${Math.floor(cssH)}px`;

    // 실제 렌더 해상도 (고품질)
    const isMobile = window.innerWidth <= 768;
    const q = isMobile ? 3.0 : 4.0;
    const renderScale = fitWidthScale * q;
    const renderViewport = page.getViewport({ scale: renderScale });

    canvas.width  = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: renderViewport, intent: "display", renderInteractiveForms: false }).promise;

    // 레이아웃 적용 및 진행바 초기화
    requestAnimationFrame(() => {
      applyLayout();
      const holderEl = holderRef.current;
      if (holderEl) {
        holderEl.scrollTop = 0;
        updateThumbFromScroll();
      }
    });
  }, [applyLayout, updateThumbFromScroll]);

  const renderFirstPage = useCallback(async (doc) => { if (doc) await renderPage(doc, 1); }, [renderPage]);

  // PDF 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !filePath || !sid) return;
      setLoading(true); setErr(null);
      try {
        const key = `${filePath}::${sid}`;
        if (pdfDoc && lastKeyRef.current === key) {
          setLoading(false);
          await renderFirstPage(pdfDoc);
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

        await renderFirstPage(doc);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, filePath, sid, pdfDoc, renderFirstPage]);

  if (!open) return null;

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
      className="pdf-modal-root"
    >
      <div style={modalStyle} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => changeZoomKeepingCenter(zoom - 0.1)} style={zoomBtnStyle}>−</button>
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 45, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={() => changeZoomKeepingCenter(zoom + 0.1)} disabled={zoom >= MAX_ZOOM}
              style={{ ...zoomBtnStyle, opacity: zoom >= MAX_ZOOM ? 0.3 : 1, cursor: zoom >= MAX_ZOOM ? "not-allowed" : "pointer" }}>
              +
            </button>
          </div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">✕</button>
        </div>

        {/* 뷰어(네이티브 스크롤) */}
        <div ref={holderRef} style={viewerStyleScrollable}>
          {/* 스크롤 범위를 제공하는 sizer */}
          <div ref={sizerRef}>
            {/* 그 위에 실제 캔버스(absolute + scale) */}
            {loading && (
              <div style={centerStyle}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 50, height: 50, border: "4px solid #333", borderTop: "4px solid var(--primary)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>불러오는 중</div>
                </div>
              </div>
            )}
            {err && <div style={{ ...centerStyle, color: "var(--bad)" }}>{String(err)}</div>}
            {!loading && !err && (
              <canvas
                ref={canvasRef}
                style={{
                  display: "block",
                  userSelect: "none",
                  imageRendering: "high-quality",
                  willChange: "transform,left",
                }}
              />
            )}
          </div>

          {/* 오른쪽 진행 썸 */}
          {thumb.show && (
            <div style={progressWrap}>
              <div style={progressTrack} />
              <div style={{ ...progressThumb, height: `${thumb.height}px`, transform: `translateY(${thumb.top}px)` }} />
            </div>
          )}
        </div>

        {/* 하단 페이지 네비(여러 페이지일 때) */}
        {numPages > 1 && !loading && (
          <div style={footerStyle}>
            <button
              style={navBtnStyle}
              onClick={async () => {
                if (!pdfDoc || pageNum <= 1) return;
                const prev = pageNum - 1;
                setPageNum(prev);
                await renderPage(pdfDoc, prev);
              }}
            >← 이전</button>
            <span style={{ fontWeight: 700 }}>Page {pageNum} / {numPages}</span>
            <button
              style={navBtnStyle}
              onClick={async () => {
                if (!pdfDoc || pageNum >= numPages) return;
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

// ------- styles -------
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
  gap: 12
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
  minWidth: 32,
  height: 32
};

const viewerStyleScrollable = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflowY: "auto",         // ✅ 네이티브 스크롤
  overflowX: "hidden",
  padding: "15px",
  touchAction: "auto"        // ✅ 터치 스크롤 허용
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

// 오른쪽 진행 썸
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
  borderRadius: 2
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
  willChange: "transform,height"
};

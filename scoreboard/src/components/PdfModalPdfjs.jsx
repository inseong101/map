// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const MIN_ZOOM_HARD_CAP = 0.1;   // 하한
  const MAX_ZOOM = 1.0;            // 상한(폭 맞춤)

  const holderRef = useRef(null);  // 네이티브 스크롤 컨테이너 (padding 15px)
  const sizerRef  = useRef(null);  // 스크롤 범위 제공(레이아웃 높이)
  const canvasRef = useRef(null);  // 실제 PDF 그리는 캔버스(absolute + scale)

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);

  // 기준(CSS) 크기(zoom=1에서 컨테이너 내부폭에 맞춤)
  const baseCss = useRef({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1.0);

  // 컨테이너 내부 사이즈(패딩 제외)를 일관 계산
  const getHolderBox = useCallback(() => {
    const el = holderRef.current;
    if (!el) {
      return {
        clientW: 600, clientH: 400,
        padL: 0, padR: 0, padT: 0, padB: 0,
        innerW: 600, innerH: 400
      };
    }
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft || "0");
    const padR = parseFloat(cs.paddingRight || "0");
    const padT = parseFloat(cs.paddingTop || "0");
    const padB = parseFloat(cs.paddingBottom || "0");
    const clientW = el.clientWidth;
    const clientH = el.clientHeight;
    const innerW = Math.max(0, clientW - padL - padR);
    const innerH = Math.max(0, clientH - padT - padB);
    return { clientW, clientH, padL, padR, padT, padB, innerW, innerH };
  }, []);

  const getScaledSize = useCallback(() => {
    return {
      width:  baseCss.current.width  * zoom,
      height: baseCss.current.height * zoom,
    };
  }, [zoom]);

  // 레이아웃 적용: sizer=레이아웃, canvas=absolute+scale+가로 중앙
  const applyLayout = useCallback(() => {
    const holder = holderRef.current;
    const sizer  = sizerRef.current;
    const canvas = canvasRef.current;
    if (!holder || !sizer || !canvas) return;

    const { innerW } = getHolderBox();
    const { width: scaledW, height: scaledH } = getScaledSize();

    // sizer: 내부 컨텐츠 영역(패딩 제외) 크기로 설정 → 네이티브 스크롤 범위 제공
    sizer.style.position = "relative";
    sizer.style.width  = `${Math.ceil(innerW)}px`;
    sizer.style.height = `${Math.ceil(scaledH)}px`;

    // canvas: sizer 내부에서 absolute + scale, X축 중앙 정렬
    const left = Math.max(0, Math.round((innerW - scaledW) / 2));
    canvas.style.position = "absolute";
    canvas.style.top = "0px";
    canvas.style.left = `${left}px`;
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = `scale(${zoom})`;
  }, [getHolderBox, getScaledSize, zoom]);

  // 줌 변경: “현재 화면 중앙” 기준 유지
  const changeZoomKeepingCenter = useCallback((nextZoomRaw) => {
    const holder = holderRef.current;
    if (!holder) return;

    const newZoom = Math.max(MIN_ZOOM_HARD_CAP, Math.min(MAX_ZOOM, nextZoomRaw));

    const oldScaledH = baseCss.current.height * zoom;
    const newScaledH = baseCss.current.height * newZoom;

    const viewportCenter = holder.clientHeight / 2;
    const centerAbs = holder.scrollTop + viewportCenter;   // 현재 중앙의 절대 위치(스케일 반영)
    const ratio = oldScaledH > 0 ? centerAbs / oldScaledH : 0.5;

    setZoom(newZoom);

    // 레이아웃 갱신 후 scrollTop 재설정
    requestAnimationFrame(() => {
      applyLayout();
      const newCenterAbs = ratio * newScaledH;
      const maxTop = Math.max(0, holder.scrollHeight - holder.clientHeight);
      const newScrollTop = Math.max(0, Math.min(newCenterAbs - viewportCenter, maxTop));
      holder.scrollTop = newScrollTop;
    });
  }, [applyLayout, zoom]);

  const handleZoomIn  = useCallback(() => changeZoomKeepingCenter(Math.round((zoom + 0.1) * 100) / 100), [zoom, changeZoomKeepingCenter]);
  const handleZoomOut = useCallback(() => changeZoomKeepingCenter(Math.round((zoom - 0.1) * 100) / 100), [zoom, changeZoomKeepingCenter]);

  // 리사이즈 시 레이아웃 재적용
  useEffect(() => {
    if (!open) return;
    const onResize = () => applyLayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, applyLayout]);

  // Ctrl/⌘ + Wheel 브라우저 줌 방지(우리 줌만 사용)
  useEffect(() => {
    if (!open) return;
    const preventPageZoom = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("wheel", preventPageZoom, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", preventPageZoom, { capture: true });
  }, [open]);

  // PDF 페이지 렌더
  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current) return;

    const page = await doc.getPage(num);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: false });

    // 내부폭(innerW)에 맞춰 기준 크기 산정(패딩 제외)
    const { innerW } = getHolderBox();
    const baseViewport = page.getViewport({ scale: 1 });
    const fitWidthScale = innerW / baseViewport.width;

    const cssW = innerW;
    const cssH = baseViewport.height * fitWidthScale;
    baseCss.current = { width: cssW, height: cssH };

    // CSS 기준 크기
    canvas.style.width  = `${Math.floor(cssW)}px`;
    canvas.style.height = `${Math.floor(cssH)}px`;

    // 실제 렌더 해상도(고품질)
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

    // 레이아웃 적용 및 초기 스크롤
    requestAnimationFrame(() => {
      applyLayout();
      const holderEl = holderRef.current;
      if (holderEl) holderEl.scrollTop = 0;
    });
  }, [applyLayout, getHolderBox]);

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
            <button
              onClick={() => changeZoomKeepingCenter(zoom + 0.1)}
              disabled={zoom >= MAX_ZOOM}
              style={{ ...zoomBtnStyle, opacity: zoom >= MAX_ZOOM ? 0.3 : 1, cursor: zoom >= MAX_ZOOM ? "not-allowed" : "pointer" }}
            >
              +
            </button>
          </div>

          <button onClick={onClose} style={closeBtnStyle} aria-label="닫기">✕</button>
        </div>

        {/* 뷰어(네이티브 스크롤) */}
        <div ref={holderRef} style={viewerStyleScrollable}>
          {/* 스크롤 범위 제공 */}
          <div ref={sizerRef}>
            {/* 실제 PDF 캔버스 */}
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
        </div>

        {/* 하단 네비(여러 페이지일 때) */}
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
            >
              ← 이전
            </button>
            <span style={{ fontWeight: 700 }}>Page {pageNum} / {numPages}</span>
            <button
              style={navBtnStyle}
              onClick={async () => {
                if (!pdfDoc || pageNum >= numPages) return;
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

/* ---------------- styles ---------------- */
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

const viewerStyleScrollable = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflowY: "auto",    // 네이티브 스크롤
  overflowX: "hidden",
  padding: "15px",      // ← 내부 폭(innerW) 계산의 기준
  touchAction: "auto",
  overscrollBehavior: "contain", // 모바일 바운스 억제
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

// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 1.0;

  const holderRef = useRef(null);   // overflow: auto; padding: 15px
  const sizerRef  = useRef(null);   // 레이아웃 높이(스크롤 범위)를 제공
  const canvasRef = useRef(null);   // 실제 렌더되는 캔버스(absolute + scale)

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);

  // 기준(CSS) 크기(zoom=1에서 컨테이너 내부 폭에 맞춤)
  const baseCss = useRef({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1.0);

  // 컨테이너 내부(패딩 제외) 사이즈
  const getInnerBox = useCallback(() => {
    const el = holderRef.current;
    if (!el) return { innerW: 600, innerH: 400, clientH: 400 };
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft || "0");
    const padR = parseFloat(cs.paddingRight || "0");
    const padT = parseFloat(cs.paddingTop || "0");
    const padB = parseFloat(cs.paddingBottom || "0");
    const clientW = el.clientWidth;   // padding 포함, 스크롤바 제외
    const clientH = el.clientHeight;  // padding 포함
    const innerW = Math.max(0, clientW - padL - padR);
    const innerH = Math.max(0, clientH - padT - padB);
    return { innerW, innerH, clientH };
  }, []);

  // 레이아웃 적용: sizer(height), canvas(center+scale)
  const applyLayout = useCallback(() => {
    const holder = holderRef.current;
    const sizer  = sizerRef.current;
    const canvas = canvasRef.current;
    if (!holder || !sizer || !canvas) return;

    const { innerW } = getInnerBox();
    const scaledH = baseCss.current.height * zoom;

    // sizer는 스크롤 범위를 제공(폭은 innerW, 높이는 스케일 반영)
    sizer.style.position = "relative";
    sizer.style.width  = `${Math.ceil(innerW)}px`;
    sizer.style.height = `${Math.ceil(scaledH)}px`;

    // 캔버스는 sizer 안에서 '항상 가로 중앙'
    // → left: 50% + translateX(-50%) + scale
    canvas.style.position = "absolute";
    canvas.style.top = "0px";
    canvas.style.left = "50%";
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = `translateX(-50%) scale(${zoom})`;
  }, [getInnerBox, zoom]);

  // 줌 변경: 현재 화면 '중앙' 기준으로 유지
  const changeZoomKeepingCenter = useCallback((nextZoomRaw) => {
    const holder = holderRef.current;
    if (!holder) return;

    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw));

    const oldH = baseCss.current.height * zoom;
    const newH = baseCss.current.height * newZoom;

    const viewportCenter = holder.clientHeight / 2;
    const centerAbsOld = holder.scrollTop + viewportCenter;      // 현재 중앙의 절대 위치(스케일 반영)
    const ratio = oldH > 0 ? centerAbsOld / oldH : 0.5;          // 0~1 사이

    setZoom(newZoom);

    // 레이아웃 갱신 후, 같은 '비율' 위치가 중앙에 오도록 scrollTop 재설정
    requestAnimationFrame(() => {
      applyLayout();
      const centerAbsNew = ratio * newH;
      const target = Math.max(0, centerAbsNew - viewportCenter);
      const maxTop = Math.max(0, holder.scrollHeight - holder.clientHeight);
      holder.scrollTop = Math.min(target, maxTop);
    });
  }, [applyLayout, zoom]);

  const handleZoomIn  = useCallback(() => changeZoomKeepingCenter(Math.round((zoom + 0.1) * 100) / 100), [zoom, changeZoomKeepingCenter]);
  const handleZoomOut = useCallback(() => changeZoomKeepingCenter(Math.round((zoom - 0.1) * 100) / 100), [zoom, changeZoomKeepingCenter]);

  // 리사이즈 → 레이아웃 재적용
  useEffect(() => {
    if (!open) return;
    const onResize = () => applyLayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, applyLayout]);

  // Ctrl/⌘+Wheel 브라우저 줌 방지(우리 줌만 사용)
  useEffect(() => {
    if (!open) return;
    const preventPageZoom = (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); }
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

    // 내부 폭(innerW)에 맞춰 '기준' 크기 산정 (zoom=1.0)
    const { innerW } = getInnerBox();
    const baseViewport = page.getViewport({ scale: 1 });
    const fitWidthScale = innerW / baseViewport.width;

    const cssW = innerW;
    const cssH = baseViewport.height * fitWidthScale;
    baseCss.current = { width: cssW, height: cssH };

    // CSS 기준 크기
    canvas.style.width  = `${Math.round(cssW)}px`;
    canvas.style.height = `${Math.round(cssH)}px`;

    // 실제 렌더 해상도(고품질)
    const isMobile = window.innerWidth <= 768;
    const q = isMobile ? 3.0 : 4.0;
    const renderScale = fitWidthScale * q;
    const renderViewport = page.getViewport({ scale: renderScale });

    canvas.width  = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: renderViewport, intent: "display", renderInteractiveForms: false }).promise;

    // 레이아웃 적용 + 초기 스크롤 0
    requestAnimationFrame(() => {
      applyLayout();
      const holder = holderRef.current;
      if (holder) holder.scrollTop = 0;
    });
  }, [applyLayout, getInnerBox]);

  const renderFirstPage = useCallback(async (doc) => {
    if (doc) await renderPage(doc, 1);
  }, [renderPage]);

  // PDF 로드 (Cloud Functions 호출)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !filePath || !sid) return;
      setLoading(true);
      setErr(null);
      try {
        const key = `${filePath}::${sid}`;
        if (pdfDoc && lastKeyRef.current === key) {
          setLoading(false);
          await renderFirstPage(pdfDoc);
          return;
        }

        const functions = getFunctions(undefined, "asia-northeast3");
        const serve = httpsCallable(functions, "serveWatermarkedPdf");

        let bytes;
        try {
          const res = await serve({ filePath, sid });
          const base64 = res?.data;
          if (!base64) throw new Error("빈 응답");
          const bin = atob(base64);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch (fnErr) {
          // 함수 레벨 에러 메시지를 좀 더 친절하게 가공
          const msg = (fnErr?.message || "").toLowerCase();
          if (msg.includes("internal") || msg.includes("500")) {
            throw new Error("서버(PDF 생성) 내부 오류(500). 파일 경로/권한/서버 로그를 확인하세요.");
          }
          throw fnErr;
        }

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
            <button onClick={handleZoomOut} style={zoomBtnStyle}>−</button>
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 45, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
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
          <div ref={sizerRef}>
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
                  willChange: "transform",
                }}
              />
            )}
          </div>
        </div>

        {/* 페이지 네비(옵션) */}
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
  borderBottom: "1px solid #2333b",
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
  overflowY: "auto",
  overflowX: "hidden",
  padding: "15px",
  touchAction: "auto",
  overscrollBehavior: "contain",
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

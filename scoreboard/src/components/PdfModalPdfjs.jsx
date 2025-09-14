// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
// ⚠️ 뷰어 UI/이미지 의존성 제거: build/pdf 만 사용 (pdf_viewer.css 불러오지 않음)
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

// 워커 버전 = 라이브러리 버전 일치 (API/Worker mismatch 방지)
GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);

  // 페이지 렌더 (캔버스)
  const renderPage = useCallback(async (doc, num, fitWidth = true) => {
    if (!doc || !canvasRef.current) return;

    const page = await doc.getPage(num);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // 컨테이너 폭 기준 스케일
    const container = canvas.parentElement;
    const containerWidth = container?.clientWidth || 800;
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = fitWidth ? Math.min(1.75, containerWidth / baseViewport.width) : 1.2;
    const viewport = page.getViewport({ scale });

    // 레티나 스케일
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }, []);

  // 문서 로드
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open || !filePath || !sid) return;
      setLoading(true);
      setErr(null);
      setPdfDoc(null);
      setPageNum(1);
      setNumPages(0);

      try {
        // us-central1 고정 (함수 지역 일치)
        const functions = getFunctions(undefined, "us-central1");
        const serve = httpsCallable(functions, "serveWatermarkedPdf");
        const res = await serve({ filePath, sid });
        const base64 = res?.data;
        if (!base64) throw new Error("빈 응답");

        // base64 -> Uint8Array
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        // pdf.js 로드
        const task = getDocument({ data: bytes });
        const doc = await task.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
        await renderPage(doc, 1, true);

        const onResize = () => renderPage(doc, pageNum, true);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, filePath, sid, renderPage, pageNum]);

  // 키보드 내비게이션 & 인쇄 단축키 최소화
  useEffect(() => {
    if (!open) return;

    const handler = async (e) => {
      // ← / →
      if (pdfDoc && e.key === "ArrowRight" && pageNum < numPages) {
        const next = pageNum + 1;
        setPageNum(next);
        await renderPage(pdfDoc, next, true);
      } else if (pdfDoc && e.key === "ArrowLeft" && pageNum > 1) {
        const prev = pageNum - 1;
        setPageNum(prev);
        await renderPage(pdfDoc, prev, true);
      }
      // Ctrl/Cmd + P 차단 시도 (완전 차단은 불가)
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [open, pdfDoc, pageNum, numPages, renderPage]);

  if (!open) return null;

  return (
    <div style={backdrop} onClick={onClose}>
      {/* 인쇄 시 숨김 */}
      <style>{`@media print { .pdf-modal-root { display:none !important; } }`}</style>

      <div
        className="pdf-modal-root"
        style={modal}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()} // 우클릭 저장 최소화
      >
        <div style={modalHeader}>
          <div style={{ fontWeight: 700 }}>{title || "특별해설"}</div>
          <button onClick={onClose} style={closeBtn} aria-label="닫기">✕</button>
        </div>

        <div style={{ flex: 1, background: "#111", position: "relative", overflow: "auto" }}>
          {loading && <div style={center}>불러오는 중…</div>}
          {err && <div style={{ ...center, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && (
            <canvas
              ref={canvasRef}
              style={{ display: "block", margin: "0 auto", userSelect: "none" }}
            />
          )}
        </div>

        {numPages > 1 && (
          <div style={footer}>
            <button
              style={navBtn}
              onClick={async () => {
                if (!pdfDoc || pageNum <= 1) return;
                const prev = pageNum - 1;
                setPageNum(prev);
                await renderPage(pdfDoc, prev, true);
              }}
            >
              ← 이전
            </button>
            <span>Page {pageNum} / {numPages}</span>
            <button
              style={navBtn}
              onClick={async () => {
                if (!pdfDoc || pageNum >= numPages) return;
                const next = pageNum + 1;
                setPageNum(next);
                await renderPage(pdfDoc, next, true);
              }}
            >
              다음 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const backdrop = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
};
const modal = {
  width: "min(900px, 96vw)", height: "min(90vh, 800px)",
  background: "#1c1f24", color: "#e5e7eb",
  border: "1px solid #2d333b", borderRadius: 12,
  display: "flex", flexDirection: "column", overflow: "hidden"
};
const modalHeader = {
  height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 12px", borderBottom: "1px solid #2d333b"
};
const closeBtn = {
  border: "1px solid #2d333b", borderRadius: 6, background: "transparent",
  padding: "4px 8px", cursor: "pointer", color: "#e5e7eb"
};
const center = { position: "absolute", inset: 0, display: "grid", placeItems: "center" };
const footer = {
  borderTop: "1px solid #2d333b",
  padding: "8px 12px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#15181c"
};
const navBtn = {
  border: "1px solid #2d333b", background: "transparent", color: "#e5e7eb",
  borderRadius: 8, padding: "6px 10px", cursor: "pointer"
};

// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

// pdf.js 워커 경로 설정 (필수)
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef(null);

  // 여러 페이지 지원을 위한 상태
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  const renderPage = async (pdfDoc, pageNum) => {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };
    await page.render(renderContext).promise;
  };

  useEffect(() => {
    if (!open || !filePath || !sid) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Functions 호출
        const functions = getFunctions();
        const serve = httpsCallable(functions, "serveWatermarkedPdf");
        const res = await serve({ filePath, sid });
        const base64 = res.data;

        // base64 -> Uint8Array
        const byteChars = atob(base64);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const bytes = new Uint8Array(byteNums);

        // pdf.js 로드
        const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setNumPages(pdfDoc.numPages);
        setCurrentPage(1);
        await renderPage(pdfDoc, 1);

        // 페이지 넘김 이벤트 핸들링
        const handleKey = async (e) => {
          if (e.key === "ArrowRight" && currentPage < pdfDoc.numPages) {
            const next = currentPage + 1;
            setCurrentPage(next);
            await renderPage(pdfDoc, next);
          } else if (e.key === "ArrowLeft" && currentPage > 1) {
            const prev = currentPage - 1;
            setCurrentPage(prev);
            await renderPage(pdfDoc, prev);
          }
        };
        window.addEventListener("keydown", handleKey);

        return () => window.removeEventListener("keydown", handleKey);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, filePath, sid]);

  if (!open) return null;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700 }}>{title || "특별해설"}</div>
          <button onClick={onClose} style={closeBtn} aria-label="닫기">✕</button>
        </div>

        <div style={{ flex: 1, background: "#111", position: "relative", overflow: "auto" }}>
          {loading && <div style={center}>불러오는 중…</div>}
          {err && <div style={{ ...center, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && (
            <canvas ref={canvasRef} style={{ display: "block", margin: "0 auto" }} />
          )}
        </div>

        {/* 페이지 이동 UI */}
        {numPages > 1 && (
          <div style={footer}>
            <span>Page {currentPage} / {numPages}</span>
            <span style={{ opacity: 0.7 }}>← → 키로 넘길 수 있음</span>
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
  background: "#15181c"
};

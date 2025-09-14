// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

// CRA에서 안전하게 동작하는 워커 경로(CDN 고정 버전 권장)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);

  const renderPage = useCallback(async (doc, num, fitWidth = true) => {
    if (!doc || !canvasRef.current) return;
    const page = await doc.getPage(num);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const containerWidth = canvas.parentElement?.clientWidth || 800;
    const viewport = page.getViewport({ scale: 1 });
    const scale = fitWidth ? Math.min(1.75, containerWidth / viewport.width) : 1.2;
    const scaledViewport = page.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(scaledViewport.width * dpr);
    canvas.height = Math.floor(scaledViewport.height * dpr);
    canvas.style.width = `${Math.floor(scaledViewport.width)}px`;
    canvas.style.height = `${Math.floor(scaledViewport.height)}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
  }, []);

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
        const functions = getFunctions(undefined, "us-central1");
        const serve = httpsCallable(functions, "serveWatermarkedPdf");
        const res = await serve({ filePath, sid });
        const base64 = res?.data;
        if (!base64) throw new Error("빈 응답");

        // base64 → Uint8Array
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
        await renderPage(doc, 1, true);

        const onResize = () => renderPage(doc, 1, true);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, filePath, sid, renderPage]);

  useEffect(() => {
    if (!open || !pdfDoc) return;
    const handler = async (e) => {
      if (e.key === "ArrowRight" && pageNum < numPages) {
        const next = pageNum + 1;
        setPageNum(next);
        await renderPage(pdfDoc, next, true);
      } else if (e.key === "ArrowLeft" && pageNum > 1) {
        const prev = pageNum - 1;
        setPageNum(prev);
        await renderPage(pdfDoc, prev, true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, pdfDoc, pageNum, numPages, renderPage]);

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
          {!loading && !err && <canvas ref={canvasRef} style={{ display: "block", margin: "0 auto" }} />}
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

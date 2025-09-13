// scoreboard/src/components/PdfJsModal.jsx
import React, { useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

// ✅ CRA + pdfjs-dist v3.x 환경에서는 이 경로 사용
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.entry";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// base64 → Uint8Array 변환 도우미
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 간단한 PDF 뷰어 (Canvas 기반)
function PdfViewer({ data }) {
  const containerRef = React.useRef(null);

  useEffect(() => {
    (async () => {
      if (!data) return;
      const pdf = await pdfjsLib.getDocument({ data }).promise;

      // 컨테이너 초기화
      const container = containerRef.current;
      container.innerHTML = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.2 });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        container.appendChild(canvas);

        await page.render({ canvasContext: context, viewport }).promise;
      }
    })();
  }, [data]);

  return <div ref={containerRef} style={{ overflow: "auto" }} />;
}

export default function PdfJsModal({ open, onClose, filePath, sid, title }) {
  const [pdfData, setPdfData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !filePath || !sid) return;
    setLoading(true);
    setErr(null);
    setPdfData(null);

    (async () => {
      try {
        // ✅ Firebase Functions 연동 부분 (serveWatermarkedPdf 호출)
        const { getFunctions, httpsCallable } = await import("firebase/functions");
        const functions = getFunctions();
        const serve = httpsCallable(functions, "serveWatermarkedPdf");

        const res = await serve({ filePath, sid });
        const base64 = res.data;
        setPdfData(base64ToUint8Array(base64));
      } catch (e) {
        setErr(e?.message || "PDF 로드 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, filePath, sid]);

  if (!open) return null;

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={modalHeader}>
          <div>{title}</div>
          <button onClick={onClose} style={closeBtn} aria-label="닫기">✕</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "var(--surface)" }}>
          {loading && <div style={center}>불러오는 중…</div>}
          {err && <div style={{ ...center, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && pdfData && <PdfViewer data={pdfData} />}
        </div>
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
  background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12,
  display: "flex", flexDirection: "column", overflow: "hidden"
};
const modalHeader = {
  height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 12px", borderBottom: "1px solid var(--line)", fontWeight: 800, color: "var(--ink)"
};
const closeBtn = {
  border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface)",
  padding: "4px 8px", cursor: "pointer", color: "var(--ink)"
};
const center = { padding: 24, textAlign: "center", color: "var(--ink)" };

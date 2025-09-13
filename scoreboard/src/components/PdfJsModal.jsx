// scoreboard/src/components/PdfJsModal.jsx
import React, { useEffect, useState } from "react";
import PdfViewer, { base64ToUint8Array } from "./PdfViewer";
import { getFunctions, httpsCallable } from "firebase/functions";

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

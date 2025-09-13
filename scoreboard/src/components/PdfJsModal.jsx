// scoreboard/src/components/PdfJsModal.jsx
import React, { useEffect, useRef, useState } from "react";
import { fetchWatermarkedPdfBase64, logPdfAction } from "../services/pdfService";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";

// PDF.js 워커 설정 (CDN)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function PdfJsModal({ open, onClose, filePath, sid, title = "특별해설" }) {
  const wrapRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const toastRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    let mounted = true;
    let pdfDoc = null;

    const render = async () => {
      if (!wrapRef.current) return;
      wrapRef.current.innerHTML = "";
      setLoading(true);
      setErrorMsg("");

      try {
        const b64 = await fetchWatermarkedPdfBase64(filePath, sid);
        if (!mounted) return;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const task = pdfjsLib.getDocument({ data: bytes });
        pdfDoc = await task.promise;

        const container = wrapRef.current;
        const maxWidth = container.clientWidth || 820;

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const scale = Math.min(maxWidth / viewport.width, 1.6);
          const v2 = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = Math.ceil(v2.width);
          canvas.height = Math.ceil(v2.height);
          canvas.style.display = "block";
          canvas.style.margin = "0 auto 12px";

          container.appendChild(canvas);

          await page.render({ canvasContext: ctx, viewport: v2 }).promise;
        }
      } catch (e) {
        console.error(e);
        if (mounted) setErrorMsg("PDF를 불러오지 못했습니다.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    render();

    // 키/메뉴 시도 감지 (다운로드/인쇄 억제 + 서버 로깅)
    const onKey = async (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "s" || k === "p")) {
        e.preventDefault();
        const action = k === "s" ? "download_attempt" : "print_attempt";
        await logPdfAction({ filePath, sid, action, meta: { combo: `${e.ctrlKey ? "Ctrl+" : ""}${e.metaKey ? "Meta+" : ""}${k}` } });
        showToast(`학수번호 ${sid}로 ${action === "download_attempt" ? "다운로드" : "인쇄"} 시도가 감지되었습니다.`);
      }
    };
    const onContext = async (e) => {
      e.preventDefault();
      await logPdfAction({ filePath, sid, action: "contextmenu_attempt" });
      showToast(`학수번호 ${sid}로 컨텍스트 메뉴 시도가 감지되었습니다.`);
    };
    const beforePrint = async () => {
      await logPdfAction({ filePath, sid, action: "print_attempt", meta: { event: "beforeprint" } });
      showToast(`학수번호 ${sid}로 인쇄 시도가 감지되었습니다.`);
      setTimeout(() => window.print(), 50); // 완전 차단은 불가. 기록 + 안내만.
    };

    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("beforeprint", beforePrint);

    return () => {
      mounted = false;
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("beforeprint", beforePrint);
    };
  }, [open, filePath, sid]);

  if (!open) return null;

  return (
    <div style={styles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="닫기">✕</button>
        </div>

        <div style={styles.viewer} ref={wrapRef}>
          {loading && <div style={styles.center}>불러오는 중…</div>}
          {!!errorMsg && <div style={styles.center}>{errorMsg}</div>}
        </div>

        <div ref={toastRef} style={styles.toast} aria-live="polite" />
      </div>
    </div>
  );

  function showToast(msg) {
    if (!toastRef.current) return;
    toastRef.current.textContent = msg;
    toastRef.current.style.opacity = "1";
    setTimeout(() => {
      if (toastRef.current) toastRef.current.style.opacity = "0";
    }, 2500);
  }
}

const styles = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
  },
  modal: {
    width: "min(960px, 94vw)", height: "min(90vh, 820px)",
    background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12,
    display: "flex", flexDirection: "column", overflow: "hidden",
  },
  header: {
    padding: "10px 12px", borderBottom: "1px solid var(--line)",
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  closeBtn: {
    appearance: "none", border: "1px solid var(--line)", background: "var(--surface-2)",
    color: "var(--ink)", borderRadius: 8, padding: "6px 10px", cursor: "pointer",
  },
  viewer: { flex: 1, overflow: "auto", background: "#111", padding: 8 },
  center: { padding: 20, color: "#bbb", textAlign: "center" },
  toast: {
    position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.75)", color: "#fff", padding: "8px 12px",
    borderRadius: 8, fontSize: 12, opacity: 0, transition: "opacity .25s",
  },
};

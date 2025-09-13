// src/components/PdfModal.jsx
import React, { useEffect, useState, useRef } from "react";
import { fetchWatermarkedPdfBase64, logPdfAction } from "../services/pdfService";

export default function PdfModal({ open, onClose, filePath, sid, title = "특별해설" }) {
  const [url, setUrl] = useState(null);
  const toastRef = useRef(null);

  useEffect(() => {
    if (!open) {
      if (url) URL.revokeObjectURL(url);
      setUrl(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const b64 = await fetchWatermarkedPdfBase64(filePath, sid);
        if (!mounted) return;
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const u = URL.createObjectURL(blob);
        setUrl(u);
      } catch (e) {
        console.error("PDF load error", e);
      }
    })();
    return () => { mounted = false; };
  }, [open, filePath, sid]);

  // 시도 감지
  useEffect(() => {
    if (!open) return;
    const onKey = async (e) => {
      const combo = `${e.metaKey ? "Meta+" : ""}${e.ctrlKey ? "Ctrl+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key}`;
      // 저장(Ctrl/Cmd+S), 인쇄(Ctrl/Cmd+P)
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "s")) {
        e.preventDefault();
        await report("download_attempt", { combo });
        showToast(`학수번호 ${sid}로 다운로드 시도가 감지되었습니다.`);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "p")) {
        e.preventDefault();
        await report("print_attempt", { combo });
        showToast(`학수번호 ${sid}로 인쇄 시도가 감지되었습니다.`);
      }
    };
    const onContext = async (e) => {
      e.preventDefault();
      await report("contextmenu_attempt", {});
      showToast(`학수번호 ${sid}로 컨텍스트 메뉴 시도가 감지되었습니다.`);
    };
    const beforePrint = async () => {
      await report("print_attempt", { event: "beforeprint" });
      showToast(`학수번호 ${sid}로 인쇄 시도가 감지되었습니다.`);
    };

    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("beforeprint", beforePrint);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("beforeprint", beforePrint);
    };
  }, [open, filePath, sid]);

  async function report(action, meta) {
    try {
      await logPdfAction({ filePath, sid, action, meta });
    } catch {}
  }

  function showToast(msg) {
    if (!toastRef.current) return;
    toastRef.current.textContent = msg;
    toastRef.current.style.opacity = "1";
    setTimeout(() => {
      if (toastRef.current) toastRef.current.style.opacity = "0";
    }, 2500);
  }

  if (!open) return null;

  return (
    <div style={styles.backdrop} role="dialog" aria-modal="true">
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={{ fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="닫기">✕</button>
        </div>
        <div style={styles.viewer}>
          {url ? (
            // 기본 iframe 뷰어 (다운로드 버튼 미제공)
            <iframe
              src={url}
              title="PDF"
              style={{ width: "100%", height: "100%", border: "none" }}
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div style={{ padding: 20 }}>불러오는 중…</div>
          )}
        </div>
        <div ref={toastRef} style={styles.toast} aria-live="polite" />
      </div>
    </div>
  );
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
  viewer: { flex: 1, background: "#111" },
  toast: {
    position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.75)", color: "#fff", padding: "8px 12px",
    borderRadius: 8, fontSize: 12, opacity: 0, transition: "opacity .25s",
  },
};

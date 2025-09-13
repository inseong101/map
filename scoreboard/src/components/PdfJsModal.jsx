// scoreboard/src/components/PdfJsModal.jsx
import React, { useEffect, useState, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { getFunctions, httpsCallable } from "firebase/functions";

/**
 * pdf.js 워커 설정 (v4 / v3 모두 대응 시도)
 * - v4: ESM worker(.mjs)
 * - v3: UMD worker(.js)
 */
(function setupPdfWorker() {
  try {
    // v4 방식 (CRA에서도 동작하도록 URL 생성)
    // eslint-disable-next-line no-undef
    const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch {
    try {
      // v3 fallback
      // eslint-disable-next-line no-undef
      const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url);
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    } catch {
      // 최후: CDN (가능하면 피하세요)
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
  }
})();

/** base64 -> Uint8Array */
function base64ToUint8Array(base64) {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 간단한 Canvas 기반 PDF 뷰어 (다운로드 UI 없음) */
function PdfViewer({ data }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: true });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        // 컨테이너 초기화
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        // 각 페이지 렌더
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;

          // 스케일 계산 (폭 기준)
          const targetWidth = Math.min(860, container.clientWidth || 860);
          const viewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / viewport.width;
          const scaled = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(scaled.width);
          canvas.height = Math.floor(scaled.height);
          canvas.style.display = "block";
          canvas.style.margin = "0 auto 8px";
          canvas.style.boxShadow = "0 0 0 1px var(--line)";
          canvas.style.background = "#fff";

          const ctx = canvas.getContext("2d");
          container.appendChild(canvas);

          await page.render({ canvasContext: ctx, viewport: scaled }).promise;
        }
      } catch (e) {
        console.error("PDF render error:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  // 인쇄/다운로드 억제(완전 차단은 불가, 시도 로깅만 보조)
  useEffect(() => {
    const onKeyDown = (e) => {
      const isPrint =
        (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p";
      if (isPrint) {
        e.preventDefault();
        e.stopPropagation();
        alert("인쇄가 제한됩니다. 시도가 기록됩니다.");
      }
    };
    const onContext = (e) => {
      // 우클릭 메뉴 최소 억제
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("contextmenu", onContext, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("contextmenu", onContext, { capture: true });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        padding: 12,
        overflow: "auto",
        height: "100%",
        background: "var(--surface)",
      }}
    />
  );
}

export default function PdfJsModal({ open, onClose, filePath, sid, title }) {
  const [pdfData, setPdfData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  // 열릴 때 PDF 불러오기 (워터마크는 Functions에서 삽입)
  useEffect(() => {
    if (!open || !filePath || !sid) return;

    let cancelled = false;
    setLoading(true);
    setErr(null);
    setPdfData(null);

    (async () => {
      try {
        const functions = getFunctions();
        const serve = httpsCallable(functions, "serveWatermarkedPdf");
        const res = await serve({ filePath, sid });
        if (cancelled) return;
        const base64 = res.data;
        setPdfData(base64ToUint8Array(base64));
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, filePath, sid]);

  // 다운로드/프린트 시도 로깅 (프론트 감지 수준)
  useEffect(() => {
    if (!open || !filePath || !sid) return;
    const functions = getFunctions();
    const logFn = httpsCallable(functions, "logPdfAction");

    const logAndAlert = async (action) => {
      try {
        await logFn({ filePath, sid, action });
      } catch (_) { /* ignore */ }
    };

    const onKeyDown = (e) => {
      const isPrint =
        (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p";
      if (isPrint) {
        e.preventDefault();
        e.stopPropagation();
        logAndAlert("print_attempt");
        alert(`학수번호 ${sid}의 인쇄 시도가 감지되었습니다.`);
      }
    };
    const onContext = (e) => {
      e.preventDefault();
      logAndAlert("contextmenu_open");
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("contextmenu", onContext, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("contextmenu", onContext, { capture: true });
    };
  }, [open, filePath, sid]);

  if (!open) return null;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ textAlign: "center", width: "100%" }}>{title}</div>
          <button onClick={onClose} style={closeBtn} aria-label="닫기">
            ✕
          </button>
        </div>

        <div style={{ flex: 1, position: "relative" }}>
          {loading && <div style={center}>불러오는 중…</div>}
          {err && <div style={{ ...center, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && pdfData && <PdfViewer data={pdfData} />}
        </div>
      </div>
    </div>
  );
}

/* ===== Styles ===== */
const backdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};
const modal = {
  width: "min(900px, 96vw)",
  height: "min(90vh, 800px)",
  background: "var(--surface-2)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
const modalHeader = {
  height: 48,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 12px",
  borderBottom: "1px solid var(--line)",
  fontWeight: 800,
  color: "var(--ink)",
  position: "relative",
};
const closeBtn = {
  position: "absolute",
  right: 8,
  top: 8,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--surface)",
  padding: "4px 8px",
  cursor: "pointer",
  color: "var(--ink)",
};
const center = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--ink)",
  fontWeight: 700,
};

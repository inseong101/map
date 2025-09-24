// src/components/PdfModalPdfjs.jsx
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

// 워커 버전 = 라이브러리 버전 일치
GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const holderRef = useRef(null);     // 캔버스 컨테이너
  const canvasRef = useRef(null);
  const roRef = useRef(null);         // ResizeObserver
  const reflowTimer = useRef(null);   // 리사이즈 디바운스
  const renderingRef = useRef(false); // 렌더링 중복 방지
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);    // 동일 파일 재오픈 캐시 키

  // 현재 컨테이너 폭 읽기
  const getContainerWidth = () => {
    const el = holderRef.current;
    if (!el) return 800;
    const rect = el.getBoundingClientRect();
    return Math.max(320, Math.floor(rect.width));
  };

  // 깜빡임 방지: 한 번에 최종 해상도로 렌더링
  const renderPage = useCallback(
    async (doc, num) => {
      if (!doc || !canvasRef.current || !holderRef.current) return;
      
      // 중복 렌더링 방지
      if (renderingRef.current) return;
      renderingRef.current = true;
      
      try {
        const page = await doc.getPage(num);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { alpha: false });

        const cw = getContainerWidth();
        const baseViewport = page.getViewport({ scale: 1 });
        const targetScale = Math.min(1.75, cw / baseViewport.width);

        // 한 번에 최종 해상도로 렌더링 (깜빡임 방지)
        const vp = page.getViewport({ scale: targetScale });
        const dpr = Math.min(1.75, window.devicePixelRatio || 1);
        
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      } finally {
        renderingRef.current = false;
      }
    },
    []
  );

  // 레이아웃 확정 후 첫 렌더
  const renderFirstPageAfterLayout = useCallback(
    async (doc) => {
      if (!doc) return;
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      await renderPage(doc, 1);
    },
    [renderPage]
  );

  // 문서 로드
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open || !filePath || !sid) return;
      setLoading(true);
      setErr(null);

      try {
        const key = `${filePath}::${sid}`;
        // 동일 파일 재오픈이면 pdfDoc 재활용 (빠르게)
        if (pdfDoc && lastKeyRef.current === key) {
          await renderFirstPageAfterLayout(pdfDoc);
          return;
        }

        const functions = getFunctions(undefined, "us-central1");
        const serve = httpsCallable(functions, "serveWatermarkedPdf");
        const res = await serve({ filePath, sid });
        const base64 = res?.data;
        if (!base64) throw new Error("빈 응답");

        // base64 → Uint8Array
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const task = getDocument({ data: bytes });
        const doc = await task.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
        lastKeyRef.current = key;

        await renderFirstPageAfterLayout(doc);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, filePath, sid, renderFirstPageAfterLayout, pdfDoc]);
  
  // 리사이즈: 디바운스 시간 증가로 깜빡임 방지
  useLayoutEffect(() => {
    if (!open) return;
    const el = holderRef.current;
    if (!el) return;

    roRef.current?.disconnect();
    roRef.current = new ResizeObserver(() => {
      clearTimeout(reflowTimer.current);
      reflowTimer.current = setTimeout(() => {
        if (pdfDoc && !renderingRef.current) {
          renderPage(pdfDoc, pageNum);
        }
      }, 300); // 120ms → 300ms로 증가하여 깜빡임 방지
    });
    roRef.current.observe(el);
    return () => roRef.current?.disconnect();
  }, [open, pdfDoc, pageNum, renderPage]);

  // 키보드 내비
  useEffect(() => {
    if (!open) return;
    const handler = async (e) => {
      if (e.key === "ArrowRight" && pdfDoc && pageNum < numPages && !renderingRef.current) {
        const next = pageNum + 1;
        setPageNum(next);
        await renderPage(pdfDoc, next);
      } else if (e.key === "ArrowLeft" && pdfDoc && pageNum > 1 && !renderingRef.current) {
        const prev = pageNum - 1;
        setPageNum(prev);
        await renderPage(pdfDoc, prev);
      }
      // 프린트 단축키 최소화 (완전 차단은 불가)
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
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={modalHeader}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          <button onClick={onClose} style={closeBtn} aria-label="닫기">✕</button>
        </div>

        <div ref={holderRef} style={viewer}>
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
                if (!pdfDoc || pageNum <= 1 || renderingRef.current) return;
                const prev = pageNum - 1;
                setPageNum(prev);
                await renderPage(pdfDoc, prev);
              }}
            >
              ← 이전
            </button>
            <span>Page {pageNum} / {numPages}</span>
            <button
              style={navBtn}
              onClick={async () => {
                if (!pdfDoc || pageNum >= numPages || renderingRef.current) return;
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
    </div>
  );
}

/* ===== 스타일: 더 작고, X 항상 보이도록 헤더 고정 ===== */
const backdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modal = {
  width: "min(680px, 92vw)",
  height: "min(70vh, 700px)",
  background: "#1c1f24",
  color: "#e5e7eb",
  border: "1px solid #2d333b",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 10px 40px rgba(0,0,0,.35)",
};

const modalHeader = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 10px",
  borderBottom: "1px solid #2d333b",
  background: "linear-gradient(#1c1f24, #1a1d22)",
};

const closeBtn = {
  border: "1px solid #2d333b",
  borderRadius: 6,
  background: "transparent",
  padding: "2px 8px",
  cursor: "pointer",
  color: "#e5e7eb",
  fontSize: 18,
  lineHeight: 1,
};

const viewer = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "auto",
  padding: "8px 6px",
};

const center = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
};

const footer = {
  borderTop: "1px solid #2d333b",
  padding: "6px 10px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#15181c",
  fontSize: 13,
};

const navBtn = {
  border: "1px solid #2d333b",
  background: "transparent",
  color: "#e5e7eb",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};

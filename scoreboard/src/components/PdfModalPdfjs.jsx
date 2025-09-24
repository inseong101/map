// src/components/PdfModalPdfjs.jsx
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

// 워커 버전 = 라이브러리 버전 일치
GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

export default function PdfModalPdfjs({ open, onClose, filePath, sid, title }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const lastKeyRef = useRef(null);
  const renderedRef = useRef(false); // 렌더링 완료 플래그

  // 현재 컨테이너 폭 읽기
  const getContainerWidth = () => {
    const el = holderRef.current;
    if (!el) return 600;
    const rect = el.getBoundingClientRect();
    return Math.max(320, Math.floor(rect.width - 20)); // 패딩 고려
  };

  // 안정적인 한 번 렌더링
  const renderPage = useCallback(
    async (doc, num) => {
      if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
      
      try {
        renderedRef.current = true; // 렌더링 시작
        
        const page = await doc.getPage(num);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { alpha: false });

        const containerWidth = getContainerWidth();
        const baseViewport = page.getViewport({ scale: 1 });
        
        // 컨테이너에 맞는 스케일 계산 (여백 고려)
        const scale = Math.min(1.5, containerWidth / baseViewport.width);
        const viewport = page.getViewport({ scale });

        // 캔버스 크기 설정 (고정값으로 안정화)
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        
        // 변환 매트릭스 초기화
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        // 배경 지우기
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // PDF 렌더링
        await page.render({
          canvasContext: ctx,
          viewport: viewport
        }).promise;
        
      } catch (error) {
        console.error("PDF 렌더링 오류:", error);
      } finally {
        // 렌더링 완료 후 짧은 지연으로 플래그 해제
        setTimeout(() => {
          renderedRef.current = false;
        }, 100);
      }
    },
    []
  );

  // 첫 렌더링 (레이아웃 안정화 대기)
  const renderFirstPage = useCallback(
    async (doc) => {
      if (!doc) return;
      // 모달이 완전히 열린 후 렌더링
      await new Promise(resolve => setTimeout(resolve, 100));
      await renderPage(doc, 1);
    },
    [renderPage]
  );

  // 문서 로드
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open || !filePath || !sid) {
        renderedRef.current = false;
        return;
      }
      
      setLoading(true);
      setErr(null);
      renderedRef.current = false;

      try {
        const key = `${filePath}::${sid}`;
        
        // 동일 파일 재오픈 체크
        if (pdfDoc && lastKeyRef.current === key) {
          setLoading(false);
          await renderFirstPage(pdfDoc);
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

        await renderFirstPage(doc);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderedRef.current = false;
    };
  }, [open, filePath, sid, renderFirstPage, pdfDoc]);

  // 키보드 내비게이션
  useEffect(() => {
    if (!open) return;
    
    const handler = async (e) => {
      if (renderedRef.current) return; // 렌더링 중이면 무시
      
      if (e.key === "ArrowRight" && pdfDoc && pageNum < numPages) {
        const next = pageNum + 1;
        setPageNum(next);
        await renderPage(pdfDoc, next);
      } else if (e.key === "ArrowLeft" && pdfDoc && pageNum > 1) {
        const prev = pageNum - 1;
        setPageNum(prev);
        await renderPage(pdfDoc, prev);
      }
      
      // 프린트 차단
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
          {loading && (
            <div style={center}>
              <div className="spinner" style={{ width: 24, height: 24, marginBottom: 8 }}></div>
              불러오는 중…
            </div>
          )}
          {err && <div style={{ ...center, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && (
            <canvas
              ref={canvasRef}
              style={{ 
                display: "block", 
                margin: "0 auto",
                userSelect: "none",
                maxWidth: "100%",
                height: "auto"
              }}
            />
          )}
        </div>

        {numPages > 1 && !loading && (
          <div style={footer}>
            <button
              style={navBtn}
              disabled={renderedRef.current || pageNum <= 1}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum <= 1) return;
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
              disabled={renderedRef.current || pageNum >= numPages}
              onClick={async () => {
                if (renderedRef.current || !pdfDoc || pageNum >= numPages) return;
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

/* ===== 스타일 ===== */
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
  padding: "10px",
};

const center = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  flexDirection: "column",
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
  opacity: 1,
  transition: "opacity 0.2s",
};

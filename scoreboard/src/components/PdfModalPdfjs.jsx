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
  const renderedRef = useRef(false);

  // 현재 컨테이너 크기 읽기 (가로/세로 모두 고려)
  const getContainerSize = () => {
    const el = holderRef.current;
    if (!el) return { width: 600, height: 400 };
    const rect = el.getBoundingClientRect();
    return { 
      width: Math.max(320, Math.floor(rect.width - 20)), 
      height: Math.max(300, Math.floor(rect.height - 20))
    };
  };

  // 고화질 렌더링 (가로/세로 비율 유지, 찌그러짐 방지)
  const renderPage = useCallback(
    async (doc, num) => {
      if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
      
      try {
        renderedRef.current = true;
        
        const page = await doc.getPage(num);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { alpha: false });

        const { width: containerWidth, height: containerHeight } = getContainerSize();
        const baseViewport = page.getViewport({ scale: 1 });
        
        // 가로/세로 비율을 유지하면서 컨테이너에 맞는 스케일 계산
        const scaleX = containerWidth / baseViewport.width;
        const scaleY = containerHeight / baseViewport.height;
        let targetScale = Math.min(scaleX, scaleY); // 찌그러짐 방지
        
        // 고화질을 위해 스케일 증가 (모바일에서도 선명하게)
        const isMobile = window.innerWidth <= 768;
        const pixelRatio = window.devicePixelRatio || 1;
        const qualityMultiplier = isMobile ? 2.5 : 3.0; // 모바일/데스크톱 화질 개선
        
        targetScale = Math.min(targetScale * qualityMultiplier, 4.0); // 최대 4배 확대

        // 1단계: 중해상도 퀵 렌더링 (로딩 시간 단축)
        const quickScale = targetScale * 0.6;
        const quickViewport = page.getViewport({ scale: quickScale });
        
        // 캔버스 크기 설정 (비율 유지)
        canvas.width = Math.floor(quickViewport.width * pixelRatio);
        canvas.height = Math.floor(quickViewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(quickViewport.width)}px`;
        canvas.style.height = `${Math.floor(quickViewport.height)}px`;
        
        // 고해상도 렌더링을 위한 스케일링
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        await page.render({ canvasContext: ctx, viewport: quickViewport }).promise;

        // 2단계: 최고해상도 업그레이드
        setTimeout(async () => {
          try {
            const finalViewport = page.getViewport({ scale: targetScale });
            
            canvas.width = Math.floor(finalViewport.width * pixelRatio);
            canvas.height = Math.floor(finalViewport.height * pixelRatio);
            canvas.style.width = `${Math.floor(finalViewport.width)}px`;
            canvas.style.height = `${Math.floor(finalViewport.height)}px`;
            
            ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // 고화질 렌더링 옵션 추가
            await page.render({ 
              canvasContext: ctx, 
              viewport: finalViewport,
              intent: 'display',
              renderInteractiveForms: false,
              optionalContentConfigPromise: null
            }).promise;
          } catch (error) {
            console.error("고해상도 렌더링 오류:", error);
          }
        }, 100);
        
      } catch (error) {
        console.error("PDF 렌더링 오류:", error);
      } finally {
        setTimeout(() => {
          renderedRef.current = false;
        }, 300);
      }
    },
    []
  );

  // 첫 렌더링
  const renderFirstPage = useCallback(
    async (doc) => {
      if (!doc) return;
      await new Promise(resolve => setTimeout(resolve, 150));
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

        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        // PDF 로딩 옵션 개선
        const task = getDocument({ 
          data: bytes,
          useSystemFonts: true,
          disableFontFace: false,
          cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
          cMapPacked: true
        });
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
      if (renderedRef.current) return;
      
      if (e.key === "ArrowRight" && pdfDoc && pageNum < numPages) {
        const next = pageNum + 1;
        setPageNum(next);
        await renderPage(pdfDoc, next);
      } else if (e.key === "ArrowLeft" && pdfDoc && pageNum > 1) {
        const prev = pageNum - 1;
        setPageNum(prev);
        await renderPage(pdfDoc, prev);
      }
      
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [open, pdfDoc, pageNum, numPages, renderPage]);

  // 윈도우 리사이즈 시 재렌더링
  useEffect(() => {
    if (!open || !pdfDoc) return;
    
    let timeoutId;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        if (!renderedRef.current) {
          await renderPage(pdfDoc, pageNum);
        }
      }, 300);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, [open, pdfDoc, pageNum, renderPage]);

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
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div style={{ 
                  width: '40px', 
                  height: '40px', 
                  border: '4px solid #333', 
                  borderTop: '4px solid #7ea2ff', 
                  borderRadius: '50%', 
                  animation: 'spin 1s linear infinite' 
                }}></div>
                <div>고화질 PDF를 준비하는 중...</div>
                <div style={{ textDecoration: 'underline' }}>
  전졸협 자료는 법적으로 저작권이 보호됩니다
</div>
           <div style={{ textDecoration: 'underline' }}>
  무단 복제 및 배포는 법적으로 처벌받을 수 있습니다.
</div>     
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
                maxHeight: "100%",
                objectFit: "contain", // 비율 유지
                imageRendering: "high-quality" // 고화질 렌더링
              }}
            />
          )}
        </div>

        {numPages > 1 && !loading && (
          <div style={footer}>
            <button
              style={{...navBtn, opacity: renderedRef.current || pageNum <= 1 ? 0.5 : 1}}
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
            <span style={{ fontWeight: 700 }}>Page {pageNum} / {numPages}</span>
            <button
              style={{...navBtn, opacity: renderedRef.current || pageNum >= numPages ? 0.5 : 1}}
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
  background: "rgba(0,0,0,.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modal = {
  width: "min(85vw, 900px)", // 모바일에서 더 큰 화면 활용
  height: "min(85vh, 800px)", // 높이도 증가
  background: "#1c1f24",
  color: "#e5e7eb",
  border: "1px solid #2d333b",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 15px 50px rgba(0,0,0,.5)",
};

const modalHeader = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 12px",
  borderBottom: "1px solid #2d333b",
  background: "linear-gradient(#1c1f24, #1a1d22)",
};

const closeBtn = {
  border: "1px solid #2d333b",
  borderRadius: 6,
  background: "transparent",
  padding: "4px 10px",
  cursor: "pointer",
  color: "#e5e7eb",
  fontSize: 16,
  lineHeight: 1,
  transition: "background 0.2s ease",
};

const viewer = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "auto",
  padding: "15px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const center = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
};

const footer = {
  borderTop: "1px solid #2d333b",
  padding: "8px 12px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#15181c",
  fontSize: 14,
};

const navBtn = {
  border: "1px solid #2d333b",
  background: "transparent",
  color: "#e5e7eb",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  transition: "background 0.2s ease",
  fontWeight: 600,
};

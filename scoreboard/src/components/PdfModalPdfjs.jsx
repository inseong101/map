// src/components/PdfModalPdfjs.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf";

GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

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

  const getContainerSize = () => {
    const el = holderRef.current;
    if (!el) return { width: 600, height: 400 };
    const rect = el.getBoundingClientRect();
    return { 
      width: Math.max(320, Math.floor(rect.width - 20)), 
      height: Math.max(300, Math.floor(rect.height - 20))
    };
  };

  const renderPage = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current || !holderRef.current || renderedRef.current) return;
    
    try {
      renderedRef.current = true;
      
      const page = await doc.getPage(num);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false });

      const { width: containerWidth, height: containerHeight } = getContainerSize();
      const baseViewport = page.getViewport({ scale: 1 });
      
      const scaleX = containerWidth / baseViewport.width;
      const scaleY = containerHeight / baseViewport.height;
      let targetScale = Math.min(scaleX, scaleY);
      
      const isMobile = window.innerWidth <= 768;
      const pixelRatio = window.devicePixelRatio || 1;
      const qualityMultiplier = isMobile ? 2.5 : 3.0;
      
      targetScale = Math.min(targetScale * qualityMultiplier, 4.0);

      const quickScale = targetScale * 0.6;
      const quickViewport = page.getViewport({ scale: quickScale });
      
      canvas.width = Math.floor(quickViewport.width * pixelRatio);
      canvas.height = Math.floor(quickViewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(quickViewport.width)}px`;
      canvas.style.height = `${Math.floor(quickViewport.height)}px`;
      
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      await page.render({ canvasContext: ctx, viewport: quickViewport }).promise;

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
  }, []);

  const renderFirstPage = useCallback(async (doc) => {
    if (!doc) return;
    await new Promise(resolve => setTimeout(resolve, 150));
    await renderPage(doc, 1);
  }, [renderPage]);

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

  // 키보드 단축키 (ESC로 모달 닫기, 인쇄 차단)
  useEffect(() => {
    if (!open) return;
    
    const handler = (e) => {
      if (e.key === "Escape" && !loading) {
        // 로딩 중일 때는 ESC로도 닫지 못하게 함
        onClose();
      }
      
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [open, onClose, loading]);

  // 안전한 뒤로가기 처리
  useEffect(() => {
    if (!open) return;

    let isSetup = false;
    
    // 모달 완전히 열린 후 히스토리 설정 (지연 실행)
    const setupTimer = setTimeout(() => {
      const modalState = { modal: 'pdf-open', timestamp: Date.now() };
      window.history.pushState(modalState, '', window.location.href);
      isSetup = true;
    }, 300); // 300ms 지연
    
    const handlePopstate = (e) => {
      // 설정이 완료된 후에만 처리
      if (!isSetup) return;
      
      // 모달 상태가 아니고 로딩 중이 아닐 때만 닫기
      if (e.state?.modal !== 'pdf-open' && !loading) {
        onClose();
      }
    };
    
    window.addEventListener('popstate', handlePopstate);
    
    return () => {
      clearTimeout(setupTimer);
      window.removeEventListener('popstate', handlePopstate);
      
      // 정상적으로 설정된 경우에만 히스토리 정리
      if (isSetup && window.history.state?.modal === 'pdf-open') {
        window.history.back();
      }
    };
  }, [open, onClose, loading]);

  // ❌ 문제가 되는 리사이즈 핸들러 제거
  // useEffect(() => {
  //   if (!open || !pdfDoc) return;
  //   
  //   let timeoutId;
  //   const handleResize = () => {
  //     clearTimeout(timeoutId);
  //     timeoutId = setTimeout(async () => {
  //       if (!renderedRef.current) {
  //         await renderPage(pdfDoc, pageNum);
  //       }
  //     }, 300);
  //   };
  //   
  //   window.addEventListener('resize', handleResize);
  //   return () => {
  //     window.removeEventListener('resize', handleResize);
  //     clearTimeout(timeoutId);
  //   };
  // }, [open, pdfDoc, pageNum, renderPage]);

  if (!open) return null;

  return (
    <div style={backdropStyle} onClick={loading ? undefined : onClose}>
      <style>{`
        @media print { 
          .pdf-modal-root { display: none !important; } 
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        className="pdf-modal-root"
        style={modalStyle}
        onClick={(e) => {
          e.stopPropagation(); // 🔧 모달 내부 클릭 시 버블링 완전 차단
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={headerStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation(); // 🔧 이벤트 버블링 방지
              onClose();
            }} 
            style={closeBtnStyle} 
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div ref={holderRef} style={viewerStyle} onClick={(e) => e.stopPropagation()}>
          {loading && (
            <div style={centerStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ 
                  width: '50px', 
                  height: '50px', 
                  border: '4px solid #333', 
                  borderTop: '4px solid #7ea2ff', 
                  borderRadius: '50%', 
                  animation: 'spin 1s linear infinite' 
                }}></div>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#7ea2ff' }}>
                  고화질 PDF를 준비하는 중...
                </div>
                <div style={{ fontSize: '14px', textAlign: 'center', lineHeight: '1.4' }}>
                  처음 접속 시 1-2분 정도 소요될 수 있습니다.<br/>
                  잠시만 기다려주세요.
                </div>
                <div style={{ fontSize: '12px', color: '#999', textAlign: 'center', lineHeight: '1.3' }}>
                  전졸협 자료는 법적으로 저작권이 보호됩니다.<br/>
                  무단 복제 및 배포는 법적으로 처벌받을 수 있습니다.
                </div>
                <div style={{ 
                  marginTop: '10px',
                  padding: '8px 16px', 
                  background: 'rgba(126,162,255,0.15)', 
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#7ea2ff',
                  textAlign: 'center'
                }}>
                  💡 로딩 중에는 모달이 자동으로 닫히지 않습니다
                </div>
              </div>
            </div>
          )}
          {err && <div style={{ ...centerStyle, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && (
            <canvas
              ref={canvasRef}
              onClick={(e) => e.stopPropagation()} // 🔧 캔버스 클릭도 버블링 방지
              style={{ 
                display: "block", 
                margin: "0 auto",
                userSelect: "none",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                imageRendering: "high-quality"
              }}
            />
          )}
        </div>

        {numPages > 1 && !loading && (
          <div style={footerStyle} onClick={(e) => e.stopPropagation()}>
            <button
              style={{...navBtnStyle, opacity: renderedRef.current || pageNum <= 1 ? 0.5 : 1}}
              disabled={renderedRef.current || pageNum <= 1}
              onClick={async (e) => {
                e.stopPropagation(); // 🔧 이벤트 버블링 방지
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
              style={{...navBtnStyle, opacity: renderedRef.current || pageNum >= numPages ? 0.5 : 1}}
              disabled={renderedRef.current || pageNum >= numPages}
              onClick={async (e) => {
                e.stopPropagation(); // 🔧 이벤트 버블링 방지
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

const backdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modalStyle = {
  width: "min(85vw, 900px)",
  height: "min(85vh, 800px)",
  background: "#1c1f24",
  color: "#e5e7eb",
  border: "1px solid #2d333b",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 15px 50px rgba(0,0,0,.5)",
};

const headerStyle = {
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

const closeBtnStyle = {
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

const viewerStyle = {
  flex: 1,
  background: "#111",
  position: "relative",
  overflow: "auto",
  padding: "15px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const centerStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
};

const footerStyle = {
  borderTop: "1px solid #2d333b",
  padding: "8px 12px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#15181c",
  fontSize: 14,
};

const navBtnStyle = {
  border: "1px solid #2d333b",
  background: "transparent",
  color: "#e5e7eb",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  transition: "background 0.2s ease",
  fontWeight: 600,
};

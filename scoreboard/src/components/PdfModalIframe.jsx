// scoreboard/src/components/PdfModalIframe.jsx
// NOTE: pdf.js 렌더링으로 교체하여 브라우저 기본 PDF 툴바(다운/프린트) 제거
// 필요한 패키지: npm i pdfjs-dist
// CRA/webpack은 아래 worker 엔트리를 자동 번들링합니다.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/build/pdf.worker.entry";

export default function PdfModalIframe({ open, onClose, filePath, sid, title }) {
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const pdfRef = useRef(null);    // pdf.js document
  const canvasRef = useRef(null); // 렌더 캔버스
  const wrapRef = useRef(null);   // 캔버스 wrapper (크기 계산)

  const blockShortcuts = useCallback((e) => {
    // ⌘/Ctrl + S, P, O, U, , (print), context menu 등 차단
    if ((e.ctrlKey || e.metaKey) && ["s", "p", "o", "u", ","].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Ctrl+Shift+I (개발자 도구) 까지 막진 않음(브라우저 권한), 단축키만 억제 시도
    // F12는 막히지 않을 수 있음.
  }, []);

  const blockContextMenu = useCallback((e) => {
    e.preventDefault();
  }, []);

  const blockDrag = useCallback((e) => {
    e.preventDefault();
  }, []);

  const fetchAndLoad = useCallback(async () => {
    if (!open || !filePath || !sid) return;
    setErr(null);
    setLoading(true);
    setPageNumber(1);
    setNumPages(0);
    pdfRef.current = null;

    try {
      // 워터마크된 PDF base64를 Functions에서 받아옴 (인증 필요)
      const functions = getFunctions();
      const serve = httpsCallable(functions, "serveWatermarkedPdf");
      const res = await serve({ filePath, sid });
      const base64 = res.data; // base64 string

      // base64 → Uint8Array
      const byteChars = atob(base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);

      // pdf.js 로드
      const loadingTask = pdfjsLib.getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
    } catch (e) {
      console.error("PDF 로드 실패:", e);
      setErr(e?.message || "PDF 로드 실패");
    } finally {
      setLoading(false);
    }
  }, [open, filePath, sid]);

  // 문서 로드/재로드
  useEffect(() => {
    fetchAndLoad();
  }, [fetchAndLoad]);

  // 페이지 렌더
  const renderPage = useCallback(async (pageno) => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!pdf || !canvas || !wrap) return;

    const page = await pdf.getPage(pageno);

    // 컨테이너 폭 기준으로 스케일
    const containerWidth = wrap.clientWidth || 800;
    const initialViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / initialViewport.width;
    const viewport = page.getViewport({ scale });

    const ctx = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    const renderContext = { canvasContext: ctx, viewport };
    await page.render(renderContext).promise;
  }, []);

  // 현재 페이지 바뀌면 렌더
  useEffect(() => {
    if (!open || !pdfRef.current) return;
    renderPage(pageNumber);
  }, [open, pageNumber, renderPage]);

  // 리사이즈 시 현재 페이지 다시 렌더
  useEffect(() => {
    if (!open) return;
    const handler = () => {
      if (pdfRef.current) renderPage(pageNumber);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [open, pageNumber, renderPage]);

  // 단축키/컨텍스트 메뉴 차단
  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current || document;
    document.addEventListener("keydown", blockShortcuts, true);
    el.addEventListener("contextmenu", blockContextMenu, true);
    el.addEventListener("dragstart", blockDrag, true);
    return () => {
      document.removeEventListener("keydown", blockShortcuts, true);
      el.removeEventListener("contextmenu", blockContextMenu, true);
      el.removeEventListener("dragstart", blockDrag, true);
    };
  }, [open, blockShortcuts, blockContextMenu, blockDrag]);

  if (!open) return null;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "특별해설"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              {numPages > 0 ? `${pageNumber} / ${numPages}` : ""}
            </span>
            <button
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              style={iconBtn}
              disabled={pageNumber <= 1}
              aria-label="이전 페이지"
              title="이전 페이지"
            >
              ‹
            </button>
            <button
              onClick={() => setPageNumber((p) => Math.min(numPages || p, p + 1))}
              style={iconBtn}
              disabled={numPages === 0 || pageNumber >= numPages}
              aria-label="다음 페이지"
              title="다음 페이지"
            >
              ›
            </button>
            <button onClick={onClose} style={closeBtn} aria-label="닫기">✕</button>
          </div>
        </div>

        <div ref={wrapRef} style={viewerWrap}>
          {loading && <div style={center}>불러오는 중…</div>}
          {err && <div style={{ ...center, color: "#ef4444" }}>{String(err)}</div>}
          {!loading && !err && <canvas ref={canvasRef} style={canvasStyle} />}
          {/* 드래그/선택 억제 오버레이 */}
          <div style={overlay} />
        </div>
      </div>
    </div>
  );
}

const backdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999
};
const modal = {
  width: "min(900px, 96vw)",
  height: "min(90vh, 800px)",
  background: "#1c1f24",
  color: "#e5e7eb",
  border: "1px solid #2d333b",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden"
};
const modalHeader = {
  height: 48,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 12px",
  borderBottom: "1px solid #2d333b",
  gap: 8
};
const closeBtn = {
  border: "1px solid #2d333b",
  borderRadius: 6,
  background: "transparent",
  padding: "4px 8px",
  cursor: "pointer",
  color: "#e5e7eb"
};
const iconBtn = {
  border: "1px solid #2d333b",
  borderRadius: 6,
  background: "transparent",
  padding: "2px 8px",
  cursor: "pointer",
  color: "#e5e7eb"
};
const viewerWrap = {
  position: "relative",
  flex: 1,
  background: "#111",
  display: "grid",
  placeItems: "center",
  overflow: "auto",
  userSelect: "none" // 선택 억제
};
const canvasStyle = {
  display: "block",
  background: "#fff",
  boxShadow: "0 2px 12px rgba(0,0,0,.4)"
};
const overlay = {
  position: "absolute",
  inset: 0,
  // 마우스 이벤트 대부분 캔버스에 통과시키되, 드래그/우클릭 등은 위의 이벤트 리스너로 차단
  pointerEvents: "none"
};
const center = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center"
};

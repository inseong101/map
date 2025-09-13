// scoreboard/src/components/PdfViewer.jsx
import React, { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";

// 최신 방식: 워커 등록
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// base64 -> Uint8Array 유틸 (서버에서 base64 내려줄 때 사용)
export function base64ToUint8Array(base64) {
  const raw = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const len = raw.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * props:
 *  - data: Uint8Array (PDF 바이너리)
 *  - page (선택): 렌더할 페이지 번호 (기본 1)
 *  - scale (선택): 배율 (기본 1.5)
 *  - onError (선택): 에러 콜백
 */
export default function PdfViewer({ data, page = 1, scale = 1.5, onError }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;

    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        const pg = await pdf.getPage(page);
        const viewport = pg.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const ctx = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await pg.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (onError) onError(e);
        // 콘솔 경고만
        console.warn("PDF render error:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [data, page, scale, onError]);

  return (
    <div style={{ width: "100%", overflow: "auto" }}>
      <canvas ref={canvasRef} style={{ width: "100%", display: "block" }} />
    </div>
  );
}

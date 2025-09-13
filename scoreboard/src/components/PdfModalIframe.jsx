// scoreboard/src/components/PdfModalIframe.jsx
import React, { useEffect, useMemo, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";

export default function PdfModalIframe({ open, onClose, filePath, sid, title }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  // iframe sandbox 옵션: 다운로드/프린트 버튼 노출 억제 목적(완전 차단은 불가)
  const sandbox = useMemo(
    () =>
      [
        // allow-scripts 필요 (iframe 내 렌더링)
        "allow-scripts",
        // 인앱 네비게이션 차단
        "allow-top-navigation-by-user-activation",
        // 다운로드를 의도적으로 허용하지 않음(기본 미포함)
        // "allow-downloads" 를 넣지 않습니다.
        // 폼/지오로케이션/팝업 등도 미허용 상태
      ].join(" "),
    []
  );
  useEffect(() => {
    if (!open || !filePath || !sid) return;
    let revoked = false;
    let urlToRevoke = null;

    (async () => {
      setLoading(true);
      setErr(null);
      setBlobUrl(null);
      try {
        // 워터마크된 PDF를 Functions에서 받아옴
        const functions = getFunctions();
        const serve = httpsCallable(functions, "serveWatermarkedPdf");
        const res = await serve({ filePath, sid });
        const base64 = res.data; // base64 string

        const byteChars = atob(base64);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const bytes = new Uint8Array(byteNums);
        const blob = new Blob([bytes], { type: "application/pdf" });

        const url = URL.createObjectURL(blob);
        urlToRevoke = url;
        if (!revoked) setBlobUrl(url);
      } catch (e) {
        setErr(e?.message || "PDF 로드 실패");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      revoked = true;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    };
  }, [open, filePath, sid]);

  if (!open) return null;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700 }}>{title || "특별해설"}</div>
          <button onClick={onClose} style={closeBtn} aria-label="닫기">✕</button>
        </div>

        <div style={{ flex: 1, background: "#111", position: "relative" }}>
          {loading && <div style={center}>불러오는 중…</div>}
          {err && <div style={{ ...center, color: "#ef4444" }}>{String(err)}</div>}

          {!loading && !err && blobUrl && (
            <iframe
              title="watermarked-pdf"
              src={blobUrl}
              style={{ border: 0, width: "100%", height: "100%" }}
              sandbox={sandbox}
              // 다운/프린트 탐지용 (간단 이벤트 후킹)
              onLoad={() => {
                // iframe 내부 접근은 sandbox로 제한됨. 추가 보안 로깅은 window.onbeforeprint 등 프론트 훅으로 커버 불가.
                // 시도성 이벤트는 아래 별도 버튼/키 감지로 로거 호출 권장.
              }}
            />
          )}
        </div>

        {/* 간단한 시도 로깅 버튼(선택): 다운로드/프린트 UI 외부에서 탐지 */}
        <div style={footer}>
          <button
            style={ghostBtn}
            onClick={async () => {
              try {
                const functions = getFunctions();
                const log = httpsCallable(functions, "logPdfAction");
                await log({ filePath, sid, action: "download_attempt", meta: { from: "footer-button" } });
                alert(`학수번호 ${sid}로 다운로드 시도가 기록되었습니다.`);
              } catch (_) {}
            }}
          >
            다운로드 시도 로깅
          </button>
          <button style={ghostBtn}
            onClick={async () => {
              try {
                const functions = getFunctions();
                const log = httpsCallable(functions, "logPdfAction");
                await log({ filePath, sid, action: "print_attempt", meta: { from: "footer-button" } });
                alert(`학수번호 ${sid}로 인쇄 시도가 기록되었습니다.`);
              } catch (_) {}
            }}
          >
            인쇄 시도 로깅
          </button>
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
  background: "#1c1f24", color: "#e5e7eb",
  border: "1px solid #2d333b", borderRadius: 12,
  display: "flex", flexDirection: "column", overflow: "hidden"
};
const modalHeader = {
  height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 12px", borderBottom: "1px solid #2d333b"
};
const closeBtn = {
  border: "1px solid #2d333b", borderRadius: 6, background: "transparent",
  padding: "4px 8px", cursor: "pointer", color: "#e5e7eb"
};
const center = { position: "absolute", inset: 0, display: "grid", placeItems: "center" };
const footer = {
  borderTop: "1px solid #2d333b",
  padding: "8px 12px",
  display: "flex",
  gap: 8,
  background: "#15181c"
};
const ghostBtn = {
  border: "1px solid #2d333b", background: "transparent", color: "#e5e7eb",
  borderRadius: 8, padding: "6px 10px", cursor: "pointer"
};

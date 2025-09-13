import React, { useEffect, useMemo, useState } from "react";

/**
 * PdfModalIframe
 * props:
 * - open: boolean
 * - onClose: () => void
 * - filePath: "explanation/1-1-1.pdf" 같은 Storage 내부 경로
 * - src: (옵션) 만약 절대 URL로 바로 넘기고 싶으면 이걸 사용
 * - title: 모달 제목
 * - sid: 학수번호(로그/분석용, UI에는 안 씀)
 */
export default function PdfModalIframe({ open, onClose, filePath, src, title, sid }) {
  const [loading, setLoading] = useState(false);
  const [iframeUrl, setIframeUrl] = useState("");
  const [err, setErr] = useState(null);

  const wantUrl = useMemo(() => {
    // src가 http(s)면 우선 사용
    if (src && /^https?:\/\//i.test(src)) return src;
    // filePath가 http(s)면 그대로
    if (filePath && /^https?:\/\//i.test(filePath)) return filePath;
    return null;
  }, [src, filePath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;              // 닫혀 있으면 아무 것도 안 함
      setErr(null);
      setLoading(true);
      setIframeUrl("");

      try {
        // 1) 이미 절대 URL을 받은 경우 (CDN, 직접 링크 등)
        if (wantUrl) {
          if (!cancelled) setIframeUrl(wantUrl);
          return;
        }

        // 2) Storage 내부 경로인 경우 getDownloadURL로 변환
        //    버킷: gs://jeonjolhyup.firebasestorage.app
        //    경로: explanation/1-1-1.pdf
        if (!filePath) throw new Error("파일 경로가 비어있어요.");

        const { initializeApp, getApps } = await import("firebase/app");
        const { getStorage, ref, getDownloadURL } = await import("firebase/storage");

        // 이미 초기화되어 있다면 재사용, 아니면 환경설정 필요
        // (프로젝트에 이미 firebase/app 초기화 되어 있다면 이 블록은 무시됨)
        if (getApps().length === 0) {
          // ⚠️ 이미 /services/firebase 등에서 initializeApp이 되어 있다면
          // 이 config는 무시되니 걱정 X. (혹시 없다면 아래를 채워주세요)
          initializeApp({
            apiKey: "YOUR_API_KEY",
            authDomain: "YOUR_PROJECT.firebaseapp.com",
            projectId: "YOUR_PROJECT_ID",
            storageBucket: "jeonjolhyup.firebasestorage.app", // 중요: 웹용 버킷 도메인
            appId: "YOUR_APP_ID",
          });
        }

        // 버킷 명시 (gs://… 형태도 지원)
        const storage = getStorage(undefined, "gs://jeonjolhyup.firebasestorage.app");
        const storageRef = ref(storage, filePath);
        const url = await getDownloadURL(storageRef);

        if (!cancelled) setIframeUrl(url);
      } catch (e) {
        console.error("PDF URL 로드 실패:", e);
        if (!cancelled) setErr(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, filePath, wantUrl]);

  if (!open) return null;

  return (
    <div
      className="pdf-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || "PDF 보기"}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        className="pdf-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(1100px, 96vw)",
          height: "min(90vh, 900px)",
          background: "#0b1020",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "rgba(255,255,255,0.04)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ color: "#e8eeff", fontWeight: 700, fontSize: 14 }}>
            {title || "특별 해설"}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "#e8eeff",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            닫기
          </button>
        </div>

        {/* 콘텐츠 */}
        <div style={{ position: "absolute", inset: 44 }}>
          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
                backgroundSize: "200% 100%",
                animation: "pdf-skeleton 1.2s ease-in-out infinite",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "3px solid rgba(255,255,255,0.2)",
                  borderTopColor: "var(--primary, #7ea2ff)",
                  animation: "spin 0.9s linear infinite",
                }}
                aria-label="PDF 로딩 중"
              />
            </div>
          )}

          {err && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "#ff9aa2",
                fontSize: 14,
                padding: 16,
                textAlign: "center",
              }}
            >
              <div>
                PDF를 불러오지 못했습니다.
                <br />
                <code style={{ opacity: 0.8 }}>{String(err?.message || err)}</code>
                <br />
                <div style={{ marginTop: 8, opacity: 0.8 }}>
                  파일 경로: <code>{filePath || src}</code>
                </div>
              </div>
            </div>
          )}

          {!loading && !err && iframeUrl && (
            <iframe
              title={title || "PDF"}
              src={iframeUrl}
              style={{ width: "100%", height: "100%", border: "none" }}
              allow="fullscreen"
            />
          )}
        </div>
      </div>

      {/* 키프레임 */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pdf-skeleton { 0% { background-position: 0% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}

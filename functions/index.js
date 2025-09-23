
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { PDFDocument, rgb, degrees, StandardFonts } = require("pdf-lib");

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();


function toKRE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+82")) return digits;
  const onlyDigits = digits.replace(/\D/g, "");
  if (onlyDigits.startsWith("0")) return "+82" + onlyDigits.slice(1);
  return null;
}

// PDF 워터마크 & 로깅
async function writeAudit({ uid, sid, filePath, action, meta = {}, req }) {
  const col = admin.firestore().collection("pdf_audit");
  const doc = {
    uid: uid || null,
    sid: sid || null,
    filePath,
    action,
    ts: admin.firestore.FieldValue.serverTimestamp(),
    ip: req?.ip || req?.headers?.["x-forwarded-for"] || null,
    ua: req?.headers?.["user-agent"] || null,
    ...meta,
  };
  await col.add(doc);
}

exports.serveWatermarkedPdf = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const { filePath, sid } = data || {};
  if (!filePath || !sid) {
    throw new functions.https.HttpsError("invalid-argument", "filePath, sid가 필요합니다.");
  }

  const bucket = admin.storage().bucket();
  const [bytes] = await bucket.file(filePath).download();

  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const text = String(sid);
  const fontSize = 42;
  const angle = degrees(36);
  const color = rgb(0.6, 0.6, 0.6);
  const opacity = 0.12;

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = fontSize;

    const stepX = textWidth * 1.8;
    const stepY = textHeight * 1.0;

    for (let y = -stepY; y < height + stepY; y += stepY) {
      const xOffset = (y / stepY) % 2 === 0 ? 0 : stepX / 2;
      for (let x = -stepX; x < width + stepX; x += stepX) {
        page.drawText(text, {
          x: x + xOffset,
          y,
          size: fontSize,
          font,
          color,
          opacity,
          rotate: angle,
        });
      }
    }
    page.drawText(text, {
      x: 24,
      y: 24,
      size: 12,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.6,
    });
  }

  const out = await pdfDoc.save();

  await writeAudit({
    uid: context.auth.uid,
    sid,
    filePath,
    action: "view",
    req: context.rawRequest,
  });

  return Buffer.from(out).toString("base64");
});

exports.logPdfAction = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { filePath, sid, action, meta } = data || {};
  if (!filePath || !sid || !action) {
    throw new functions.https.HttpsError("invalid-argument", "filePath, sid, action이 필요합니다.");
  }
  await writeAudit({
    uid: context.auth.uid,
    sid,
    filePath,
    action,
    meta: meta || {},
    req: context.rawRequest
  });
  return { ok: true };
});

exports.getExplanationIndex = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { roundLabel } = data || {};
  const bucket = admin.storage().bucket();

  const [files] = await bucket.getFiles({ prefix: "explanation/" });
  const bySession = { "1교시": [], "2교시": [], "3교시": [], "4교시": [] };

  files.forEach(f => {
    const m = f.name.match(/^explanation\/(\d+)-(\d+)-(\d+)\.pdf$/);
    if (!m) return;
    const [_, r, s, q] = m;
    const rLabel = `${parseInt(r,10)}차`;
    const sLabel = `${parseInt(s,10)}교시`;
    const qNum   = parseInt(q, 10);
    if (roundLabel && roundLabel !== rLabel) return;
    if (bySession[sLabel]) bySession[sLabel].push(qNum);
  });

  Object.keys(bySession).forEach(k => {
    const set = new Set(bySession[k]);
    bySession[k] = Array.from(set).sort((a,b)=>a-b);
  });

  return bySession;
});


exports.verifyAndBindPhoneSid = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const { phone, sid } = data || {};
  const e164 = toKRE164(phone);
  if (!e164) {
    throw new functions.https.HttpsError("invalid-argument", "유효한 전화번호 형식이 아닙니다.");
  }
  const cleanSid = String(sid || '').trim();
  if (!/^\d{6}$/.test(cleanSid)) {
    throw new functions.https.HttpsError("invalid-argument", "학수번호는 6자리 숫자여야 합니다.");
  }

  const snap = await db.collection('phones').doc(e164).get();
  if (!snap.exists) {
    return { ok: false, code: 'PHONE_NOT_FOUND', message: '등록되지 않은 전화번호입니다.' };
  }
  const sids = snap.data()?.sids || [];
  if (!sids.includes(cleanSid)) {
    return { ok: false, code: 'SID_MISMATCH', message: '전화번호와 학수번호가 일치하지 않습니다.' };
  }

  const uid = context.auth.uid;
  const bindRef = db.collection('bindings').doc(uid);
  await bindRef.set({
    sids: admin.firestore.FieldValue.arrayUnion(cleanSid),
    phone: e164,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, message: '검증 및 바인딩 완료', phone: e164, sid: cleanSid };
});

exports.getMyBindings = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = context.auth.uid;
  const snap = await db.collection('bindings').doc(uid).get();
  if (!snap.exists) return { ok: true, sids: [], phone: null };
  const { sids = [], phone = null } = snap.data() || {};
  return { ok: true, sids, phone };
});

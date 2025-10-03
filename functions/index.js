// functions/index.js
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

// Storage에 phones_seed.xlsx 업로드 시 자동 실행
exports.onPhonesFileUploaded = functions
  .region('asia-northeast3') // ✅ 8GB가 적용되지 않는 Storage 트리거지만, 지역은 통일
  .storage.object().onFinalize(async (object) => {
  const filePath = object.name;
  
  console.log('=== Storage 트리거 실행 ===');
  console.log('파일 경로:', filePath);
  console.log('파일명 비교:', filePath === 'phones_seed.xlsx');
  console.log('버킷:', object.bucket);
  console.log('이벤트 타입:', object.eventType);
  
  if (filePath !== 'phones_seed.xlsx') {
    console.log('phones_seed.xlsx가 아닌 파일이므로 무시');
    return null;
  }

  console.log('phones_seed.xlsx 파일 처리 시작!');
  
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    
    console.log('파일 다운로드 시도...');
    const [fileBuffer] = await file.download();
    console.log('파일 다운로드 완료, 크기:', fileBuffer.length);
    
    const XLSX = require('xlsx');
    console.log('XLSX 파싱 시작...');
    const workbook = XLSX.read(fileBuffer);
    const sheetName = workbook.Sheets[workbook.SheetNames[0]];
    console.log('시트명:', sheetName);
    
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);
    console.log('파싱된 행 수:', rows.length);
    console.log('첫 번째 행 샘플:', rows[0]);

    let successCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      try {
        const rawPhone = row.phone || row.전화번호 || row['전화번호'] || row.Phone || row.PHONE;
        const rawSid = row.sid || row.학수번호 || row['학수번호'] || row.Sid || row.SID;
        
        if (!rawPhone || !rawSid) {
          continue;
        }

        const phone = toKRE164(rawPhone);
        if (!phone) {
          errorCount++;
          continue;
        }

        const sid = String(rawSid).trim();
        if (!/^\d{6}$/.test(sid)) {
          errorCount++;
          continue;
        }

        const phoneRef = db.collection('phones').doc(phone);
        await phoneRef.set({ sids: [sid] });
        
        successCount++;
      } catch (error) {
        console.error('행 처리 오류:', error);
        errorCount++;
      }
    }

    console.log(`처리 완료: 성공 ${successCount}건, 실패 ${errorCount}건`);
    
  } catch (error) {
    console.error('전체 처리 오류:', error);
  }
});

exports.serveWatermarkedPdf = functions
  .region('asia-northeast3') // ✅ 지역 설정
  .runWith({ memory: '8GB', timeoutSeconds: 180 }) // ✅ 8GB 메모리 설정
  .https.onCall(async (data, context) => {
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
  const fontSize = 64; // ✅ 크기를 64로 증가
  const angle = degrees(45); // ✅ 45도 기울임
  const color = rgb(0.6, 0.6, 0.6);
  const opacity = 0.12;

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    
    // ✅ X축 정중앙 시작점 계산: (페이지 너비 - 텍스트 너비) / 2
    const centerX = (width - textWidth) / 2; 
    
    const textHeight = fontSize;
    const stepY = textHeight * 3.5; // Y축 반복 간격 (띄엄띄엄 배치)

    // Y축 중앙을 기준으로 위아래로 반복 배치
    for (let y = -height * 0.5; y < height * 2.5; y += stepY) { // Y축 범위를 더 넓혀 짤림 방지
      page.drawText(text, {
        x: centerX, // ✅ X축 정중앙 시작점에 고정
        y: y, 
        size: fontSize,
        font,
        color,
        opacity,
        rotate: angle, // 45도
      });
    }
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

exports.logPdfAction = functions
  .region('asia-northeast3')
  .runWith({ memory: '8GB', timeoutSeconds: 180 })
  .https.onCall(async (data, context) => {
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

// 해설 인덱스 조회 (Storage 기반)
exports.getExplanationIndex = functions
  .region('asia-northeast3')
  .runWith({ memory: '8GB', timeoutSeconds: 180 })
  .https.onCall(async (data, context) => {
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

// 많이 틀린 문항 조회 - 단순화된 더미 데이터
exports.getHighErrorRateQuestions = functions
  .region('asia-northeast3')
  .runWith({ memory: '8GB', timeoutSeconds: 180 })
  .https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  
  const { roundLabel } = data || {};
  
  // 단순한 더미 데이터 반환 - 실제 과목 매핑은 프론트엔드에서 처리
  const dummyData = {
    "간": [], "심": [], "비": [], "폐": [], "신": [],
    "상한": [], "사상": [], "침구": [], "법규": [],
    "외과": [], "신정": [], "안이비": [], "부인": [],
    "소아": [], "예방": [], "생리": [], "본초": []
  };
  
  // 각 과목마다 랜덤하게 문제들 생성 (프론트엔드에서 과목별로 필터링됨)
  const sessions = ["1교시", "2교시", "3교시", "4교시"];
  const sessionRanges = { "1교시": 80, "2교시": 100, "3교시": 80, "4교시": 80 };
  
  Object.keys(dummyData).forEach(subject => {
    sessions.forEach(session => {
      const maxQ = sessionRanges[session];
      // 각 세션에서 랜덤하게 문제들 생성
      const questionCount = Math.floor(Math.random() * 10) + 5; 
      for (let i = 0; i < questionCount; i++) {
        const qNum = Math.floor(Math.random() * maxQ) + 1;
        dummyData[subject].push({
          questionNum: qNum,
          errorRate: Math.random() * 0.7 + 0.3,
          session: session
        });
      }
    });
    
    // 중복 제거 및 정렬
    const uniqueQuestions = Array.from(
      new Map(dummyData[subject].map(q => [q.questionNum + q.session, q])).values()
    );
    dummyData[subject] = uniqueQuestions.sort((a, b) => b.errorRate - a.errorRate);
  });

  return { data: dummyData };
});

exports.verifyAndBindPhoneSid = functions
  .region('asia-northeast3')
  .runWith({ memory: '8GB', timeoutSeconds: 180 })
  .https.onCall(async (data, context) => {
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

exports.getMyBindings = functions
  .region('asia-northeast3')
  .runWith({ memory: '8GB', timeoutSeconds: 180 })
  .https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = context.auth.uid;
  const snap = await db.collection('bindings').doc(uid).get();
  if (!snap.exists) return { ok: true, sids: [], phone: null };
  const { sids = [], phone = null } = snap.data() || {};
  return { ok: true, sids, phone };
});


exports.warmupPdfService = functions
  .region('asia-northeast3')
  .runWith({ memory: '8GB', timeoutSeconds: 180 })
  .https.onCall(async (data, context) => {
    console.log('PDF 서비스 워밍업');
    try {
      const testPdf = await PDFDocument.create();
      await testPdf.embedFont(StandardFonts.Helvetica);
      return { warmed: true, timestamp: Date.now() };
    } catch (error) {
      return { warmed: false, error: error.message };
    }
  });

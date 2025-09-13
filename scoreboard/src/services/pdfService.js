// scoreboard/src/services/pdfService.js
import { getFunctions, httpsCallable } from "firebase/functions";

export async function fetchWatermarkedPdfBase64(filePath, sid) {
  const functions = getFunctions();
  const serve = httpsCallable(functions, "serveWatermarkedPdf");
  const res = await serve({ filePath, sid });
  return res.data; // base64
}

export async function logPdfAction({ filePath, sid, action, meta = {} }) {
  const functions = getFunctions();
  const logger = httpsCallable(functions, "logPdfAction");
  try { await logger({ filePath, sid, action, meta }); } catch {}
}

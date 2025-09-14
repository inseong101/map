// src/App.jsx
import React, { useState, useEffect } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import './App.css';

import {
  discoverRoundsFor,
  getSchoolFromSid,
  fetchRoundData, // ✅ 세부데이터(그룹/과목/오답) 가져오기
} from './services/dataService';

import { doc, getDoc } from 'firebase/firestore';
import { auth, db, functions } from './firebase'; // ✅ functions도 여기서 가져오면 region 일치
import {
  RecaptchaVerifier,
  signInWithPhoneNumber
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

// === 모든 회차 라벨(보정용) ===
// 필요에 맞게 늘리세요. (ex. '3차','4차' ...)
const ALL_ROUND_LABELS = ['1차', '2차'];

// === rounds 보정: 누락 회차 absent 처리 ===
function normalizeRounds(inputRounds) {
  const arr = Array.isArray(inputRounds) ? inputRounds : [];
  const byLabel = new Map(arr.map(r => [r.label, r]));
  return ALL_ROUND_LABELS.map(label =>
    byLabel.get(label) || { label, data: { status: 'absent' } }
  );
}

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

// 교시별 Firestore 점수 합산
async function getRoundTotalFromFirestore(roundLabel, sid) {
  const perSession = [];
  let completedCount = 0;

  for (const session of SESSIONS) {
    const ref = doc(db, 'scores_raw', roundLabel, session, sid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      perSession.push(0);
      continue;
    }
    const d = snap.data() || {};
    if (d.status === 'completed') {
      completedCount++;
      const s = Number(d.totalScore);
      perSession.push(Number.isFinite(s) ? s : 0);
    } else {
      perSession.push(0);
    }
  }

  const total = perSession.reduce((a, b) => a + b, 0);
  const roundStatus =
    completedCount === 4 ? 'completed' :
    completedCount === 0 ? 'absent' : 'dropout';

  return { total, sessionScores: perSession, roundStatus };
}

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [studentId, setStudentId] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [confirmation, setConfirmation] = useState(null);

  const [rounds, setRounds] = useState([]);
  const [hydratedRounds, setHydratedRounds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState('');

  // reCAPTCHA 세팅 (v9)
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        'recaptcha-container',
        { size: 'invisible' }
      );
    }
  }, []);

  // 인증번호 요청
  const handleSendCode = async () => {
    try {
      setError('');
      const appVerifier = window.recaptchaVerifier;
      const conf = await signInWithPhoneNumber(auth, phone, appVerifier);
      setConfirmation(conf);
      alert('인증번호가 전송되었습니다.');
    } catch (err) {
      console.error('SMS 전송 오류:', err);
      setError(err?.message || 'SMS 전송에 실패했습니다.');
    }
  };

  // 서버에서 전화번호-학수번호 검증 + 바인딩
  async function serverVerifyAndBind(phoneInput, sidInput) {
    const verifyFn = httpsCallable(functions, 'verifyAndBindPhoneSid');
    const res = await verifyFn({ phone: phoneInput, sid: sidInput });
    const { ok, code, message } = res.data || {};
    if (!ok) {
      const msg =
        code === 'PHONE_NOT_FOUND' ? '등록되지 않은 전화번호입니다.' :
        code === 'SID_MISMATCH'    ? '전화번호와 학수번호가 일치하지 않습니다.' :
        message || '검증에 실패했습니다.';
      throw new Error(msg);
    }
    return true;
  }

  // 인증번호 검증 + 바인딩까지
  const handleVerifyCode = async () => {
    try {
      if (!confirmation) {
        setError('먼저 인증번호를 받아주세요.');
        return false;
      }
      // ① 전화번호 인증(로그인)
      await confirmation.confirm(smsCode);
      // ② 서버 검증 + bindings/{uid}.sids 에 추가
      await serverVerifyAndBind(phone, studentId);
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(err?.message || '인증 또는 바인딩에 실패했습니다.');
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!/^\d{6}$/.test(studentId)) {
      setError('학수번호는 숫자 6자리여야 합니다.');
      return;
    }
    if (!confirmation) {
      setError('먼저 인증번호를 받아주세요.');
      return;
    }

    const ok = await handleVerifyCode();
    if (!ok) return;

    setLoading(true);
    try {
      // 존재 회차 탐색(실데이터 기반)
      const foundRounds = await discoverRoundsFor(studentId);

      if (foundRounds.length === 0) {
        setError('존재하지 않는 학수번호이거나 점수 데이터가 없습니다.');
        return;
      }
      setCurrentView('result');
      setRounds(foundRounds);
      setHydrating(true);
    } catch (err) {
      console.error(err);
      setError('데이터 조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 결과 화면 Hydrate (✅ 세부데이터까지 병합해서 RoundCard로 전달)
  useEffect(() => {
    async function hydrate() {
      if (currentView !== 'result') return;
      if (!studentId || rounds.length === 0) {
        setHydratedRounds([]);
        setHydrating(false);
        return;
      }
      try {
        const out = [];
        for (const { label, data } of rounds) {
          // 1) 교시별 합산/상태
          const { total, sessionScores, roundStatus } =
            await getRoundTotalFromFirestore(label, studentId);

          // 2) 세부 데이터(그룹별 점수/과목별 점수/오답 by 세션)
          const detailed = await fetchRoundData(studentId, label);

          // 3) 병합
          out.push({
            label,
            data: {
              ...(detailed || {}),   // groupResults, subjectScores, wrongBySession 등
              ...(data || {}),
              sessionScores,
              totalScore: total,
              totalMax: 340,
              status: roundStatus
            }
          });
        }
        setHydratedRounds(out);
      } catch (e) {
        console.error('보정 점수 생성 실패:', e);
        setHydratedRounds(rounds);
      } finally {
        setHydrating(false);
      }
    }
    hydrate();
  }, [currentView, studentId, rounds]);

  /* =========================
     화면 렌더
     ========================= */
  if (currentView === 'result') {
    const school = getSchoolFromSid(studentId);
    const base = hydratedRounds.length ? hydratedRounds : rounds;
    const effectiveRounds = normalizeRounds(base);

    if (hydrating) {
      return (
        <div className="container">
          <div className="card narrow">
            <div className="spinner" />
            <div style={{ textAlign: 'center', fontWeight: 800 }}>불러오는 중...</div>
          </div>
        </div>
      );
    }

    return (
      <div className="container">
        <h1>성적 조회</h1>
        <StudentCard sid={studentId} school={school} rounds={effectiveRounds} />
        {effectiveRounds.map(({ label, data }) => (
          <RoundCard key={label} label={label} data={data} sid={studentId} />
        ))}
      </div>
    );
  }

  // 홈(인증/조회 폼) — 깔끔한 카드 UI
  return (
    <div className="container">
      <h1>본인 점수 확인</h1>
      <div className="card narrow">
        <form onSubmit={handleSubmit} className="flex-column">
          <label style={{ fontWeight: 800 }}>학수번호</label>
          <input
            className="input"
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="예) 015001"
          />

          <label style={{ fontWeight: 800, marginTop: 6 }}>전화번호</label>
          <div className="flex" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+821012345678 또는 010-1234-5678"
            />
            <button type="button" className="btn secondary" onClick={handleSendCode}>
              인증번호 받기
            </button>
          </div>

          <label style={{ fontWeight: 800, marginTop: 6 }}>인증번호</label>
          <input
            className="input"
            type="text"
            value={smsCode}
            onChange={(e) => setSmsCode(e.target.value)}
            placeholder="예) 123456"
          />

          <button type="submit" className="btn" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? '조회 중...' : '인증 확인 후 성적 보기'}
          </button>
        </form>

        {error && <div className="alert">{error}</div>}
      </div>

      <div id="recaptcha-container"></div>
    </div>
  );
}

export default App;

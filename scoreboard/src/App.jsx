// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import './App.css';

import {
  discoverRoundsFor,
  getSchoolFromSid,
  fetchRoundData, // 세부데이터(그룹/과목/오답)
} from './services/dataService';

import { doc, getDoc } from 'firebase/firestore';
import { auth, db, functions } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

// 필요에 맞게 늘리세요.
const ALL_ROUND_LABELS = ['1차', '2차'];
const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];
const RESEND_COOLDOWN = 60; // 인증번호 재전송 쿨다운(초)

// 누락 회차 absent 처리
function normalizeRounds(inputRounds) {
  const arr = Array.isArray(inputRounds) ? inputRounds : [];
  const byLabel = new Map(arr.map(r => [r.label, r]));
  return ALL_ROUND_LABELS.map(label =>
    byLabel.get(label) || { label, data: { status: 'absent' } }
  );
}

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

// 에러코드 → 친절한 한국어 메시지
function mapAuthError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/too-many-requests':
      return '요청이 너무 많이 시도되어 잠시 차단되었습니다. 잠시 후 다시 시도해주세요.';
    case 'auth/invalid-phone-number':
      return '전화번호 형식이 올바르지 않습니다. (예: +821012345678 또는 010-1234-5678)';
    case 'auth/missing-phone-number':
      return '전화번호를 입력해주세요.';
    case 'auth/invalid-verification-code':
      return '인증번호가 올바르지 않습니다.';
    case 'auth/code-expired':
      return '인증번호가 만료되었습니다. 다시 요청해주세요.';
    case 'functions/internal':
    case 'functions/invalid-argument':
      return '서버 검증 중 오류가 발생했습니다. 정보를 확인하고 다시 시도해주세요.';
    default:
      return err?.message || '요청 처리 중 오류가 발생했습니다.';
  }
}

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [studentId, setStudentId] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [confirmation, setConfirmation] = useState(null);

  // 상태
  const [rounds, setRounds] = useState([]);
  const [hydratedRounds, setHydratedRounds] = useState([]);
  const [error, setError] = useState('');

  // 버튼/플로우 락
  const [sending, setSending] = useState(false);     // 인증번호 보내는 중
  const [verifying, setVerifying] = useState(false); // 코드 검증/바인딩 중
  const [loading, setLoading] = useState(false);     // 성적 조회 중
  const [hydrating, setHydrating] = useState(false); // 결과 상세 합성 중

  // 재전송 쿨다운
  const [resendLeft, setResendLeft] = useState(0);
  const cooldownTimerRef = useRef(null);

  // reCAPTCHA (v9)
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        'recaptcha-container',
        { size: 'invisible' }
      );
    }
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, []);

  // 쿨다운 타이머 시작
  const startCooldown = () => {
    setResendLeft(RESEND_COOLDOWN);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setResendLeft(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 인증번호 요청
  const handleSendCode = async () => {
    if (sending || verifying || loading || resendLeft > 0) return; // 중복 방지
    setError('');

    // 간단한 입력 유효성
    const cleanPhone = String(phone).trim();
    if (!cleanPhone) {
      setError('전화번호를 입력해주세요.');
      return;
    }

    try {
      setSending(true);
      const appVerifier = window.recaptchaVerifier;
      const conf = await signInWithPhoneNumber(auth, cleanPhone, appVerifier);
      setConfirmation(conf);
      startCooldown();
      alert('인증번호가 전송되었습니다.');
    } catch (err) {
      console.error('SMS 전송 오류:', err);
      setError(mapAuthError(err));
    } finally {
      setSending(false);
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
    if (verifying) return false;
    setError('');

    if (!confirmation) {
      setError('먼저 인증번호를 받아주세요.');
      return false;
    }
    try {
      setVerifying(true);
      // ① 전화번호 인증(로그인)
      await confirmation.confirm(smsCode);
      // ② 서버 검증 + bindings/{uid}.sids 에 추가
      await serverVerifyAndBind(phone, studentId);
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(mapAuthError(err));
      return false;
    } finally {
      setVerifying(false);
    }
  };

  // 성적 조회 제출
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

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

  // 결과 화면 Hydrate: 교시합산 + 세부데이터(그룹/과목/오답)
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
          const { total, sessionScores, roundStatus } =
            await getRoundTotalFromFirestore(label, studentId);
          const detailed = await fetchRoundData(studentId, label); // WrongPanel/그룹용

          out.push({
            label,
            data: {
              ...(detailed || {}),
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

  /* ============ 렌더링 ============ */

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

  // 홈(인증/조회 폼)
  const sendDisabled =
    sending || verifying || loading || resendLeft > 0 || !phone.trim();
  const submitDisabled =
    sending || verifying || loading || !studentId || !smsCode;

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
            disabled={sending || verifying || loading}
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
              disabled={sending || verifying || loading}
            />
            <button
              type="button"
              className="btn secondary"
              onClick={handleSendCode}
              disabled={sendDisabled}
              title={resendLeft > 0 ? `재전송까지 ${resendLeft}초` : ''}
            >
              {sending
                ? '전송 중...'
                : resendLeft > 0
                  ? `재전송(${resendLeft}s)`
                  : '인증번호 받기'}
            </button>
          </div>

          <label style={{ fontWeight: 800, marginTop: 6 }}>인증번호</label>
          <input
            className="input"
            type="text"
            value={smsCode}
            onChange={(e) => setSmsCode(e.target.value)}
            placeholder="예) 123456"
            disabled={sending || verifying || loading}
          />

          <button
            type="submit"
            className="btn"
            disabled={submitDisabled}
            style={{ marginTop: 6 }}
          >
            {verifying
              ? '인증 확인 중...'
              : loading
                ? '조회 중...'
                : '인증 확인 후 성적 보기'}
          </button>
        </form>

        {error && <div className="alert" style={{ whiteSpace: 'pre-line' }}>{error}</div>}
      </div>

      <div id="recaptcha-container"></div>
    </div>
  );
}

export default App;

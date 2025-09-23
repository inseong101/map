import React, { useState, useEffect, useRef } from 'react';
import ControversialPanel from './components/ControversialPanel';
import './App.css';

import { auth, functions } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

const ALL_ROUND_LABELS = ['1차', '2차', '3차', '4차', '5차', '6차', '7차', '8차'];
const RESEND_COOLDOWN = 60;

function mapAuthError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/too-many-requests':
      return '요청이 너무 많이 시도되어 잠시 차단되었습니다. 잠시 후 다시 시도해주세요.';
    case 'auth/invalid-phone-number':
      return '전화번호 형식이 올바르지 않습니다. (예: +821012345678)';
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
  const [error, setError] = useState('');

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const cooldownTimerRef = useRef(null);
  const [selectedRoundLabel, setSelectedRoundLabel] = useState(ALL_ROUND_LABELS[0]);
  const [availableRounds, setAvailableRounds] = useState(ALL_ROUND_LABELS); // ✅ 회차 목록을 앱에서 직접 정의

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

  const startCooldown = () => {
    setResendLeft(RESEND_COOLDOWN);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setResendLeft(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    if (sending || verifying || loading || resendLeft > 0) return;
    setError('');

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

  const serverVerifyAndBind = async (phoneInput, sidInput) => {
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
  };

  const handleVerifyCode = async () => {
    if (verifying) return false;
    setError('');

    if (!confirmation) {
      setError('먼저 인증번호를 받아주세요.');
      return false;
    }
    try {
      setVerifying(true);
      await confirmation.confirm(smsCode);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(studentId)) {
        setError('학수번호는 숫자 6자리여야 합니다.');
        return;
    }
    const ok = await handleVerifyCode();
    if (ok) {
      setCurrentView('controversial');
    }
  };

  const handleLogout = () => {
    auth.signOut();
    setCurrentView('home');
    setStudentId('');
    setPhone('');
    setSmsCode('');
    setConfirmation(null);
  };

  if (currentView === 'controversial') {
    return (
      <div className="container">
        <ControversialPanel
          allRoundLabels={availableRounds}
          roundLabel={selectedRoundLabel}
          onRoundChange={setSelectedRoundLabel}
          sid={studentId}
          onBack={handleLogout}
        />
      </div>
    );
  }

  const sendDisabled = sending || verifying || loading || resendLeft > 0 || !phone.trim();
  const submitDisabled = sending || verifying || loading || !studentId || !smsCode;

  return (
    <div className="container">
      <div id="recaptcha-container" />
      <h1>많이 틀린 문항 해설</h1>
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
              placeholder="010-1234-5678"
              disabled={sending || verifying}
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
            disabled={sending || verifying}
          />
          <button
            type="submit"
            className="btn"
            disabled={submitDisabled}
            style={{ marginTop: 6 }}
          >
            {verifying ? '인증 확인 중...' : '인증 확인 후 해설 보기'}
          </button>
        </form>
        {error && <div className="alert" style={{ whiteSpace: 'pre-line' }}>{error}</div>}
      </div>
    </div>
  );
}

export default App;

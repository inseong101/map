// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import ControversialPanel from './components/ControversialPanel';
import './App.css';

import { auth, functions } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

const ALL_ROUND_LABELS = ['1차', '2차']; // 논란 문제 해설을 제공할 회차
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
    default:
      return err?.message || '요청 처리 중 오류가 발생했습니다.';
  }
}

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState('');

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const cooldownTimerRef = useRef(null);

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
    if (sending || verifying || resendLeft > 0) return;
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
      return true;
    } catch (err) {
      console.error('코드 검증 오류:', err);
      setError(mapAuthError(err));
      return false;
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await handleVerifyCode();
    if (ok) {
      setCurrentView('controversial');
    }
  };

  const handleLogout = () => {
    auth.signOut();
    setCurrentView('home');
    setPhone('');
    setSmsCode('');
    setConfirmation(null);
  };

  if (currentView === 'controversial') {
    return (
      <div className="container">
        <ControversialPanel
          roundLabel={ALL_ROUND_LABELS[0]}
          sid={auth.currentUser?.uid || 'guest'}
          onBack={handleLogout}
        />
      </div>
    );
  }

  const sendDisabled = sending || verifying || resendLeft > 0 || !phone.trim();
  const submitDisabled = sending || verifying || !smsCode;

  return (
    <div className="container">
      <div id="recaptcha-container" />
      <h1>논란 문제 해설</h1>
      <div className="card narrow">
        <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} className="flex-column">
          <label style={{ fontWeight: 800 }}>전화번호</label>
          <div className="flex" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+821012345678 또는 010-1234-5678"
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
            {verifying ? '인증 확인 중...' : '인증 확인'}
          </button>
        </form>

        {error && <div className="alert" style={{ whiteSpace: 'pre-line' }}>{error}</div>}
      </div>
    </div>
  );
}

export default App;

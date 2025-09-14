// src/components/PhoneLogin.jsx
import React, { useEffect, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export default function PhoneLogin({ onSignedIn }) {
  const [phone, setPhone] = useState('');     // 예: +821012345678
  const [code, setCode]   = useState('');
  const [phase, setPhase] = useState('enter'); // enter | sent | done
  const confirmRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    }
  }, []);

  const sendCode = async () => {
    setError('');
    try {
      if (!phone.startsWith('+82')) {
        return setError('국제포맷으로 입력하세요. 예: +821042762945');
      }
      const appVerifier = window.recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, phone, appVerifier);
      confirmRef.current = result;
      setPhase('sent');
    } catch (e) {
      setError(e.message || '전송 실패');
    }
  };

  const verifyCode = async () => {
    setError('');
    try {
      if (!confirmRef.current) return setError('인증 세션이 없습니다.');
      await confirmRef.current.confirm(code);
      setPhase('done');
      onSignedIn?.(); // 부모에 알림
    } catch (e) {
      setError('인증코드가 올바르지 않습니다.');
    }
  };

  return (
    <div>
      <div id="recaptcha-container" />
      {phase === 'enter' && (
        <>
          <label className="small">전화번호(+82…)</label>
          <input className="input" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+8210XXXXYYYY" />
          <button className="btn" onClick={sendCode}>인증코드 받기</button>
        </>
      )}
      {phase === 'sent' && (
        <>
          <label className="small">인증코드</label>
          <input className="input" value={code} onChange={e=>setCode(e.target.value)} />
          <button className="btn" onClick={verifyCode}>확인</button>
        </>
      )}
      {error && <div className="alert" role="alert">{error}</div>}
    </div>
  );
}

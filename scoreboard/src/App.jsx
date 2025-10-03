// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import ControversialPanel from './components/ControversialPanel';
import './App.css';

import { auth, functions } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged } from 'firebase/auth'; // ✅ onAuthStateChanged 추가
import { httpsCallable } from 'firebase/functions';

// ✅ 회차 목록을 앱 내에서 직접 정의
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
  const [currentView, setCurrentView] = useState('loading'); // ✅ loading 상태 추가
  const [user, setUser] = useState(null); // ✅ user 상태 추가
  const [studentId, setStudentId] = useState('');
  const [boundSids, setBoundSids] = useState([]); // ✅ boundSids 상태 추가
  const [boundPhone, setBoundPhone] = useState(''); // ✅ boundPhone 상태 추가
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState('');

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false); // ✅ loading 상태 사용
  const [resendLeft, setResendLeft] = useState(0);
  const cooldownTimerRef = useRef(null);
  const [selectedRoundLabel, setSelectedRoundLabel] = useState(ALL_ROUND_LABELS[0]);
  const [availableRounds, setAvailableRounds] = useState(ALL_ROUND_LABELS);

  // ✅ 1. Auth 상태 감지 및 Recaptcha 초기화
  useEffect(() => {
    // Recaptcha 초기화
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        'recaptcha-container',
        { size: 'invisible' }
      );
    }
    
    // Auth 상태 변경 리스너
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        setCurrentView('loading');
        await fetchBoundSids(user);
      } else {
        setCurrentView('home');
        setBoundSids([]);
        setStudentId('');
        setBoundPhone('');
      }
    });

    return () => {
      unsubscribe();
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, []);
  
  // ✅ 2. 바인딩된 SID를 서버에서 가져와 메인 뷰로 전환
  const fetchBoundSids = async (user) => {
    try {
      setLoading(true);
      const getBindingsFn = httpsCallable(functions, 'getMyBindings');
      const res = await getBindingsFn();
      const { sids = [], phone: fetchedPhone } = res.data || {};
      
      setBoundSids(sids);
      setBoundPhone(fetchedPhone || ''); 

      // 단일 SID 모델 적용
      if (sids.length === 1) { 
        setStudentId(sids[0]);
        setCurrentView('main'); // ✅ 메인 화면으로 이동
      } else {
        setCurrentView('home'); 
      }
    } catch (err) {
      console.error('바인딩 SID 로드 오류:', err);
      setError('로그인 상태를 확인할 수 없습니다. 다시 시도해주세요.');
      setCurrentView('home');
    } finally {
      setLoading(false);
    }
  };


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

    // ✅ [강화]: 새로운 요청 시작 시 이전 상태 초기화
    setConfirmation(null); 

    const cleanPhone = String(phone).trim().replace(/-/g, '');
    const formattedPhone = cleanPhone.startsWith('010') ? `+82${cleanPhone.substring(1)}` : cleanPhone;

    if (!formattedPhone) {
      setError('전화번호를 입력해주세요.');
      return;
    }

    try {
      setSending(true);
      const appVerifier = window.recaptchaVerifier;
      await appVerifier.render(); // reCAPTCHA 렌더링 강제
      
      const conf = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
      setConfirmation(conf);
      startCooldown();
      alert('인증번호가 전송되었습니다.');
    } catch (err) {
      console.error('SMS 전송 오류:', err);
      setError(mapAuthError(err));
      window.recaptchaVerifier.clear(); // 오류 시 초기화
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
      
      // ✅ [강화]: Firebase Auth 확인과 서버 바인딩을 순차적으로 빠르게 처리
      const result = await confirmation.confirm(smsCode);
      await serverVerifyAndBind(phone, studentId);
      
      // 로그인 및 바인딩 성공 후 상태 업데이트
      setUser(result.user);
      await fetchBoundSids(result.user); // 메인 화면으로 전환
      
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(mapAuthError(err));
      setConfirmation(null); // 실패 시 초기화
      if (window.recaptchaVerifier) window.recaptchaVerifier.clear();
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
    await handleVerifyCode();
  };

  const handleLogout = () => {
    auth.signOut();
    setCurrentView('loading');
    setStudentId('');
    setPhone('');
    setSmsCode('');
    setConfirmation(null);
  };

  // ----------------------
  // 뷰 렌더링
  // ----------------------
  const renderContent = () => {
    switch (currentView) {
      case 'loading':
        return (
          <div style={{ textAlign: 'center', padding: '100px 0' }}>
            <div className="spinner" />
            <p className="small">로그인 상태 확인 및 데이터 로드 중...</p>
          </div>
        );
      
      case 'controversial':
        return (
          <div className="container">
            <ControversialPanel
              allRoundLabels={availableRounds}
              roundLabel={selectedRoundLabel}
              onRoundChange={setSelectedRoundLabel}
              sid={studentId}
              onBack={() => setCurrentView('main')} // 메인으로 복귀
            />
          </div>
        );

      case 'main':
        {
          const selectedSid = studentId; 
          const displayPhone = boundPhone || user?.phoneNumber || '알 수 없음';
          
          return (
              <div className="container">
                  <h1 style={{ marginBottom: '16px' }}>환영합니다!</h1>
                  <div className="card narrow">
                      <h2 style={{ fontSize: '20px' }}>로그인 정보</h2>
                      
                      <div className="group-grid" style={{ marginBottom: '20px' }}>
                          <div className="group-box span-12">
                              <p style={{ margin: 0, fontWeight: 800 }}>인증된 전화번호</p>
                              <p style={{ margin: 0, fontSize: '18px', color: 'var(--primary)', fontWeight: 700 }}>{displayPhone}</p>
                          </div>
                          <div className="group-box span-12">
                              <p style={{ margin: 0, fontWeight: 800 }}>현재 학수번호</p>
                              <p className="kpi" style={{ margin: 0 }}>
                                  <span className="num" style={{ fontSize: '28px' }}>{selectedSid || '오류'}</span>
                              </p>
                          </div>
                      </div>

                      <hr className="sep" />

                      <button
                          className="btn primary wide"
                          onClick={() => setCurrentView('controversial')}
                          disabled={!selectedSid}
                          style={{ height: '48px', fontSize: '16px' }}
                      >
                          해설 페이지로 이동
                      </button>

                      <hr className="sep" />
                      <button onClick={handleLogout} className="btn secondary wide">
                          로그아웃
                      </button>
                  </div>
              </div>
          );
        }

      case 'home':
      default:
        {
          const isInteracting = sending || verifying || loading;
          const sendDisabled = isInteracting || resendLeft > 0 || !phone.trim();
          const submitDisabled = isInteracting || !studentId || !smsCode;

          return (
            <div className="container">
              <h1>학수번호 인증</h1>
              <div className="card narrow">
                <form onSubmit={handleSubmit} className="flex-column">
                  <label style={{ fontWeight: 800 }}>학수번호</label>
                  <input
                    className="input"
                    type="text"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="예) 015001"
                    disabled={isInteracting}
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
                      disabled={isInteracting}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={handleSendCode}
                      disabled={sendDisabled} // ✅ 이 조건이 false일 때 버튼이 활성화됩니다.
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
                    disabled={isInteracting}
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
    }
  };


  return (
    <div className="app-root-container">
      {/* reCAPTCHA 컨테이너를 모든 뷰에서 항상 DOM에 존재하도록 고정 */}
      <div 
        id="recaptcha-container" 
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} 
      />
      {renderContent()}
    </div>
  );
}

export default App;

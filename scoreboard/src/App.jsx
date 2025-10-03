// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import ControversialPanel from './components/ControversialPanel';
import './App.css';

import { auth, functions } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged } from 'firebase/auth'; 
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
    case 'auth/code-expired':
      return '인증번호가 만료되었습니다. 다시 요청해주세요.'; 
    case 'functions/internal':
    case 'functions/invalid-argument':
      return '서버 검증 중 오류가 발생했습니다. 정보를 확인하고 다시 시도해주세요.';
    default:
      return err?.message || '요청 처리 중 오류가 발생했습니다.';
  }
}

// ----------------------
// 메인 앱 컴포넌트 시작
// ----------------------
function App() {
  const [currentView, setCurrentView] = useState('loading');
  const [user, setUser] = useState(null); 
  const [studentId, setStudentId] = useState(''); 
  const [boundSids, setBoundSids] = useState([]); 
  const [boundPhone, setBoundPhone] = useState(''); 

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
  const [availableRounds, setAvailableRounds] = useState(ALL_ROUND_LABELS);
  
  // ✅ 1. Firebase Auth 상태 변화 감지 및 SID 로드
  useEffect(() => {
    // Recaptcha 초기화 (컨테이너가 DOM에 항상 존재하도록 보장)
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
        // ✅ 로그인 상태 확인 시, 서버 바인딩 과정을 fetchBoundSids에서 처리
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

      // 🚨 단일 SID 모델 적용: SID가 1개일 때만 정상으로 간주하고 메인으로 전환
      if (sids.length === 1) { 
        setStudentId(sids[0]);
        setCurrentView('main'); 
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
  
  // ✅ 3. [강화] 서버 바인딩 로직 분리 (인증 성공 후 실행)
  // Firebase Auth 성공 후 이 함수를 호출하여 서버 측 바인딩을 수행합니다.
  const runServerVerifyAndBind = async (phoneInput, sidInput) => {
    try {
        setVerifying(true);
        const verifyFn = httpsCallable(functions, 'verifyAndBindPhoneSid');
        const res = await verifyFn({ phone: phoneInput, sid: sidInput });
        const { ok, message } = res.data || {};
        
        if (!ok) {
            throw new Error(message || '서버 바인딩 검증 실패');
        }
        
        // 서버 바인딩까지 성공하면 상태 업데이트 후 메인 화면으로 이동
        await fetchBoundSids(auth.currentUser);
        
    } catch (err) {
        console.error('최종 서버 바인딩 오류:', err);
        setError(mapAuthError(err));
        auth.signOut(); // 실패 시 Firebase Auth 세션도 제거하여 재로그인 유도
    } finally {
        setVerifying(false);
    }
  }


  const startCooldown = () => { /* ... (생략) ... */ };
  const handleSendCode = async () => { /* ... (생략) ... */ };
  
  // ✅ 4. [핵심 수정] 인증 코드 확인 및 바인딩 함수: Firebase Auth만 먼저 빠르게 처리
  const handleVerifyCode = async () => {
    if (verifying) return false;
    setError('');

    if (!confirmation) {
      setError('먼저 인증번호를 받아주세요.');
      return false;
    }
    
    setVerifying(true);
    try {
      // 🚨 [가장 중요] Firebase Auth 확인만 먼저 수행하여 성공 여부를 빠르게 확보
      const result = await confirmation.confirm(smsCode); 
      
      // Auth 성공 후, 즉시 서버 바인딩을 비동기로 실행하고 verifying 상태 유지
      runServerVerifyAndBind(phone, studentId); 
      
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(mapAuthError(err));
      setConfirmation(null);
      if (window.recaptchaVerifier) {
          window.recaptchaVerifier.clear();
      }
      setVerifying(false); // Auth 실패 시에만 verifying 상태 해제
      return false;
    }
  };


  // 폼 제출 함수
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(studentId)) {
        setError('학수번호는 숫자 6자리여야 합니다.');
        return;
    }
    await handleVerifyCode();
  };

  // 로그아웃 함수
  const handleLogout = () => {
    auth.signOut();
    setCurrentView('loading'); 
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
              allRoundLabels={ALL_ROUND_LABELS}
              roundLabel={selectedRoundLabel}
              onRoundChange={setSelectedRoundLabel}
              sid={studentId}
              onBack={() => setCurrentView('main')}
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
                      
                      {/* 로그인 인증 정보 표시 */}
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
          // 인증 확인 중이거나 서버 바인딩 중이면 로딩 상태로 처리
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

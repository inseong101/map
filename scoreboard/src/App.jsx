// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react'; // ✅ useCallback 추가
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
      return '전화번호를 입력해주세요.';
    case 'auth/invalid-verification-code':
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

  // ✅ [수정]: History API를 사용하는 새로운 뷰 전환 함수 정의
  const navigateToView = useCallback((viewName) => {
    if (viewName === 'controversial') {
        // 메인에서 컨텐츠로 갈 때만 히스토리를 push
        window.history.pushState({ view: 'controversial' }, '', '#controversial');
    } else if (viewName === 'main') {
        // 메인으로 돌아오거나 메인으로 처음 갈 때는 히스토리를 교체 (깔끔하게)
        window.history.replaceState({ view: 'main' }, '', '#main');
    } else if (viewName === 'home' || viewName === 'loading') {
        // 홈이나 로딩은 히스토리 교체
        window.history.replaceState({ view: viewName }, '', '#');
    }
    setCurrentView(viewName);
  }, []);
  
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
        navigateToView('loading'); // ✅ navigateToView 사용
        await fetchBoundSids(user);
      } else {
        navigateToView('home'); // ✅ navigateToView 사용
        setBoundSids([]);
        setStudentId('');
        setBoundPhone('');
      }
    });

    // 🚨 [핵심 수정]: Popstate 이벤트 리스너 추가 (뒤로가기 처리)
    const handlePopState = (event) => {
        const targetView = event.state?.view;
        // 히스토리 항목이 'main'이나 'home'으로 설정되어 있었다면 해당 뷰로 복귀
        if (targetView === 'main' || targetView === 'home') {
            setCurrentView(targetView);
        } else if (currentView === 'controversial') {
            // 컨텐츠 페이지에서 뒤로가기 시도 시, 명시적으로 메인으로 복귀
            setCurrentView('main');
            // history.replaceState를 사용하지 않으면 브라우저가 다시 뒤로가기를 시도할 수 있으므로
            // 이 처리는 단순하게 view를 변경하는 것으로 충분
        }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      unsubscribe();
      window.removeEventListener('popstate', handlePopState);
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [navigateToView]);
  
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
        navigateToView('main'); // ✅ navigateToView 사용
      } else {
        navigateToView('home'); // ✅ navigateToView 사용
      }
    } catch (err) {
      console.error('바인딩 SID 로드 오류:', err);
      setError('로그인 상태를 확인할 수 없습니다. 다시 시도해주세요.');
      navigateToView('home'); // ✅ navigateToView 사용
    } finally {
      setLoading(false);
    }
  };


  const startCooldown = () => { /* ... (생략) ... */ };

  // SMS 인증 번호 요청 함수
  const handleSendCode = async () => {
    if (sending || verifying || loading || resendLeft > 0) return;
    
    // ✅ [강화]: 새로운 요청 시작 시 이전 상태 초기화
    setError('');
    setConfirmation(null); 

    const cleanPhone = String(phone).trim().replace(/-/g, '');
    const formattedPhone = cleanPhone.startsWith('010') ? `+82${cleanPhone.substring(1)}` : cleanPhone;

    if (!formattedPhone) {
      setError('전화번호를 입력해주세요.');
      return;
    }

    // 학수번호 유효성 검증
    if (!/^\d{6}$/.test(studentId)) {
      setError('학수번호는 숫자 6자리여야 합니다.');
      return;
    }
    
    // 🚨 [핵심 보안 조치]: 1. SMS 발송 전에 서버에서 DB 존재 여부 확인
    try {
      setSending(true);
      
      const checkFn = httpsCallable(functions, 'checkPhoneSidExists');
      const checkRes = await checkFn({ phone: formattedPhone, sid: studentId });
      
      if (!checkRes.data?.ok) {
          // 🚨 [보안]: DB 검증 실패 시, 구체적인 오류 대신 일반적인 오류 메시지를 표시하여 정보 유출/테러 방지
          setError('입력하신 정보가 등록되지 않았습니다. 정보를 확인해 주세요.');
          return; // 검증 실패 시 SMS 발송을 중단
      }

      // 2. DB 검증 통과 후 Firebase SMS 발송
      const appVerifier = window.recaptchaVerifier;
      await appVerifier.render(); // reCAPTCHA 위젯 렌더링 강제
      
      const conf = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
      setConfirmation(conf);
      startCooldown();
      alert('인증번호가 전송되었습니다.');
    } catch (err) {
      console.error('SMS 전송/검증 오류:', err);
      // Firebase SDK 오류 처리
      setError(mapAuthError(err)); 
      if (window.recaptchaVerifier) window.recaptchaVerifier.clear();
    } finally {
      setSending(false);
    }
  };


  // 서버 학수번호 바인딩 검증 함수
  const serverVerifyAndBind = async (phoneInput, sidInput) => { /* ... (생략) ... */ };

  // 인증 코드 확인 및 바인딩 함수
  const handleVerifyCode = async () => {
    if (verifying) return false;
    setError('');

    if (!confirmation) {
      setError('먼저 인증번호를 받아주세요.');
      return false;
    }
    try {
      setVerifying(true);
      
      const result = await confirmation.confirm(smsCode); 
      
      await serverVerifyAndBind(phone, studentId);
      
      // 3. 최종 성공 후 상태 업데이트
      setUser(result.user);
      await fetchBoundSids(result.user); // 메인 화면으로 전환
      
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(mapAuthError(err));
      setConfirmation(null); // 실패 시 confirmation 객체 초기화
      if (window.recaptchaVerifier) window.recaptchaVerifier.clear();
      return false;
    } finally {
      setVerifying(false);
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
    navigateToView('loading'); // ✅ navigateToView 사용
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
              onBack={() => navigateToView('main')} // ✅ navigateToView 사용
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
                          onClick={() => navigateToView('controversial')} // ✅ navigateToView 사용
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
          // ✅ [강화]: 학수번호와 전화번호 유효성 검사 통과 시에만 버튼 활성화
          const sendDisabled = isInteracting || resendLeft > 0 || !phone.trim() || !/^\d{6}$/.test(studentId); 
          const submitDisabled = isInteracting || !studentId || !smsCode;

          return (
            <div className="container">
              <h1>
                전국한의과대학 졸업준비협의체<br />
                2025 전국모의고사
              </h1>
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

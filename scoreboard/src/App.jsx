// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react'; 
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

// ✅ [통일된 로고 + 이름 + 로그인 정보 헤더 정의]
const SiteIdentifier = ({ selectedSid, handleLogout }) => {
    // 로그인 정보가 있을 때만 우측 정보 표시
    const isLoggedIn = !!selectedSid;
    
    return (
        <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', /* 좌우 끝으로 배치 */
            alignItems: 'center', 
            gap: '20px', 
            marginBottom: '0px', 
            paddingTop: '8px',
            width: '100%',
        }}>
            {/* 좌측: 로고 + 이름 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img 
                    src="/logo.png" 
                    alt="전졸협 로고" 
                    style={{ 
                        height: '32px', // 로고 크기 조정
                        flexShrink: 0
                    }} 
                />
                <h1 style={{ 
                    margin: 0, 
                    fontSize: '16px', 
                    fontWeight: 800, 
                    lineHeight: 1.2,
                    color: 'var(--ink)',
                    whiteSpace: 'nowrap' /* 줄바꿈 방지 */
                }}>
                    전국한의과대학 졸업준비협의체
                </h1>
            </div>
            
            {/* 우측: 학수번호 + 로그아웃 버튼 (줄바꿈 없이 한 줄로) */}
            {isLoggedIn && (
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '14px', 
                    color: 'var(--muted)', 
                    textAlign: 'right'
                }}>
                    <p style={{ margin: 0, fontWeight: 700 }}>
                        학수번호: <span style={{ color: 'var(--ink)', fontWeight: 800 }}>{selectedSid}</span>
                    </p>
                    <button onClick={handleLogout} className="btn secondary" style={{ fontSize: '12px', padding: '3px 6px', height: 'auto', fontWeight: 600 }}>
                        로그아웃
                    </button>
                </div>
            )}
        </div>
    );
};


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

  const navigateToView = useCallback((viewName) => {
    if (viewName === 'controversial') {
        window.history.pushState({ view: 'controversial' }, '', '#controversial');
    } else if (viewName === 'main') {
        window.history.replaceState({ view: 'main' }, '', '#main');
    } else if (viewName === 'home' || viewName === 'loading') {
        window.history.replaceState({ view: viewName }, '', '#');
    }
    setCurrentView(viewName);
  }, []);
  
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    }
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        navigateToView('loading');
        await fetchBoundSids(user);
      } else {
        navigateToView('home');
        setBoundSids([]);
        setStudentId('');
        setBoundPhone('');
      }
    });

    const handlePopState = (event) => {
        const targetView = event.state?.view;
        if (targetView === 'main' || targetView === 'home') {
            setCurrentView(targetView);
        } else if (currentView === 'controversial') {
            setCurrentView('main');
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
  
  const fetchBoundSids = async (user) => {
    try {
      setLoading(true);
      const getBindingsFn = httpsCallable(functions, 'getMyBindings');
      const res = await getBindingsFn();
      const { sids = [], phone: fetchedPhone } = res.data || {};
      
      setBoundSids(sids);
      setBoundPhone(fetchedPhone || ''); 

      if (sids.length === 1) { 
        setStudentId(sids[0]);
        navigateToView('main');
      } else {
        navigateToView('home');
      }
    } catch (err) {
      console.error('바인딩 SID 로드 오류:', err);
      setError('로그인 상태를 확인할 수 없습니다. 다시 시도해주세요.');
      navigateToView('home');
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
          cooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };
  
  const handleSendCode = async () => {
    if (sending || verifying || loading || resendLeft > 0) return;
    setError('');
    setConfirmation(null); 

    const cleanPhone = String(phone).trim().replace(/-/g, '');
    const formattedPhone = cleanPhone.startsWith('010') ? `+82${cleanPhone.substring(1)}` : cleanPhone;

    if (!formattedPhone) { setError('전화번호를 입력해주세요.'); return; }
    if (!/^\d{6}$/.test(studentId)) { setError('학수번호는 숫자 6자리여야 합니다.'); return; }
    
    try {
      setSending(true);
      const checkFn = httpsCallable(functions, 'checkPhoneSidExists');
      const checkRes = await checkFn({ phone: formattedPhone, sid: studentId });
      
      if (!checkRes.data?.ok) {
          setError('입력하신 정보가 등록되지 않았습니다. 정보를 확인해 주세요.');
          return;
      }

      const appVerifier = window.recaptchaVerifier;
      await appVerifier.render();
      
      const conf = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
      setConfirmation(conf);
      startCooldown();
      alert('인증번호가 전송되었습니다.');
    } catch (err) {
      console.error('SMS 전송/검증 오류:', err);
      setError(mapAuthError(err)); 
      if (window.recaptchaVerifier) window.recaptchaVerifier.clear();
    } finally { setSending(false); }
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
    if (!confirmation) { setError('먼저 인증번호를 받아주세요.'); return false; }
    try {
      setVerifying(true);
      const result = await confirmation.confirm(smsCode); 
      await serverVerifyAndBind(phone, studentId);
      setUser(result.user);
      await fetchBoundSids(result.user);
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(mapAuthError(err));
      setConfirmation(null); 
      if (window.recaptchaVerifier) window.recaptchaVerifier.clear();
      return false;
    } finally { setVerifying(false); }
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(studentId)) { setError('학수번호는 숫자 6자리여야 합니다.'); return; }
    await handleVerifyCode();
  };

  const handleLogout = () => {
    auth.signOut();
    setCurrentView('home');
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
          <div className="container" style={{ paddingTop: '0px' }}>
            <ControversialPanel
              allRoundLabels={availableRounds}
              roundLabel={selectedRoundLabel}
              onRoundChange={setSelectedRoundLabel}
              sid={studentId}
              onBack={() => navigateToView('main')}
            />
          </div>
        );
        
      case 'main':
        {
          const selectedSid = studentId; 
          
          return (
              <div className="container" style={{ paddingTop: '0px' }}>
                  
                  {/* 중앙 제목 복원 */}
                  <h1 style={{ textAlign: 'center', margin: '0 0 20px', fontSize: '24px', fontWeight: 800 }}>
                      2025 전국모의고사
                  </h1>
                  
                  {/* 2. 사이트 설명 및 문항 현황 */}
                  <div className="card narrow" style={{ padding: '24px' }}>
                      <h2 style={{ marginTop: 0, fontSize: '20px', fontWeight: 800, color: 'var(--ink)', textAlign: 'center' }}>
                          전국 모의고사 특별 해설 현황
                      </h2>
                      <hr className="sep" style={{ margin: '12px 0 20px 0' }} />
                      
                      {/* ✅ [도식화된 교시별 문항 수 현황] */}
                      <div style={{ display: 'grid', gap: '15px' }}>
                          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--primary)' }}>교시별 특별 해설 문항 수 (총 38문제)</h3>
                          
                          {/* 1교시: 내과 (과목 순서 및 이름 준수) */}
                          <div className="group-box" style={{ background: 'var(--surface-2)', padding: '12px 16px' }}>
                              <p style={{ margin: 0, fontWeight: 800, color: 'var(--ink)' }}>1교시</p>
                              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>간계내과학 (2문제), 심계내과학 (2문제), 비계내과학 (2문제), 폐계내과학 (2문제), 신계내과학 (2문제) &nbsp;&nbsp;<span style={{ color: 'var(--ink)', fontWeight: 800 }}>총 10문제</span></p>
                          </div>
                          
                          {/* 2교시: 순서: 상한론, 사상의학, 침구의학, 보건의약관계법규 */}
                          <div className="group-box" style={{ background: 'var(--surface-2)', padding: '12px 16px' }}>
                              <p style={{ margin: 0, fontWeight: 800, color: 'var(--ink)' }}>2교시</p>
                              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>상한론 (2문제), 사상의학 (2문제), 침구의학 (5문제), 보건의약관계법규 (2문제) &nbsp;&nbsp;<span style={{ color: 'var(--ink)', fontWeight: 800 }}>총 11문제</span></p>
                          </div>
                          
                          {/* 3교시: 순서: 외과학, 신경정신과학, 안이비인후과학, 부인과학 */}
                          <div className="group-box" style={{ background: 'var(--surface-2)', padding: '12px 16px' }}>
                              <p style={{ margin: 0, fontWeight: 800, color: 'var(--ink)' }}>3교시</p>
                              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>외과학 (2문제), 신경정신과학 (2문제), 안이비인후과학 (2문제), 부인과학 (3문제) &nbsp;&nbsp;<span style={{ color: 'var(--ink)', fontWeight: 800 }}>총 9문제</span></p>
                          </div>
                          
                          {/* 4교시: 순서: 소아과학, 예방의학, 한방생리학, 본초학 */}
                          <div className="group-box" style={{ background: 'var(--surface-2)', padding: '12px 16px' }}>
                              <p style={{ margin: 0, fontWeight: 800, color: 'var(--ink)' }}>4교시</p>
                              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>소아과학 (2문제), 예방의학 (2문제), 한방생리학 (2문제), 본초학 (2문제) &nbsp;&nbsp;<span style={{ color: 'var(--ink)', fontWeight: 800 }}>총 8문제</span></p>
                          </div>

                      </div>
                      
                      {/* 해설 제공 목적 및 기준 */}
                      <div className="group-box" style={{ background: 'var(--surface-2)', marginTop: '20px', padding: '12px 16px' }}>
                          <h3 style={{ marginTop: 0, fontSize: '15px', color: 'var(--ink)', fontWeight: 700 }}>해설 제공의 목적과 기준</h3>
                          <p style={{ color: 'var(--muted)', lineHeight: '1.5', margin: '8px 0' }}>
                              본 특별 해설은 응시자 전체의 오답률 상위 문항에 대한 심층 분석을 제공하여, 응시자의 복습 효율을 증대시키고 고난도 내용을 최종 점검하는 것을 목표로 합니다.
                          </p>
                          <ul style={{ paddingLeft: '20px', margin: '8px 0 0', lineHeight: '1.6', fontSize: '13px', color: 'var(--muted)', listStyleType: 'disc' }}>
                              <li>제공 기준: 과목별 오답률 상위 10% 문항</li>
                              <li>제공 내용: 정답률, 5개 선지 선택 비율, '왜 매력적인 오답이 되었는지'에 대한 간략한 설명 포함</li>
                          </ul>
                      </div>
                      
                      {/* 보안 유의사항 (법적 경고문구) */}
                      <p style={{ color: 'var(--muted)', fontSize: '13px', fontWeight: 700, textAlign: 'center', marginTop: '20px', lineHeight: '1.6' }}>
                          이 콘텐츠의 무단 사용은 저작권법에 위배되며, 이를 위반할 경우 민사 및 형사상의 법적 처벌을 받을 수 있습니다. 무단 복제, 배포를 금지합니다.
                      </p>
                      
                      <hr className="sep" style={{ margin: '24px 0 16px 0' }} />

                      {/* 액션 버튼 */}
                      <button
                          className="btn primary wide"
                          onClick={() => navigateToView('controversial')}
                          disabled={!selectedSid}
                          style={{ height: '48px', fontSize: '16px' }}
                      >
                          해설 페이지로 이동
                      </button>
                  </div>
              </div>
          );
        }

      case 'home':
      default:
        {
          const isInteracting = sending || verifying || loading;
          const sendDisabled = isInteracting || resendLeft > 0 || !phone.trim() || !/^\d{6}$/.test(studentId); 
          const submitDisabled = isInteracting || !studentId || !smsCode;

          return (
            <div className="container" style={{ paddingTop: '0px' }}>
              <div className="card narrow">
                <h2 style={{ textAlign: 'center', marginBottom: '24px', fontSize: '20px', fontWeight: 800 }}>
                    2025 전국모의고사
                </h2>
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
      {/* reCAPTCHA 컨테이너 */}
      <div 
        id="recaptcha-container" 
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} 
      />
      
      <div className="container">
          {/* SiteIdentifier는 로딩 뷰를 제외하고 항상 상단 왼쪽에 표시 */}
          {currentView !== 'loading' && <SiteIdentifier selectedSid={studentId} handleLogout={handleLogout} />}
          {renderContent()}
      </div>
    </div>
  );
}

export default App;

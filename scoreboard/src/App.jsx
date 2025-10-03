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
  const [boundSids, setBoundSids] = useState([]); // 🚨 단일 SID 모델이지만, getMyBindings 호환성을 위해 유지
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
  
  // ✅ 2. 바인딩된 SID를 서버에서 가져와 곧바로 콘텐츠 뷰로 전환
  const fetchBoundSids = async (user) => {
    try {
      setLoading(true);
      const getBindingsFn = httpsCallable(functions, 'getMyBindings');
      const res = await getBindingsFn();
      const { sids = [], phone: fetchedPhone } = res.data || {};
      
      setBoundSids(sids);
      setBoundPhone(fetchedPhone || ''); 

      // 🚨 단일 SID 모델 적용: SID가 1개일 때만 정상으로 간주하고 컨텐츠로 직행
      if (sids.length === 1) { 
        setStudentId(sids[0]);
        setCurrentView('controversial'); // ✅ 메인 화면 스킵, 컨텐츠로 직행
      } else {
        // SID가 0개거나 2개 이상이면 에러로 간주하고 홈으로 돌려보냄
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


  const startCooldown = () => { /* ... (로직은 이전과 동일) ... */ };
  const handleSendCode = async () => { /* ... (로직은 이전과 동일) ... */ };
  const serverVerifyAndBind = async (phoneInput, sidInput) => { /* ... (로직은 이전과 동일) ... */ };


  // SMS 인증 코드 확인 및 바인딩 함수
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
      
      // 서버에서 바인딩 및 SID 확인
      await serverVerifyAndBind(phone, studentId);
      
      // 로그인 및 바인딩 성공 후 상태 업데이트
      setUser(result.user);
      setStudentId(studentId); // 입력한 학수번호를 현재 학수번호로 설정
      setCurrentView('controversial'); // ✅ 인증 성공 후 컨텐츠로 직행
      
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(mapAuthError(err));
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
    setCurrentView('loading'); 
  };

  // ----------------------
  // 뷰 렌더링 (단일 블록으로 통합)
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
              onBack={handleLogout} // ✅ 뒤로가기 버튼을 누르면 로그아웃 (메인 화면이 없으므로)
            />
          </div>
        );
        
      // 🚨 case 'main': 블록 전체가 제거됨.
      
      case 'home':
      default:
        {
          const sendDisabled = sending || verifying || loading || resendLeft > 0 || !phone.trim();
          const submitDisabled = sending || verifying || loading || !studentId || !smsCode;

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
    }
  };


  return (
    <div className="app-root-container">
      <div 
        id="recaptcha-container" 
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} 
      />
      {renderContent()}
    </div>
  );
}

export default App;

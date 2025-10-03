// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import ControversialPanel from './components/ControversialPanel';
import './App.css';

import { auth, functions } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged } from 'firebase/auth'; // onAuthStateChanged 추가
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
  const [user, setUser] = useState(null); // Firebase User 객체 상태
  const [studentId, setStudentId] = useState(''); // 현재 선택/바인딩된 학수번호
  const [boundSids, setBoundSids] = useState([]); // 바인딩된 모든 학수번호 목록
  const [boundPhone, setBoundPhone] = useState(''); // ✅ 바인딩된 전화번호 (로그인 정보 표시용)

  const [phone, setPhone] = useState(''); // 입력 필드 상태
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
        // 로그인 상태인 경우, 바인딩된 SID 목록을 가져옴
        setCurrentView('loading');
        await fetchBoundSids(user);
      } else {
        // 로그아웃 상태인 경우, 홈 화면으로 이동
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
  
  // ✅ 2. 바인딩된 SID를 서버에서 가져오는 함수
  const fetchBoundSids = async (user) => {
    try {
      setLoading(true);
      const getBindingsFn = httpsCallable(functions, 'getMyBindings');
      const res = await getBindingsFn();
      const { sids = [], phone: fetchedPhone } = res.data || {};
      
      setBoundSids(sids);
      setBoundPhone(fetchedPhone || ''); // ✅ 바인딩된 전화번호 저장

      if (sids.length > 0) {
        // 바인딩된 학수번호가 있으면 첫 번째 것을 선택하고 메인으로 이동
        setStudentId(sids[0]);
        setCurrentView('main');
      } else {
        // 바인딩이 없으면 다시 홈 화면으로 (재인증 필요)
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


  const handleVerifyCode = async () => {
    if (verifying) return false;
    setError('');

    if (!confirmation) {
      setError('먼저 인증번호를 받아주세요.');
      return false;
    }
    try {
      setVerifying(true);
      const result = await confirmation.confirm(smsCode); // Firebase Auth 로그인 완료
      
      // 서버에서 바인딩 및 SID 확인
      await serverVerifyAndBind(phone, studentId);
      
      // 로그인 및 바인딩 성공 후 상태 업데이트
      setUser(result.user);
      await fetchBoundSids(result.user); // 바인딩된 SID 목록을 다시 가져와서 'main'으로 전환
      
      return true;
    } catch (err) {
      console.error('코드/바인딩 검증 오류:', err);
      setError(mapAuthError(err));
      return false;
    } finally {
      setVerifying(false);
    }
  };

  const handleSendCode = async () => {
    if (sending || verifying || loading || resendLeft > 0) return;
    setError('');

    const cleanPhone = String(phone).trim().replace(/-/g, '');
    const formattedPhone = cleanPhone.startsWith('010') ? `+82${cleanPhone.substring(1)}` : cleanPhone;

    if (!formattedPhone) {
      setError('전화번호를 입력해주세요.');
      return;
    }

    try {
      setSending(true);
      const appVerifier = window.recaptchaVerifier;
      const conf = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
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
    setCurrentView('loading'); // 로그아웃 후 다시 로딩 상태로 변경
  };

  // ----------------------
  // 뷰 렌더링
  // ----------------------

  // 로딩 뷰
  if (currentView === 'loading') {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '100px 0' }}>
        <div className="spinner" />
        <p className="small">로그인 상태 확인 및 데이터 로드 중...</p>
      </div>
    );
  }


  // 컨텐츠 뷰 (ControversialPanel)
  if (currentView === 'controversial') {
    return (
      <div className="container">
        <ControversialPanel
          allRoundLabels={ALL_ROUND_LABELS}
          roundLabel={selectedRoundLabel}
          onRoundChange={setSelectedRoundLabel}
          sid={studentId}
          onBack={() => setCurrentView('main')} // 컨텐츠 페이지에서 뒤로가기 시 메인으로 이동
        />
      </div>
    );
  }
  
  // ✅ 메인 뷰 (로그인 정보 표시 및 SID 선택)
  if (currentView === 'main') {
      const selectedSid = studentId || (boundSids.length > 0 ? boundSids[0] : '');
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
                              <span className="num" style={{ fontSize: '28px' }}>{selectedSid || '선택 필요'}</span>
                          </p>
                      </div>
                  </div>

                  <hr className="sep" />

                  {/* 학수번호 선택 (2개 이상일 때만) */}
                  {boundSids.length > 1 && (
                      <div className="flex-column" style={{ marginBottom: '20px' }}>
                          <label style={{ fontWeight: 800 }}>다른 학수번호 선택</label>
                          <select
                              className="input big"
                              value={selectedSid}
                              onChange={(e) => setStudentId(e.target.value)}
                          >
                              {boundSids.map(sid => (
                                  <option key={sid} value={sid}>
                                      {sid}
                                  </option>
                              ))}
                          </select>
                      </div>
                  )}

                  <button
                      className="btn primary wide"
                      onClick={() => setCurrentView('controversial')}
                      disabled={!selectedSid}
                      style={{ height: '48px', fontSize: '16px' }}
                  >
                      선택된 학수번호 해설 페이지로 이동
                  </button>

                  <hr className="sep" />
                  <button onClick={handleLogout} className="btn secondary wide">
                      로그아웃
                  </button>
              </div>
          </div>
      );
  }


  // currentView === 'home' (로그인/인증 화면)
  const sendDisabled = sending || verifying || loading || resendLeft > 0 || !phone.trim();
  const submitDisabled = sending || verifying || loading || !studentId || !smsCode;

  return (
    <div className="container">
      <div id="recaptcha-container" />
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

export default App;

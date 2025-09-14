// src/App.jsx - 전화번호 + SMS 인증 + 학수번호 매핑 검증
import React, { useState, useEffect } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AdminSystem from './components/AdminSystem';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  signInWithPhoneNumber,
  RecaptchaVerifier
} from 'firebase/auth';

// === 모든 회차 라벨 ===
const ALL_ROUND_LABELS = ['1차', '2차'];

// === rounds 보정: 누락 회차 absent 처리 ===
function normalizeRounds(inputRounds) {
  const arr = Array.isArray(inputRounds) ? inputRounds : [];
  const byLabel = new Map(arr.map(r => [r.label, r]));
  return ALL_ROUND_LABELS.map(label =>
    byLabel.get(label) || { label, data: { status: 'absent' } }
  );
}

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

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

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [studentId, setStudentId] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [verificationId, setVerificationId] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [hydratedRounds, setHydratedRounds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState('');

  // reCAPTCHA 세팅
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        'recaptcha-container',
        { size: 'invisible' }
      );
    }
  }, []);

  // 인증번호 요청
  const handleSendCode = async () => {
    try {
      const appVerifier = window.recaptchaVerifier;
      const confirmation = await signInWithPhoneNumber(auth, phone, appVerifier);
      setVerificationId(confirmation.verificationId);
      alert('인증번호가 전송되었습니다.');
    } catch (err) {
      console.error('SMS 전송 오류:', err);
      setError('SMS 전송에 실패했습니다.');
    }
  };

  // 인증번호 검증
  const handleVerifyCode = async () => {
    try {
      const credential = window.firebase.auth.PhoneAuthProvider.credential(
        verificationId,
        smsCode
      );
      await auth.signInWithCredential(credential);

      // 🔒 Firestore 매핑 검증
      const ref = doc(db, 'phones', phone);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setError('등록되지 않은 전화번호입니다.');
        return false;
      }
      const allowedSids = snap.data()?.sids || [];
      if (!allowedSids.includes(studentId)) {
        setError('전화번호와 학수번호가 일치하지 않습니다.');
        return false;
      }

      return true;
    } catch (err) {
      console.error('코드 검증 오류:', err);
      setError('인증번호가 올바르지 않습니다.');
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (studentId.length !== 6) {
      setError('학수번호는 숫자 6자리여야 합니다.');
      return;
    }
    if (!verificationId) {
      setError('먼저 인증번호를 받아주세요.');
      return;
    }
    const ok = await handleVerifyCode();
    if (!ok) return;

    setLoading(true);
    try {
      const foundRounds = await discoverRoundsFor(studentId);
      if (foundRounds.length === 0) {
        setError('존재하지 않는 학수번호입니다.');
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
          out.push({
            label,
            data: {
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

  if (currentView === 'result') {
    const school = getSchoolFromSid(studentId);
    const base = hydratedRounds.length ? hydratedRounds : rounds;
    const effectiveRounds = normalizeRounds(base);

    if (hydrating) {
      return <div className="container">불러오는 중...</div>;
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

  return (
    <div className="container">
      <h1>본인 점수 확인</h1>
      <form onSubmit={handleSubmit} className="flex-column">
        <label>학수번호</label>
        <input
          type="text"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="예) 015001"
        />

        <label>전화번호</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+821012345678"
        />
        <button type="button" onClick={handleSendCode}>인증번호 받기</button>

        <label>인증번호</label>
        <input
          type="text"
          value={smsCode}
          onChange={(e) => setSmsCode(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? '조회 중...' : '인증 확인 후 성적 보기'}
        </button>
      </form>
      <div id="recaptcha-container"></div>
      {error && <div className="alert">{error}</div>}
    </div>
  );
}

export default App;

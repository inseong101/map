// src/App.jsx - 전화번호 인증 + 서버 검증/바인딩 + 성적 조회
import React, { useState, useEffect, useRef } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import './App.css';

import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';

import { auth, db, functions } from './firebase';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

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

// 프론트에서도 +82 정규화 (Auth는 E.164를 요구)
function toKRE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+82')) return digits;
  const onlyDigits = digits.replace(/\D/g, '');
  if (onlyDigits.startsWith('0')) return '+82' + onlyDigits.slice(1);
  return null;
}

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

export default function App() {
  const [currentView, setCurrentView] = useState('home');
  const [studentId, setStudentId] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);

  const [rounds, setRounds] = useState([]);
  const [hydratedRounds, setHydratedRounds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState('');

  const recaptchaRef = useRef(null);

  // reCAPTCHA 세팅 (v9)
  useEffect(() => {
    if (!recaptchaRef.current) {
      recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    }
  }, []);

  // 인증번호 요청 (v9)
  const handleSendCode = async () => {
    setError('');
    try {
      const e164 = toKRE164(phone);
      if (!e164) {
        setError('전화번호 형식이 올바르지 않습니다. 예: 010-1234-5678');
        return;
      }
      const appVerifier = recaptchaRef.current;
      const conf = await signInWithPhoneNumber(auth, e164, appVerifier);
      setConfirmationResult(conf);
      alert('인증번호가 전송되었습니다.');
    } catch (err) {
      console.error('SMS 전송 오류:', err);
      setError('SMS 전송에 실패했습니다.');
    }
  };

  // 서버 검증 + 바인딩 (Callable)
  const verifyAndBindPhoneSid = httpsCallable(functions, 'verifyAndBindPhoneSid');

  // 인증번호 검증 + 서버 바인딩
  const handleVerifyAndBind = async () => {
    setError('');
    try {
      if (!confirmationResult) {
        setError('먼저 인증번호를 받아주세요.');
        return false;
      }
      if (!/^\d{6}$/.test(studentId)) {
        setError('학수번호는 숫자 6자리여야 합니다.');
        return false;
      }

      // 1) Firebase Auth 인증 완료
      await confirmationResult.confirm(smsCode);

      // 2) 서버에서 전화번호-학수번호 검증 및 내 계정에 바인딩
      const res = await verifyAndBindPhoneSid({ phone, sid: studentId });
      const data = res.data || {};
      if (!data.ok) {
        if (data.code === 'PHONE_NOT_FOUND') setError('등록되지 않은 전화번호입니다.');
        else if (data.code === 'SID_MISMATCH') setError('전화번호와 학수번호가 일치하지 않습니다.');
        else setError(data.message || '검증 실패');
        return false;
      }
      return true;
    } catch (err) {
      console.error('코드 검증/바인딩 오류:', err);
      setError('인증번호가 올바르지 않거나 검증에 실패했습니다.');
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!/^\d{6}$/.test(studentId)) {
      setError('학수번호는 숫자 6자리여야 합니다.');
      return;
    }
    if (!confirmationResult) {
      setError('먼저 인증번호를 받아주세요.');
      return;
    }

    const ok = await handleVerifyAndBind();
    if (!ok) return;

    setLoading(true);
    try {
      const foundRounds = await discoverRoundsFor(studentId);
      if (!foundRounds || foundRounds.length === 0) {
        setError('존재하지 않는 학수번호이거나 점수 데이터가 없습니다.');
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

  // 결과 보정/합산
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
          placeholder="예) 010-1234-5678"
        />
        <button type="button" onClick={handleSendCode}>인증번호 받기</button>

        <label>인증번호</label>
        <input
          type="text"
          value={smsCode}
          onChange={(e) => setSmsCode(e.target.value)}
          placeholder="6자리"
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

// src/App.jsx - 관리자 시스템 + RoundCard 점수 보정(교시별 totalScore 합산)
import React, { useState, useEffect } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AdminSystem from './components/AdminSystem';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

// === 모든 회차 라벨(프로젝트 규칙에 맞게 수정 가능) ===
const ALL_ROUND_LABELS = ['1차', '2차'];

// 🔧 테스트 모드: 비밀번호 요구 여부
// 실제 운영 시 true 로 변경하세요.
const PASSWORD_REQUIRED = false;

// === rounds 보정: 누락된 회차는 미응시(status:'absent')로 채워서 항상 보이게 ===
function normalizeRounds(inputRounds) {
  const arr = Array.isArray(inputRounds) ? inputRounds : [];
  const byLabel = new Map(arr.map(r => [r.label, r]));

  return ALL_ROUND_LABELS.map(label => {
    const found = byLabel.get(label);
    if (found) {
      return { label, data: { status: 'absent', ...(found.data || {}) } };
    }
    return { label, data: { status: 'absent' } };
  });
}

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

async function getRoundTotalFromFirestore(roundLabel, sid) {
  const db = getFirestore();
  const perSession = [];
  let completedCount = 0;

  for (const session of SESSIONS) {
    try {
      const ref = doc(db, 'scores_raw', roundLabel, session, sid);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        perSession.push(0);
        continue;
      }

      const d = snap.data() || {};
      if (d.status !== 'completed') {
        perSession.push(0);
        continue;
      }

      completedCount++;
      const s = Number(d.totalScore);
      perSession.push(Number.isFinite(s) ? s : 0);
    } catch (e) {
      console.error(`점수 조회 오류: ${roundLabel} ${session} ${sid}`, e);
      perSession.push(0);
    }
  }

  const total = perSession.reduce((a, b) => a + b, 0);
  const roundStatus =
    completedCount === 4 ? 'completed' :
    completedCount === 0 ? 'absent' : 'dropout';

  return { total, sessionScores: perSession, roundStatus };
}

// ===== (임시) 비밀번호 검증 스텁 =====
// - PASSWORD_REQUIRED=false 면 언제나 true 반환 (=검사 생략)
// - PASSWORD_REQUIRED=true 로 바꾸면, 여기서 실제 검증 로직(예: Firestore/Cloud Function 호출)로 교체
async function verifyPassword(studentId, password) {
  if (!PASSWORD_REQUIRED) return true;
  // TODO: 운영 시 실제 검증 구현
  // 예시) const ok = await callCloudFunction('verifyPassword', { sid: studentId, pw: password });
  // return ok;
  return false;
}

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [rounds, setRounds] = useState([]);
  const [hydratedRounds, setHydratedRounds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState('');

  // 🔒 비밀번호 실패/락아웃 상태 (localStorage 유지)
  const [pwFailCount, setPwFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState(0); // epoch(ms)

  useEffect(() => {
    // 초기화 (브라우저 저장된 실패/락아웃 불러오기)
    const fc = parseInt(localStorage.getItem('pw_fail_count') || '0', 10);
    const lu = parseInt(localStorage.getItem('pw_lock_until') || '0', 10);
    setPwFailCount(Number.isFinite(fc) ? fc : 0);
    setLockUntil(Number.isFinite(lu) ? lu : 0);
  }, []);

  const isLocked = () => {
    const now = Date.now();
    return lockUntil && now < lockUntil;
  };
  const lockRemainMinutes = () => {
    if (!isLocked()) return 0;
    return Math.ceil((lockUntil - Date.now()) / 60000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // 🔒 락 상태 확인
    if (isLocked()) {
      setError(`비밀번호를 여러 번 틀리셨습니다. ${lockRemainMinutes()}분 후 다시 시도하세요.`);
      return;
    }

    const id = studentId.replace(/\D/g, '').slice(0, 6);
    if (id.length !== 6) {
      setError('학수번호는 숫자 6자리여야 합니다.');
      return;
    }

    // 🔑 비밀번호 검증 (필요 시)
    if (PASSWORD_REQUIRED) {
      const ok = await verifyPassword(id, password);
      if (!ok) {
        const next = pwFailCount + 1;
        setPwFailCount(next);
        localStorage.setItem('pw_fail_count', String(next));

        if (next >= 5) {
          const until = Date.now() + 30 * 60 * 1000; // 30분
          setLockUntil(until);
          localStorage.setItem('pw_lock_until', String(until));
          setError('비밀번호를 5회 이상 틀리셨습니다. 30분 후 다시 시도하세요.');
        } else {
          setError('비밀번호가 틀렸습니다.');
        }
        return;
      } else {
        // 성공 시 실패 카운트 초기화
        setPwFailCount(0);
        setLockUntil(0);
        localStorage.removeItem('pw_fail_count');
        localStorage.removeItem('pw_lock_until');
      }
    }

    setLoading(true);
    try {
      const foundRounds = await discoverRoundsFor(id);

      if (foundRounds.length === 0) {
        // 🔔 학수번호 부재 안내 그대로 유지
        setError('존재하지 않는 학수번호입니다.');
        return;
      }

      // 💡 결과 화면 진입 즉시 로딩 화면 먼저 띄우기 (플리커 방지)
      setCurrentView('result');
      setHydrating(true);
      setRounds(foundRounds);
    } catch (err) {
      console.error('데이터 조회 오류:', err);
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

      setHydrating(true);
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
              totalMax: (data && data.totalMax) || 340,
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

  const handleInputChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setStudentId(value);
  };
  const handlePwChange = (e) => {
    setPassword(e.target.value);
  };

  if (currentView === 'admin') {
    return (
      <div className="container">
        <div className="header">
          <div>
            <h1>전졸협 모의고사 관리자 시스템</h1>
            <div className="small">성적 데이터를 회차별/교시별로 확인할 수 있습니다.</div>
          </div>
          <button onClick={() => setCurrentView('home')} className="btn">홈으로</button>
        </div>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          marginTop: 16,
          minHeight: '70vh'
        }}>
          <AdminSystem />
        </div>
      </div>
    );
  }

  if (currentView === 'result') {
    const school = getSchoolFromSid(studentId);
    const base = hydratedRounds.length ? hydratedRounds : rounds;
    const effectiveRounds = normalizeRounds(base);

    if (hydrating) {
      return (
        <div className="container">
          <h1>전졸협 모의고사 성적 조회</h1>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <div className="spinner" />
            <div className="small">데이터 불러오는 중…</div>
          </div>
        </div>
      );
    }

    return (
      <div className="container">
        <h1>전졸협 모의고사 성적 조회</h1>

        <div id="cards-grid" className="cards-grid">
          <StudentCard
            sid={studentId}
            school={school}
            rounds={effectiveRounds}
            loading={false}
          />

          {effectiveRounds.map(({ label, data }) => (
            <RoundCard
              key={label}
              label={label}
              data={data}
              sid={studentId}
            />
          ))}
        </div>
      </div>
    );
  }

  // Home 화면
  const submitDisabled = loading || (
    PASSWORD_REQUIRED
      ? !(studentId.length === 6 && password.length > 0)
      : (studentId.length !== 6)
  );

  return (
    <div className="container">
      <h1>전졸협 모의고사 성적 사이트</h1>
      <div className="grid">
        <div className="col-12">
          <div className="card narrow">
            <h2 style={{ marginTop: 0 }}>본인 점수 보기</h2>
            <form onSubmit={handleSubmit} className="flex-column">
              <label htmlFor="sid" className="small">학수번호</label>
              <input
                id="sid"
                type="text"
                className="input"
                value={studentId}
                onChange={handleInputChange}
                placeholder="예) 015001"
                maxLength={6}
                disabled={loading}
                autoComplete="off"
              />

              {/* 🔐 비밀번호 입력칸 (항상 표시 / 테스트 모드에선 검증만 생략) */}
              <label htmlFor="pw" className="small">비밀번호</label>
              <input
                id="pw"
                type="password"
                className="input"
                value={password}
                onChange={handlePwChange}
                placeholder={PASSWORD_REQUIRED ? '비밀번호를 입력하세요' : '테스트 모드: 임의 입력 가능'}
                disabled={loading}
                autoComplete="off"
              />

              <button type="submit" className="btn" disabled={submitDisabled}>
                {loading ? '조회 중...' : '성적 확인'}
              </button>
            </form>

            <div className="small" style={{ marginTop: 16 }}>
              • 숫자 6자리만 입력 가능합니다. 예: <code>015001</code><br/>
              • 비밀번호를 잊으셨다면 각 학교 졸업준비위원장에게 문의
            </div>
            {error && <div className="alert" role="alert">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

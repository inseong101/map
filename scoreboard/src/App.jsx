// src/App.jsx - 관리자 시스템 + RoundCard 점수 보정(교시별 totalScore 합산)
import React, { useState, useEffect } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AdminSystem from './components/AdminSystem';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

async function getRoundTotalFromFirestore(roundLabel, sid) {
  const db = getFirestore();
  const perSession = [];

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

      const s = Number(d.totalScore);
      perSession.push(Number.isFinite(s) ? s : 0);
    } catch (e) {
      console.error(`점수 조회 오류: ${roundLabel} ${session} ${sid}`, e);
      perSession.push(0);
    }
  }

  const total = perSession.reduce((a, b) => a + b, 0);
  return { total, sessionScores: perSession };
}

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [studentId, setStudentId] = useState('');
  const [rounds, setRounds] = useState([]);
  const [hydratedRounds, setHydratedRounds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const id = studentId.replace(/\D/g, '').slice(0, 6);
    if (id.length !== 6) {
      setError('학수번호는 숫자 6자리여야 합니다.');
      return;
    }

    setLoading(true);
    try {
      const foundRounds = await discoverRoundsFor(id);

      if (foundRounds.length === 0) {
        setError('존재하지 않는 학수번호거나 미응시자입니다.');
        return;
      }

      setRounds(foundRounds);
      setCurrentView('result');
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
        return;
      }

      setHydrating(true);
      try {
        const out = [];
        for (const { label, data } of rounds) {
          const { total, sessionScores } = await getRoundTotalFromFirestore(label, studentId);
          out.push({
            label,
            data: {
              ...(data || {}),
              sessionScores,
              totalScore: total,
              totalMax: (data && data.totalMax) || 340
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

    return (
      <div className="container">
        {/* 🎯 중앙 제목만 남김 */}
        <h1>전졸협 모의고사 성적 조회</h1>

        <div id="cards-grid" className="cards-grid">
          <StudentCard
            sid={studentId}
            school={school}
            rounds={hydratedRounds.length ? hydratedRounds : rounds}
            loading={hydrating}
          />

          {(hydratedRounds.length ? hydratedRounds : rounds).map(({ label, data }) => (
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
              />
              <button type="submit" className="btn" disabled={loading || studentId.length !== 6}>
                {loading ? '조회 중...' : '성적 확인'}
              </button>
            </form>
            <div className="small" style={{ marginTop: 16 }}>
              • 숫자 6자리만 입력 가능합니다. 예: <code>015001</code>
            </div>
            {error && <div className="alert" role="alert">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

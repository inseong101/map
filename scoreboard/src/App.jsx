// src/App.jsx - 관리자 시스템 + RoundCard 점수 보정(교시별 totalScore 합산)
import React, { useState, useEffect } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AdminSystem from './components/AdminSystem';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';

// ⬇️ Firestore에서 교시별 점수 읽어 합산하는 보조 함수
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const SESSIONS = ['1교시', '2교시', '3교시', '4교시'];

/**
 * 특정 회차(roundLabel), 학번(sid)에 대해
 * scores_raw/{roundLabel}/{session}/{sid} 문서들의 totalScore를 읽어 합산.
 * - status !== 'completed' 이거나 문서 없음 → 0점 취급 (분포/등수에는 어차피 제외됨)
 * - 반환: { total, sessionScores }
 */
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
      // status가 completed가 아닐 경우 0점으로
      if (d.status !== 'completed') {
        perSession.push(0);
        continue;
      }

      // functions에서 미리 저장해둔 교시별 totalScore를 그대로 사용
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
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'result' | 'admin'
  const [studentId, setStudentId] = useState('');
  const [rounds, setRounds] = useState([]);              // discoverRoundsFor 결과(raw)
  const [hydratedRounds, setHydratedRounds] = useState([]); // Firestore 점수로 보정된 결과
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);     // 보정 로딩
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

  // 결과 화면 진입 시, rounds가 바뀌거나 sid가 바뀌면 Firestore에서 합산 점수로 보정
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
          // 기존 data를 그대로 두되, 점수 부분만 확실하게 덮어씀
          out.push({
            label,
            data: {
              ...(data || {}),
              sessionScores,                     // [교시1,2,3,4] – 없는 교시는 0
              totalScore: total,                 // 합산 총점(함수산출)
              totalMax: (data && data.totalMax) || 340
            }
          });
        }
        setHydratedRounds(out);
      } catch (e) {
        console.error('보정 점수 생성 실패:', e);
        // 실패 시라도 RoundCard가 망가지지 않게 원본 rounds 그대로 사용
        setHydratedRounds(rounds);
      } finally {
        setHydrating(false);
      }
    }
    hydrate();
  }, [currentView, studentId, rounds]);

  const goHome = () => {
    setCurrentView('home');
    setStudentId('');
    setRounds([]);
    setHydratedRounds([]);
    setError('');
  };

  const goAdmin = () => {
    setCurrentView('admin');
    setError('');
  };

  const handleInputChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setStudentId(value);
  };

  // 관리자 시스템 화면
  if (currentView === 'admin') {
    return (
      <div className="container">
        <div className="header">
          <div>
            <h1>전졸협 모의고사 관리자 시스템</h1>
            <div className="small">성적 데이터를 회차별/교시별로 확인할 수 있습니다.</div>
          </div>
          <button 
            onClick={goHome}
            className="btn"
            style={{ alignSelf: 'flex-start' }}
          >
            홈으로
          </button>
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

  // 학생 결과 화면
  if (currentView === 'result') {
    const school = getSchoolFromSid(studentId);

    return (
      <div className="container">
        <div className="header">
          <div>
            <h1>전졸협 모의고사 성적 조회</h1>
            <div className="small">학수번호: {studentId} ({school})</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={goAdmin} className="btn" style={{ fontSize: 12, padding: '6px 12px' }}>
              관리자
            </button>
            <button onClick={goHome} className="btn">
              다른 학생 조회
            </button>
          </div>
        </div>

        <div id="cards-grid" className="cards-grid">
          {/* StudentCard에 rounds 대신 보정된 hydratedRounds 전달(원하면 그대로 rounds도 전달 가능) */}
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

  // 홈 화면
  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>전졸협 모의고사 성적 사이트</h1>
          <div className="small">학수번호 6자리를 입력해 본인 성적을 확인하세요.</div>
        </div>
      </div>

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
              
              <button 
                type="submit" 
                className="btn"
                disabled={loading || studentId.length !== 6}
              >
                {loading ? '조회 중...' : '성적 확인'}
              </button>
            </form>

            {/* 🎯 관리자 시스템 버튼 */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <button 
                onClick={goAdmin}
                className="btn"
                style={{ 
                  width: '100%',
                  background: 'var(--warn)',
                  fontSize: 13
                }}
              >
                🔧 성적관리시스템 (관리자)
              </button>
              <div className="small" style={{ marginTop: 8, textAlign: 'center', opacity: 0.7 }}>
                회차별/교시별 답안 현황을 확인할 수 있습니다
              </div>
            </div>

            <div className="small" style={{ marginTop: 16 }}>
              • 숫자 6자리만 입력 가능합니다. 예: <code>015001</code>
            </div>

            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

// src/App.jsx - 관리자 시스템 추가
import React, { useState } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AdminSystem from './components/AdminSystem';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';

function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'result' | 'admin'
  const [studentId, setStudentId] = useState('');
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(false);
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

  const goHome = () => {
    setCurrentView('home');
    setStudentId('');
    setRounds([]);
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
          <StudentCard 
            sid={studentId} 
            school={school} 
            rounds={rounds} 
          />
          
          {rounds.map(({ label, data }) => (
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

            {/* 🎯 관리자 시스템 버튼 추가 */}
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

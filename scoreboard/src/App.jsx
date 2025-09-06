// src/App.jsx - 전체 미응시자 처리 추가
import React, { useState } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AbsentCard from './components/AbsentCard';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid, ROUND_LABELS } from './services/dataService';
import { detectStudentAbsenceStatus } from './utils/helpers';

function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'result'
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
        setError('존재하지 않는 학수번호거나 모든 회차를 미응시했습니다.');
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

  const handleInputChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setStudentId(value);
  };

  if (currentView === 'home') {
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

              <div className="small" style={{ marginTop: 10 }}>
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

  // 결과 화면
  const school = getSchoolFromSid(studentId);

  // 카드 렌더링 로직
  const renderCards = () => {
    const cards = [];
    
    // StudentCard는 응시한 회차가 있는 경우만 표시
    if (rounds.length > 0) {
      cards.push(
        <StudentCard 
          key="student"
          sid={studentId} 
          school={school} 
          rounds={rounds} 
        />
      );
    }
    
    // 각 회차별 카드 렌더링 (1차~8차 순서대로)
    ROUND_LABELS.forEach(label => {
      const roundData = rounds.find(r => r.label === label);
      
      if (roundData) {
        // 응시한 회차 - 일반 RoundCard 또는 중도포기 카드
        const absenceStatus = detectStudentAbsenceStatus(roundData.data);
        
        cards.push(
          <RoundCard 
            key={label}
            label={label}
            data={roundData.data}
            sid={studentId}
            isPartialAbsent={absenceStatus.isPartiallyAbsent}
            missedSessions={absenceStatus.missedSessions}
          />
        );
      } else {
        // 전체 미응시 - 얇은 AbsentCard
        cards.push(
          <AbsentCard 
            key={label}
            label={label}
          />
        );
      }
    });
    
    return cards;
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>전졸협 모의고사 성적 사이트</h1>
          <div className="small">{school} {studentId} 학생의 성적표</div>
        </div>
        <button 
          onClick={goHome}
          className="btn"
          style={{ fontSize: '14px' }}
        >
          다른 학번 조회
        </button>
      </div>

      <div id="cards-grid" className="cards-grid">
        {renderCards()}
      </div>
    </div>
  );
}

export default App;

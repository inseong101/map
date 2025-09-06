// src/App.jsx
import React, { useState } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';

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


                  {/* ✅ 여기 추가 */}
    <div style={{ marginTop: 10, textAlign: 'right' }}>
      <a
        className="btn secondary"
        href="/admin"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="성적관리시스템 (관리자만 접근가능)"
      >
        성적관리시스템<span className="small" style={{ marginLeft: 6, opacity: .85 }}>(관리자만 접근가능)</span>
      </a>
    </div>

    <div className="small" style={{ marginTop: 8, opacity: .85, lineHeight: 1.6, textAlign: 'center' }}>
      • 숫자만 입력하세요. <b>01~12</b>로 시작하는 6자리입니다.<br/>
      • 조회 중에는 버튼이 비활성화됩니다.
    </div>
  </div>
)}

            
              
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

  return (
    <div className="container">
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

export default App;

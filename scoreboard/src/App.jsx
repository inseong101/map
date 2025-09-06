// src/App.jsx - 조회 버튼 로딩 상태 복구(검색중… + 비활성화), SearchPanel 없이 구현
import React, { useState } from 'react';
import './App.css';

import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AbsentCard from './components/AbsentCard';

import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';
import { detectStudentAbsenceStatus } from './utils/helpers';

function App() {
  // 🔹 조회 입력/로딩/결과 상태
  const [sidInput, setSidInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [student, setStudent] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 🔹 조회 핸들러 (Enter/버튼)
  const onSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;

    const sid = (sidInput || '').trim();
    if (!sid || sid.length !== 6) {
      setErrorMsg('학수번호 6자리를 입력해주세요.');
      return;
    }

    setErrorMsg('');
    setIsLoading(true);
    try {
      const school = getSchoolFromSid(sid);
      const rounds = await discoverRoundsFor(sid); // 기존 프로젝트 함수 그대로 사용
      setStudent({ sid, school, rounds });
    } catch (err) {
      console.error(err);
      setStudent(null);
      setErrorMsg('조회에 실패했습니다. 학수번호를 확인해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      {/* 헤더 */}
      <div className="header">
        <div>
          <h1>전졸협 성적 조회</h1>
          <div className="small">모의고사 성적을 빠르게 확인하세요.</div>
        </div>
      </div>

      {/* 🔹 상단 조회 폼 (예전 느낌) */}
      <div className="card narrow" style={{ marginBottom: 16 }}>
        <form onSubmit={onSubmit} className="flex" style={{ justifyContent: 'space-between' }}>
          <div className="flex" style={{ flex: 1, gap: 10 }}>
            <input
              className="input"
              type="text"
              placeholder="학수번호 6자리 (예: 010101)"
              value={sidInput}
              onChange={(e) => setSidInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              maxLength={6}
              style={{ flex: 1, fontWeight: 700 }}
            />
            <button
              type="submit"
              className={`btn ${isLoading ? 'loading' : ''}`}
              disabled={isLoading || !sidInput || sidInput.length !== 6}
              style={{ minWidth: 120 }}
            >
              {isLoading ? '검색중…' : '조회'}
            </button>
          </div>
        </form>

        <div className="small" style={{ marginTop: 8, opacity: .85, lineHeight: 1.6 }}>
          • 숫자만 입력하세요. <b>01~12</b>로 시작하는 6자리입니다.<br/>
          • 조회 중에는 버튼이 비활성화됩니다.
        </div>
      </div>

      {/* 에러 메시지 */}
      {errorMsg && (
        <div className="card" style={{ borderColor: 'rgba(239,68,68,.55)', marginBottom: 16 }}>
          <div className="small" style={{ color: '#ffd8d8' }}>{errorMsg}</div>
        </div>
      )}

      {/* 조회 결과 */}
      {student && (
        <div className="grid">
          <div className="col-12">
            <StudentCard sid={student.sid} school={student.school} />
          </div>

          {Array.isArray(student.rounds) && student.rounds.map((r) => (
            <div className="col-12" key={r.label}>
              <RoundCard
                label={r.label}
                data={r.data}
                sid={student.sid}
                // RoundCard는 프로젝트 최신 버전 그대로 사용
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;

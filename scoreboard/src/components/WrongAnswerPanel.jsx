// src/components/WrongAnswerPanel.jsx
import React, { useState } from 'react';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';

function WrongAnswerPanel({ roundLabel, data }) {
  // 🔹 세션(1~4교시) 열림 상태 추가: 기본은 모두 열림
  const [openSession, setOpenSession] = useState({
    '1교시': true,
    '2교시': true,
    '3교시': true,
    '4교시': true,
  });

  // 🔹 과목(자식) 열림 상태 (기존 로직 그대로 사용)
  const [openSections, setOpenSections] = useState({});

  const toggleSection = (subject) => {
    setOpenSections(prev => ({
      ...prev,
      [subject]: !prev[subject]
    }));
  };

  const toggleSession = (sessionName) => {
    setOpenSession(prev => ({ ...prev, [sessionName]: !prev[sessionName] }));
  };

  // 교시별 오답을 과목별 오답으로 변환
  const getWrongQuestionsBySubject = () => {
    const result = {};
    ALL_SUBJECTS.forEach(s => (result[s] = []));

    if (data && data.wrongBySession) {
      Object.entries(data.wrongBySession).forEach(([session, wrongList]) => {
        const ranges = SESSION_SUBJECT_RANGES[session] || [];
        wrongList.forEach(questionNum => {
          const range = ranges.find(r => questionNum >= r.from && questionNum <= r.to);
          if (range && result[range.s]) {
            result[range.s].push(questionNum);
          }
        });
      });
    }

    // 중복 제거 및 정렬
    Object.keys(result).forEach(subject => {
      result[subject] = Array.from(new Set(result[subject])).sort((a, b) => a - b);
    });

    return result;
  };

  const wrongBySubject = getWrongQuestionsBySubject();

  // 교시별 과목 그룹화
  const sessionGroups = {
    "1교시": ["간", "심", "비", "폐", "신"],
    "2교시": ["상한", "사상", "침구", "보건"],
    "3교시": ["외과", "신경", "안이비", "부인과"],
    "4교시": ["소아", "예방", "생리", "본초"]
  };

  const renderQuestionCells = (wrongNumbers) => {
    if (!wrongNumbers || wrongNumbers.length === 0) {
      return <div className="small" style={{ opacity: 0.8 }}>오답 없음</div>;
    }
    return wrongNumbers.map(num => (
      <div key={num} className="qcell bad">{num}</div>
    ));
  };

  const renderSessionGroup = (sessionName, subjects) => {
    const isOpen = !!openSession[sessionName];

    return (
      <div key={sessionName} className="session-group">
        {/* 🔹 세션 헤더를 버튼으로 바꿔 접고/펼치기 */}
        <button
          type="button"
          className={`session-header ${isOpen ? 'expanded' : ''}`}
          onClick={() => toggleSession(sessionName)}
        >
          <span className="title">{sessionName}</span>
          <span className="chevron">❯</span>
        </button>

        {/* 🔹 여기 'expanded' 클래스가 핵심! */}
        <div className={`session-content ${isOpen ? 'expanded' : ''}`}>
          {subjects.map(subject => {
            const wrongNumbers = wrongBySubject[subject] || [];
            const isOpenSub = !!openSections[subject];

            return (
              <div key={subject} className="item">
                <button
                  type="button"
                  className={`acc-btn ${isOpenSub ? 'open' : ''}`}
                  onClick={() => toggleSection(subject)}
                >
                  <span>{subject} 오답 ({wrongNumbers.length}문항)</span>
                  <span className={`rotate ${isOpenSub ? 'open' : ''}`}>❯</span>
                </button>

                {/* 🔹 패널 높이를 넉넉히(기존 150px → 280px) + 스크롤 */}
                <div
                  className="panel"
                  style={{
                    maxHeight: isOpenSub ? '280px' : '0',
                    overflow: isOpenSub ? 'auto' : 'hidden'
                  }}
                >
                  <div className="qgrid" style={{ padding: '6px 0' }}>
                    {renderQuestionCells(wrongNumbers)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 피드백</h2>
      <div className="small" style={{ opacity: 0.8, marginBottom: '6px' }}>
        교시 박스를 클릭해 접거나 펼칠 수 있어요. 과목을 클릭하면 오답 목록을 볼 수 있습니다.
      </div>

      <div className="accordion">
        {Object.entries(sessionGroups).map(([sessionName, subjects]) =>
          renderSessionGroup(sessionName, subjects)
        )}
      </div>
    </div>
  );
}

export default WrongAnswerPanel;

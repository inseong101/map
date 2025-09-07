// src/components/WrongAnswerPanel.jsx
import React, { useState } from 'react';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';

function WrongAnswerPanel({ roundLabel, data }) {
  const [openSections, setOpenSections] = useState({});

  const toggleSection = (subject) => {
    setOpenSections((prev) => ({
      ...prev,
      [subject]: !prev[subject],
    }));
  };

  // 교시별 오답을 과목별 오답으로 변환 (중복 제거 + 정렬)
  const getWrongQuestionsBySubject = () => {
    const result = {};
    ALL_SUBJECTS.forEach((s) => (result[s] = []));

    if (data?.wrongBySession) {
      Object.entries(data.wrongBySession).forEach(([session, wrongList]) => {
        const ranges = SESSION_SUBJECT_RANGES[session] || [];
        wrongList.forEach((questionNum) => {
          const range = ranges.find((r) => questionNum >= r.from && questionNum <= r.to);
          if (range && result[range.s]) {
            result[range.s].push(questionNum);
          }
        });
      });
    }

    Object.keys(result).forEach((subject) => {
      result[subject] = Array.from(new Set(result[subject])).sort((a, b) => a - b);
    });

    return result;
  };

  const wrongBySubject = getWrongQuestionsBySubject();

  // 교시별 과목 그룹
  const sessionGroups = {
    '1교시': ['간', '심', '비', '폐', '신'],
    '2교시': ['상한', '사상', '침구', '보건'],
    '3교시': ['외과', '신경', '안이비', '부인과'],
    '4교시': ['소아', '예방', '생리', '본초'],
  };

  // 번호 칩만(정답률/보조문구 없음)
  const renderWrongQuestionCell = (questionNum) => {
    return (
      <span key={`wrong-${questionNum}`} className="qcell">
        {questionNum}
      </span>
    );
  };

  const renderQuestionSection = (wrongNumbers) => {
    if (!wrongNumbers || wrongNumbers.length === 0) {
      return (
        <div className="small" style={{ opacity: 0.8, padding: '10px 0' }}>
          오답 없음
        </div>
      );
    }
    // 🔥 제목(“내 오답(…문항)”) 제거, 번호만 나열
    return <div className="qgrid">{wrongNumbers.map((n) => renderWrongQuestionCell(n))}</div>;
  };

  const renderSessionGroup = (sessionName, subjects) => {
    return (
      <div key={sessionName} className="session-group">
        <div className="session-header">{sessionName}</div>
        <div className="session-content">
          {subjects.map((subject) => {
            const wrongNumbers = wrongBySubject[subject] || [];
            const isOpen = openSections[subject];
            const totalWrongCount = wrongNumbers.length;

            return (
              <div key={subject} className="item">
                <button
                  type="button"
                  className={`acc-btn ${isOpen ? 'open' : ''}`}
                  onClick={() => toggleSection(subject)}
                >
                  <span style={{ fontWeight: 800 }}>{subject} 오답</span>
                  <span className="small" style={{ opacity: 0.85 }}>{totalWrongCount}문항</span>
                  <span className={`rotate ${isOpen ? 'open' : ''}`}>❯</span>
                </button>

                <div
                  className="panel"
                  style={{
                    maxHeight: isOpen ? 'none' : '0',
                    overflow: isOpen ? 'visible' : 'hidden',
                    padding: isOpen ? '10px 0' : '0',
                  }}
                >
                  {isOpen && renderQuestionSection(wrongNumbers)}
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
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답노트</h2>
      <div className="small" style={{ opacity: 0.8, marginBottom: '6px' }}>
        과목명을 클릭하면 오답 번호가 펼쳐집니다.
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

// src/components/WrongAnswerPanel.jsx
import React, { useState } from 'react';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';

function WrongAnswerPanel({ roundLabel, data }) {
  const [openSections, setOpenSections] = useState({});

  const toggleSection = (subject) => {
    setOpenSections(prev => ({
      ...prev,
      [subject]: !prev[subject]
    }));
  };

  // 교시별 오답을 과목별 오답으로 변환
  const getWrongQuestionsBySubject = () => {
    const result = {};
    ALL_SUBJECTS.forEach(s => result[s] = []);

    if (data.wrongBySession) {
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

  const renderQuestionCells = (wrongNumbers) => {
    if (wrongNumbers.length === 0) {
      return <div className="small" style={{ opacity: 0.8 }}>오답 없음</div>;
    }

    return wrongNumbers.map(num => (
      <div key={num} className="qcell bad">{num}</div>
    ));
  };

  const renderAccordionItems = () => {
    return ALL_SUBJECTS.map(subject => {
      const wrongNumbers = wrongBySubject[subject] || [];
      const isOpen = openSections[subject];

      return (
        <div key={subject} className="item">
          <button
            type="button"
            className={`acc-btn ${isOpen ? 'open' : ''}`}
            onClick={() => toggleSection(subject)}
          >
            <span>{subject} 오답 ({wrongNumbers.length}문항)</span>
            <span className={`rotate ${isOpen ? 'open' : ''}`}>❯</span>
          </button>
          
          <div 
            className="panel"
            style={{ 
              maxHeight: isOpen ? '150px' : '0',
              overflow: isOpen ? 'auto' : 'hidden'
            }}
          >
            <div className="qgrid" style={{ padding: '6px 0' }}>
              {renderQuestionCells(wrongNumbers)}
            </div>
          </div>
        </div>
      );
    });
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답 피드백</h2>
      <div className="small" style={{ opacity: 0.8, marginBottom: '6px' }}>
        과목명을 클릭하면 틀린 문항이 펼쳐집니다.
      </div>
      
      <div className="accordion">
        {renderAccordionItems()}
      </div>
    </div>
  );
}

export default WrongAnswerPanel;

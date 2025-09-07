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

  // 간단한 오답률 계산 (임시 데이터 - 실제로는 통계 서비스에서 가져와야 함)
  const getErrorRateForQuestion = (questionNum) => {
    // 임시로 랜덤한 오답률 반환 (실제로는 통계 데이터에서 계산)
    const mockErrorRates = {
      1: 15, 2: 23, 3: 67, 4: 34, 5: 78, 6: 12, 7: 45, 8: 89,
      9: 23, 10: 56, 11: 34, 12: 71, 13: 28, 14: 82, 15: 19,
      17: 73, 18: 29, 19: 64, 20: 41, 21: 85, 22: 17, 23: 58,
      33: 76, 34: 42, 35: 69, 36: 33, 37: 81, 38: 25, 39: 57,
      45: 83, 46: 37, 47: 72, 48: 26, 49: 68, 50: 44, 51: 79,
      52: 91, 53: 35, 54: 62, 55: 18, 56: 74, 57: 48, 58: 86,
      61: 77, 62: 31, 63: 65, 64: 39, 65: 84, 66: 22, 67: 59,
      85: 69, 86: 43, 87: 76, 88: 27, 89: 82, 90: 38, 91: 75, 92: 54
    };
    
    return mockErrorRates[questionNum] || Math.floor(Math.random() * 40) + 30; // 30-70% 범위
  };

  const wrongBySubject = getWrongQuestionsBySubject();

  // 교시별 과목 그룹화
  const sessionGroups = {
    "1교시": ["간", "심", "비", "폐", "신"],
    "2교시": ["상한", "사상", "침구", "보건"],
    "3교시": ["외과", "신경", "안이비", "부인과"],
    "4교시": ["소아", "예방", "생리", "본초"]
  };

  // 오답 문항 셀 렌더링 (오답률 포함)
  const renderWrongQuestionCell = (questionNum) => {
    const errorRate = getErrorRateForQuestion(questionNum);
    return (
      <div key={`wrong-${questionNum}`} className="qcell bad">
        <div className="question-num">{questionNum}</div>
        <div className="error-rate">{errorRate}%</div>
      </div>
    );
  };

  const renderQuestionSection = (wrongNumbers) => {
    if (wrongNumbers.length === 0) {
      return <div className="small" style={{ opacity: 0.8, padding: '10px 0' }}>오답 없음</div>;
    }

    return (
      <div className="question-section">
        <div className="section-title">내 오답 ({wrongNumbers.length}문항)</div>
        <div className="qgrid">
          {wrongNumbers.map(num => renderWrongQuestionCell(num))}
        </div>
      </div>
    );
  };

  const renderSessionGroup = (sessionName, subjects) => {
    return (
      <div key={sessionName} className="session-group">
        <div className="session-header">
          {sessionName}
        </div>
        <div className="session-content">
          {subjects.map(subject => {
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
                  <span>{subject} 오답 ({totalWrongCount}문항)</span>
                  <span className={`rotate ${isOpen ? 'open' : ''}`}>❯</span>
                </button>
                
                <div 
                  className="panel"
                  style={{ 
                    maxHeight: isOpen ? 'none' : '0',
                    overflow: isOpen ? 'visible' : 'hidden',
                    padding: isOpen ? '10px 0' : '0'
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
        과목명을 클릭하면 오답노트가 펼쳐집니다. 각 문항 아래 숫자는 전체 오답률입니다.
      </div>
      
      <div className="accordion">
        {Object.entries(sessionGroups).map(([sessionName, subjects]) => 
          renderSessionGroup(sessionName, subjects)
        )}
      </div>

      <style jsx>{`
        .question-section {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .section-title {
          font-weight: 600;
          font-size: 0.9rem;
          color: #666;
          margin-bottom: 5px;
        }

        .qgrid {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .qcell {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 45px;
          height: 40px;
          border-radius: 4px;
          font-weight: 600;
          color: white;
          padding: 2px;
        }

        .qcell.bad {
          background-color: #dc3545;
        }

        .question-num {
          font-size: 0.8rem;
          font-weight: 600;
          line-height: 1;
        }

        .error-rate {
          font-size: 0.7rem;
          opacity: 0.9;
          line-height: 1;
          margin-top: 1px;
        }

        .panel {
          transition: all 0.3s ease;
          border-left: 3px solid #e9ecef;
          padding-left: 10px;
        }

        .session-group {
          margin-bottom: 8px;
        }

        .session-header {
          font-weight: 600;
          color: #495057;
          margin-bottom: 8px;
          padding: 8px 12px;
          background: #f8f9fa;
          border-radius: 6px;
          font-size: 0.9rem;
        }

        .session-content {
          padding-left: 8px;
        }

        .item {
          margin-bottom: 6px;
        }

        .acc-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 10px 12px;
          background: #f8f9fa;
          border: 1px solid #dee2e6;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 0.85rem;
          color: #495057;
        }

        .acc-btn:hover {
          background: #e9ecef;
          border-color: #adb5bd;
        }

        .rotate {
          transition: transform 0.3s ease;
          font-size: 0.8rem;
          color: #6c757d;
        }

        .rotate.open {
          transform: rotate(90deg);
        }

        .small {
          font-size: 0.8rem;
        }
      `}</style>
    </div>
  );
}

export default WrongAnswerPanel;

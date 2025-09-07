// src/components/WrongAnswerPanel.jsx
import React, { useState, useEffect } from 'react';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';
import { getHighErrorRateQuestions } from '../services/analyticService';

function WrongAnswerPanel({ roundLabel, data }) {
  const [openSections, setOpenSections] = useState({});
  const [highErrorQuestions, setHighErrorQuestions] = useState({});
  const [loading, setLoading] = useState(true);

  // 고오답률 문항 데이터 가져오기
  useEffect(() => {
    const loadHighErrorQuestions = async () => {
      try {
        setLoading(true);
        // API 또는 서비스에서 고오답률 문항 가져오기
        const response = await fetch(`${process.env.REACT_APP_API_URL}/getHighErrorRateQuestions?roundLabel=${roundLabel}`);
        const result = await response.json();
        
        if (result.success) {
          setHighErrorQuestions(result.data || {});
        }
      } catch (error) {
        console.error('고오답률 문항 로딩 실패:', error);
      } finally {
        setLoading(false);
      }
    };

    if (roundLabel) {
      loadHighErrorQuestions();
    }
  }, [roundLabel]);

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

  // 교시별 과목 그룹화
  const sessionGroups = {
    "1교시": ["간", "심", "비", "폐", "신"],
    "2교시": ["상한", "사상", "침구", "보건"],
    "3교시": ["외과", "신경", "안이비", "부인과"],
    "4교시": ["소아", "예방", "생리", "본초"]
  };

  // 개별 문항 셀 렌더링 (학생 오답)
  const renderWrongQuestionCell = (num) => (
    <div key={`wrong-${num}`} className="qcell bad">{num}</div>
  );

  // 고오답률 문항 셀 렌더링 (진한 빨간색 + 오답률 표시)
  const renderHighErrorQuestionCell = (questionData) => (
    <div key={`high-error-${questionData.questionNum}`} className="qcell high-error">
      <div className="question-num">{questionData.questionNum}</div>
      <div className="error-rate">{questionData.errorRate}%</div>
    </div>
  );

  const renderQuestionSection = (wrongNumbers, highErrorData) => {
    const hasWrongQuestions = wrongNumbers.length > 0;
    const hasHighErrorQuestions = highErrorData && highErrorData.length > 0;

    if (!hasWrongQuestions && !hasHighErrorQuestions) {
      return <div className="small" style={{ opacity: 0.8, padding: '10px 0' }}>오답 없음</div>;
    }

    return (
      <div className="question-section">
        {/* 학생 오답 문항 */}
        {hasWrongQuestions && (
          <div className="wrong-section">
            <div className="section-title">내 오답 ({wrongNumbers.length}문항)</div>
            <div className="qgrid">
              {wrongNumbers.map(num => renderWrongQuestionCell(num))}
            </div>
          </div>
        )}

        {/* 고오답률 문항 */}
        {hasHighErrorQuestions && (
          <div className="high-error-section">
            <div className="section-title">고오답률 문항 ({highErrorData.length}문항)</div>
            <div className="qgrid">
              {highErrorData.map(questionData => renderHighErrorQuestionCell(questionData))}
            </div>
          </div>
        )}
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
            const highErrorData = highErrorQuestions[subject] || [];
            const isOpen = openSections[subject];
            const totalWrongCount = wrongNumbers.length;
            const totalHighErrorCount = highErrorData.length;

            return (
              <div key={subject} className="item">
                <button
                  type="button"
                  className={`acc-btn ${isOpen ? 'open' : ''}`}
                  onClick={() => toggleSection(subject)}
                >
                  <span>{subject} 오답노트 (내 오답: {totalWrongCount}, 고오답률: {totalHighErrorCount})</span>
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
                  {renderQuestionSection(wrongNumbers, highErrorData)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>{roundLabel} 오답노트</h2>
        <div className="loading">고오답률 문항 데이터 로딩 중...</div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답노트</h2>
      <div className="small" style={{ opacity: 0.8, marginBottom: '6px' }}>
        과목명을 클릭하면 오답노트가 펼쳐집니다. 빨간색은 내 오답, 진한 빨간색은 고오답률 문항입니다.
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

        .wrong-section,
        .high-error-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
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
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 30px;
          border-radius: 4px;
          font-size: 0.85rem;
          font-weight: 600;
          color: white;
        }

        .qcell.bad {
          background-color: #dc3545;
        }

        .qcell.high-error {
          background-color: #a71e2a;
          flex-direction: column;
          height: 40px;
          width: 45px;
          padding: 2px;
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
          background: #ffffff;
          border: 1px solid #dee2e6;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 0.85rem;
        }

        .acc-btn:hover {
          background: #f8f9fa;
          border-color: #adb5bd;
        }

        .acc-btn.open {
          background: #e3f2fd;
          border-color: #90caf9;
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

        .loading {
          text-align: center;
          padding: 20px;
          color: #6c757d;
        }
      `}</style>
    </div>
  );
}

export default WrongAnswerPanel;

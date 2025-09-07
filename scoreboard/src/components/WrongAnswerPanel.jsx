// src/components/WrongAnswerPanel.jsx
import React, { useState, useEffect } from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';

function WrongAnswerPanel({ roundLabel, data }) {
  const [openSections, setOpenSections] = useState({});
  const [errorRateMap, setErrorRateMap] = useState({});   // { [qNum]: number }
  const [choicePercMap, setChoicePercMap] = useState({}); // { [qNum]: {1..5} }
  const [showChoices, setShowChoices] = useState(true);

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

  // Firestore에서 analytics 로드 (4개 교시를 한 번씩만)
  useEffect(() => {
    let cancelled = false;
    async function loadAnalytics() {
      try {
        const db = getFirestore();
        const sessions = ["1교시", "2교시", "3교시", "4교시"];

        const parts = await Promise.all(
          sessions.map(async (sess) => {
            const ref = doc(db, 'analytics', `${roundLabel}_${sess}`);
            const snap = await getDoc(ref);
            if (!snap.exists()) return { err: {}, cho: {} };
            const a = snap.data() || {};
            const qs = a.questionStats || {};
            const cp = a.choicePercents || {};
            const err = {};
            Object.entries(qs).forEach(([k, st]) => {
              const q = parseInt(k, 10);
              if (Number.isFinite(q) && typeof st?.errorRate === 'number') {
                err[q] = st.errorRate;
              }
            });
            return { err, cho: cp };
          })
        );

        const mergedErr = Object.assign({}, ...parts.map(p => p.err));
        const mergedCho = Object.assign({}, ...parts.map(p => p.cho));

        if (!cancelled) {
          setErrorRateMap(mergedErr);
          setChoicePercMap(mergedCho);
        }
      } catch (e) {
        console.error('오답률/선지 분포 로드 실패:', e);
      }
    }
    loadAnalytics();
    return () => { cancelled = true; };
  }, [roundLabel]);

  // Firestore에서 가져온 오답률 반환 (없으면 null)
  const getErrorRateForQuestion = (questionNum) => {
    const v = errorRateMap[questionNum];
    return typeof v === 'number' ? Math.round(v) : null;
  };

  const wrongBySubject = getWrongQuestionsBySubject();

  // 교시별 과목 그룹화
  const sessionGroups = {
    "1교시": ["간", "심", "비", "폐", "신"],
    "2교시": ["상한", "사상", "침구", "보건"],
    "3교시": ["외과", "신경", "안이비", "부인과"],
    "4교시": ["소아", "예방", "생리", "본초"]
  };

  // 오답 문항 셀 렌더링 (오답률 + 선택 분포)
  const renderWrongQuestionCell = (questionNum) => {
    const errorRate = getErrorRateForQuestion(questionNum);
    const choices = choicePercMap?.[questionNum]; // {1..5}
    const choiceText = choices
      ? `①${choices[1] ?? 0}% ②${choices[2] ?? 0}% ③${choices[3] ?? 0}% ④${choices[4] ?? 0}% ⑤${choices[5] ?? 0}%`
      : null;

    return (
      <div key={`wrong-${questionNum}`} className="qcell bad" title={`문항 ${questionNum}`}>
        <div className="question-num">{questionNum}</div>
        <div className="error-rate">{errorRate == null ? '—' : `${errorRate}%`}</div>
        {showChoices && (
          <div className="choice-row">{choiceText || '—'}</div>
        )}
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

      {/* 선지 분포 토글 */}
      <div style={{ margin: '6px 0 10px' }}>
        <label className="small" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showChoices}
            onChange={(e) => setShowChoices(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          선지 분포 표시
        </label>
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
          min-width: 56px; /* 선지 줄 표시 위해 약간 넓힘 */
          height: auto;    /* 내용 높이에 맞춤 */
          border-radius: 4px;
          font-weight: 600;
          color: white;
          padding: 4px 3px;
          text-align: center;
        }

        .qcell.bad {
          background-color: #dc3545;
        }

        .question-num {
          font-size: 0.8rem;
          font-weight: 600;
          line-height: 1;
          margin-bottom: 1px;
        }

        .error-rate {
          font-size: 0.7rem;
          opacity: 0.95;
          line-height: 1;
        }

        .choice-row {
          margin-top: 2px;
          font-size: 0.65rem;
          line-height: 1.1;
          opacity: 0.95;
          word-spacing: 2px;
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

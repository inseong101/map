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
    ALL_SUBJECTS.forEach(s => (result[s] = []));

    const wrongBySession = data?.wrongBySession || {};
    Object.entries(wrongBySession).forEach(([session, wrongList]) => {
      const ranges = SESSION_SUBJECT_RANGES[session] || [];
      wrongList.forEach((questionNum) => {
        const range = ranges.find(r => questionNum >= r.from && questionNum <= r.to);
        if (range && result[range.s]) {
          result[range.s].push(questionNum);
        }
      });
    });

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

  const attendedSessions = new Set(Object.keys(data?.wrongBySession || {}));

  const renderQuestionCells = (wrongNumbers, isAbsentSubject) => {
    if (isAbsentSubject) {
      return (
        <div className="small" style={{ color: 'var(--abs)', fontWeight: 700 }}>
          미응시
        </div>
      );
    }
    if (!wrongNumbers || wrongNumbers.length === 0) {
      return <div className="small" style={{ opacity: 0.8 }}>오답 없음</div>;
    }
    return wrongNumbers.map(num => (
      <div
        key={num}
        className="qcell bad"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 28,
          height: 24,
          borderRadius: 8,
          border: '1px solid rgba(239,68,68,.45)',
          background: 'rgba(239,68,68,.12)',
          margin: '2px 6px 2px 0',
          fontSize: 12,
          fontWeight: 700
        }}
      >
        {num}
      </div>
    ));
  };

  const renderSessionGroup = (sessionName, subjects) => {
    const isSessionAbsent = !attendedSessions.has(sessionName);

    return (
      <div key={sessionName} className="session-group">
        <div
          className="session-header"
          style={isSessionAbsent ? {
            background: 'linear-gradient(90deg, rgba(168,85,247,.12), rgba(168,85,247,.18))',
            borderBottom: '1px solid rgba(168,85,247,.35)'
          } : undefined}
        >
          <span style={{ fontWeight: 800 }}>
            {sessionName}
            {isSessionAbsent && (
              <span
                className="badge absent"
                style={{ marginLeft: 8, fontSize: 11 }}
              >
                미응시
              </span>
            )}
          </span>
        </div>

        <div className="session-content" style={{ padding: 16 }}>
          {subjects.map(subject => {
            const wrongNumbers = wrongBySubject[subject] || [];
            const isOpen = !!openSections[subject];
            // 과목단위 미응시: 교시 전체 미응시일 때 해당 교시의 모든 과목을 미응시 처리
            const isSubjectAbsent = isSessionAbsent;

            return (
              <div key={subject} className="item" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className={`acc-btn ${isOpen ? 'open' : ''}`}
                  onClick={() => toggleSection(subject)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: `1px solid ${isSubjectAbsent ? 'rgba(168,85,247,.45)' : 'var(--line)'}`,
                    background: isSubjectAbsent ? 'rgba(168,85,247,.10)' : 'var(--surface-2)',
                    color: isSubjectAbsent ? 'var(--abs)' : 'var(--ink)',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  <span>
                    {subject}{' '}
                    {isSubjectAbsent ? (
                      <span className="badge absent" style={{ marginLeft: 6, fontSize: 10 }}>미응시</span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>
                        오답 {wrongNumbers.length}문항
                      </span>
                    )}
                  </span>
                  <span
                    className={`rotate ${isOpen ? 'open' : ''}`}
                    style={{
                      transition: 'transform .2s ease',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      color: isSubjectAbsent ? 'var(--abs)' : 'var(--muted)'
                    }}
                  >
                    ❯
                  </span>
                </button>

                <div
                  className="panel"
                  style={{
                    maxHeight: isOpen ? 160 : 0,
                    overflow: isOpen ? 'auto' : 'hidden',
                    transition: 'max-height .25s ease',
                    border: `1px solid ${isSubjectAbsent ? 'rgba(168,85,247,.35)' : 'transparent'}`,
                    borderTop: 'none',
                    borderRadius: 10
                  }}
                >
                  <div
                    className="qgrid"
                    style={{
                      padding: '8px 6px',
                      background: isSubjectAbsent ? 'rgba(168,85,247,.08)' : 'transparent',
                      borderRadius: 10
                    }}
                  >
                    {renderQuestionCells(wrongNumbers, isSubjectAbsent)}
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
        과목명을 클릭하면 틀린 문항이 펼쳐집니다.
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

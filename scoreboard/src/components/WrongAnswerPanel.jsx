// src/components/WrongAnswerPanel.jsx
import React, { useState, useEffect } from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';

function WrongAnswerPanel({ roundLabel, data }) {
  const [openSections, setOpenSections] = useState({});
  const [correctRateMap, setCorrectRateMap] = useState({}); // { [qNum]: number }
  const [loading, setLoading] = useState(true);

  const toggleSection = (subject) => {
    setOpenSections((prev) => ({
      ...prev,
      [subject]: !prev[subject],
    }));
  };

  // 교시별 오답을 과목별 오답으로 변환
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

    // 중복 제거 및 정렬
    Object.keys(result).forEach((subject) => {
      result[subject] = Array.from(new Set(result[subject])).sort((a, b) => a - b);
    });

    return result;
  };

  // Firestore에서 analytics 로드 (4개 교시를 한 번씩만)
  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      try {
        setLoading(true);
        const db = getFirestore();
        const sessions = ['1교시', '2교시', '3교시', '4교시'];

        const parts = await Promise.all(
          sessions.map(async (sess) => {
            const ref = doc(db, 'analytics', `${roundLabel}_${sess}`);
            const snap = await getDoc(ref);
            if (!snap.exists()) return {};
            const a = snap.data() || {};
            const qs = a.questionStats || {};
            const map = {};
            Object.entries(qs).forEach(([k, st]) => {
              const q = parseInt(k, 10);
              if (Number.isFinite(q) && typeof st?.correctRate === 'number') {
                map[q] = st.correctRate; // 백엔드에서 소수점(%)로 저장됨
              }
            });
            return map;
          })
        );

        const merged = Object.assign({}, ...parts);

        if (!cancelled) {
          setCorrectRateMap(merged);
        }
      } catch (e) {
        console.error('정답률 로드 실패:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [roundLabel]);

  // Firestore에서 가져온 정답률 반환 (없으면 null)
  const getCorrectRateForQuestion = (questionNum) => {
    const v = correctRateMap[questionNum];
    return typeof v === 'number' ? Math.round(v) : null; // 정수%로 표시
  };

  const wrongBySubject = getWrongQuestionsBySubject();

  // 교시별 과목 그룹화
  const sessionGroups = {
    '1교시': ['간', '심', '비', '폐', '신'],
    '2교시': ['상한', '사상', '침구', '보건'],
    '3교시': ['외과', '신경', '안이비', '부인과'],
    '4교시': ['소아', '예방', '생리', '본초'],
  };

  // 오답 문항 셀 (정답률만)
  const renderWrongQuestionCell = (questionNum) => {
    const correctRate = getCorrectRateForQuestion(questionNum);

    return (
      <div key={`wrong-${questionNum}`} className="qcell good" title={`문항 ${questionNum}`}>
        <div className="question-num">{questionNum}</div>
        <div className="rate">{loading ? '…' : correctRate == null ? '—' : `${correctRate}%`}</div>
      </div>
    );
  };

  const renderQuestionSection = (wrongNumbers) => {
    if (wrongNumbers.length === 0) {
      return (
        <div className="small" style={{ opacity: 0.8, padding: '10px 0' }}>
          오답 없음
        </div>
      );
    }

    // ✅ "내 오답 (n문항)" 제목 제거 — 번호만 표시
    return <div className="qgrid">{wrongNumbers.map((num) => renderWrongQuestionCell(num))}</div>;
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
                  <span>
                    {subject} 오답 ({totalWrongCount}문항)
                  </span>
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
        각 문항 번호 아래 숫자는 <b>정답률</b>입니다.
      </div>

      <div className="accordion">
        {Object.entries(sessionGroups).map(([sessionName, subjects]) =>
          renderSessionGroup(sessionName, subjects)
        )}
      </div>

      {/* qgrid는 스크롤 제거 / flip-back(부모)은 App.css에서 overflow-y: auto 유지 */}
      <style jsx>{`
        .qgrid {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          max-height: none;
          overflow: visible;
          padding-right: 0;
        }
        .qgrid::-webkit-scrollbar { display: none; }

        .qcell {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 56px;
          height: auto;
          border-radius: 4px;
          font-weight: 600;
          color: white;
          padding: 6px 6px;
          text-align: center;
        }
        .qcell.good { background-color: #28a745; }

        .question-num {
          font-size: 0.8rem;
          font-weight: 700;
          line-height: 1;
          margin-bottom: 2px;
        }
        .rate {
          font-size: 0.8rem;
          opacity: 0.98;
          line-height: 1.1;
        }

        .panel {
          transition: all 0.3s ease;
          border-left: 3px solid #e9ecef;
          padding-left: 10px;
        }
        .session-group { margin-bottom: 8px; }
        .session-header {
          font-weight: 600;
          color: #495057;
          margin-bottom: 8px;
          padding: 8px 12px;
          background: #f8f9fa;
          border-radius: 6px;
          font-size: 0.9rem;
        }
        .session-content { padding-left: 8px; }
        .item { margin-bottom: 6px; }

        .acc-btn {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%; padding: 10px 12px;
          background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px;
          cursor: pointer; transition: all 0.2s ease; font-size: 0.85rem; color: #495057;
        }
        .acc-btn:hover { background: #e9ecef; border-color: #adb5bd; }
        .rotate { transition: transform 0.3s ease; font-size: 0.8rem; color: #6c757d; }
        .rotate.open { transform: rotate(90deg); }
        .small { font-size: 0.8rem; }
      `}</style>
    </div>
  );
}

export default WrongAnswerPanel;

// src/components/WrongAnswerPanel.jsx
import React, { useMemo, useEffect, useState } from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';

/**
 * 과목별 오답을 항상 펼쳐서 보여주는 패널
 * - 토글/아코디언 제거
 * - "내 오답(…문항)" 제거
 * - per-subject 스크롤 제거
 * - 각 문항 옆에 전체 정답률(%) 표시
 */
function WrongAnswerPanel({ roundLabel, data }) {
  const [correctRateMap, setCorrectRateMap] = useState({}); // { [qNum]: number }
  const [loadingRates, setLoadingRates] = useState(true);

  // 교시별 오답을 과목별 배열로 변환
  const wrongBySubject = useMemo(() => {
    const result = {};
    ALL_SUBJECTS.forEach((s) => (result[s] = []));

    if (data?.wrongBySession) {
      Object.entries(data.wrongBySession).forEach(([session, wrongList]) => {
        const ranges = SESSION_SUBJECT_RANGES[session] || [];
        wrongList.forEach((qNum) => {
          const range = ranges.find((r) => qNum >= r.from && qNum <= r.to);
          if (range && result[range.s]) {
            result[range.s].push(qNum);
          }
        });
      });
    }

    // 중복 제거 + 정렬
    Object.keys(result).forEach((subject) => {
      result[subject] = Array.from(new Set(result[subject])).sort((a, b) => a - b);
    });

    return result;
  }, [data]);

  // 화면에 묶어 보여줄 교시별 과목 그룹
  const sessionGroups = {
    '1교시': ['간', '심', '비', '폐', '신'],
    '2교시': ['상한', '사상', '침구', '보건'],
    '3교시': ['외과', '신경', '안이비', '부인과'],
    '4교시': ['소아', '예방', '생리', '본초'],
  };

  // Firestore analytics에서 문항별 정답률(%) 로드
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingRates(true);
        const db = getFirestore();
        const sessions = ['1교시', '2교시', '3교시', '4교시'];

        const partials = await Promise.all(
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
                map[q] = st.correctRate; // 소수점(%) 형태
              }
            });
            return map;
          })
        );

        const merged = Object.assign({}, ...partials);
        if (!cancelled) setCorrectRateMap(merged);
      } catch (e) {
        console.error('정답률 로드 실패:', e);
      } finally {
        if (!cancelled) setLoadingRates(false);
      }
    })();

    return () => { cancelled = true; };
  }, [roundLabel]);

  const getCorrectRate = (qNum) => {
    const v = correctRateMap[qNum];
    if (typeof v !== 'number') return null;
    return Math.round(v); // 정수%로
  };

  const renderSubjectAlwaysOpen = (subject) => {
    const wrongNumbers = wrongBySubject[subject] || [];
    const count = wrongNumbers.length;

    return (
      <div key={subject} className="sub-block">
        <div className="sub-title">
          {subject} 오답 ({count}문항)
        </div>

        {count === 0 ? (
          <div className="small" style={{ opacity: 0.8 }}>오답 없음</div>
        ) : (
          <div className="qgrid no-scroll">
            {wrongNumbers.map((n) => {
              const rate = getCorrectRate(n);
              return (
                <span key={n} className="qnum">
                  {n}
                  <span className="qrate">
                    {loadingRates ? '…' : (rate == null ? ' —' : ` ${rate}%`)}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderSessionGroup = (sessionName, subjects) => {
    return (
      <div key={sessionName} className="session-group plain">
        <div className="session-header">{sessionName}</div>
        <div className="session-content no-scroll">
          {subjects.map(renderSubjectAlwaysOpen)}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답노트</h2>
      <div className="small" style={{ opacity: 0.8, marginBottom: '6px' }}>
        과목별로 오답 번호와 전체 정답률(%)만 표시합니다.
      </div>

      <div className="accordion always-open">
        {Object.entries(sessionGroups).map(([sessionName, subjects]) =>
          renderSessionGroup(sessionName, subjects)
        )}
      </div>

      {/* 컴포넌트 전용 최소 스타일 */}
      <style jsx>{`
        .accordion.always-open {
          border-top: 1px solid var(--line);
          margin-top: 8px;
        }

        .session-group.plain {
          margin-bottom: 12px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: var(--surface-2);
          overflow: visible;
        }

        .session-header {
          background: linear-gradient(90deg, var(--primary), #4cc9ff);
          color: #fff;
          padding: 10px 16px;
          font-weight: 800;
          font-size: 14px;
          text-align: center;
          border-bottom: 1px solid var(--line);
        }

        .session-content.no-scroll {
          padding: 8px 10px 10px;
          overflow: visible;      /* ✅ per-subject 스크롤 제거 */
        }

        .sub-block { margin-bottom: 8px; }

        .sub-title {
          font-weight: 700;
          color: var(--ink);
          margin: 6px 2px;
          font-size: 0.95rem;
        }

        /* 번호만 보이는 칩 + 정답률 (배경/테두리 없음) */
        .qgrid.no-scroll {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 10px;
          padding-right: 0;
          overflow: visible;
          max-height: none;
        }
        .qnum {
          font-weight: 800;
          padding: 2px 4px;      /* 숫자 간 살짝 여백 */
          line-height: 1.3;
        }
        .qnum .qrate {
          font-weight: 600;
          opacity: .8;
          margin-left: 2px;
        }
      `}</style>
    </div>
  );
}

export default WrongAnswerPanel;

// src/components/WrongAnswerPanel.jsx
import React, { useMemo, useEffect, useState } from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { ALL_SUBJECTS, SESSION_SUBJECT_RANGES } from '../services/dataService';

/**
 * 항상 펼쳐진 오답 패널 (초록색 버튼형 칩)
 * - 토글/아코디언 제거 (항상 open)
 * - "내 오답(…문항)" 문구 제거, 과목명 섹션만 남김
 * - per-subject 스크롤 제거 (내용 많으면 자연스럽게 늘어남)
 * - 각 오답 칩: 초록 버튼형(번호 + 정답률%)
 */
function WrongAnswerPanel({ roundLabel, data }) {
  const [correctRateMap, setCorrectRateMap] = useState({}); // { [qNum]: number }
  const [loading, setLoading] = useState(true);

  // 교시별 오답을 과목별 배열로 변환
  const wrongBySubject = useMemo(() => {
    const result = {};
    ALL_SUBJECTS.forEach((s) => (result[s] = []));

    if (data?.wrongBySession) {
      Object.entries(data.wrongBySession).forEach(([session, wrongList]) => {
        const ranges = SESSION_SUBJECT_RANGES[session] || [];
        wrongList.forEach((qNum) => {
          const range = ranges.find((r) => qNum >= r.from && qNum <= r.to);
          if (range && result[range.s]) result[range.s].push(qNum);
        });
      });
    }

    // 중복 제거 + 정렬
    Object.keys(result).forEach((subject) => {
      result[subject] = Array.from(new Set(result[subject])).sort((a, b) => a - b);
    });

    return result;
  }, [data]);

  // Firestore에서 각 문항 정답률 로드 (4개 교시를 한 번씩만)
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
                map[q] = st.correctRate; // 정답률(%) 저장됨
              }
            });
            return map;
          })
        );

        const merged = Object.assign({}, ...parts);
        if (!cancelled) setCorrectRateMap(merged);
      } catch (e) {
        console.error('정답률 로드 실패:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAnalytics();
    return () => { cancelled = true; };
  }, [roundLabel]);

  // 정답률 가져오기(정수%)
  const getCorrectRate = (qNum) => {
    const v = correctRateMap[qNum];
    return typeof v === 'number' ? Math.round(v) : null;
  };

  // 화면에 묶어 보여줄 교시별 과목 그룹
  const sessionGroups = {
    '1교시': ['간', '심', '비', '폐', '신'],
    '2교시': ['상한', '사상', '침구', '보건'],
    '3교시': ['외과', '신경', '안이비', '부인과'],
    '4교시': ['소아', '예방', '생리', '본초'],
  };

  const renderSubjectBlock = (subject) => {
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
                <div key={n} className="qcell good" title={`문항 ${n}`}>
                  <div className="question-num">{n}</div>
                  <div className="rate">{loading ? '…' : rate == null ? '—' : `${rate}%`}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderSessionGroup = (sessionName, subjects) => (
    <div key={sessionName} className="session-group plain">
      <div className="session-header">{sessionName}</div>
      <div className="session-content no-scroll">
        {subjects.map(renderSubjectBlock)}
      </div>
    </div>
  );

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{roundLabel} 오답노트</h2>
      <div className="small" style={{ opacity: 0.8, marginBottom: '6px' }}>
        과목별 오답을 초록 버튼으로 표시합니다. 숫자는 문항 번호, 아래는 전체 <b>정답률</b>%입니다.
      </div>

      <div className="accordion always-open">
        {Object.entries(sessionGroups).map(([sessionName, subjects]) =>
          renderSessionGroup(sessionName, subjects)
        )}
      </div>

      {/* 전용 스타일 (전역과 충돌 최소화) */}
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
          overflow: visible; /* 내부 스크롤 제거 */
        }

        /* 교시 헤더: 고정 파란 그라데이션 */
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
          padding: 10px 12px 12px;
          overflow: visible;  /* per-subject 스크롤 제거 */
        }

        .sub-block { margin-bottom: 10px; }

        .sub-title {
          font-weight: 800;
          color: var(--ink);
          margin: 4px 2px 8px;
          font-size: 0.95rem;
        }

        /* 번호 칩: 초록 버튼형 (번호 + 정답률) */
        .qgrid.no-scroll {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding-right: 0;
          overflow: visible;   /* 스크롤 제거 */
          max-height: none;    /* 높이 제한 없음 */
        }

        .qcell {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 56px;
          height: auto;
          padding: 6px 6px;
          border-radius: 6px;
          font-weight: 700;
          text-align: center;
          color: #fff;
          user-select: none;
        }
        .qcell.good {
          background-color: #28a745; /* ✅ 초록 버튼형 */
        }

        .question-num {
          font-size: 0.86rem;
          font-weight: 800;
          line-height: 1;
          margin-bottom: 2px;
        }

        .rate {
          font-size: 0.8rem;
          opacity: 0.98;
          line-height: 1.1;
        }
      `}</style>
    </div>
  );
}

export default WrongAnswerPanel;

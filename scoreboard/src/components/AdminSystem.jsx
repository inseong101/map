// scoreboard/src/components/AdminSystem.jsx
import React, { useState, useEffect } from 'react';
import './AdminSystem.css';

import { SESSION_SUBJECT_RANGES } from '../services/dataService';

// Firebase
import { db } from '../services/firebase';
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';

/**
 * 화면:
 * - overview  : DB 개괄
 * - rounds    : 회차 선택
 * - sessions  : 교시 선택
 * - answers   : 답안 상세 표
 */
const AdminSystem = () => {
  const [currentView, setCurrentView] = useState('overview');
  const [selectedRound, setSelectedRound] = useState('');
  const [selectedSession, setSelectedSession] = useState('');

  // 공통 상태
  const [availableRounds, setAvailableRounds] = useState([]);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [answerData, setAnswerData] = useState([]);
  const [answerKey, setAnswerKey] = useState({});
  const [overallStatus, setOverallStatus] = useState(null);
  const [sessionAnalytics, setSessionAnalytics] = useState({});
  const [loading, setLoading] = useState(false);

  // Overview 전용
  const [overviewRows, setOverviewRows] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const rounds   = ['1차','2차','3차','4차','5차','6차','7차','8차'];
  const sessions = ['1교시','2교시','3교시','4교시'];

  // 교시별 문항수
  const getQuestionNumbers = (session) => {
    switch (session) {
      case '1교시': return Array.from({length:80},(_,i)=>i+1);
      case '2교시': return Array.from({length:100},(_,i)=>i+1);
      case '3교시': return Array.from({length:80},(_,i)=>i+1);
      case '4교시': return Array.from({length:80},(_,i)=>i+1);
      default: return [];
    }
  };

  // ✅ 교시별 과목 매핑(SESSION_SUBJECT_RANGES 사용)
  const subjectBy = (qNum, session) => {
    const ranges = SESSION_SUBJECT_RANGES?.[session] || [];
    const r = ranges.find(rr => qNum >= rr.from && qNum <= rr.to);
    return r?.s || '-';
  };

  // 선택률/정답률(답한 사람 기준 → 1~5 합=100%)
  const getQuestionStatistics = (questionNum) => {
    const analytics = sessionAnalytics[selectedSession];
    if (!analytics) {
      return {
        totalResponses: 0,
        answered: 0,
        nonResponseRate: 0,
        correctRate: 0,
        choiceRates: { 1:0,2:0,3:0,4:0,5:0 },
        correctAnswer: answerKey[questionNum] ?? null,
      };
    }
    const qs = analytics.questionStats?.[questionNum];
    const cs = analytics.choiceStats?.[questionNum];

    const total = qs?.totalResponses ?? 0;
    const nullCount = cs?.null ?? 0;
    const answered = Math.max(0, total - nullCount);

    const pct = (n) => answered > 0 ? Math.round((n / answered) * 100) : 0;
    const choiceRates = {
      1: pct(cs?.[1] ?? 0),
      2: pct(cs?.[2] ?? 0),
      3: pct(cs?.[3] ?? 0),
      4: pct(cs?.[4] ?? 0),
      5: pct(cs?.[5] ?? 0),
    };
    const nonResponseRate = total > 0 ? Math.round((nullCount / total) * 100) : 0;

    const correctAnswer = Number(answerKey[questionNum]);
    const correctRate = (correctAnswer >= 1 && correctAnswer <= 5)
      ? choiceRates[correctAnswer]
      : 0;

    return {
      totalResponses: total,
      answered,
      nonResponseRate,
      correctRate,
      choiceRates,
      correctAnswer,
    };
  };

  // ---------- Overview 로드 ----------
  useEffect(() => { loadOverview(); }, []);

  async function loadOverview() {
    setOverviewLoading(true);
    try {
      const rows = [];
      const availRounds = [];

      for (const round of rounds) {
        const sessionAvailability = {};
        let hasAnySession = false;
        for (const s of sessions) {
          try {
            const ref = collection(db, 'scores_raw', round, s);
            const snap = await getDocs(ref);
            const ok = !snap.empty;
            sessionAvailability[s] = ok;
            if (ok) hasAnySession = true;
          } catch {
            sessionAvailability[s] = false;
          }
        }
        if (hasAnySession) availRounds.push(round);

        let overall = null;
        try {
          const ref = doc(db, 'analytics', `${round}_overall_status`);
          const snap = await getDoc(ref);
          if (snap.exists()) overall = snap.data();
        } catch {}

        const perSession = [];
        for (const s of sessions) {
          const questions = getQuestionNumbers(s);
          const expectedQ = questions.length;

          let analytics = null;
          try {
            const ref = doc(db, 'analytics', `${round}_${s}`);
            const snap = await getDoc(ref);
            if (snap.exists()) analytics = snap.data();
          } catch {}

          let keyObj = null;
          try {
            const ref = doc(db, 'answer_keys', `${round}_${s}`);
            const snap = await getDoc(ref);
            if (snap.exists()) keyObj = snap.data();
          } catch {}

          const keyFilled = keyObj ? Object.keys(keyObj).filter(k=>keyObj[k]!=null).length : 0;
          perSession.push({
            session: s,
            available: !!sessionAvailability[s],
            analyticsExists: !!analytics,
            keyExists: !!keyObj,
            expectedQuestions: expectedQ,
            keyFilled,
          });
        }

        rows.push({ round, sessionAvailability, overall, perSession });
      }

      setAvailableRounds(availRounds);
      setOverviewRows(rows);
    } finally {
      setOverviewLoading(false);
    }
  }

  // ---------- 기존 rounds/sessions 흐름 ----------
  useEffect(() => {
    if (selectedRound) {
      checkAvailableSessions(selectedRound);
      loadOverallStatus(selectedRound);
      loadSessionAnalytics(selectedRound);
    }
  }, [selectedRound]);

  const checkAvailableSessions = async (round) => {
    const available = [];
    for (const session of sessions) {
      try {
        const sessionRef = collection(db, 'scores_raw', round, session);
        const snapshot = await getDocs(sessionRef);
        if (!snapshot.empty) available.push(session);
      } catch (e) {
        console.warn(`${round} ${session} 확인 실패:`, e);
      }
    }
    setAvailableSessions(available);
  };

  const loadOverallStatus = async (round) => {
    try {
      const statusRef = doc(db, 'analytics', `${round}_overall_status`);
      const statusSnap = await getDoc(statusRef);
      setOverallStatus(statusSnap.exists() ? statusSnap.data() : null);
    } catch (e) {
      console.error('전체 응시 상태 로드 실패:', e);
      setOverallStatus(null);
    }
  };

  const loadSessionAnalytics = async (round) => {
    const analyticsData = {};
    for (const session of sessions) {
      try {
        const ref = doc(db, 'analytics', `${round}_${session}`);
        const snap = await getDoc(ref);
        if (snap.exists()) analyticsData[session] = snap.data();
      } catch (e) {
        console.warn(`${session} 통계 로드 실패:`, e);
      }
    }
    setSessionAnalytics(analyticsData);
  };

  const loadAnswerData = async (round, session) => {
    setLoading(true);
    try {
      const keyRef = doc(db, 'answer_keys', `${round}_${session}`);
      const keySnap = await getDoc(keyRef);
      setAnswerKey(keySnap.exists() ? (keySnap.data() || {}) : {});

      const sessionRef = collection(db, 'scores_raw', round, session);
      const snapshot = await getDocs(sessionRef);

      const questionNumbers = getQuestionNumbers(session);
      const students = [];
      snapshot.forEach(d => {
        const data = d.data() || {};
        const responses = data.responses || {};
        const filled = {};
        questionNumbers.forEach(q => {
          filled[q] = (responses[q] !== undefined) ? responses[q] : null;
        });
        students.push({
          sid: d.id,
          responses: filled,
          status: data.status || 'unknown',
        });
      });

      students.sort((a,b)=>a.sid.localeCompare(b.sid));
      setAnswerData(students);
    } catch (e) {
      console.error('답안 데이터 로드 실패:', e);
    }
    setLoading(false);
  };

  const handleRoundSelect   = (round)   => { setSelectedRound(round); setCurrentView('sessions'); };
  const handleSessionSelect = (session) => { setSelectedSession(session); setCurrentView('answers'); loadAnswerData(selectedRound, session); };

  // ==== 렌더 ====

  const TopTabs = () => (
    <div className="admin-top-tabs">
      <button className={`admin-tab ${currentView==='overview' ? 'active':''}`} onClick={()=>setCurrentView('overview')}>Overview</button>
      <button className={`admin-tab ${currentView==='rounds' ? 'active':''}`} onClick={()=>setCurrentView('rounds')}>회차별 상세</button>
      {currentView!=='overview' && (
        <button className="admin-tab subtle" onClick={()=>loadOverview()} title="Overview 새로고침">↻ 개괄 새로고침</button>
      )}
    </div>
  );

  if (currentView === 'overview') {
    return (
      <div className="admin-root">
        <TopTabs />
        <h2 className="admin-title">DB 개괄(한눈에 보기)</h2>

        {overviewLoading ? (
          <div className="admin-loading">요약 로딩 중…</div>
        ) : (
          <div className="overview-table-wrap">
            <table className="overview-table">
              <thead>
                <tr>
                  <th>회차</th>
                  <th>가용 교시</th>
                  <th>참여 현황(요약)</th>
                  <th>교시별 상태</th>
                  <th style={{minWidth:120}}>액션</th>
                </tr>
              </thead>
              <tbody>
                {overviewRows.map(row=>{
                  const sOK = sessions.filter(s=>row.sessionAvailability[s]).join(', ') || '-';
                  const os  = row.overall;
                  const statusLine = os
                    ? `대상 ${os.totalStudents ?? '-'} · 완료 ${os.byStatus?.completed ?? '-'} · 중도 ${os.byStatus?.dropout ?? '-'} · 미응시 ${os.byStatus?.absent ?? '-'}`
                    : 'overall_status 없음';

                  return (
                    <tr key={row.round}>
                      <td className="bold">{row.round}</td>
                      <td>{sOK || '-'}</td>
                      <td>{statusLine}</td>
                      <td>
                        <div className="per-session-grid">
                          {row.perSession.map(ps=>(
                            <div key={ps.session} className="pill-line">
                              <span className={`pill ${ps.available ? 'green':'gray'}`}>{ps.session}</span>
                              <span className={`pill ${ps.analyticsExists ? 'blue':'warn'}`}>{ps.analyticsExists?'analytics OK':'analytics 없음'}</span>
                              <span className={`pill ${ps.keyExists ? 'purple':'warn'}`}>{ps.keyExists?`키 ${ps.keyFilled}/${ps.expectedQuestions}`:'정답표 없음'}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="btn-row">
                          <button className="btn small" onClick={()=>{ setSelectedRound(row.round); setCurrentView('sessions'); }}>교시 보기</button>
                          <button className="btn small outline" onClick={()=>{ setSelectedRound(row.round); setCurrentView('answers'); setSelectedSession('1교시'); loadAnswerData(row.round,'1교시'); }}>1교시 표</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (currentView === 'rounds') {
    return (
      <div className="admin-root">
        <TopTabs />
        <h2 className="admin-title">성적관리시스템 - 회차 선택</h2>

        <div className="grid-cards min120">
          {rounds.map(round=>{
            const ok = availableRounds.includes(round);
            return (
              <button key={round} onClick={()=> ok && handleRoundSelect(round)} disabled={!ok}
                className={`round-btn ${ok?'ok':'disabled'}`}>
                {round}
                {!ok && <div className="muted small">데이터 없음</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (currentView === 'sessions') {
    return (
      <div className="admin-root">
        <TopTabs />
        <div className="bar">
          <button onClick={()=>{ setCurrentView('rounds'); setSelectedRound(''); setAvailableSessions([]); setOverallStatus(null); setSessionAnalytics({}); }} className="btn outline">← 뒤로</button>
          <h2 className="admin-title inline">{selectedRound} - 교시 선택</h2>
        </div>

        <div className="grid-cards min120">
          {sessions.map(s=>{
            const ok = availableSessions.includes(s);
            const analytics = sessionAnalytics[s];
            return (
              <button key={s} onClick={()=> ok && handleSessionSelect(s)} disabled={!ok}
                className={`round-btn ${ok?'ok2':'disabled'}`}>
                {s}
                {analytics && <div className="tiny">{analytics.attendedStudents}/{analytics.totalStudents}명</div>}
                {!ok && <div className="muted tiny">데이터 없음</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ===== 답안 표 =====
  if (currentView === 'answers') {
    const questions = getQuestionNumbers(selectedSession);

    if (loading) {
      return (
        <div className="admin-root">
          <TopTabs />
          <div className="admin-loading">데이터 로딩 중…</div>
        </div>
      );
    }

    // 헤더 행 타이틀(왼쪽 2칸 병합)
    const rowTitles = [
      '① 선택률', '② 선택률', '③ 선택률', '④ 선택률', '⑤ 선택률',
      '미응답률', '정답', '정답률', '문항번호', '과목',
    ];

    return (
      <div className="admin-root">
        <TopTabs />
        <div className="bar">
          <button onClick={()=>{ setCurrentView('sessions'); setAnswerData([]); }} className="btn outline">← 뒤로</button>
          <h2 className="admin-title inline">{selectedRound} {selectedSession} - 답안 현황</h2>
          <div className="muted tiny">
            총 {answerData.length}명 •
            <span className="legend green">■</span> 정답
            <span className="legend red">■</span> 오답
            <span className="legend gray">■</span> 미응답
            <span className="legend dark">■</span> 미응시자
          </div>
        </div>

        <div className="table-scroll-x">
          <table className="answers-table" style={{ minWidth: Math.max(900, questions.length * 30 + 130) }}>
            <thead>
              {/* 1: ① */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[0]}</th>
                {questions.map(q=>{
                  const st = getQuestionStatistics(q);
                  const isKey = Number(answerKey[q])===1;
                  return <th key={`c1-${q}`} className={`c1 ${isKey?'is-key':''}`}>① {st.choiceRates[1]}%</th>;
                })}
              </tr>
              {/* 2: ② */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[1]}</th>
                {questions.map(q=>{
                  const st = getQuestionStatistics(q);
                  const isKey = Number(answerKey[q])===2;
                  return <th key={`c2-${q}`} className={`c2 ${isKey?'is-key':''}`}>② {st.choiceRates[2]}%</th>;
                })}
              </tr>
              {/* 3: ③ */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[2]}</th>
                {questions.map(q=>{
                  const st = getQuestionStatistics(q);
                  const isKey = Number(answerKey[q])===3;
                  return <th key={`c3-${q}`} className={`c3 ${isKey?'is-key':''}`}>③ {st.choiceRates[3]}%</th>;
                })}
              </tr>
              {/* 4: ④ */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[3]}</th>
                {questions.map(q=>{
                  const st = getQuestionStatistics(q);
                  const isKey = Number(answerKey[q])===4;
                  return <th key={`c4-${q}`} className={`c4 ${isKey?'is-key':''}`}>④ {st.choiceRates[4]}%</th>;
                })}
              </tr>
              {/* 5: ⑤ */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[4]}</th>
                {questions.map(q=>{
                  const st = getQuestionStatistics(q);
                  const isKey = Number(answerKey[q])===5;
                  return <th key={`c5-${q}`} className={`c5 ${isKey?'is-key':''}`}>⑤ {st.choiceRates[5]}%</th>;
                })}
              </tr>
              {/* 6: 미응답률 */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[5]}</th>
                {questions.map(q=>{
                  const st = getQuestionStatistics(q);
                  return <th key={`nr-${q}`} className="nonresp">미응답 {st.nonResponseRate}%</th>;
                })}
              </tr>
              {/* 7: 정답 */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[6]}</th>
                {questions.map(q=>{
                  const k = answerKey[q] ?? '?';
                  return <th key={`ans-${q}`} className="answer">정답 {k}</th>;
                })}
              </tr>
              {/* 8: 정답률 */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[7]}</th>
                {questions.map(q=>{
                  const st = getQuestionStatistics(q);
                  return <th key={`cr-${q}`} className="correct">정답률 {st.correctRate}%</th>;
                })}
              </tr>
              {/* 9: 문항번호 */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[8]}</th>
                {questions.map(q=><th key={`q-${q}`} className="qnum">{q}</th>)}
              </tr>
              {/* 10: 과목 */}
              <tr>
                <th className="rowhead" colSpan={2}>{rowTitles[9]}</th>
                {questions.map(q=>{
                  const subj = subjectBy(q, selectedSession);
                  return <th key={`subj-${q}`} className="subject">{subj}</th>;
                })}
              </tr>
            </thead>

            <tbody>
              {answerData.map(stu=>(
                <tr key={stu.sid}>
                  <td className="side left body">{stu.sid}</td>
                  <td className={`side status body ${stu.status==='completed'?'ok':'bad'}`}>{stu.status==='completed'?'응시':'미응시'}</td>
                  {questions.map(q=>{
                    const ans = stu.responses[q];
                    const isNull = ans == null;
                    const correct = Number(answerKey[q]);
                    let cls = 'cell gray';
                    if (stu.status !== 'completed') cls = 'cell dark';
                    else if (!isNull) cls = (ans === correct) ? 'cell ok' : 'cell bad';
                    return <td key={`${stu.sid}-${q}`} className={cls}>{isNull?'-':ans}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {answerData.length === 0 && (
          <div className="center muted" style={{ padding: 24 }}>
            해당 교시에 답안 데이터가 없습니다.
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default AdminSystem;

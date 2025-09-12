import React, { useState, useEffect } from 'react';
import './AdminSystem.css';
import { SESSION_SUBJECT_RANGES } from '../services/dataService';
import { db } from '../services/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';

const AdminSystem = () => {
  const [currentView, setCurrentView] = useState('overview');
  const [selectedRound, setSelectedRound] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [availableRounds, setAvailableRounds] = useState([]);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [answerData, setAnswerData] = useState([]);
  const [answerKey, setAnswerKey] = useState({});
  const [overallStatus, setOverallStatus] = useState(null);
  const [sessionAnalytics, setSessionAnalytics] = useState({});
  const [loading, setLoading] = useState(false);

  const [overviewRows, setOverviewRows] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const rounds   = ['1차','2차','3차','4차','5차','6차','7차','8차'];
  const sessions = ['1교시','2교시','3교시','4교시'];

  const getQuestionNumbers = (session) => {
    switch (session) {
      case '1교시': return Array.from({length:80},(_,i)=>i+1);
      case '2교시': return Array.from({length:100},(_,i)=>i+1);
      case '3교시': return Array.from({length:80},(_,i)=>i+1);
      case '4교시': return Array.from({length:80},(_,i)=>i+1);
      default: return [];
    }
  };

  const subjectBy = (qNum, session) => {
    const ranges = SESSION_SUBJECT_RANGES?.[session] || [];
    const r = ranges.find(rr => qNum >= rr.from && qNum <= rr.to);
    return r?.s || '-';
  };

  // 응답자 기준 선택률(①~⑤ 합=100), 미응답자는 '명'으로 사용
  const getQuestionStatistics = (questionNum) => {
    const analytics = sessionAnalytics[selectedSession];
    const qs = analytics?.questionStats?.[questionNum];
    const cs = analytics?.choiceStats?.[questionNum];

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

    const correctAnswer = Number(answerKey[questionNum]);
    const correctRate =
      correctAnswer >= 1 && correctAnswer <= 5 ? choiceRates[correctAnswer] : 0;

    return { choiceRates, nullCount, correctRate, total };
  };

  // ===== Overview 로드 =====
  useEffect(() => { loadOverview(); }, []);
  async function loadOverview() {
    setOverviewLoading(true);
    try {
      const rows = [];
      const availRounds = [];
      for (const round of rounds) {
        const sessionAvailability = {};
        let hasAny = false;
        for (const s of sessions) {
          try {
            const ref = collection(db, 'scores_raw', round, s);
            const snap = await getDocs(ref);
            const ok = !snap.empty;
            sessionAvailability[s] = ok;
            if (ok) hasAny = true;
          } catch {
            sessionAvailability[s] = false;
          }
        }
        if (hasAny) availRounds.push(round);

        let overall = null;
        try {
          const ref = doc(db, 'analytics', `${round}_overall_status`);
          const snap = await getDoc(ref);
          if (snap.exists()) overall = snap.data();
        } catch {}

        const perSession = [];
        for (const s of sessions) {
          const questions = getQuestionNumbers(s);
          let keyObj = null, analytics = null;
          try {
            const kr = doc(db, 'answer_keys', `${round}_${s}`);
            const ks = await getDoc(kr);
            if (ks.exists()) keyObj = ks.data();
          } catch {}
          try {
            const ar = doc(db, 'analytics', `${round}_${s}`);
            const as = await getDoc(ar);
            if (as.exists()) analytics = as.data();
          } catch {}
          const keyFilled = keyObj ? Object.keys(keyObj).filter(k=>keyObj[k]!=null).length : 0;
          perSession.push({
            session: s,
            available: !!sessionAvailability[s],
            analyticsExists: !!analytics,
            keyExists: !!keyObj,
            expectedQuestions: questions.length,
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

  // ===== 세부 로드 =====
  useEffect(() => {
    if (selectedRound) {
      checkAvailableSessions(selectedRound);
      loadSessionAnalytics(selectedRound);
      loadOverallStatus(selectedRound);
    }
  }, [selectedRound]);

  const checkAvailableSessions = async (round) => {
    const available = [];
    for (const s of sessions) {
      try {
        const ref = collection(db, 'scores_raw', round, s);
        const snap = await getDocs(ref);
        if (!snap.empty) available.push(s);
      } catch {}
    }
    setAvailableSessions(available);
  };

  const loadOverallStatus = async (round) => {
    try {
      const ref = doc(db, 'analytics', `${round}_overall_status`);
      const snap = await getDoc(ref);
      setOverallStatus(snap.exists() ? snap.data() : null);
    } catch {
      setOverallStatus(null);
    }
  };

  const loadSessionAnalytics = async (round) => {
    const m = {};
    for (const s of sessions) {
      try {
        const ref = doc(db, 'analytics', `${round}_${s}`);
        const snap = await getDoc(ref);
        if (snap.exists()) m[s] = snap.data();
      } catch {}
    }
    setSessionAnalytics(m);
  };

  const loadAnswerData = async (round, session) => {
    setLoading(true);
    try {
      const keyRef = doc(db, 'answer_keys', `${round}_${session}`);
      const keySnap = await getDoc(keyRef);
      setAnswerKey(keySnap.exists() ? (keySnap.data() || {}) : {});

      const sessionRef = collection(db, 'scores_raw', round, session);
      const snapshot = await getDocs(sessionRef);

      const qs = getQuestionNumbers(session);
      const students = [];
      snapshot.forEach(d => {
        const data = d.data() || {};
        const responses = data.responses || {};
        const filled = {};
        qs.forEach(q => { filled[q] = responses[q] !== undefined ? responses[q] : null; });
        students.push({
          sid: d.id,
          responses: filled,
          status: data.status || 'unknown', // completed | dropout | absent 등
        });
      });
      students.sort((a,b)=>a.sid.localeCompare(b.sid));
      setAnswerData(students);
    } finally {
      setLoading(false);
    }
  };

  // ===== UI =====
  const handleRoundSelect   = (round)   => { setSelectedRound(round); setCurrentView('sessions'); };
  const handleSessionSelect = (session) => { setSelectedSession(session); setCurrentView('answers'); loadAnswerData(selectedRound, session); };

  const TopTabs = () => (
    <div className="admin-top-tabs">
      <button className={`admin-tab ${currentView==='overview' ? 'active':''}`} onClick={()=>setCurrentView('overview')}>Overview</button>
      <button className={`admin-tab ${currentView==='rounds' ? 'active':''}`} onClick={()=>setCurrentView('rounds')}>회차별 상세</button>
      {currentView!=='overview' && (
        <button className="admin-tab subtle" onClick={loadOverview} title="개괄 새로고침">↻</button>
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
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                {overviewRows.map(row=>{
                  const sOK = sessions.filter(s=>row.sessionAvailability[s]).join(', ');
                  const os  = row.overall;
                  const statusLine = os
                    ? `대상 ${os.totalStudents ?? '-'} · 유효 ${os.byStatus?.completed ?? '-'} · 중도 ${os.byStatus?.dropout ?? '-'} · 미응시 ${os.byStatus?.absent ?? '-'}`
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
                          <button className="btn small outline" onClick={()=>{ setSelectedRound(row.round); setSelectedSession('1교시'); setCurrentView('answers'); loadAnswerData(row.round,'1교시'); }}>1교시 표</button>
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
              <button
                key={round}
                onClick={()=> ok && handleRoundSelect(round)}
                disabled={!ok}
                className={`round-btn ${ok?'ok':'disabled'}`}
              >
                {round}
                {!ok && <div className="muted small">데이터 없음</div>}
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

    const statusLabel = (status) => {
      if (status === 'completed') return '유효응시';
      if (status === 'dropout')   return '중도포기';
      return '미응시';
    };
    const statusClass = (status) => {
      if (status === 'completed') return 'ok';
      if (status === 'dropout')   return 'warn';
      return 'bad-dark';
    };

    return (
      <div className="admin-root">
        <TopTabs />
        <div className="bar">
          <button onClick={()=>{ setCurrentView('sessions'); setAnswerData([]); }} className="btn outline">← 뒤로</button>
          <h2 className="admin-title inline">{selectedRound} {selectedSession} - 답안 현황</h2>
        </div>

        <div className="table-scroll-x">
          <table className="answers-table" style={{ minWidth: Math.max(900, questions.length * 30 + 136) }}>
            <thead>
              {/* 1행: 미응답자 수(명) */}
              <tr>
                <th className="rowhead" colSpan={2}>미응답자 수</th>
                {questions.map(q=>{
                  const st=getQuestionStatistics(q);
                  return <th key={`nr-${q}`} className="nonresp">{st.nullCount}명</th>;
                })}
              </tr>

              {/* 2~6행: ①~⑤ 선택률 (응답자 기준, 합=100) */}
              {[1,2,3,4,5].map(choice=>(
                <tr key={`c${choice}`}>
                  <th className="rowhead" colSpan={2}>선택 {choice}</th>
                  {questions.map(q=>{
                    const st=getQuestionStatistics(q);
                    const isKey=Number(answerKey[q])===choice;
                    return <th key={`c${choice}-${q}`} className={`c${choice} ${isKey?'is-key':''}`}>{st.choiceRates[choice]}%</th>;
                  })}
                </tr>
              ))}

              {/* 7행: 정답 */}
              <tr>
                <th className="rowhead" colSpan={2}>정답</th>
                {questions.map(q=>{
                  const k=answerKey[q] ?? '-';
                  return <th key={`ans-${q}`} className="answer">{k}</th>;
                })}
              </tr>

              {/* 8행: 정답률 */}
              <tr>
                <th className="rowhead" colSpan={2}>정답률</th>
                {questions.map(q=>{
                  const st=getQuestionStatistics(q);
                  return <th key={`cr-${q}`} className="correct">{st.correctRate}%</th>;
                })}
              </tr>

              {/* 9행: 문항번호 */}
              <tr>
                <th className="rowhead" colSpan={2}>문항번호</th>
                {questions.map(q=><th key={`q-${q}`} className="qnum">{q}</th>)}
              </tr>

              {/* 10행: 과목 (SESSION_SUBJECT_RANGES 기준) */}
              <tr>
                <th className="rowhead" colSpan={2}>과목</th>
                {questions.map(q=>{
                  const subj=subjectBy(q, selectedSession);
                  return <th key={`subj-${q}`} className="subject">{subj}</th>;
                })}
              </tr>
            </thead>

            <tbody>
              {answerData.map(stu=>(
                <tr key={stu.sid}>
                  <td className="side left body">{stu.sid}</td>
                  <td className={`side status body ${statusClass(stu.status)}`}>{statusLabel(stu.status)}</td>
                  {questions.map(q=>{
                    const ans = stu.responses[q];
                    const correct = Number(answerKey[q]);
                    const isNull = ans == null;

                    let cls = 'cell gray';               // 미응답
                    if (stu.status !== 'completed') cls = 'cell dark';   // 미응시/중도포기는 회색이 아니라 진회색
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

// scoreboard/src/components/AdminSystem.jsx
import React, { useMemo, useState, useEffect } from 'react';
import './AdminSystem.css';

import {
  findSubjectByQuestionNum,
} from '../services/dataService';

// Firebase
import { db } from '../services/firebase';
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';

const AdminSystem = () => {
  const [currentView, setCurrentView] = useState('rounds');
  const [selectedRound, setSelectedRound] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [availableRounds, setAvailableRounds] = useState([]);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [answerData, setAnswerData] = useState([]);
  const [answerKey, setAnswerKey] = useState({});
  const [overallStatus, setOverallStatus] = useState(null);
  const [sessionAnalytics, setSessionAnalytics] = useState({});
  const [loading, setLoading] = useState(false);

  const rounds = ['1차','2차','3차','4차','5차','6차','7차','8차'];
  const sessions = ['1교시','2교시','3교시','4교시'];

  // 화면에 쓰는 과목/선택률 계산 (DB 스키마 가정: analytics/{round}_{session})
  // questionStats[Q]: { totalResponses:number }
  // choiceStats[Q]  : { 1:number,2:number,3:number,4:number,5:number, null:number }
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

  useEffect(() => { checkAvailableRounds(); }, []);

  useEffect(() => {
    if (selectedRound) {
      checkAvailableSessions(selectedRound);
      loadOverallStatus(selectedRound);
      loadSessionAnalytics(selectedRound);
    }
  }, [selectedRound]);

  const checkAvailableRounds = async () => {
    setLoading(true);
    const available = [];
    for (const round of rounds) {
      try {
        const sessionRef = collection(db, 'scores_raw', round, '1교시');
        const snapshot = await getDocs(sessionRef);
        if (!snapshot.empty) available.push(round);
      } catch (e) {
        console.warn(`${round} 확인 실패:`, e);
      }
    }
    setAvailableRounds(available);
    setLoading(false);
  };

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

  const getQuestionNumbers = (session) => {
    switch (session) {
      case '1교시': return Array.from({length:80},(_,i)=>i+1);
      case '2교시': return Array.from({length:100},(_,i)=>i+1);
      case '3교시': return Array.from({length:80},(_,i)=>i+1);
      case '4교시': return Array.from({length:80},(_,i)=>i+1);
      default: return [];
    }
  };

  const loadAnswerData = async (round, session) => {
    setLoading(true);
    try {
      // 정답표
      const keyRef = doc(db, 'answer_keys', `${round}_${session}`);
      const keySnap = await getDoc(keyRef);
      setAnswerKey(keySnap.exists() ? (keySnap.data() || {}) : {});

      // 응답
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
  const goBack = () => {
    if (currentView === 'answers') {
      setCurrentView('sessions'); setAnswerData([]);
    } else if (currentView === 'sessions') {
      setCurrentView('rounds'); setSelectedRound(''); setAvailableSessions([]); setOverallStatus(null); setSessionAnalytics({});
    }
  };

  if (loading) return <div style={{ textAlign:'center', padding:40 }}><div style={{ fontSize:18, color:'var(--muted)' }}>데이터 로딩 중...</div></div>;

  // 회차 선택
  if (currentView === 'rounds') {
    return (
      <div style={{ padding:20 }}>
        <h2 style={{ marginBottom:20, color:'var(--ink)' }}>성적관리시스템 - 회차 선택</h2>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(120px,1fr))', gap:12, maxWidth:600 }}>
          {rounds.map(round=>{
            const ok = availableRounds.includes(round);
            return (
              <button key={round} onClick={()=> ok && handleRoundSelect(round)} disabled={!ok}
                style={{
                  padding:'16px 12px', border:'1px solid var(--line)', borderRadius:8,
                  background: ok ? 'var(--primary)' : 'var(--surface-2)',
                  color: ok ? '#fff' : 'var(--muted)', cursor: ok ? 'pointer' : 'not-allowed',
                  fontWeight:700, fontSize:14, opacity: ok ? 1 : .5
                }}>
                {round}
                {!ok && <div style={{fontSize:10, marginTop:4}}>데이터 없음</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 교시 선택
  if (currentView === 'sessions') {
    return (
      <div style={{ padding:20 }}>
        <div style={{ marginBottom:20 }}>
          <button onClick={goBack} style={{ padding:'8px 16px', border:'1px solid var(--line)', borderRadius:6, background:'var(--surface-2)', color:'var(--ink)', cursor:'pointer', marginRight:16 }}>← 뒤로</button>
          <h2 style={{ display:'inline', color:'var(--ink)' }}>{selectedRound} - 교시 선택</h2>
        </div>

        <h3 style={{ marginBottom:12, color:'var(--ink)' }}>교시 선택</h3>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(120px,1fr))', gap:12, maxWidth:500 }}>
          {sessions.map(s=>{
            const ok = availableSessions.includes(s);
            const analytics = sessionAnalytics[s];
            return (
              <button key={s} onClick={()=> ok && handleSessionSelect(s)} disabled={!ok}
                style={{
                  padding:'16px 12px', border:'1px solid var(--line)', borderRadius:8,
                  background: ok ? 'var(--ok)' : 'var(--surface-2)', color: ok ? '#fff' : 'var(--muted)',
                  cursor: ok ? 'pointer' : 'not-allowed', fontWeight:700, fontSize:14, opacity: ok ? 1 : .5
                }}>
                {s}
                {analytics && <div style={{fontSize:10, marginTop:4}}>{analytics.attendedStudents}/{analytics.totalStudents}명</div>}
                {!ok && <div style={{fontSize:10, marginTop:4}}>데이터 없음</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 답안 표
  if (currentView === 'answers') {
    const questions = getQuestionNumbers(selectedSession);
    return (
      <div style={{ padding:20 }}>
        <div style={{ marginBottom:20 }}>
          <button onClick={goBack} style={{ padding:'8px 16px', border:'1px solid var(--line)', borderRadius:6, background:'var(--surface-2)', color:'var(--ink)', cursor:'pointer', marginRight:16 }}>← 뒤로</button>
          <h2 style={{ display:'inline', color:'var(--ink)' }}>{selectedRound} {selectedSession} - 답안 현황</h2>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:8 }}>
            총 {answerData.length}명 •
            <span style={{ color:'#22c55e', marginLeft:8 }}>■</span> 정답
            <span style={{ color:'#ef4444', marginLeft:8 }}>■</span> 오답
            <span style={{ color:'#6b7280', marginLeft:8 }}>■</span> 미응답
            <span style={{ color:'#374151', marginLeft:8 }}>■</span> 미응시자
          </div>
        </div>

        <div style={{ overflowX:'auto', border:'1px solid var(--line)', borderRadius:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth: Math.max(900, questions.length * 30 + 130) }}>
            <thead style={{ position:'sticky', top:0, background:'var(--surface-2)', zIndex:10 }}>
              {/* 1행: ① 선택률 */}
              <tr>
                <th style={thSideLeft}>학수번호</th>
                <th style={thSideStatus}>상태</th>
                {questions.map(q=>{
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={`c1-${q}`} style={thChoice(1, stats, answerKey[q])}>
                      ① {stats.choiceRates[1]}%
                    </th>
                  );
                })}
              </tr>

              {/* 2행: ② 선택률 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={`c2-${q}`} style={thChoice(2, stats, answerKey[q])}>
                      ② {stats.choiceRates[2]}%
                    </th>
                  );
                })}
              </tr>

              {/* 3행: ③ 선택률 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={`c3-${q}`} style={thChoice(3, stats, answerKey[q])}>
                      ③ {stats.choiceRates[3]}%
                    </th>
                  );
                })}
              </tr>

              {/* 4행: ④ 선택률 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={`c4-${q}`} style={thChoice(4, stats, answerKey[q])}>
                      ④ {stats.choiceRates[4]}%
                    </th>
                  );
                })}
              </tr>

              {/* 5행: ⑤ 선택률 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={`c5-${q}`} style={thChoice(5, stats, answerKey[q])}>
                      ⑤ {stats.choiceRates[5]}%
                    </th>
                  );
                })}
              </tr>

              {/* 6행: 미응답률 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={`nr-${q}`} style={thNonResp}>
                      미응답 {stats.nonResponseRate}%
                    </th>
                  );
                })}
              </tr>

              {/* 7행: 정답 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const correct = answerKey[q] ?? '?';
                  return (
                    <th key={`ans-${q}`} style={thAnswer}>
                      정답 {correct}
                    </th>
                  );
                })}
              </tr>

              {/* 8행: 정답률 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={`cr-${q}`} style={thCorrectRate}>
                      정답률 {stats.correctRate}%
                    </th>
                  );
                })}
              </tr>

              {/* 9행: 문항번호 */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>(
                  <th key={`q-${q}`} style={thQNum}>{q}</th>
                ))}
              </tr>

              {/* 10행: 과목(맨 아래) */}
              <tr>
                <th style={thSideLeftStickySpacer}/>
                <th style={thSideStatusStickySpacer}/>
                {questions.map(q=>{
                  const subj = findSubjectByQuestionNum(q, selectedSession);
                  return (
                    <th key={`subj-${q}`} style={thSubject}>{subj}</th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {answerData.map(stu=>(
                <tr key={stu.sid}>
                  <td style={tdSideLeft}>{stu.sid}</td>
                  <td style={tdStatus(stu.status)}>{stu.status==='completed'?'응시':'미응시'}</td>
                  {questions.map(q=>{
                    const ans = stu.responses[q];
                    const isNull = ans === null || ans === undefined;
                    const correct = Number(answerKey[q]);
                    let bg = '#6b7280'; // 미응답
                    if (stu.status !== 'completed') bg = '#374151'; // 미응시자
                    else if (!isNull) bg = (ans === correct) ? '#22c55e' : '#ef4444';
                    return (
                      <td key={`${stu.sid}-${q}`} style={{
                        padding:'6px 4px',
                        border:'1px solid var(--line)',
                        background:bg, color:'#fff', textAlign:'center',
                        fontSize:11, fontWeight:600, minWidth:30
                      }}>
                        {isNull ? '-' : ans}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {answerData.length === 0 && (
          <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>
            해당 교시에 답안 데이터가 없습니다.
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default AdminSystem;

/* ===== 스타일 헬퍼 ===== */
const thBase = {
  padding:'4px',
  border:'1px solid var(--line)',
  color:'#fff',
  fontWeight:700,
  fontSize:10,
  textAlign:'center',
  minWidth:30,
};
const thSideLeft = {
  ...thBase,
  padding:'12px 8px',
  background:'var(--surface-2)',
  color:'var(--ink)',
  fontSize:12,
  minWidth:80,
  position:'sticky',
  left:0,
  zIndex:11,
};
const thSideStatus = {
  ...thBase,
  padding:'12px 8px',
  background:'var(--surface-2)',
  color:'var(--ink)',
  fontSize:11,
  minWidth:56,
  position:'sticky',
  left:80,
  zIndex:11,
};
const thSideLeftStickySpacer   = { ...thSideLeft,   visibility:'hidden' };
const thSideStatusStickySpacer = { ...thSideStatus, visibility:'hidden' };

const thChoice = (n, stats, correct) => ({
  ...thBase,
  background: (Number(correct)===n) ? '#10b981' : '#6b7280',
});
const thNonResp = { ...thBase, background:'#0ea5e9' };
const thAnswer  = { ...thBase, background:'#8b5cf6' };
const thCorrectRate = { ...thBase, background:'#22c55e' };
const thQNum    = { ...thBase, background:'var(--surface-2)', color:'var(--ink)', fontWeight:800 };
const thSubject = { ...thBase, background:'#111827', fontWeight:800 };

const tdSideLeft = {
  padding:'8px',
  border:'1px solid var(--line)',
  background:'var(--surface)',
  color:'var(--ink)',
  fontWeight:700,
  fontSize:11,
  position:'sticky',
  left:0,
  zIndex:1,
};
const tdStatus = (status) => ({
  padding:'6px 4px',
  border:'1px solid var(--line)',
  background: status==='completed' ? '#22c55e' : '#ef4444',
  color:'#fff',
  textAlign:'center',
  fontSize:10,
  fontWeight:600,
  position:'sticky',
  left:80,
  zIndex:1,
});

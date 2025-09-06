// src/components/AdminSystem.jsx - 관리자용 성적관리시스템
import React, { useState, useEffect } from 'react';
import { collection, doc, getDocs, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

const AdminSystem = () => {
  const [currentView, setCurrentView] = useState('rounds'); // 'rounds' | 'sessions' | 'answers'
  const [selectedRound, setSelectedRound] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [availableRounds, setAvailableRounds] = useState([]);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [answerData, setAnswerData] = useState([]);
  const [answerKey, setAnswerKey] = useState({});
  const [loading, setLoading] = useState(false);

  const rounds = ['1차', '2차', '3차', '4차', '5차', '6차', '7차', '8차'];
  const sessions = ['1교시', '2교시', '3교시', '4교시'];

  // 사용 가능한 회차 확인
  useEffect(() => {
    checkAvailableRounds();
  }, []);

  // 선택된 회차의 사용 가능한 교시 확인
  useEffect(() => {
    if (selectedRound) {
      checkAvailableSessions(selectedRound);
    }
  }, [selectedRound]);

  const checkAvailableRounds = async () => {
    setLoading(true);
    const available = [];
    
    for (const round of rounds) {
      try {
        // 해당 회차에 데이터가 있는지 확인
        const sessionRef = collection(db, 'scores_raw', round, '1교시');
        const snapshot = await getDocs(sessionRef);
        
        if (!snapshot.empty) {
          available.push(round);
        }
      } catch (error) {
        console.warn(`${round} 확인 실패:`, error);
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
        
        if (!snapshot.empty) {
          available.push(session);
        }
      } catch (error) {
        console.warn(`${round} ${session} 확인 실패:`, error);
      }
    }
    
    setAvailableSessions(available);
  };

  const loadAnswerData = async (round, session) => {
    setLoading(true);
    
    try {
      // 정답지 로드
      const answerKeyRef = doc(db, 'answer_keys', round);
      const answerKeySnap = await getDoc(answerKeyRef);
      const keyData = answerKeySnap.exists() ? answerKeySnap.data() : {};
      setAnswerKey(keyData);

      // 학생 답안 데이터 로드
      const sessionRef = collection(db, 'scores_raw', round, session);
      const snapshot = await getDocs(sessionRef);
      
      const students = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        students.push({
          sid: doc.id,
          responses: data.responses || {},
          wrongQuestions: data.wrongQuestions || []
        });
      });

      // 학수번호 순으로 정렬
      students.sort((a, b) => a.sid.localeCompare(b.sid));
      setAnswerData(students);
      
    } catch (error) {
      console.error('답안 데이터 로드 실패:', error);
    }
    
    setLoading(false);
  };

  const getQuestionNumbers = (session) => {
    // 교시별 문항 번호 범위
    const ranges = {
      '1교시': Array.from({length: 80}, (_, i) => i + 1),
      '2교시': Array.from({length: 100}, (_, i) => i + 1),
      '3교시': Array.from({length: 80}, (_, i) => i + 1),
      '4교시': Array.from({length: 80}, (_, i) => i + 1)
    };
    return ranges[session] || [];
  };

  const getCellColor = (sid, questionNum, selectedAnswer) => {
    const correctAnswer = answerKey[questionNum];
    
    if (!selectedAnswer || !correctAnswer) return '#2a2a2a'; // 기본색
    
    return selectedAnswer === correctAnswer ? '#22c55e' : '#ef4444'; // 초록/빨강
  };

  const handleRoundSelect = (round) => {
    setSelectedRound(round);
    setCurrentView('sessions');
  };

  const handleSessionSelect = (session) => {
    setSelectedSession(session);
    setCurrentView('answers');
    loadAnswerData(selectedRound, session);
  };

  const goBack = () => {
    if (currentView === 'answers') {
      setCurrentView('sessions');
      setAnswerData([]);
    } else if (currentView === 'sessions') {
      setCurrentView('rounds');
      setSelectedRound('');
      setAvailableSessions([]);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 18, color: 'var(--muted)' }}>데이터 로딩 중...</div>
      </div>
    );
  }

  // 회차 선택 화면
  if (currentView === 'rounds') {
    return (
      <div style={{ padding: 20 }}>
        <h2 style={{ marginBottom: 20, color: 'var(--ink)' }}>성적관리시스템 - 회차 선택</h2>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
          gap: 12,
          maxWidth: 600
        }}>
          {rounds.map(round => {
            const isAvailable = availableRounds.includes(round);
            return (
              <button
                key={round}
                onClick={() => isAvailable && handleRoundSelect(round)}
                disabled={!isAvailable}
                style={{
                  padding: '16px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: isAvailable ? 'var(--primary)' : 'var(--surface-2)',
                  color: isAvailable ? '#fff' : 'var(--muted)',
                  cursor: isAvailable ? 'pointer' : 'not-allowed',
                  fontWeight: 700,
                  fontSize: 14,
                  opacity: isAvailable ? 1 : 0.5,
                  transition: 'all 0.2s ease'
                }}
              >
                {round}
                {!isAvailable && <div style={{fontSize: 10, marginTop: 4}}>데이터 없음</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 교시 선택 화면
  if (currentView === 'sessions') {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ marginBottom: 20 }}>
          <button onClick={goBack} style={{
            padding: '8px 16px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--surface-2)',
            color: 'var(--ink)',
            cursor: 'pointer',
            marginRight: 16
          }}>
            ← 뒤로
          </button>
          <h2 style={{ display: 'inline', color: 'var(--ink)' }}>{selectedRound} - 교시 선택</h2>
        </div>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
          gap: 12,
          maxWidth: 500
        }}>
          {sessions.map(session => {
            const isAvailable = availableSessions.includes(session);
            return (
              <button
                key={session}
                onClick={() => isAvailable && handleSessionSelect(session)}
                disabled={!isAvailable}
                style={{
                  padding: '16px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: isAvailable ? 'var(--ok)' : 'var(--surface-2)',
                  color: isAvailable ? '#fff' : 'var(--muted)',
                  cursor: isAvailable ? 'pointer' : 'not-allowed',
                  fontWeight: 700,
                  fontSize: 14,
                  opacity: isAvailable ? 1 : 0.5
                }}
              >
                {session}
                {!isAvailable && <div style={{fontSize: 10, marginTop: 4}}>데이터 없음</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 답안 표 화면
  if (currentView === 'answers') {
    const questions = getQuestionNumbers(selectedSession);
    
    return (
      <div style={{ padding: 20 }}>
        <div style={{ marginBottom: 20 }}>
          <button onClick={goBack} style={{
            padding: '8px 16px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--surface-2)',
            color: 'var(--ink)',
            cursor: 'pointer',
            marginRight: 16
          }}>
            ← 뒤로
          </button>
          <h2 style={{ display: 'inline', color: 'var(--ink)' }}>
            {selectedRound} {selectedSession} - 답안 현황
          </h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            총 {answerData.length}명 응시 • 
            <span style={{ color: '#22c55e', marginLeft: 8 }}>■</span> 정답 
            <span style={{ color: '#ef4444', marginLeft: 8 }}>■</span> 오답
          </div>
        </div>

        <div style={{ 
          overflowX: 'auto', 
          border: '1px solid var(--line)', 
          borderRadius: 8,
          maxHeight: '70vh',
          overflowY: 'auto'
        }}>
          <table style={{ 
            width: '100%', 
            borderCollapse: 'collapse',
            minWidth: Math.max(800, questions.length * 30 + 100)
          }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 10 }}>
              <tr>
                <th style={{
                  padding: '12px 8px',
                  border: '1px solid var(--line)',
                  background: 'var(--surface-2)',
                  color: 'var(--ink)',
                  fontWeight: 700,
                  fontSize: 12,
                  minWidth: 80,
                  position: 'sticky',
                  left: 0,
                  zIndex: 11
                }}>
                  학수번호
                </th>
                {questions.map(q => (
                  <th key={q} style={{
                    padding: '12px 4px',
                    border: '1px solid var(--line)',
                    background: 'var(--surface-2)',
                    color: 'var(--ink)',
                    fontWeight: 700,
                    fontSize: 11,
                    minWidth: 30,
                    writingMode: 'vertical-rl'
                  }}>
                    {q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answerData.map(student => (
                <tr key={student.sid}>
                  <td style={{
                    padding: '8px',
                    border: '1px solid var(--line)',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontWeight: 700,
                    fontSize: 11,
                    position: 'sticky',
                    left: 0,
                    zIndex: 1
                  }}>
                    {student.sid}
                  </td>
                  {questions.map(q => {
                    const answer = student.responses[q];
                    const bgColor = getCellColor(student.sid, q, answer);
                    
                    return (
                      <td key={q} style={{
                        padding: '6px 4px',
                        border: '1px solid var(--line)',
                        background: bgColor,
                        color: '#fff',
                        textAlign: 'center',
                        fontSize: 11,
                        fontWeight: 600,
                        minWidth: 30
                      }}>
                        {answer || '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {answerData.length === 0 && (
          <div style={{ 
            textAlign: 'center', 
            padding: 40, 
            color: 'var(--muted)' 
          }}>
            해당 교시에 답안 데이터가 없습니다.
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default AdminSystem;

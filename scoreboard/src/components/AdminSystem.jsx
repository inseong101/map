import React, { useState, useEffect } from 'react';
import { 
  ALL_SUBJECTS, 
  SUBJECT_MAX, 
  GROUPS, 
  ROUND_LABELS,
  SESSION_SUBJECT_RANGES,
  // getSubjectByQuestion를 올바른 함수명으로 변경
} from '../services/dataService';

// Firebase import 추가
import { db } from '../services/firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  getDoc,
  query,
  where 
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

  const rounds = ['1차', '2차', '3차', '4차', '5차', '6차', '7차', '8차'];
  const sessions = ['1교시', '2교시', '3교시', '4교시'];

  // 학교 코드 매핑
  const schoolCodes = {
    '01': '가천대', '02': '경희대', '03': '대구한', '04': '대전대',
    '05': '동국대', '06': '동신대', '07': '동의대', '08': '부산대',
    '09': '상지대', '10': '세명대', '11': '우석대', '12': '원광대'
  };

  // 문항 번호로 과목을 찾는 함수 (로컬에서 구현)
  const findSubjectByQuestionNum = (questionNum, session) => {
    const ranges = SESSION_SUBJECT_RANGES[session] || [];
    for (const range of ranges) {
      if (questionNum >= range.from && questionNum <= range.to) {
        return range.s;
      }
    }
    return null;
  };

  // 통계 데이터에서 문항별 정보를 가져오는 함수 (함수명 변경)
  const getQuestionStatistics = (questionNum) => {
    if (!sessionAnalytics[selectedSession]) {
      return {
        actualResponses: 0,
        totalResponses: 0,
        responseRate: 0,
        errorRate: 0,
        choiceRates: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
    }

    const analytics = sessionAnalytics[selectedSession];
    const questionStats = analytics.questionStats?.[questionNum];
    const choiceStats = analytics.choiceStats?.[questionNum];

    if (!questionStats || !choiceStats) {
      return {
        actualResponses: 0,
        totalResponses: 0,
        responseRate: 0,
        errorRate: 0,
        choiceRates: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
    }

    // 선택률 계산
    const total = questionStats.totalResponses || 0;
    const choiceRates = {};
    
    for (let i = 1; i <= 5; i++) {
      const count = choiceStats[i] || 0;
      choiceRates[i] = total > 0 ? Math.round((count / total) * 100) : 0;
    }

    return {
      actualResponses: questionStats.totalResponses - (choiceStats.null || 0),
      totalResponses: questionStats.totalResponses || 0,
      responseRate: Math.round(questionStats.responseRate || 0),
      errorRate: Math.round(questionStats.errorRate || 0),
      choiceRates
    };
  };

  // 나머지 함수들은 그대로 유지...
  useEffect(() => {
    checkAvailableRounds();
  }, []);

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

  const loadOverallStatus = async (round) => {
    try {
      const statusRef = doc(db, 'analytics', `${round}_overall_status`);
      const statusSnap = await getDoc(statusRef);
      
      if (statusSnap.exists()) {
        const data = statusSnap.data();
        
        const schoolStats = Object.entries(data.studentDetails || {})
          .reduce((acc, [sid, details]) => {
            const schoolCode = sid.slice(0, 2);
            if (!acc[schoolCode]) {
              acc[schoolCode] = {
                code: schoolCode,
                name: schoolCodes[schoolCode] || `학교${schoolCode}`,
                totalStudents: 0,
                completed: 0,
                dropout: 0,
                absent: 0
              };
            }
            
            acc[schoolCode].totalStudents++;
            acc[schoolCode][details.overallStatus]++;
            
            return acc;
          }, {});

        setOverallStatus({
          overall: {
            totalStudents: data.totalStudents || 0,
            completed: data.byStatus?.completed || 0,
            dropout: data.byStatus?.dropout || 0,
            absent: data.byStatus?.absent || 0,
            attendanceRate: data.totalStudents > 0 
              ? Math.round(((data.byStatus?.completed || 0) / data.totalStudents) * 100) 
              : 0
          },
          bySession: data.bySession || {},
          schools: Object.values(schoolStats),
          lastUpdated: data.lastUpdated
        });
      } else {
        setOverallStatus(null);
      }
    } catch (error) {
      console.error('전체 응시 상태 로드 실패:', error);
      setOverallStatus(null);
    }
  };

  const loadSessionAnalytics = async (round) => {
    const analyticsData = {};
    
    for (const session of sessions) {
      try {
        const analyticsRef = doc(db, 'analytics', `${round}_${session}`);
        const analyticsSnap = await getDoc(analyticsRef);
        
        if (analyticsSnap.exists()) {
          analyticsData[session] = analyticsSnap.data();
        }
      } catch (error) {
        console.warn(`${session} 통계 로드 실패:`, error);
      }
    }
    
    setSessionAnalytics(analyticsData);
  };

  const loadAnswerData = async (round, session) => {
    setLoading(true);
    
    try {
      const answerKeyRef = doc(db, 'answer_keys', `${round}_${session}`);
      const answerKeySnap = await getDoc(answerKeyRef);
      const keyData = answerKeySnap.exists() ? answerKeySnap.data() : {};
      setAnswerKey(keyData);

      const sessionRef = collection(db, 'scores_raw', round, session);
      const snapshot = await getDocs(sessionRef);
      
      const students = [];
      const questionNumbers = getQuestionNumbers(session);
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const responses = data.responses || {};
        
        const completeResponses = {};
        questionNumbers.forEach(qNum => {
          completeResponses[qNum] = responses[qNum] !== undefined ? responses[qNum] : null;
        });
        
        students.push({
          sid: doc.id,
          responses: completeResponses,
          wrongQuestions: data.wrongQuestions || [],
          status: data.status || 'unknown'
        });
      });

      students.sort((a, b) => a.sid.localeCompare(b.sid));
      setAnswerData(students);
      
    } catch (error) {
      console.error('답안 데이터 로드 실패:', error);
    }
    
    setLoading(false);
  };

  const getQuestionNumbers = (session) => {
    const ranges = {
      '1교시': Array.from({length: 80}, (_, i) => i + 1),
      '2교시': Array.from({length: 100}, (_, i) => i + 1),
      '3교시': Array.from({length: 80}, (_, i) => i + 1),
      '4교시': Array.from({length: 80}, (_, i) => i + 1)
    };
    return ranges[session] || [];
  };

  const getCellColor = (sid, questionNum, selectedAnswer, status) => {
    if (status === 'absent') return '#374151';
    if (selectedAnswer === null) return '#6b7280';
    
    const correctAnswer = answerKey[questionNum];
    if (!correctAnswer) return '#2a2a2a';
    
    return selectedAnswer === correctAnswer ? '#22c55e' : '#ef4444';
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
      setOverallStatus(null);
      setSessionAnalytics({});
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

  // 교시 선택 화면 + 통계 정보 표시
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
        
        {/* 전체 응시 현황 표시 부분은 그대로 유지 */}
        {overallStatus && (
          <div style={{ 
            marginBottom: 24, 
            padding: 16, 
            background: 'var(--surface-2)', 
            borderRadius: 8,
            border: '1px solid var(--line)'
          }}>
            {/* 기존 통계 표시 코드 그대로 유지 */}
          </div>
        )}
        
        {/* 교시 선택 버튼들도 그대로 유지 */}
        <h3 style={{ marginBottom: 12, color: 'var(--ink)' }}>교시 선택</h3>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
          gap: 12,
          maxWidth: 500
        }}>
          {sessions.map(session => {
            const isAvailable = availableSessions.includes(session);
            const analytics = sessionAnalytics[session];
            
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
                {analytics && (
                  <div style={{fontSize: 10, marginTop: 4}}>
                    {analytics.attendedStudents}/{analytics.totalStudents}명
                  </div>
                )}
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
            총 {answerData.length}명 • 
            <span style={{ color: '#22c55e', marginLeft: 8 }}>■</span> 정답 
            <span style={{ color: '#ef4444', marginLeft: 8 }}>■</span> 오답
            <span style={{ color: '#6b7280', marginLeft: 8 }}>■</span> 미응답
            <span style={{ color: '#374151', marginLeft: 8 }}>■</span> 미응시자
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
            minWidth: Math.max(800, questions.length * 30 + 130)
          }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 10 }}>
              {/* 과목명 행 */}
              <tr>
                <th rowSpan="9" style={{
                  padding: '12px 8px',
                  border: '1px solid var(--line)',
                  background: 'var(--surface-2)',
                  color: 'var(--ink)',
                  fontWeight: 700,
                  fontSize: 12,
                  minWidth: 80,
                  position: 'sticky',
                  left: 0,
                  zIndex: 11,
                  verticalAlign: 'middle'
                }}>
                  학수번호
                </th>
                <th rowSpan="9" style={{
                  padding: '12px 8px',
                  border: '1px solid var(--line)',
                  background: 'var(--surface-2)',
                  color: 'var(--ink)',
                  fontWeight: 700,
                  fontSize: 11,
                  minWidth: 50,
                  verticalAlign: 'middle'
                }}>
                  상태
                </th>
                {questions.map(q => {
                  const subject = findSubjectByQuestionNum(q, selectedSession);
                  return (
                    <th key={q} style={{
                      padding: '6px 4px',
                      border: '1px solid var(--line)',
                      background: '#8b5cf6',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 9,
                      minWidth: 30,
                      textAlign: 'center'
                    }}>
                      {subject}
                    </th>
                  );
                })}
              </tr>

              {/* 문항번호 행 */}
              <tr>
                {questions.map(q => (
                  <th key={q} style={{
                    padding: '6px 4px',
                    border: '1px solid var(--line)',
                    background: 'var(--surface-2)',
                    color: 'var(--ink)',
                    fontWeight: 700,
                    fontSize: 10,
                    textAlign: 'center'
                  }}>
                    {q}
                  </th>
                ))}
              </tr>

              {/* 정답 행 */}
              <tr>
                {questions.map(q => (
                  <th key={q} style={{
                    padding: '4px',
                    border: '1px solid var(--line)',
                    background: '#22c55e',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 10,
                    textAlign: 'center'
                  }}>
                    {answerKey[q] || '?'}
                  </th>
                ))}
              </tr>

              {/* 응답 현황 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStatistics(q); // 함수명 변경
                  return (
                    <th key={q} style={{
                      padding: '4px',
                      border: '1px solid var(--line)',
                      background: '#3b82f6',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 9,
                      textAlign: 'center'
                    }}>
                      {stats ? `${stats.actualResponses}/${stats.totalResponses}` : '0/0'}
                    </th>
                  );
                })}
              </tr>

              {/* 나머지 헤더 행들도 getQuestionStatistics로 변경 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={q} style={{
                      padding: '4px',
                      border: '1px solid var(--line)',
                      background: '#0ea5e9',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 9,
                      textAlign: 'center'
                    }}>
                      {stats ? `${stats.responseRate}%` : '0%'}
                    </th>
                  );
                })}
              </tr>

              <tr>
                {questions.map(q => {
                  const stats = getQuestionStatistics(q);
                  return (
                    <th key={q} style={{
                      padding: '4px',
                      border: '1px solid var(--line)',
                      background: '#ef4444',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 9,
                      textAlign: 'center'
                    }}>
                      {stats ? `${stats.errorRate}%` : '0%'}
                    </th>
                  );
                })}
              </tr>

              {/* 선택률 행들 (1-5번) */}
              {[1, 2, 3, 4, 5].map(choice => (
                <tr key={choice}>
                  {questions.map(q => {
                    const stats = getQuestionStatistics(q);
                    const isCorrect = answerKey[q] === choice;
                    const symbols = ['①', '②', '③', '④', '⑤'];
                    
                    return (
                      <th key={q} style={{
                        padding: '4px',
                        border: '1px solid var(--line)',
                        background: isCorrect ? '#10b981' : '#6b7280',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 9,
                        textAlign: 'center'
                      }}>
                        {symbols[choice-1]}{stats ? `${stats.choiceRates[choice]}%` : '0%'}
                      </th>
                    );
                  })}
                </tr>
              ))}
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
                  <td style={{
                    padding: '6px 4px',
                    border: '1px solid var(--line)',
                    background: student.status === 'completed' ? '#22c55e' : '#ef4444',
                    color: '#fff',
                    textAlign: 'center',
                    fontSize: 10,
                    fontWeight: 600
                  }}>
                    {student.status === 'completed' ? '응시' : '미응시'}
                  </td>
                  {questions.map(q => {
                    const answer = student.responses[q];
                    const bgColor = getCellColor(student.sid, q, answer, student.status);
                    
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
                        {answer === null ? '-' : answer}
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

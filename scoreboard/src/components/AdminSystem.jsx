import React, { useState, useEffect } from 'react';
import { 
  ALL_SUBJECTS, 
  SUBJECT_MAX, 
  GROUPS, 
  ROUND_LABELS,
  SESSION_SUBJECT_RANGES,
  getSubjectByQuestion
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
  const [currentView, setCurrentView] = useState('rounds'); // 'rounds' | 'sessions' | 'answers'
  const [selectedRound, setSelectedRound] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [availableRounds, setAvailableRounds] = useState([]);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [answerData, setAnswerData] = useState([]);
  const [answerKey, setAnswerKey] = useState({});
  const [overallStatus, setOverallStatus] = useState(null); // 전체 응시 상태
  const [sessionAnalytics, setSessionAnalytics] = useState({}); // 교시별 통계
  const [loading, setLoading] = useState(false);

  const rounds = ['1차', '2차', '3차', '4차', '5차', '6차', '7차', '8차'];
  const sessions = ['1교시', '2교시', '3교시', '4교시'];

  // 학교 코드 매핑
  const schoolCodes = {
    '01': '가천대', '02': '경희대', '03': '대구한', '04': '대전대',
    '05': '동국대', '06': '동신대', '07': '동의대', '08': '부산대',
    '09': '상지대', '10': '세명대', '11': '우석대', '12': '원광대'
  };

  // 사용 가능한 회차 확인
  useEffect(() => {
    checkAvailableRounds();
  }, []);

  // 선택된 회차의 사용 가능한 교시 확인 + 통계 로드
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

  // 전체 응시 상태 로드 (백엔드 analytics/{roundLabel}_overall_status 사용)
  const loadOverallStatus = async (round) => {
    try {
      const statusRef = doc(db, 'analytics', `${round}_overall_status`);
      const statusSnap = await getDoc(statusRef);
      
      if (statusSnap.exists()) {
        const data = statusSnap.data();
        
        // 학교별 데이터 변환
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

  // 교시별 통계 로드
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
      // 교시별 정답지 로드 (수정된 경로)
      const answerKeyRef = doc(db, 'answer_keys', `${round}_${session}`);
      const answerKeySnap = await getDoc(answerKeyRef);
      const keyData = answerKeySnap.exists() ? answerKeySnap.data() : {};
      setAnswerKey(keyData);

      // 학생 답안 데이터 로드
      const sessionRef = collection(db, 'scores_raw', round, session);
      const snapshot = await getDocs(sessionRef);
      
      const students = [];
      const questionNumbers = getQuestionNumbers(session);
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const responses = data.responses || {};
        
        // 모든 문항에 대해 응답 확인 (미응답은 null로 표시)
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

      // 학수번호 순으로 정렬
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
    // 미응시자는 전체적으로 다른 색상
    if (status === 'absent') return '#374151'; // 어두운 회색
    
    if (selectedAnswer === null) return '#6b7280'; // 회색 (미응답)
    
    const correctAnswer = answerKey[questionNum];
    if (!correctAnswer) return '#2a2a2a'; // 기본색
    
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
        
        {/* 전체 응시 현황 (백엔드 데이터 사용) */}
        {overallStatus && (
          <div style={{ 
            marginBottom: 24, 
            padding: 16, 
            background: 'var(--surface-2)', 
            borderRadius: 8,
            border: '1px solid var(--line)'
          }}>
            <h3 style={{ margin: '0 0 12px 0', color: 'var(--ink)' }}>전체 응시 현황</h3>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', 
              gap: 12,
              marginBottom: 16
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--ink)' }}>
                  {overallStatus.overall.totalStudents}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>시험대상자</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#22c55e' }}>
                  {overallStatus.overall.completed}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>완전응시자</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#f59e0b' }}>
                  {overallStatus.overall.dropout}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>중도포기자</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ef4444' }}>
                  {overallStatus.overall.absent}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>미응시자</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--primary)' }}>
                  {overallStatus.overall.attendanceRate}%
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>완전응시율</div>
              </div>
            </div>

            {/* 교시별 응시 현황 */}
            <h4 style={{ margin: '16px 0 8px 0', color: 'var(--ink)' }}>교시별 응시 현황</h4>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: 8,
              marginBottom: 16
            }}>
              {sessions.map(session => {
                const sessionData = overallStatus.bySession[session];
                if (!sessionData) return null;
                
                const total = sessionData.attended + sessionData.absent;
                const rate = total > 0 ? Math.round((sessionData.attended / total) * 100) : 0;
                
                return (
                  <div key={session} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    borderRadius: 6,
                    fontSize: 12
                  }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--ink)' }}>
                      {session}
                    </span>
                    <div style={{ display: 'flex', gap: 8, color: 'var(--muted)' }}>
                      <span style={{ color: '#22c55e' }}>응시: {sessionData.attended}</span>
                      <span style={{ color: '#ef4444' }}>미응시: {sessionData.absent}</span>
                      <span style={{ color: 'var(--primary)' }}>({rate}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 학교별 통계 */}
            <h4 style={{ margin: '16px 0 8px 0', color: 'var(--ink)' }}>학교별 현황</h4>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
              gap: 8,
              maxHeight: 200,
              overflowY: 'auto'
            }}>
              {overallStatus.schools.map(school => {
                const rate = school.totalStudents > 0 
                  ? Math.round((school.completed / school.totalStudents) * 100) 
                  : 0;
                
                return (
                  <div key={school.code} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    borderRadius: 6,
                    fontSize: 12
                  }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--ink)' }}>
                      {school.name}
                    </span>
                    <div style={{ display: 'flex', gap: 12, color: 'var(--muted)' }}>
                      <span>대상: {school.totalStudents}</span>
                      <span style={{ color: '#22c55e' }}>완료: {school.completed}</span>
                      <span style={{ color: '#f59e0b' }}>포기: {school.dropout}</span>
                      <span style={{ color: '#ef4444' }}>미응시: {school.absent}</span>
                      <span style={{ color: 'var(--primary)' }}>({rate}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* 교시 선택 버튼들 */}
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
                  const subject = getSubjectByQuestion(q, selectedSession);
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
                  const stats = getQuestionStats(q);
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

              {/* 응답률(%) 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStats(q);
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

              {/* 오답률 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStats(q);
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

              {/* 1번 선택률 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStats(q);
                  const isCorrect = answerKey[q] === 1;
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
                      ①{stats ? `${stats.choiceRates[1]}%` : '0%'}
                    </th>
                  );
                })}
              </tr>

              {/* 2번 선택률 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStats(q);
                  const isCorrect = answerKey[q] === 2;
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
                      ②{stats ? `${stats.choiceRates[2]}%` : '0%'}
                    </th>
                  );
                })}
              </tr>

              {/* 3번 선택률 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStats(q);
                  const isCorrect = answerKey[q] === 3;
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
                      ③{stats ? `${stats.choiceRates[3]}%` : '0%'}
                    </th>
                  );
                })}
              </tr>

              {/* 4번 선택률 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStats(q);
                  const isCorrect = answerKey[q] === 4;
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
                      ④{stats ? `${stats.choiceRates[4]}%` : '0%'}
                    </th>
                  );
                })}
              </tr>

              {/* 5번 선택률 행 */}
              <tr>
                {questions.map(q => {
                  const stats = getQuestionStats(q);
                  const isCorrect = answerKey[q] === 5;
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
                      ⑤{stats ? `${stats.choiceRates[5]}%` : '0%'}
                    </th>
                  );
                })}
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

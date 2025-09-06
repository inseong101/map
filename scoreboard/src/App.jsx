// src/App.jsx - 전체 미응시자 처리 + 기본 레이아웃
import React, { useState, useMemo } from 'react';
import './App.css';

import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import AbsentCard from './components/AbsentCard';

import {
  discoverRoundsFor,
  getSchoolFromSid,
  ROUND_LABELS,
} from './services/dataService';

import {
  isValidStudentId,
  detectStudentAbsenceStatus,
} from './utils/helpers';

function App() {
  const [sidInput, setSidInput] = useState('');
  const [sid, setSid] = useState('');
  const [school, setSchool] = useState('');
  const [rounds, setRounds] = useState([]); // [{ label, data }, ...]

  // 입력 변화
  const onChange = (e) => setSidInput(e.target.value.trim());

  // 조회 버튼
  const onSubmit = async (e) => {
    e.preventDefault();
    const trySid = sidInput;

    // 6자리 & 01~12 시작 필터
    if (!isValidStudentId(trySid)) {
      setSid('');
      setSchool('');
      setRounds([]);
      return;
    }

    // 학교명
    const sch = getSchoolFromSid(trySid) || '';
    setSid(trySid);
    setSchool(sch);

    // 회차 데이터 로딩
    const found = await discoverRoundsFor(trySid);
    // 기대 형태: [{ label: '제1회', data: { totalScore, wrongBySession, ... } }, ...]
    setRounds(Array.isArray(found) ? found : []);
  };

  // 전체 미응시 여부: 모든 회차의 wrongBySession이 비어있는 경우
  const isCompletelyAbsent = useMemo(() => {
    if (!rounds || rounds.length === 0) return false;
    return rounds.every((r) => {
      const wb = r && r.data ? (r.data.wrongBySession || {}) : {};
      const status = detectStudentAbsenceStatus(wb);
      return !!status.isNoAttendance;
    });
  }, [rounds]);

  // 안내 메시지
  const InvalidSidGuide = () => (
    <div className="card narrow" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>학수번호 안내</h2>
      <div className="small">
        <div>• 학수번호는 6자리입니다.</div>
        <div>• 앞 2자리가 01~12 중 하나여야 합니다.</div>
      </div>
    </div>
  );

  return (
    <div className="container">
      {/* 헤더 */}
      <div className="header">
        <div>
          <h1>전졸협 모의고사 성적 조회</h1>
          <div className="small">학수번호로 회차별 성적과 오답을 확인하세요.</div>
        </div>
        {/* 검색 폼 */}
        <form onSubmit={onSubmit} className="flex" style={{ alignItems: 'stretch', gap: 8 }}>
          <input
            className="input"
            placeholder="학수번호(예: 05xxxx)"
            value={sidInput}
            onChange={onChange}
            maxLength={6}
            style={{ width: 160 }}
          />
          <button className="btn" type="submit">조회</button>
        </form>
      </div>

      {/* 유효성 안내 */}
      {sidInput && !isValidStudentId(sidInput) && <InvalidSidGuide />}

      {/* 조회 결과 */}
      {sid && (
        <div className="grid" style={{ marginTop: 16 }}>
          {/* 좌측: 학생 개요 + 추이 */}
          <div className="col-12">
            <StudentCard sid={sid} school={school} rounds={rounds} />
          </div>

          {/* 우측(아래): 회차별 카드들 */}
          {isCompletelyAbsent ? (
            // 전체 미응시자일 때: 보라 AbsentCard 한 장만 보여줌
            <div className="col-12">
              <AbsentCard sid={sid} school={school} />
            </div>
          ) : (
            // 아니라면 각 회차별 RoundCard 렌더
            rounds.map((r) => {
              const label = r && r.label ? r.label : '';
              const data = r && r.data ? r.data : {};
              const wb = data.wrongBySession || {};
              const absence = detectStudentAbsenceStatus(wb);

              // RoundCard는 내부에서 전체 카드 배경을 합격/불합격/미응시로 자동 결정
              return (
                <div className="col-12" key={label}>
                  <RoundCard
                    label={label}
                    data={data}
                    sid={sid}
                    isPartialAbsent={absence.isPartiallyAbsent}
                    attendedCount={absence.attendedCount}
                  />
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 미조회 상태 기본 가이드 */}
      {!sid && (
        <div className="card narrow" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>사용 방법</h2>
          <div className="small">
            <div>1) 상단 입력창에 학수번호(6자리)를 입력 후 ‘조회’를 누르세요.</div>
            <div>2) 앞 2자리는 01~12 중 하나여야 하며, 그 외는 분석에서 제외됩니다.</div>
            <div>3) 회차 카드의 배경색: 합격(초록)/불합격(빨강)/미응시(보라)</div>
            <div>4) 과목(그룹) 단위 미응시도 보라색으로 표시됩니다.</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

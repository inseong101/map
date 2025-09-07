import React, { useState } from 'react';
import StudentCard from './components/StudentCard';
import RoundCard from './components/RoundCard';
import './App.css';
import { discoverRoundsFor, getSchoolFromSid } from './services/dataService';

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [studentId, setStudentId] = useState('');
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const id = studentId.replace(/\D/g, '').slice(0, 6);
    if (id.length !== 6) {
      setError('학수번호는 숫자 6자리여야 합니다.');
      return;
    }
    setLoading(true);
    try {
      const foundRounds = await discoverRoundsFor(id);
      setRounds(foundRounds);
      setCurrentView('result');
    } catch (err) {
      console.error('데이터 조회 오류:', err);
      setError('데이터 조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setStudentId(value);
  };

  if (currentView === 'result') {
    const school = getSchoolFromSid(studentId);
    const roundLabels = Array.from({ length: 8 }, (_, i) => `${i + 1}차`);
    const roundMap = Object.fromEntries(rounds.map(r => [r.label, r.data]));

    return (
      <div className="container">
        <h1>전졸협 모의고사 성적 조회</h1>
        <div id="cards-grid" className="cards-grid">
          <StudentCard sid={studentId} school={school} rounds={rounds} />
          {roundLabels.map(label => (
            <RoundCard
              key={label

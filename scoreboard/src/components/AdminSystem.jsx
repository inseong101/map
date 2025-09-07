// 기존 getQuestionStats 함수를 찾아서 다음과 같이 수정하세요:

// 헤더용 간단한 통계 함수
const getQuestionStats = (questionNum) => {
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

  // 선택률 계산 - 안전한 접근
  const total = questionStats.totalResponses || 0;
  const choiceRates = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  
  // choiceStats가 객체인지 확인하고 안전하게 접근
  if (choiceStats && typeof choiceStats === 'object') {
    for (let i = 1; i <= 5; i++) {
      const count = choiceStats[i] || choiceStats[i.toString()] || 0;
      choiceRates[i] = total > 0 ? Math.round((count / total) * 100) : 0;
    }
  }

  return {
    actualResponses: total - (choiceStats?.null || choiceStats?.['null'] || 0),
    totalResponses: total,
    responseRate: total > 0 ? Math.round(((total - (choiceStats?.null || 0)) / total) * 100) : 0,
    errorRate: Math.round(questionStats.errorRate || 0),
    choiceRates: choiceRates
  };
};

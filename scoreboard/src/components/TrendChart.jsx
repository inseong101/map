// src/components/TrendChart.jsx
import React, { useEffect, useRef } from 'react';
import { drawLineChart, getAverages } from '../utils/helpers';

function TrendChart({ rounds, school }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (rounds.length > 0 && canvasRef.current) {
      renderChart();
    }
  }, [rounds, school]);

  const renderChart = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const labels = rounds.map(r => r.label).sort((a, b) => parseInt(a) - parseInt(b));
    const meSeries = labels.map(label => {
      const round = rounds.find(r => r.label === label);
      return round ? round.data.totalScore : null;
    });

    const schoolAvgSeries = await Promise.all(
      labels.map(async (label) => {
        const { schoolAvg } = await getAverages(school, label);
        return schoolAvg;
      })
    );

    const nationalAvgSeries = await Promise.all(
      labels.map(async (label) => {
        const { nationalAvg } = await getAverages('all', label);
        return nationalAvg;
      })
    );

    const maxV = Math.max(
      ...meSeries.filter(v => v != null),
      ...schoolAvgSeries,
      ...nationalAvgSeries,
      1
    );

    drawLineChart(canvas, labels, [
      { name: '본인', values: meSeries },
      { name: '학교', values: schoolAvgSeries },
      { name: '전국', values: nationalAvgSeries },
    ], maxV);
  };

  return (
    <canvas 
      ref={canvasRef}
      width={360} 
      height={220}
    />
  );
}

export default TrendChart;

// src/components/AbsentCard.jsx (새 파일)
import React from 'react';

function AbsentCard({ label }) {
  return (
    <div className="card absent-card" style={{ marginBottom: '16px' }}>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--ink)' }}>
            {label}
          </h2>
        </div>
        <div>
          <span className="badge absent">
            미응시
          </span>
        </div>
      </div>
    </div>
  );
}

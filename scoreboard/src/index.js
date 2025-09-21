// src/index.js  (서비스워커 캐시 간섭 방지용 추가)
// index.js 재밌다

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ✅ PWA SW가 예전 pdf.js/자원 캐싱해 둔 경우 “차단/빈 화면” 유발 방지
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then(regs => {
    regs.forEach(r => r.unregister());
  });
}

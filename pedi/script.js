document.addEventListener('DOMContentLoaded', () => {
  const BASE = './chapter/';
  const CHAPTERS = [
      "1장 서론.md",
      "2장 소아의 진단.md",
      "3장 성장과 발달.md",
      "4장 유전.md",
      "5장 소아의 영양.md",
      "6장 소아 양생(小兒 養生).md",
      "7장 소아 치료법.md",
      "8장 신생아 및 초생병.md",
      "9장 감염병.md",
      "10장 호흡기계의 병증 및 질환.md",
      "11장 소화기계의 병증 및 질환.md",
      "12장 신경계의 병증 및 질환.md",
      "13장 소아청소년기 정신장애.md",
      "14장 심혈관계.md",
      "15장 간담계의 병증 및 질환.md",
      "16장 비뇨생식기계의 병증 및 질환.md",
      "17장 알레르기 질환.md",
      "18장 면역질환.md",
      "19장 근·골격계 질환.md",
      "20장 내분비질환.md",
      "21장 종양.md",
      "22장 피부질환.md",
      "23장 안질환.md",
      "24장 증후.md",
      "25장 급증(손상).md",
      "26장 소아의료윤리.md"
    ];


  const $list = document.getElementById('list');

  CHAPTERS.forEach((file, idx) => {
    // 파일명 정규화 (맥에서 NFD → NFC)
    const clean = file.normalize('NFC').replace(/\.md$/, '');
    // "6장 ..." → "제6장 ..." 으로 표시
    const title = '제' + clean;

    // li 요소
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="chapter">
        <button class="chapter-btn">${title}</button>
        <button class="expand-btn">+</button>
        <div class="chapter-content" style="display:none"></div>
      </div>
    `;
    $list.appendChild(li);

    const expandBtn = li.querySelector('.expand-btn');
    const contentEl = li.querySelector('.chapter-content');

    expandBtn.addEventListener('click', async () => {
      if (contentEl.style.display === 'none') {
        try {
          const res = await fetch(BASE + file);
          if (!res.ok) throw new Error('fetch fail');
          const md = await res.text();

          // 절(# ...)은 "제n절"로, 나머지는 그대로
          const html = md.split('\n').map(line => {
            if (line.startsWith('#')) {
              return '<div class="section"><b>제' +
                     line.replace(/^#+\s*/, '') +
                     '</b></div>';
            } else if (line.startsWith('-')) {
              return '<div class="item">' +
                     line.replace(/^-+\s*/, '') +
                     '</div>';
            }
            return '';
          }).join('');

          contentEl.innerHTML = html;
          contentEl.style.display = 'block';
          expandBtn.textContent = '−';
        } catch (e) {
          contentEl.textContent = '불러오기 실패: ' + e.message;
          contentEl.style.display = 'block';
        }
      } else {
        contentEl.style.display = 'none';
        expandBtn.textContent = '+';
      }
    });
  });
});

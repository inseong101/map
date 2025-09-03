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

  CHAPTERS.forEach((name, idx) => {
    const li = document.createElement('li');

    // 큰 버튼 (장)
    const btn = document.createElement('button');
    btn.className = 'chapter-btn';
    btn.textContent = `제${idx + 1}장 · ${name.replace(/^\d+장\s*/, '')}`;
    li.appendChild(btn);

    // 소절/항목 자리 (fetch 후 넣기)
    const sub = document.createElement('ul');
    sub.className = 'sublist';
    li.appendChild(sub);

    btn.addEventListener('click', async () => {
      if (sub.childElementCount === 0) {
        try {
          const res = await fetch(BASE + name);
          const md = await res.text();
          const lines = md.split('\n');

          lines.forEach(line => {
            if (line.startsWith('# ')) {
              // 절 (제N절)
              const text = line.replace(/^#\s*/, '').trim();
              const li2 = document.createElement('li');
              li2.textContent = text.startsWith('제') ? text : '제' + text;
              sub.appendChild(li2);
            } else if (line.startsWith('- ')) {
              // 항목 (넘버링 그대로)
              const text = line.replace(/^-+\s*/, '').trim();
              const li2 = document.createElement('li');
              li2.textContent = text;
              sub.appendChild(li2);
            }
          });
        } catch (e) {
          sub.innerHTML = `<li>불러오기 실패: ${e.message}</li>`;
        }
      }
      sub.classList.toggle('visible');
    });

    $list.appendChild(li);
  });
});

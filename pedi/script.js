document.addEventListener('DOMContentLoaded', () => {
  const BASE = './chapter/';
const CHAPTERS = [
      "1장 서론.md",
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


 // 파싱 캐시
  const parsedCache = new Map();

  // 마크다운 파서: "# 1절 …" → "제1절 …", "- 1. …" → "1. …"
  function parseChapter(md) {
    const sections = [];
    let current = null;
    const lines = md.split(/\r?\n/);

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith('# ')) {
        if (current) sections.push(current);
        const t = line.replace(/^#\s*/, ''); // "1절 …"
        current = { title: '제' + t, items: [] };
      } else if (line.startsWith('- ')) {
        if (current) {
          const item = line.replace(/^-+\s*/, '').trim(); // "1. …"
          current.items.push(item);
        }
      }
    }
    if (current) sections.push(current);
    return { sections };
  }

  // 장 블록 DOM 생성
  function makeChapterRow(file) {
    const title = `제${file.replace(/\.md$/, '')}`;
    const li = document.createElement('li');
    li.className = 'chapter';
    li.innerHTML = `
      <div class="chapter-line" role="button" aria-expanded="false">${title}</div>
      <div class="sections"></div>
    `;

    const $line = li.querySelector('.chapter-line');
    const $sections = li.querySelector('.sections');

    // 장 토글
    $line.addEventListener('click', async () => {
      const open = $line.getAttribute('aria-expanded') === 'true';
      if (open) {
        $sections.classList.remove('visible');
        $line.setAttribute('aria-expanded', 'false');
        return;
      }

      // 최초 로드 시 마크다운 가져와 파싱
      if (!parsedCache.has(file)) {
        try {
          const res = await fetch(BASE + encodeURIComponent(file), { cache: 'no-store' });
          if (!res.ok) throw new Error('fetch failed ' + res.status);
          const md = await res.text();
          parsedCache.set(file, parseChapter(md));
        } catch (e) {
          console.error('❌ fetch 실패:', file, e);
          // 내용이 없어도 토글 피드백(간격)만 표시
          $sections.innerHTML = `<div class="empty-space"></div>`;
          $sections.classList.add('visible');
          $line.setAttribute('aria-expanded', 'true');
          return;
        }
      }

      // 섹션 렌더(최초 1회만)
      if ($sections.childElementCount === 0) {
        const { sections } = parsedCache.get(file) || { sections: [] };

        if (!sections.length) {
          $sections.innerHTML = `<div class="empty-space"></div>`;
        } else {
          sections.forEach((sec) => {
            const secWrap = document.createElement('div');
            secWrap.className = 'section';
            secWrap.innerHTML = `
              <div class="section-line" role="button" aria-expanded="false">${sec.title}</div>
              <ul class="items"></ul>
            `;

            const $secLine = secWrap.querySelector('.section-line');
            const $items = secWrap.querySelector('.items');

            // 절 토글
            $secLine.addEventListener('click', () => {
              const secOpen = $secLine.getAttribute('aria-expanded') === 'true';
              if (secOpen) {
                $items.classList.remove('visible');
                $secLine.setAttribute('aria-expanded', 'false');
              } else {
                // 절을 처음 펼칠 때 하위 항목 DOM 구성
                if ($items.childElementCount === 0) {
                  if (sec.items.length === 0) {
                    // 항목이 없으면 간격만
                    const spacer = document.createElement('div');
                    spacer.className = 'item-spacer';
                    $items.appendChild(spacer);
                  } else {
                    // 항목(1., 2., …) 각각도 토글 가능한 박스
                    sec.items.forEach((txt) => {
                      const itemLi = document.createElement('li');
                      itemLi.className = 'item item-line';
                      itemLi.setAttribute('role', 'button');
                      itemLi.setAttribute('aria-expanded', 'false');
                      itemLi.innerHTML = `
                        <div class="item-title">${txt}</div>
                        <div class="item-content"></div>
                      `;

                      const $content = itemLi.querySelector('.item-content');

                      // 항목 토글 (나중에 DB 컨텐츠 여기에 삽입)
                      itemLi.addEventListener('click', (ev) => {
                        ev.stopPropagation(); // 절 토글로 전파 방지
                        const isOpen = itemLi.getAttribute('aria-expanded') === 'true';
                        if (isOpen) {
                          $content.classList.remove('visible');
                          itemLi.setAttribute('aria-expanded', 'false');
                        } else {
                          // 처음 열릴 때 빈 여백만 넣어도 되고,
                          // 추후 여기서 Firestore 등에서 내용을 불러와 채우면 됨.
                          if ($content.childElementCount === 0) {
                            const spacer = document.createElement('div');
                            spacer.className = 'item-spacer';
                            $content.appendChild(spacer);
                          }
                          $content.classList.add('visible');
                          itemLi.setAttribute('aria-expanded', 'true');
                        }
                      });

                      $items.appendChild(itemLi);
                    });
                  }
                }

                $items.classList.add('visible');
                $secLine.setAttribute('aria-expanded', 'true');
              }
            });

            $sections.appendChild(secWrap);
          });
        }
      }

      $sections.classList.add('visible');
      $line.setAttribute('aria-expanded', 'true');
    });

    return li;
  }

  // 메인 렌더
  const $list = document.getElementById('list');
  CHAPTERS.forEach((file) => {
    $list.appendChild(makeChapterRow(file));
  });
});

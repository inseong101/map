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
  if (!$list) return;

  // 파일별 파싱 캐시(한 번 읽은 md는 다시 fetch 안 함)
  const parsedCache = new Map();

  // 파일명 → 버튼 표시용 "제n장 ..." 으로 변환
  const chapterTitleFromFile = (file) => {
    const clean = file.normalize('NFC').replace(/\.md$/i, ''); // "6장 소아양생(…)"
    // 이미 "n장 ..." 형태이니 앞에 "제"만 붙임
    return '제' + clean;
  };

  // "# 1절 ..." → "제1절 ..." 로 변환 (이미 '제'가 있으면 중복 금지)
  const toJeJeol = (heading) => {
    const text = heading.replace(/^#+\s*/, '').trim(); // "1절 태아…"
    const m = text.match(/^(?:제)?\s*(\d+)\s*절\s*(.*)$/);
    if (m) return `제${m[1]}절 ${m[2] || ''}`.trim();
    // "1절" 패턴이 아니면 그대로
    return text;
  };

  // Markdown 한 장(파일) 파싱 → { sections: [{ title, items[] }] }
  const parseChapter = (md) => {
    const lines = md.split(/\r?\n/);
    const sections = [];
    let cur = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith('#')) {
        // 절 시작
        const title = toJeJeol(line);
        cur = { title, items: [] };
        sections.push(cur);
      } else if (line.startsWith('-')) {
        // 항목(네가 이미 '1.', '2.' 번호를 적어둔 그대로 표시)
        const item = line.replace(/^-+\s*/, '').trim();
        if (cur) cur.items.push(item);
      } else {
        // 그 외 라인은 무시(빈 줄, 주석 등)
      }
    }
    return { sections };
  };

  // DOM: 장 블록 만들기
  const makeChapterRow = (file) => {
    const title = chapterTitleFromFile(file);
    const li = document.createElement('li');
    li.className = 'chapter';

    li.innerHTML = `
      <div class="chapter-line">
        <button class="chapter-btn" type="button">${title}</button>
        <button class="expand-btn" type="button" aria-label="펼치기">+</button>
      </div>
      <div class="sections" hidden></div>
    `;

    const $expand = li.querySelector('.expand-btn');
    const $sections = li.querySelector('.sections');

    // 펼침 버튼: 장을 펼치면 "절 버튼"들이 등장
    $expand.addEventListener('click', async (ev) => {
      ev.stopPropagation();

      if ($sections.hasAttribute('hidden')) {
        // 최초 로드 시 md fetch → parse → section 버튼 렌더
        if (!parsedCache.has(file)) {
          // 파일 경로 인코딩(한글/공백 안전)
          const url = BASE + encodeURIComponent(file);
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) {
            $sections.innerHTML = `<div class="error">불러오기 실패: ${res.status}</div>`;
            $sections.hidden = false;
            $expand.textContent = '−';
            return;
          }
          const md = await res.text();
          parsedCache.set(file, parseChapter(md));
        }

        // 렌더(이미 렌더되어 있으면 재사용)
        if ($sections.childElementCount === 0) {
          const { sections } = parsedCache.get(file);

          if (!sections.length) {
            $sections.innerHTML = `<div class="empty">절이 없습니다</div>`;
          } else {
            sections.forEach((sec, idx) => {
              const secWrap = document.createElement('div');
              secWrap.className = 'section';

              // 절 버튼(눌러야 항목 표시)
              secWrap.innerHTML = `
                <div class="section-line">
                  <button class="section-btn" type="button">${sec.title}</button>
                </div>
                <ul class="items" hidden></ul>
              `;
              const $secBtn = secWrap.querySelector('.section-btn');
              const $items = secWrap.querySelector('.items');

              $secBtn.addEventListener('click', () => {
                if ($items.hasAttribute('hidden')) {
                  // 항목 렌더(한 번만 생성)
                  if ($items.childElementCount === 0) {
                    sec.items.forEach((txt) => {
                      const li = document.createElement('li');
                      li.className = 'item';
                      li.textContent = txt; // 네가 붙인 "1. …" 그대로 유지
                      $items.appendChild(li);
                    });
                  }
                  $items.hidden = false;
                } else {
                  $items.hidden = true;
                }
              });

              $sections.appendChild(secWrap);
            });
          }
        }

        $sections.hidden = false;
        $expand.textContent = '−';
      } else {
        $sections.hidden = true;
        $expand.textContent = '+';
      }
    });

    // “장 제목” 클릭해도 펼치도록
    li.querySelector('.chapter-btn').addEventListener('click', () => $expand.click());

    return li;
  };

  // 목록 렌더
  CHAPTERS.forEach((file) => {
    $list.appendChild(makeChapterRow(file));
  });
});

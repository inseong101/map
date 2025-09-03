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
// 캐시
const parsedCache = new Map();

// 제목 파싱 함수
function parseChapter(md) {
  const sections = [];
  let current = null;
  const lines = md.split(/\r?\n/);

  for (const line of lines) {
    if (line.startsWith("# ")) {
      // 절
      if (current) sections.push(current);
      const title = line.replace(/^#\s*/, "");
      current = { title: "제" + title, items: [] };
    } else if (line.startsWith("- ")) {
      if (current) current.items.push(line.replace(/^-+\s*/, ""));
    }
  }
  if (current) sections.push(current);
  return { sections };
}

// 장 블록 만들기
function makeChapterRow(file, idx) {
  const title = `제${file.replace(/\.md$/, "")}`;
  const li = document.createElement("li");
  li.innerHTML = `
    <div class="chapter-line" role="button" aria-expanded="false">${title}</div>
    <div class="sections"></div>
  `;
  const $line = li.querySelector(".chapter-line");
  const $sections = li.querySelector(".sections");

  $line.addEventListener("click", async () => {
    const open = $line.getAttribute("aria-expanded") === "true";
    if (open) {
      $sections.classList.remove("visible");
      $line.setAttribute("aria-expanded", "false");
      return;
    }

    if (!parsedCache.has(file)) {
      const res = await fetch(BASE + encodeURIComponent(file));
      if (res.ok) {
        const md = await res.text();
        parsedCache.set(file, parseChapter(md));
      }
    }

    if ($sections.childElementCount === 0) {
      const { sections } = parsedCache.get(file);
      sections.forEach((sec) => {
        const secDiv = document.createElement("div");
        secDiv.innerHTML = `
          <div class="section-line" role="button" aria-expanded="false">${sec.title}</div>
          <ul class="items"></ul>
        `;
        const $secLine = secDiv.querySelector(".section-line");
        const $items = secDiv.querySelector(".items");

        $secLine.addEventListener("click", () => {
          const secOpen = $secLine.getAttribute("aria-expanded") === "true";
          if (secOpen) {
            $items.classList.remove("visible");
            $secLine.setAttribute("aria-expanded", "false");
          } else {
            if ($items.childElementCount === 0) {
              sec.items.forEach((txt) => {
                const li = document.createElement("li");
                li.textContent = txt;
                $items.appendChild(li);
              });
            }
            $items.classList.add("visible");
            $secLine.setAttribute("aria-expanded", "true");
          }
        });

        $sections.appendChild(secDiv);
      });
    }

    $sections.classList.add("visible");
    $line.setAttribute("aria-expanded", "true");
  });

  return li;
}

// 메인
const $list = document.getElementById("list");
CHAPTERS.forEach((file, i) => {
  $list.appendChild(makeChapterRow(file, i + 1));
});

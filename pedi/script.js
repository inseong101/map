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



 // 캐시
const parsedCache = new Map();

// 마크다운 파싱 (제목: 제1절…, 항목: 1. …)
function parseChapter(md) {
  const sections = [];
  let current = null;
  const lines = md.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("# ")) {
      // 절 헤더: "# 1절 …" -> "제1절 …"
      if (current) sections.push(current);
      const t = line.replace(/^#\s*/, ""); // "1절 …"
      current = { title: "제" + t, items: [] };
    } else if (line.startsWith("- ")) {
      if (current) {
        const item = line.replace(/^-+\s*/, "").trim(); // "- 1. …" -> "1. …"
        current.items.push(item);
      }
    }
  }
  if (current) sections.push(current);
  return { sections };
}

// 장 블록 생성
function makeChapterRow(file) {
  const title = `제${file.replace(/\.md$/, "")}`; // "제6장 소아양생(…)"
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

    // 최초 로드
    if (!parsedCache.has(file)) {
      try {
        const res = await fetch(BASE + encodeURIComponent(file), { cache: "no-store" });
        if (!res.ok) throw new Error("fetch failed " + res.status);
        const md = await res.text();
        parsedCache.set(file, parseChapter(md));
      } catch (e) {
        console.error("❌ fetch 실패:", file, e);
        // 실패해도 '빈 공간'은 한번 보여서 토글 피드백을 주자
        $sections.innerHTML = `<div class="empty-space"></div>`;
        $sections.classList.add("visible");
        $line.setAttribute("aria-expanded", "true");
        return;
      }
    }

    // 렌더
    if ($sections.childElementCount === 0) {
      const { sections } = parsedCache.get(file);
      if (!sections.length) {
        // 섹션이 하나도 없으면 빈 간격만 보여줌
        $sections.innerHTML = `<div class="empty-space"></div>`;
      } else {
        sections.forEach((sec) => {
          const secWrap = document.createElement("div");
          secWrap.innerHTML = `
            <div class="section-line" role="button" aria-expanded="false">${sec.title}</div>
            <div class="items"></div>
          `;
          const $secLine = secWrap.querySelector(".section-line");
          const $items = secWrap.querySelector(".items");

$secLine.addEventListener("click", () => {
  const secOpen = $secLine.getAttribute("aria-expanded") === "true";
  if (secOpen) {
    $items.classList.remove("visible");
    $secLine.setAttribute("aria-expanded", "false");
  } else {
    if ($items.childElementCount === 0) {
      if (sec.items.length === 0) {
        // 항목이 하나도 없을 때: 빈 박스(간격 표시)
        const empty = document.createElement("li");
        empty.className = "item-empty";
        empty.textContent = "항목 없음";
        $items.appendChild(empty);
      } else {
        // 실제 항목들(1., 2., …)
        sec.items.forEach((txt) => {
          const li = document.createElement("li");
          li.className = "item-line";   // ← 이 클래스가 박스 스타일 적용 포인트
          li.textContent = txt;
          // 나중에 클릭 시 DB에서 문제/개념 불러올 때 이 핸들러에 붙이면 됨
          // li.addEventListener('click', () => { ... });
          $items.appendChild(li);
        });
      }
    }
    $items.classList.add("visible");
    $secLine.setAttribute("aria-expanded", "true");
  }
});

          $sections.appendChild(secWrap);
        });
      }
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

}); // ✅ 마지막 닫는 괄호, 세미콜론 꼭 있어야 함

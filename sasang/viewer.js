// viewer.js (폴더: /sasang/, 파일: sasang.md와 같은 폴더)
(() => {
  const DEFAULT_FILE = 'sasang.md'; // 같은 폴더에 있으므로 파일명만!
  const params = new URLSearchParams(location.search);
  let file = params.get('file') || DEFAULT_FILE;

  const $title = document.getElementById('title');
  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');
  const $container = document.getElementById('container');

  // 같은 폴더이므로 경로 보정 없이 그대로 사용
  function normalizeFilePath(f) {
    if (!f) return null;
    return f;
  }

  // 페이지 스크롤 방지(휠은 마인드맵 줌/이동에 쓰이도록)
  $container.addEventListener('wheel', (e) => {
    e.preventDefault();
  }, { passive: false });

  async function loadAndRender() {
    file = normalizeFilePath(file);

    if (!file) {
      $placeholder.innerHTML = `
        <div><b>파일이 지정되지 않았습니다.</b></div>
        <div class="muted">예: ?file=sasang.md</div>`;
      return;
    }

    try {
      $placeholder.textContent = '불러오는 중…';
      // 같은 폴더의 파일 그대로 요청
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      // 제목 표기
      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      // Markdown 주입 → autoloader가 자동 렌더
      $mm.textContent = md;
      $placeholder.textContent = '';

      // 렌더 트리거
      window.markmap?.autoLoader?.renderAll?.();

      // 살짝 딜레이 후 보기영역 맞춤
      requestAnimationFrame(() => {
        setTimeout(() => {
          const svg = document.querySelector('svg.markmap');
          const mm = svg && (svg.__markmap__ || svg.markmap);
          if (mm?.fit) mm.fit();
        }, 0);
      });
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // 다시 맞춤 버튼
  $btnRefit.addEventListener('click', () => {
    const svg = document.querySelector('svg.markmap');
    const mm = svg && (svg.__markmap__ || svg.markmap);
    if (mm?.fit) mm.fit();
  });

  // 실행
  loadAndRender();
})();

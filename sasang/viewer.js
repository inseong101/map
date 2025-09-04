// viewer.js
(() => {
  // 기본 파일명: 같은 폴더에 sasang.md가 있을 때 자동 로드
  const DEFAULT_FILE = 'sasang.md';

  const params = new URLSearchParams(location.search);
  let file = params.get('file') || DEFAULT_FILE;

  const $title = document.getElementById('title');
  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');
  const $container = document.getElementById('container');

  // 같은 폴더라 별도 변환 없음
  const normalizeFilePath = f => (f ? f : null);

  // 휠로 페이지 스크롤되는 것만 방지(마인드맵 내부 줌/이동은 정상 동작)
  $container?.addEventListener('wheel', e => {
    // 페이지 전체 스크롤만 막고 이벤트는 계속 흐르게 둠
    e.preventDefault();
  }, { passive: false });

  async function loadAndRender() {
    file = normalizeFilePath(file);

    if (!file) {
      $placeholder.innerHTML =
        '<div><b>파일이 지정되지 않았습니다.</b></div>' +
        '<div class="muted">예: ?file=sasang.md</div>';
      return;
    }

    try {
      $placeholder.textContent = '불러오는 중…';
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);

      const md = await res.text();

      // 제목 표시
      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      // Markdown 주입
      $mm.textContent = md;
      $placeholder.textContent = '';

      // 🔑 처음엔 2단계까지만 펼치기
      // autoloader가 <pre.markmap>을 찾아 렌더하며, 옵션을 아래처럼 넘길 수 있음
      window.markmap?.autoLoader?.renderAll({
        initialExpandLevel: 2 // #, ## 단계까지 펼침. ###부터 접힘
      });

      // 렌더 직후 화면 맞추기
      requestAnimationFrame(() => {
        setTimeout(() => {
          const svg = document.querySelector('svg.markmap');
          const mm = svg && (svg.__markmap__ || svg.markmap);
          mm?.fit?.();
        }, 0);
      });
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML =
        `<div><b>불러오기 실패</b></div><div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // "다시 맞춤" 버튼
  $btnRefit?.addEventListener('click', () => {
    const svg = document.querySelector('svg.markmap');
    const mm = svg && (svg.__markmap__ || svg.markmap);
    mm?.fit?.();
  });

  loadAndRender();
})();

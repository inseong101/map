(() => {
  const DEFAULT_FILE = 'sasang.md';
  const params = new URLSearchParams(location.search);
  let file = params.get('file') || DEFAULT_FILE;

  const $title = document.getElementById('title');
  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');

  function normalizeFilePath(f) {
    return f || null;
  }

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
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      $mm.textContent = md;
      $placeholder.textContent = '';

      // 렌더
      window.markmap?.autoLoader?.renderAll();

      // 여러 번 fit 호출 (첫 렌더 지연 보정)
      setTimeout(fitMap, 100);
      setTimeout(fitMap, 500);
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  function fitMap() {
    const svg = document.querySelector('svg.markmap');
    const mm = svg && (svg.__markmap__ || svg.markmap);
    if (mm?.fit) mm.fit();
  }

  $btnRefit.addEventListener('click', fitMap);

  loadAndRender();
})();

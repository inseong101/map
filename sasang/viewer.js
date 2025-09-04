(() => {
  const DEFAULT_FILE = 'sasang.md'; // 같은 폴더에 있음
  const params = new URLSearchParams(location.search);
  let file = params.get('file') || DEFAULT_FILE;

  const $title = document.getElementById('title');
  const $svg = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');

  // markmap 스크립트 로드가 끝났는지 확인
  function readyMarkmap() {
    return !!(window.markmap && window.markmap.Markmap && window.markmap.Transformer);
  }
  function waitForMarkmap() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        if (readyMarkmap()) return resolve();
        if (Date.now() - start > 5000) return reject(new Error('markmap not loaded'));
        requestAnimationFrame(tick);
      })();
    });
  }

  async function loadAndRender() {
    try {
      await waitForMarkmap(); // ✅ 라이브러리 준비될 때까지 대기
      const { Markmap, Transformer } = window.markmap;

      // 파일 fetch
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      // 제목 표시
      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      // 변환
      const transformer = new Transformer();
      const { root } = transformer.transform(md);

      // 렌더
      const mm = Markmap.create($svg, {}, root);
      // 화면에 꽉 차게
      requestAnimationFrame(() => mm.fit());

      $placeholder.textContent = '';
      // 버튼
      $btnRefit.onclick = () => mm.fit();
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // 휠 스크롤로 확대/축소가 되도록, 페이지 스크롤은 막지 않음
  // (markmap이 d3-zoom으로 자체 처리)

  // 파일 경로는 같은 폴더라 그대로 사용
  loadAndRender();
})();

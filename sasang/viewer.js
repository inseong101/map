(() => {
  const DEFAULT_FILE = 'sasang.md';
  const params = new URLSearchParams(location.search);
  const file = params.get('file') || DEFAULT_FILE;

  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');
  const $container = document.getElementById('container');

  // 컨테이너의 실제 px 크기를 svg에 적용
  function sizeSvg(svg) {
    const rect = $container.getBoundingClientRect();
    svg.setAttribute('width', Math.max(1, Math.floor(rect.width)));
    svg.setAttribute('height', Math.max(1, Math.floor(rect.height)));
  }

  // autoloader가 만든 svg를 기다림
  function waitForSvg(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      (function tick() {
        const svg = document.querySelector('svg.markmap');
        if (svg) return resolve(svg);
        if (performance.now() - start > timeout) return reject(new Error('svg not created'));
        requestAnimationFrame(tick);
      })();
    });
  }

  // 리사이즈 디바운스
  let resizeTimer = null;
  function onResize(svg, mm) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      sizeSvg(svg);
      mm?.fit?.();
    }, 80);
  }

  async function loadAndRender() {
    if (!file) {
      $placeholder.innerHTML = `
        <div><b>파일이 지정되지 않았습니다.</b></div>
        <div class="muted">예: ?file=sasang.md</div>`;
      return;
    }

    try {
      $placeholder.textContent = '불러오는 중…';
      const res = await fetch(decodeURI(file), { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      // 마크다운 주입 → autoloader가 자동 렌더
      $mm.textContent = md;
      $placeholder.textContent = '';

      // 렌더 트리거
      window.markmap?.autoLoader?.renderAll?.();

      // svg 생성 대기 후 실제 px 크기 적용 + fit
      const svg = await waitForSvg();
      const mm = svg.__markmap__ || svg.markmap;

      sizeSvg(svg);
      mm?.fit?.();

      // 다시 맞춤
      $btnRefit.onclick = () => {
        sizeSvg(svg);
        mm?.fit?.();
      };

      // 창 리사이즈 대응
      window.addEventListener('resize', () => onResize(svg, mm));
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // ❌ 휠 이벤트 막지 마세요 (줌/팬에 필요)
  loadAndRender();
})();

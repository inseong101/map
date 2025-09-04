(() => {
  const DEFAULT_FILE = 'sasang.md'; // 같은 폴더에 있음
  const params = new URLSearchParams(location.search);
  const file = params.get('file') || DEFAULT_FILE;

  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');

  // autoloader가 svg를 만들 때까지 기다렸다가 fit() 호출
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

      // svg가 생기면 fit()
      const svg = await waitForSvg();
      const instance = svg.__markmap__ || svg.markmap;
      if (instance?.fit) instance.fit();

      // 다시 맞춤 버튼
      $btnRefit.onclick = () => {
        const svg2 = document.querySelector('svg.markmap');
        const mm2 = svg2 && (svg2.__markmap__ || svg2.markmap);
        mm2?.fit?.();
      };
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // ❌ 휠 스크롤 막지 마세요. 그래야 줌/팬이 정상 동작합니다.
  // 이전 코드에 있던 e.preventDefault() 제거!

  loadAndRender();
})();

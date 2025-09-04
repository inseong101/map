(() => {
  const DEFAULT_FILE = 'sasang.md'; // 같은 폴더에 있음
  const params = new URLSearchParams(location.search);
  let file = params.get('file') || DEFAULT_FILE;

  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');

  // markmap(전역) 준비될 때까지 최대 5초 대기
  function waitForMarkmap(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      (function tick() {
        const mm = window.markmap;
        if (mm && mm.Markmap && mm.Transformer) return resolve(mm);
        if (performance.now() - start > timeout) return reject(new Error('markmap not loaded'));
        requestAnimationFrame(tick);
      })();
    });
  }

  async function loadAndRender() {
    try {
      const mmns = await waitForMarkmap();            // { Markmap, Transformer }
      const { Markmap, Transformer } = mmns;

      const res = await fetch(decodeURI(file), { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      // md -> HTML 변환은 필요 없음: markmap-view가 <pre>의 텍스트를 읽어 처리
      $mm.textContent = md;
      $placeholder.textContent = '';

      // 렌더
      const transformer = new Transformer();
      const { root } = transformer.transform(md);

      // 이미 존재하는 svg를 제거하고 재생성(중복 렌더 방지)
      const oldSvg = document.querySelector('svg.markmap');
      if (oldSvg && oldSvg.parentNode) oldSvg.parentNode.removeChild(oldSvg);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('markmap');
      $mm.insertAdjacentElement('afterend', svg);

      const mm = Markmap.create(svg, null, root);
      // 처음 뷰 맞춤
      setTimeout(() => mm.fit(), 0);

      // 다시 맞춤 버튼
      $btnRefit.onclick = () => mm.fit();
    } catch (e) {
      console.error(e);
      if ($placeholder) {
        $placeholder.innerHTML = `
          <div><b>불러오기 실패</b></div>
          <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
      }
    }
  }

  // 🔹 예전처럼 wheel 이벤트로 기본 스크롤 막지 마세요 (줌/팬이 막힙니다)
  // document.getElementById('container').addEventListener('wheel', e => e.preventDefault(), { passive: false });

  loadAndRender();
})();

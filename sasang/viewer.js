(() => {
  const DEFAULT_FILE = 'sasang.md';
  const params = new URLSearchParams(location.search);
  const file = params.get('file') || DEFAULT_FILE;

  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');
  const $container = document.getElementById('container');

  // 컨테이너 실측 px → svg width/height로 꽂기
  function sizeSvg(svg) {
    const rect = $container.getBoundingClientRect();
    svg.setAttribute('width', Math.max(1, Math.floor(rect.width)));
    svg.setAttribute('height', Math.max(1, Math.floor(rect.height)));
  }

  // autoloader가 만든 svg 기다리기
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

  // 'translate(a,b) scale(k)' 문자열을 d3.zoomIdentity로 파싱
  function parseTransform(tr) {
    // 예: "translate(123.4,56.7) scale(0.8)"
    const t = { x: 0, y: 0, k: 1 };
    if (!tr) return t;
    const m1 = tr.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    if (m1) { t.x = +m1[1]; t.y = +m1[2]; }
    const m2 = tr.match(/scale\(([-\d.]+)\)/);
    if (m2) { t.k = +m2[1]; }
    return t;
  }

  // svg에 d3.zoom 붙이고, 기존 transform과 동기화
  function enableZoom(svg, g, initialTransform) {
    const d3 = window.d3;
    if (!d3) return; // (autoloader가 d3를 로드해줌)

    const selSvg = d3.select(svg);
    const selG = d3.select(g);

    const zoom = d3.zoom()
      .scaleExtent([0.1, 8])       // 확대 한계
      .on('zoom', (ev) => {
        selG.attr('transform', ev.transform);
      });

    // 더블클릭 줌은 끄고(원하면 주석 해제), 휠 줌/드래그 팬만 사용
    selSvg.call(zoom).on('dblclick.zoom', null);

    // fit()이 세팅한 transform을 줌 상태와 동기화
    const { x, y, k } = initialTransform;
    selSvg.call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));

    // 리사이즈 시 svg 크기 반영 + 재fit
    let timer = null;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sizeSvg(svg);
        // 현재 중심 유지 (현 상태를 그대로 다시 적용)
        const cur = parseTransform(g.getAttribute('transform'));
        selSvg.call(zoom.transform, d3.zoomIdentity.translate(cur.x, cur.y).scale(cur.k));
      }, 80);
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

      // 마크다운 주입 → autoloader가 감지하여 렌더
      $mm.textContent = md;
      $placeholder.textContent = '';

      // 렌더 트리거
      window.markmap?.autoLoader?.renderAll?.();

      // svg 생성 기다린 뒤 크기 지정 + fit
      const svg = await waitForSvg();
      sizeSvg(svg);

      // markmap 인스턴스
      const mm = svg.__markmap__ || svg.markmap;
      // 먼저 fit으로 화면 꽉 채우기
      mm?.fit?.();

      // g 선택 (내용 그룹)
      const g = svg.querySelector('g');
      if (!g) throw new Error('g not found');

      // fit이 적용한 현재 transform 읽어서 줌과 동기화
      const initial = parseTransform(g.getAttribute('transform'));
      enableZoom(svg, g, initial);

      // 다시 맞춤 버튼: 컨테이너 크기 반영 후 fit → 현재 transform 재동기화
      $btnRefit.onclick = () => {
        sizeSvg(svg);
        mm?.fit?.();
        const cur = parseTransform(g.getAttribute('transform'));
        const d3 = window.d3;
        if (d3) {
          const selSvg = d3.select(svg);
          selSvg.call(
            d3.zoom().transform,
            d3.zoomIdentity.translate(cur.x, cur.y).scale(cur.k)
          );
        }
      };
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // 휠 기본 스크롤을 막지 마세요. (줌/팬에 필요)
  loadAndRender();
})();

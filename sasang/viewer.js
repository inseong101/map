(() => {
  const DEFAULT_FILE = 'sasang.md'; // 같은 폴더에 있으니 파일명만
  const params = new URLSearchParams(location.search);
  const file = params.get('file') || DEFAULT_FILE;

  const $title = document.getElementById('title');
  const $container = document.getElementById('container');
  const $placeholder = document.getElementById('placeholder');
  const $md = document.getElementById('md');
  const $btnRefit = document.getElementById('btnRefit');

  // markmap view 객체
  let mm = null;
  let svgEl = null;

  // 컨테이너 크기에 맞춰 svg 크기를 '픽셀'로 강제 세팅
  function sizeSvgToContainer() {
    if (!svgEl) return;
    const w = Math.max(1, $container.clientWidth);
    const h = Math.max(1, $container.clientHeight);
    svgEl.setAttribute('width', String(w));
    svgEl.setAttribute('height', String(h));
    // style로 퍼센트가 들어가 있더라도 픽셀 속성이 우선 적용됨
  }

  function fitLater() {
    // 렌더 직후 레이아웃 잡힌 다음 여러 번 보정
    setTimeout(() => mm?.fit?.(), 0);
    setTimeout(() => mm?.fit?.(), 120);
    setTimeout(() => mm?.fit?.(), 360);
  }

  async function loadAndRender() {
    try {
      $placeholder.textContent = '불러오는 중…';
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      // 마크다운 → markmap 데이터 변환
      const { Transformer, Markmap } = window.markmap;
      const transformer = new Transformer();
      const { root /* , features */ } = transformer.transform(md);

      // 이전 svg 제거
      if (svgEl && svgEl.parentNode) svgEl.parentNode.removeChild(svgEl);

      // 새 svg 생성 후 픽셀 크기 고정
      svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.classList.add('markmap');
      $container.appendChild(svgEl);
      sizeSvgToContainer();

      // markmap 인스턴스 생성 (휠 줌/드래그는 기본 활성화)
      mm = Markmap.create(svgEl, {
        fitRatio: 0.9,        // 가장자리 여백 조금
        duration: 300,        // 애니메이션 길이
        zoom: true,           // 휠 줌
        pan: true             // 드래그 이동
      }, root);

      $placeholder.textContent = '';

      fitLater();
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // 리사이즈 시 svg 픽셀 재설정 + fit
  const ro = new ResizeObserver(() => {
    sizeSvgToContainer();
    mm?.fit?.();
  });
  ro.observe($container);

  // 다시 맞춤
  $btnRefit.addEventListener('click', () => mm?.fit?.());

  // 중요한 점: wheel 이벤트를 막지 말 것!
  // (markmap의 d3-zoom이 휠 이벤트를 사용합니다)

  loadAndRender();
})();

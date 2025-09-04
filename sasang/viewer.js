// viewer.js
(() => {
  const params = new URLSearchParams(location.search);
  let file = params.get('file'); // 예: 'md/sasang.md' 또는 'sasang.md'
  const $title = document.getElementById('title');
  const $container = document.getElementById('container');
  const $placeholder = document.getElementById('placeholder');

  // Markmap 네임스페이스
  const { Markmap } = window.markmap;
  const { Transformer } = window.markmapLib;

  let mm = null;       // Markmap 인스턴스
  let rootData = null; // transform 결과
  let initialZoom = 1;
  let initialTranslate = [0, 0];

  // 마우스 휠로 '페이지 스크롤'을 막고, 마인드맵 줌에 집중
  $container.addEventListener('wheel', (e) => {
    // 트랙패드 스크롤로 문서 전체가 움직이지 않도록 기본 동작 방지
    e.preventDefault();
  }, { passive: false });

  // 파일 경로 보정(필요하다면 접두어 붙이기)
  function normalizeFilePath(f) {
    if (!f) return null;
    // sasang/chapter/ 처럼 이미 경로가 있으면 유지, 아니면 sasang/ 밑 md로 가정
    if (f.includes('/')) return f;
    return 'md/' + f;
  }

  async function main() {
    file = normalizeFilePath(file);

    if (!file) {
      $placeholder.innerHTML = `
        <div><b>파일이 지정되지 않았습니다.</b></div>
        <div class="muted">예: ?file=md/소음인.md 또는 ?file=소음인.md</div>`;
      return;
    }

    try {
      $placeholder.textContent = '불러오는 중…';
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);

      const md = await res.text();
      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      // 변환
      const transformer = new Transformer();
      const { root } = transformer.transform(md);
      rootData = root;

      // 기존 SVG 제거 후 새로 생성
      $container.querySelector('svg')?.remove();
      $placeholder.textContent = '';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      $container.appendChild(svg);

      // 마인드맵 생성
      mm = Markmap.create(svg, {
        autoFit: true,
        fitRatio: 1,
        duration: 400,
        // 줌/패닝 옵션
        zoom: true,
        pan: true,
        maxScale: 4,
        minScale: 0.2
      }, rootData);

      // 초기 카메라 저장
      // markmap은 내부에 viewTransform(translate, k)를 유지함
      // 렌더링 다음 프레임에 읽어야 정확
      requestAnimationFrame(() => {
        if (mm && mm.state && mm.state.zoom) {
          const t = mm.state.zoom.transform;
          initialZoom = t.k;
          initialTranslate = [t.x, t.y];
        }
      });

      // 버튼들
      document.getElementById('btnFit').onclick = () => mm?.fit();
      document.getElementById('btnCenter').onclick = () => {
        if (!mm) return;
        const svgEl = $container.querySelector('svg');
        if (!svgEl || !mm.state?.zoom) return;
        const { width, height } = svgEl.getBoundingClientRect();
        // 초기 상태로 대충 중앙 정렬(초기값 저장한 경우)
        mm.state.zoom.transform.k = initialZoom;
        mm.state.zoom.transform.x = initialTranslate[0];
        mm.state.zoom.transform.y = initialTranslate[1];
        mm.renderData(rootData);
        mm.fit(); // 중앙에 맞춰주기
      };

    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  main();
})();

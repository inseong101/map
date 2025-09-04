(() => {
  const params = new URLSearchParams(location.search);
  let file = params.get('file'); // 예: 'md/sasang.md' 또는 'sasang.md'

  const $title = document.getElementById('title');
  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');
  const $container = document.getElementById('container');

  // 파일 경로 보정: 경로 없으면 sasang/md/ 아래로 본다
  function normalizeFilePath(f) {
    if (!f) return null;
    if (f.includes('/')) return f;
    return 'md/' + f;
  }

  // 페이지 스크롤 방지(휠은 SVG 줌에만 쓰이게)
  $container.addEventListener('wheel', (e) => {
    e.preventDefault(); // 페이지 스크롤만 막음(이벤트 전파는 막지 않음)
  }, { passive: false });

  async function loadAndRender() {
    file = normalizeFilePath(file);

    if (!file) {
      $placeholder.innerHTML = `
        <div><b>파일이 지정되지 않았습니다.</b></div>
        <div class="muted">예: ?file=md/sasang.md</div>`;
      return;
    }

    try {
      $placeholder.textContent = '불러오는 중…';
      const res = await fetch(decodeURI(file), { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      // 제목
      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      // 마크다운 주입 → autoloader가 감지하여 자동 렌더
      $mm.textContent = md;
      $placeholder.textContent = '';

      // 렌더
      // autoloader는 id="mm"의 <pre>를 자동 렌더링한다
      window.markmap?.autoLoader?.renderAll();

      // 렌더 직후 살짝 딜레이 → fit()
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

  loadAndRender();
})();

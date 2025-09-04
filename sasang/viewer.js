(() => {
  const params = new URLSearchParams(location.search);
  let file = params.get('file'); // 예: 'md/소음인.md' 또는 '소음인.md'

  const $title = document.getElementById('title');
  const $mm = document.getElementById('mm');
  const $placeholder = document.getElementById('placeholder');
  const $btnRefit = document.getElementById('btnRefit');

  // 파일 경로 보정: 경로 없으면 sasang/md/ 아래로 본다
  function normalizeFilePath(f) {
    if (!f) return null;
    if (f.includes('/')) return f;
    // viewer.html이 /sasang/ 밑에 있다면 상대경로로 md/ 사용
    return 'md/' + f;
  }

  // 스크롤로 페이지가 움직이지 않게 (줌에만 쓰이도록)
  document.getElementById('container').addEventListener('wheel', (e) => {
    e.preventDefault();
  }, { passive: false });

  async function loadAndRender() {
    file = normalizeFilePath(file);

    if (!file) {
      $placeholder.innerHTML = `
        <div><b>파일이 지정되지 않았습니다.</b></div>
        <div class="muted">예: ?file=md/%EC%86%8C%EC%9D%8C%EC%9D%B8.md</div>`;
      return;
    }

    try {
      $placeholder.textContent = '불러오는 중…';
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const md = await res.text();

      // 제목
      const base = decodeURIComponent(file.split('/').pop());
      $title.textContent = base;

      // 마크다운 주입 → autoloader가 감지하여 자동 렌더
      $mm.textContent = md;
      $placeholder.textContent = '';

      // 약간의 딜레이 후 렌더 호출(안전)
      // autoloader는 id="mm"의 <pre>를 자동 렌더링 한다
      setTimeout(() => {
        window.markmap?.autoLoader?.renderAll();
      }, 0);
    } catch (e) {
      console.error(e);
      $placeholder.innerHTML = `
        <div><b>불러오기 실패</b></div>
        <div class="muted">경로: ${file} / 에러: ${e.message}</div>`;
    }
  }

  // 다시 맞춤: autoloader가 만든 인스턴스를 찾아 fit 호출
  $btnRefit.addEventListener('click', () => {
    // markmap은 각 svg에 인스턴스를 data-markmap에 연결해 둠
    const svg = document.querySelector('svg.markmap');
    if (!svg) return;
    const mm = svg.__markmap__ || svg.markmap; // 구현 버전에 따라 다름
    if (mm?.fit) mm.fit();
  });

  loadAndRender();
})();

// ===== 학수번호 조회/이동 =====

// 로컬 저장 키
const RECENT_KEY = "jjh_recent_ids";

// 입력 → 학생 페이지로 이동
async function lookupStudent(e){
  e.preventDefault();
  const input = document.getElementById("sid");
  const val = (input.value || "").trim();
  const err = document.getElementById("error");
  err.classList.add("hidden");
  err.textContent = "";

  // 형식 검사: 숫자 6자리
  if(!/^\d{6}$/.test(val)){
    showError("학수번호는 숫자 6자리여야 합니다.");
    input.focus();
    return false;
  }

  const url = `students/${val}.html`;

  // 오프라인/정적 환경에서도 가능한 방식으로 HEAD → 실패 시 GET으로 재시도
  try{
    let ok = false;
    try {
      const r = await fetch(url, { method: "HEAD" });
      ok = r.ok;
    } catch(_) {
      const r2 = await fetch(url, { method: "GET" });
      ok = r2.ok;
    }

    if(ok){
      saveRecent(val);
      location.href = url;
    }else{
      showError("해당 학수번호의 성적표 파일을 찾을 수 없습니다.");
    }
  }catch(_){
    // 일부 호스팅에서 HEAD가 막힐 수 있음 → 존재 추정 후 바로 이동 (파일 없으면 404 화면)
    saveRecent(val);
    location.href = url;
  }
  return false;
}

// 최근 본 학수번호 저장/표시
function saveRecent(id){
  try{
    const prev = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const next = [id, ...prev.filter(v => v !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }catch(_){}
}

function scanHistory(){
  const box = document.getElementById("recent");
  const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  box.innerHTML = "";
  if(list.length === 0){
    showError("최근 기록이 없습니다. 학수번호를 입력해 주세요.");
    return;
  }
  list.forEach(id=>{
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = id;
    chip.onclick = ()=>{
      const inp = document.getElementById("sid");
      inp.value = id;
      document.getElementById("lookup-form").dispatchEvent(new Event("submit", {cancelable:true}));
    };
    box.appendChild(chip);
  });
  box.classList.remove("hidden");
}

function showError(msg){
  const err = document.getElementById("error");
  err.textContent = msg;
  err.classList.remove("hidden");
}

// 쿼리스트링 ?id=015001 지원 (바로 리다이렉트)
(function(){
  const p = new URLSearchParams(location.search);
  const id = p.get("id");
  if(id && /^\d{6}$/.test(id)){
    const input = document.getElementById("sid");
    if(input){ input.value = id; }
    // 자동 조회
    const form = document.getElementById("lookup-form");
    if(form){ form.dispatchEvent(new Event("submit", {cancelable:true})); }
  }
})();

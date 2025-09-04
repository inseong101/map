
function fmtPct(n){ return (n*100).toFixed(1) + "%"; }
function toggleAcc(el){
  const ic = el.querySelector(".rotate");
  const panel = el.parentElement.querySelector(".panel");
  const open = panel.getAttribute("data-open") === "1";
  if(open){
    panel.style.maxHeight = "0px";
    panel.setAttribute("data-open","0");
    ic.classList.remove("open");
  }else{
    panel.style.maxHeight = panel.scrollHeight + "px";
    panel.setAttribute("data-open","1");
    ic.classList.add("open");
  }
}
window.addEventListener("load", ()=>{
  document.querySelectorAll(".panel").forEach(p => {
    p.style.maxHeight = "0px";
    p.setAttribute("data-open","0");
  });
});
function toggleAcc(el){
  const icon = el.querySelector(".rotate");
  const panel = el.parentElement.querySelector(".panel");
  const open = panel.getAttribute("data-open") === "1";
  if(open){
    panel.style.maxHeight = "0px";
    panel.setAttribute("data-open","0");
    icon && icon.classList.remove("open");
  }else{
    panel.style.maxHeight = panel.scrollHeight + "px";
    panel.setAttribute("data-open","1");
    icon && icon.classList.add("open");
  }
}
window.addEventListener("load", ()=>{
  document.querySelectorAll(".panel").forEach(p=>{
    p.style.maxHeight = "0px";
    p.setAttribute("data-open","0");
  });
});

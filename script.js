/* global L */
"use strict";

/* ---------- 디버그: places.js 로드 확인 ---------- */
window.PLACES = window.PLACES || [];
console.log("[debug] PLACES length =", window.PLACES.length);

/* ---------- 상수 ---------- */
const DEFAULT_DEG = 270;     // (폴백용) 거의 쓰일 일 없지만 남겨둠
const DEFAULT_RAD = 100;     // (폴백용)
let nextPlaceId = (window.PLACES.length || 0) + 1;

/* ---------- 전역 레이어/맵 ---------- */
let map;
let labelsLayer = null;   // 라벨/점 컨테이너
let linesLayer  = null;   // 선 컨테이너
const layerById = {};     // id -> { marker, line, dot, baseLL }

/* ---------- 로컬 GeoJSON(시·도 경계) ---------- */
const SIDO_GEOJSON = "TL_SCCO_CTPRVN.json";

/* ---------- 유틸: deg/rad 보장(없으면 랜덤 부여) ---------- */
function ensureDegRad(p) {
  if (typeof p.deg !== "number") {
    // 0~360도 랜덤 (정수로 하고 싶으면 Math.floor)
    p.deg = Math.random() * 360;
  }
  if (typeof p.rad !== "number") {
    // 80~200px 랜덤
    p.rad = 80 + Math.random() * 120;
  }
}

/* ---------- 시·도 실루엣 + 경계 (타일 없이, 비인터랙티브) ---------- */
function addKoreaSilhouetteFromLocal() {
  fetch(SIDO_GEOJSON)
    .then(r => r.json())
    .then(geo => {
      // 실루엣(채움만)
      L.geoJSON(geo, {
        pane: "pane-geo",
        interactive: false,
        style: () => ({
          fillColor: "#dfe4ea",
          fillOpacity: 0.85,
          color: "#00000000",
          weight: 0
        })
      }).addTo(map);

      // 경계선(선만)
      L.geoJSON(geo, {
        pane: "pane-geo",
        interactive: false,
        style: () => ({
          fillOpacity: 0,
          color: "#3c3f46",
          weight: 1.5
        })
      }).addTo(map);

      // places 없으면 경계로 맞춤
      if (!window.PLACES || window.PLACES.length === 0) {
        const bounds = L.geoJSON(geo).getBounds();
        map.fitBounds(bounds);
      }
    })
    .catch(err => console.error("[geojson] load failed:", err));
}

/* ---------- 지도 초기화 ---------- */
function initMap() {
  map = L.map("map", { zoomControl: true }).setView([36.5, 127.8], 7);

  // pane(레이어 순서): geo(아래) < lines(중간) < markers(위)
  map.createPane("pane-geo");                // zIndex 기본 400
  const paneLines   = map.createPane("pane-lines");
  const paneMarkers = map.createPane("pane-markers");
  paneLines.style.zIndex   = 650;
  paneMarkers.style.zIndex = 700;
  paneLines.style.pointerEvents = "none";          // 선은 이벤트 통과
  map.getPane("pane-geo").style.pointerEvents = "none"; // 행정구역 완전 비인터랙티브

  addKoreaSilhouetteFromLocal();

  if (window.PLACES.length) {
    const latlngs = window.PLACES.map(p => [p.lat, p.lon]);
    map.fitBounds(latlngs);
  }

  renderAll();
  injectLeftTabs();
  injectRightPanel();


// 지도 확대/축소, 이동, 창 크기 변경 시 라벨-선 재계산
map.on("zoom move resize", () => {
  Object.values(layerById).forEach(rec => {
    if (rec && rec.marker && rec.line && rec.baseLL) {
      updateLeaderLine(rec.baseLL, rec.marker, rec.line);
    }
  });
});
  
}

/* ---------- 선분-사각형 경계 교차(라벨 박스 내부 구간 숨김) ---------- */
function segmentRectIntersection(P0, P1, tl, size) {
  const xmin = tl.x, ymin = tl.y;
  const xmax = tl.x + size.w, ymax = tl.y + size.h;
  const dx = P1.x - P0.x, dy = P1.y - P0.y;
  const cand = [];
  const EPS = 1e-6;

  function addIf(t, x, y) {
    if (t >= -EPS && t <= 1 + EPS) {
      const onLR = (Math.abs(x - xmin) < 1e-4 || Math.abs(x - xmax) < 1e-4) && (y >= ymin - EPS && y <= ymax + EPS);
      const onTB = (Math.abs(y - ymin) < 1e-4 || Math.abs(y - ymax) < 1e-4) && (x >= xmin - EPS && x <= xmax + EPS);
      if (onLR || onTB) cand.push({ t, x, y });
    }
  }

  if (Math.abs(dx) > EPS) {
    let t = (xmin - P0.x) / dx; addIf(t, xmin, P0.y + t * dy);
    t = (xmax - P0.x) / dx;     addIf(t, xmax, P0.y + t * dy);
  }
  if (Math.abs(dy) > EPS) {
    let t2 = (ymin - P0.y) / dy; addIf(t2, P0.x + t2 * dx, ymin);
    t2 = (ymax - P0.y) / dy;     addIf(t2, P0.x + t2 * dx, ymax);
  }

  if (!cand.length) return null;
  cand.sort((a, b) => a.t - b.t);
  return L.point(cand[0].x, cand[0].y);
}

function updateLeaderLine(baseLL, labelMarker, polyline) {
  const basePt = map.latLngToLayerPoint(baseLL);
  const iconEl = labelMarker.getElement ? labelMarker.getElement() : labelMarker._icon;
  if (!iconEl) return;

  const tl = L.DomUtil.getPosition(iconEl); // 라벨 좌상단(layer 좌표)
  const rect = iconEl.getBoundingClientRect();
  const size = { w: rect.width, h: rect.height };
  const center = L.point(tl.x + size.w / 2, tl.y + size.h / 2);

  const hit = segmentRectIntersection(basePt, center, tl, size);
  const endPt = hit || center;
  const endLL = map.layerPointToLatLng(endPt);

  polyline.setLatLngs([baseLL, endLL]);
}

/* ---------- 지도에 한 항목 추가 (점/라벨/선) ---------- */
function addPlaceToMap(p, alsoAddTab = true) {
  if (typeof p.id !== "number") p.id = nextPlaceId++;

  // deg/rad 없으면 랜덤으로 부여(한 번 정해지면 p에 저장되어 이후 재렌더에도 유지)
  ensureDegRad(p);

  const baseLL = L.latLng(p.lat, p.lon);
  const basePt = map.latLngToLayerPoint(baseLL);

  const radDeg = p.deg * Math.PI / 180;
  const dx  = Math.cos(radDeg) * p.rad;
  const dy  = Math.sin(radDeg) * p.rad;

  const labelPt = L.point(basePt.x + dx, basePt.y + dy);
  const labelLL = map.layerPointToLatLng(labelPt);

  // 점(빨강) — markers pane
  const dot = L.circleMarker(baseLL, {
    radius: 4,
    color: "#FF0000",
    fill: true,
    fillColor: "#FF0000",
    fillOpacity: 1,
    pane: "pane-markers"
  }).addTo(labelsLayer);

  // 라벨(이름+주소)
  const html =
    '<div class="poi-label">' +
      '<div class="title">' + (p.name || '이름없음') + '</div>' +
      '<div class="addr">'  + (p.address || '주소 없음') + '</div>' +
    '</div>';
  const icon = L.divIcon({ html, className: '', iconSize: null, iconAnchor: [0, 0] });
  const marker = L.marker(labelLL, {
    icon,
    draggable: true,
    autoPan: true,
    interactive: true,
    pane: "pane-markers"
  }).addTo(labelsLayer);

  // 리더 라인 — lines pane (완전 불투명, 지도보다 위)
  const line = L.polyline([baseLL, labelLL], {
    color: "#FF0000",
    weight: 2.5,
    opacity: 1,
    pane: "pane-lines"
  }).addTo(linesLayer);

  // 렌더 후 경계까지 선 갱신
  setTimeout(() => updateLeaderLine(baseLL, marker, line), 0);
  marker.on("drag",    e => updateLeaderLine(baseLL, e.target, line));
  marker.on("dragend", e => updateLeaderLine(baseLL, e.target, line));

  layerById[p.id] = { marker, line, dot, baseLL };
  if (alsoAddTab) appendTab(p);
}

/* ---------- 전체 렌더 ---------- */
function renderAll() {
  if (labelsLayer) labelsLayer.removeFrom(map);
  if (linesLayer)  linesLayer.removeFrom(map);

  labelsLayer = L.layerGroup().addTo(map); // 마커/라벨
  linesLayer  = L.layerGroup().addTo(map); // 폴리라인

  (window.PLACES || []).forEach(p => {
    ensureDegRad(p);
    addPlaceToMap(p, false);
  });
  rebuildTabs();

  console.log("[render] rendered places:", (window.PLACES || []).length);
}

/* ---------- 좌측 탭 (접기/펼치기 토글 포함) ---------- */
function leftPanelHTML() {
  return '' +
    '<div class="left-tabs" id="leftTabs">' +
      '<div class="panel-header">' +
        '<h3 class="panel-title">장소 목록</h3>' +
        '<button class="panel-toggle" id="leftToggle" aria-label="접기">−</button>' +
      '</div>' +
      '<div class="panel-content" id="leftContent">' +
        '<div id="tabList"></div>' +
      '</div>' +
    '</div>';
}
function tabItemHTML(p) {
  return '' +
    '<div class="tab-item" id="tab_' + p.id + '">' +
      '<div class="tab-title" title="' + p.name + ' (' + (p.address || '') + ')">' + p.name + '</div>' +
      '<div class="tab-close" title="삭제" data-id="' + p.id + '">×</div>' +
    '</div>';
}
function injectLeftTabs() {
  const root = document.body;
  if (!document.getElementById("leftTabs")) {
    const wrap = document.createElement("div");
    wrap.innerHTML = leftPanelHTML();
    root.appendChild(wrap.firstElementChild);
  }
  setupPanelToggle("leftTabs", "leftToggle", "leftPanelState");
  rebuildTabs();
}
function rebuildTabs() {
  const list = document.getElementById("tabList");
  if (!list) return;
  list.innerHTML = (window.PLACES || []).map(p => tabItemHTML(p)).join("");
  bindTabEvents();
}
function appendTab(p) {
  const list = document.getElementById("tabList");
  if (!list) return;
  const div = document.createElement("div");
  div.innerHTML = tabItemHTML(p);
  list.appendChild(div.firstElementChild);
  bindSingleTabEvents(p.id);
}
function bindTabEvents() {
  document.querySelectorAll(".tab-item").forEach(el => {
    const id = parseInt(el.id.replace("tab_", ""));
    const p = (window.PLACES || []).find(x => x.id === id);
    if (!p) return;

    el.querySelector(".tab-title").onclick = () => centerOnPlace(p);
    el.querySelector(".tab-close").onclick = ev => {
      ev.stopPropagation();
      removePlace(id);
    };
  });
}
function bindSingleTabEvents(id) {
  const el = document.getElementById("tab_" + id);
  if (!el) return;
  const p = (window.PLACES || []).find(x => x.id === id);
  if (!p) return;

  el.querySelector(".tab-title").onclick = () => centerOnPlace(p);
  el.querySelector(".tab-close").onclick = ev => {
    ev.stopPropagation();
    removePlace(id);
  };
}
function centerOnPlace(p) {
  const rec = layerById[p.id];
  if (rec && rec.marker) map.setView(rec.marker.getLatLng(), Math.max(map.getZoom(), 10), { animate: true });
  else map.setView([p.lat, p.lon], Math.max(map.getZoom(), 10), { animate: true });
}
function removePlace(id) {
  // 데이터
  const idx = (window.PLACES || []).findIndex(x => x.id === id);
  if (idx >= 0) window.PLACES.splice(idx, 1);

  // 레이어
  const rec = layerById[id];
  if (rec) {
    if (rec.marker) rec.marker.remove();
    if (rec.line)   rec.line.remove();
    if (rec.dot)    rec.dot.remove();
    delete layerById[id];
  }

  // 탭
  const el = document.getElementById("tab_" + id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* ---------- 우측 입력 패널 (접기/펼치기 토글 포함) ---------- */
// 입력은 이름/주소/위도/경도만. deg/rad 입력 UI 제거.
function rightPanelHTML() {
  return '' +
  '<div class="input-panel" id="rightPanel">' +
    '<div class="panel-header">' +
      '<h3 class="panel-title" style="color:#fff;">장소 추가</h3>' +
      '<button class="panel-toggle dark" id="rightToggle" aria-label="접기">−</button>' +
    '</div>' +
    '<div class="panel-content" id="rightContent">' +
      '<div class="row"><input id="in_name" type="text" placeholder="이름 (필수)" /></div>' +
      '<div class="row"><input id="in_addr" type="text" placeholder="주소 (필수)" /></div>' +
      '<div class="row">' +
        '<input id="in_lat" type="number" step="0.000001" placeholder="위도 (필수)" />' +
        '<input id="in_lon" type="number" step="0.000001" placeholder="경도 (필수)" />' +
      '</div>' +
      '<button class="btn" id="btn_add">추가</button>' +
      '<div class="hint">라벨은 추가 후 드래그해서 위치를 조정할 수 있어요.</div>' +
    '</div>' +
  '</div>';
}

function injectRightPanel() {
  if (!document.querySelector(".input-panel")) {
    const wrap = document.createElement("div");
    wrap.innerHTML = rightPanelHTML();
    document.body.appendChild(wrap.firstElementChild);
  }
  setupPanelToggle("rightPanel", "rightToggle", "rightPanelState");

  document.getElementById("btn_add").onclick = function () {
    const name = (document.getElementById("in_name").value || "").trim();
    const address = (document.getElementById("in_addr").value || "").trim();
    const lat = parseFloat(document.getElementById("in_lat").value);
    const lon = parseFloat(document.getElementById("in_lon").value);

    if (!name || isNaN(lat) || isNaN(lon)) {
      alert("이름, 위도, 경도는 필수입니다.");
      return;
    }

    const p = {
      id: nextPlaceId++,
      name,
      address: address || "주소 없음",
      lat, lon
      // deg/rad는 입력받지 않음 — addPlaceToMap/renderAll에서 ensureDegRad로 랜덤 부여
    };

    (window.PLACES || (window.PLACES = [])).push(p);
    // 랜덤 deg/rad 부여 후 바로 추가
    ensureDegRad(p);
    addPlaceToMap(p, false);
    appendTab(p);

    // 입력 초기화
    document.getElementById("in_name").value = "";
    document.getElementById("in_addr").value = "";
    document.getElementById("in_lat").value = "";
    document.getElementById("in_lon").value = "";
  };
}

/* ---------- 패널 토글 공통 ---------- */
function setupPanelToggle(containerId, toggleBtnId, storageKey) {
  const $container = document.getElementById(containerId);
  const $toggle = document.getElementById(toggleBtnId);
  if (!$container || !$toggle) return;

  // 저장된 상태 복원
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "collapsed") {
      $container.classList.add("collapsed");
      $toggle.textContent = "+";
      $toggle.setAttribute("aria-label", "펼치기");
    }
  } catch (e) {}

  $toggle.addEventListener("click", () => {
    const collapsed = $container.classList.toggle("collapsed");
    if (collapsed) {
      $toggle.textContent = "+";
      $toggle.setAttribute("aria-label", "펼치기");
      try { localStorage.setItem(storageKey, "collapsed"); } catch (e) {}
    } else {
      $toggle.textContent = "−";
      $toggle.setAttribute("aria-label", "접기");
      try { localStorage.setItem(storageKey, "expanded"); } catch (e) {}
    }
  });
}

/* ---------- 시작 ---------- */
window.addEventListener("load", initMap);

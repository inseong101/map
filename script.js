/* global L, firebase */
"use strict";

/* ---------- 디버그: places.js 로드 확인 ---------- */
window.PLACES = window.PLACES || [];
console.log("[debug] PLACES length =", window.PLACES.length);

/* ---------- 상수 ---------- */
const DEFAULT_DEG = 270;     // (폴백)
const DEFAULT_RAD = 100;     // (폴백)
let nextPlaceId = (window.PLACES.length || 0) + 1;

/* ---------- 전역 ---------- */
let map;
let labelsLayer = null;   // 라벨/점 컨테이너
let linesLayer  = null;   // 선 컨테이너
const layerById = {};     // id -> { marker, line, dot, baseLL }
const SIDO_GEOJSON = "TL_SCCO_CTPRVN.json";

/* ---------- Firebase ---------- */
let db = null;
async function initFirebase() {
  try {
    if (!window.firebase || !window.FB_CONFIG) {
      console.warn("[firebase] SDK 또는 FB_CONFIG 없음 → 로컬/비연동 모드");
      return;
    }
    if (firebase.apps?.length === 0) firebase.initializeApp(window.FB_CONFIG);
    db = firebase.firestore();
    // 익명 로그인(규칙에서 auth 필요 시)
    try { await firebase.auth().signInAnonymously(); } catch (e) { /* noop */ }
    console.log("[firebase] initialized");
  } catch (e) {
    console.error("[firebase] init failed:", e);
    db = null;
  }
}

async function loadDegRadOverrides() {
  if (!db) return new Map();
  try {
    const snap = await db.collection("places").get();
    const m = new Map();
    snap.forEach(doc => {
      const d = doc.data() || {};
      const idNum = Number(doc.id);
      if (Number.isFinite(idNum) && typeof d.deg === "number" && typeof d.rad === "number") {
        m.set(idNum, { deg: d.deg, rad: d.rad });
      }
    });
    console.log("[firebase] loaded overrides:", m.size);
    return m;
  } catch (e) {
    console.error("[firebase] load overrides failed:", e);
    return new Map();
  }
}
async function saveDegRad(id, deg, rad) {
  if (!db) return;
  try {
    await db.collection("places").doc(String(id)).set({ deg, rad }, { merge: true });
    console.log("[firebase] saved", id, { deg, rad });
  } catch (e) {
    console.error("[firebase] save failed:", e);
  }
}

/* ---------- 유틸: deg/rad 보장(없으면 랜덤) ---------- */
function ensureDegRad(p) {
  if (typeof p.deg !== "number") p.deg = Math.random() * 360;     // 0~360
  if (typeof p.rad !== "number") p.rad = 80 + Math.random() * 120; // 80~200px
}

/* ---------- GeoJSON(시·도 실루엣/경계) ---------- */
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

      if (!window.PLACES || window.PLACES.length === 0) {
        const bounds = L.geoJSON(geo).getBounds();
        map.fitBounds(bounds);
      }
    })
    .catch(err => console.error("[geojson] load failed:", err));
}

/* ---------- deg/rad 계산 (드래그 저장용) ---------- */
function computeDegRad(baseLL, labelMarker) {
  const basePt  = map.latLngToLayerPoint(baseLL);
  const labelPt = map.latLngToLayerPoint(labelMarker.getLatLng());
  const dx = labelPt.x - basePt.x;
  const dy = labelPt.y - basePt.y;
  const rad = Math.hypot(dx, dy);                 // 픽셀 거리
  let deg = Math.atan2(dy, dx) * 180 / Math.PI;   // -180~180
  if (deg < 0) deg += 360;                        // 0~360
  return { deg, rad };
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

  // deg/rad 보장 (없으면 랜덤)
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

  // 리더 라인 — lines pane
  const line = L.polyline([baseLL, labelLL], {
    color: "#FF0000",
    weight: 2.5,
    opacity: 1,
    pane: "pane-lines"
  }).addTo(linesLayer);

  // 렌더 후 경계까지 선 갱신
  setTimeout(() => updateLeaderLine(baseLL, marker, line), 0);
  marker.on("drag",    e => updateLeaderLine(baseLL, e.target, line));
  marker.on("dragend", async (e) => {
    updateLeaderLine(baseLL, e.target, line);
    // 드래그 종료 시 deg/rad 계산해서 Firestore에 저장
    const { deg, rad } = computeDegRad(baseLL, e.target);
    p.deg = deg; p.rad = rad; // 메모리에도 반영
    await saveDegRad(p.id, deg, rad);
  });

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

/* ---------- 우측 입력 패널 (deg/rad 입력 제거) ---------- */
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

    const p = { id: nextPlaceId++, name, address: address || "주소 없음", lat, lon };
    (window.PLACES || (window.PLACES = [])).push(p);
    ensureDegRad(p);   // 새 항목에 랜덤 deg/rad
    addPlaceToMap(p, false);
    appendTab(p);
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

/* ---------- 초기화 ---------- */
async function initMap() {
  await initFirebase(); // 있으면 초기화

  map = L.map("map", { zoomControl: true }).setView([36.5, 127.8], 7);

  // pane: geo(아래) < lines(중간) < markers(위)
  map.createPane("pane-geo");
  const paneLines   = map.createPane("pane-lines");
  const paneMarkers = map.createPane("pane-markers");
  paneLines.style.zIndex   = 650;
  paneMarkers.style.zIndex = 700;
  paneLines.style.pointerEvents = "none";
  map.getPane("pane-geo").style.pointerEvents = "none";

  addKoreaSilhouetteFromLocal();

  // Firestore에서 저장된 deg/rad 있으면 우선 적용
  const overrides = await loadDegRadOverrides();
  (window.PLACES || []).forEach(p => {
    const ov = overrides.get(Number(p.id));
    if (ov) { p.deg = ov.deg; p.rad = ov.rad; }
  });

  if (window.PLACES.length) {
    const latlngs = window.PLACES.map(p => [p.lat, p.lon]);
    map.fitBounds(latlngs);
  }

  renderAll();
  injectLeftTabs();
  injectRightPanel();

  // 지도 확대/축소/이동/리사이즈 시 선 재계산
  map.on("zoom move resize", () => {
    Object.values(layerById).forEach(rec => {
      if (rec && rec.marker && rec.line && rec.baseLL) {
        updateLeaderLine(rec.baseLL, rec.marker, rec.line);
      }
    });
  });
}

window.addEventListener("load", initMap);

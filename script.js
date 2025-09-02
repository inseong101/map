/* global L, firebase */
"use strict";

/* ---------- 초기 데이터(places.js) ---------- */
window.PLACES = window.PLACES || [];
console.log("[debug] PLACES length =", window.PLACES.length);

/* ---------- 상수/전역 ---------- */
let map;
let labelsLayer = null;   // 라벨/점 컨테이너
let linesLayer  = null;   // 선 컨테이너
const layerById = {};     // id -> { marker, line, dot, baseLL }
const SIDO_GEOJSON = "TL_SCCO_CTPRVN.json";

const DEFAULT_DEG = 270;      // 폴백(거의 안 씀)
const DEFAULT_RAD = 100;      // 폴백
let nextPlaceId = (window.PLACES.length || 0) + 1;


/* ---------- 유틸 함수들 ---------- */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidPlace(p) {
  return Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
}


/* ---------- Firebase ---------- */
let db = null;
async function initFirebase() {
  try {
    if (!window.firebase || !window.FB_CONFIG) {
      console.warn("[firebase] SDK 또는 FB_CONFIG 없음 → 로컬 모드");
      return;
    }
    if (firebase.apps?.length === 0) firebase.initializeApp(window.FB_CONFIG);
    db = firebase.firestore();
    try { await firebase.auth().signInAnonymously(); } catch (_) {}
    console.log("[firebase] initialized");
  } catch (e) {
    console.error("[firebase] init failed:", e);
    db = null;
  }
}

/* ---------- 유틸: deg/rad 보장(없으면 랜덤) ---------- */
function ensureDegRad(p) {
  if (typeof p.deg !== "number") p.deg = Math.random() * 360;      // 0~360
  if (typeof p.rad !== "number") p.rad = 80 + Math.random() * 120;  // 80~200px
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

/* ---------- 라벨 중심까지 or 경계점까지 선 그리기 ---------- */
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

/* ---------- deg/rad 재계산 (드래그 저장용) ---------- */
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

/* ---------- Firestore I/O ---------- */
async function saveDegRad(id, deg, rad) {
  if (!db) return;
  try {
    await db.collection("places").doc(String(id)).set({ deg, rad }, { merge: true });
    console.log("[firebase] saved deg/rad", id, { deg, rad });
  } catch (e) {
    console.error("[firebase] save failed:", e);
  }
}

async function upsertPlaceDoc(p) {
  if (!db) return;
  try {
    const payload = {
      id: p.id,
      name: p.name,
      address: p.address,
      lat: p.lat,
      lon: p.lon,
      deg: p.deg,
      rad: p.rad,
    };
    await db.collection("places").doc(String(p.id)).set(payload, { merge: true });
  } catch (e) {
    console.error("[firebase] upsert failed:", e);
  }
}

/* ---------- 지도에 한 항목 추가 (점/라벨/선) ---------- */
function addPlaceToMap(p, alsoAddTab = true) {
  if (typeof p.id !== "number") p.id = Number(p.id) || (nextPlaceId++);

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
    const { deg, rad } = computeDegRad(baseLL, e.target);
    p.deg = deg; p.rad = rad; // 메모리에도 반영
    await saveDegRad(p.id, deg, rad); // ← Firestore에 영구 저장
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
  Object.keys(layerById).forEach(k => delete layerById[k]); // 레지스트리 초기화

  (window.PLACES || []).forEach(p => addPlaceToMap(p, false));
  rebuildTabs();

  console.log("[render] rendered places:", (window.PLACES || []).length);
}

/* ---------- 좌측 탭 ---------- */
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
  const idx = (window.PLACES || []).findIndex(x => x.id === id);
  if (idx >= 0) window.PLACES.splice(idx, 1);

  const rec = layerById[id];
  if (rec) {
    if (rec.marker) rec.marker.remove();
    if (rec.line)   rec.line.remove();
    if (rec.dot)    rec.dot.remove();
    delete layerById[id];
  }

  const el = document.getElementById("tab_" + id);
  if (el && el.parentNode) el.parentNode.removeChild(el);

  // DB에서도 삭제하고 싶으면 아래 해제
  // if (db) db.collection("places").doc(String(id)).delete().catch(console.error);
}

/* ---------- 우측 입력 패널 ---------- */
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

  document.getElementById("btn_add").onclick = async function () {
    const name = (document.getElementById("in_name").value || "").trim();
    const address = (document.getElementById("in_addr").value || "").trim();
    const lat = parseFloat(document.getElementById("in_lat").value);
    const lon = parseFloat(document.getElementById("in_lon").value);

    if (!name || isNaN(lat) || isNaN(lon)) {
      alert("이름, 위도, 경도는 필수입니다.");
      return;
    }

    // 아이디 계산(스냅샷 기반)
    const ids = (window.PLACES || []).map(p => Number(p.id) || 0);
    const newId = (ids.length ? Math.max(...ids) + 1 : 1);

    const p = { id: newId, name, address: address || "주소 없음", lat, lon };
    ensureDegRad(p); // 초기 라벨 위치 랜덤

    if (db) {
      // DB에 기록 → onSnapshot이 다시 불러와서 renderAll
      await upsertPlaceDoc(p);
      // 입력 초기화만 하고 끝
      document.getElementById("in_name").value = "";
      document.getElementById("in_addr").value = "";
      document.getElementById("in_lat").value = "";
      document.getElementById("in_lon").value = "";
    } else {
      // 로컬 모드: 즉시 반영
      (window.PLACES || (window.PLACES = [])).push(p);
      addPlaceToMap(p, false);
      appendTab(p);
      document.getElementById("in_name").value = "";
      document.getElementById("in_addr").value = "";
      document.getElementById("in_lat").value = "";
      document.getElementById("in_lon").value = "";
    }
  };
}

/* ---------- 패널 토글 공통 ---------- */
function setupPanelToggle(containerId, toggleBtnId, storageKey) {
  const $container = document.getElementById(containerId);
  const $toggle = document.getElementById(toggleBtnId);
  if (!$container || !$toggle) return;

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "collapsed") {
      $container.classList.add("collapsed");
      $toggle.textContent = "+";
      $toggle.setAttribute("aria-label", "펼치기");
    }
  } catch (_) {}

  $toggle.addEventListener("click", () => {
    const collapsed = $container.classList.toggle("collapsed");
    if (collapsed) {
      $toggle.textContent = "+";
      $toggle.setAttribute("aria-label", "펼치기");
      try { localStorage.setItem(storageKey, "collapsed"); } catch (_) {}
    } else {
      $toggle.textContent = "−";
      $toggle.setAttribute("aria-label", "접기");
      try { localStorage.setItem(storageKey, "expanded"); } catch (_) {}
    }
  });
}

/* ---------- Firestore 구독 + 초기 시드 ---------- */
async function subscribePlacesAndRender() {
  if (!db) {
    // 로컬 모드: places.js 그대로 렌더
    renderAll();
    return;
  }

  // 1) DB에 현재 문서 목록 확인
  const snap = await db.collection("places").get();
  const existingIds = new Set(snap.docs.map(d => d.id));

  // 2) places.js에 있는데 DB에 없는 항목은 초기 시드(업서트)
  for (const p0 of (window.PLACES || [])) {
    const idStr = String(p0.id);
    if (!existingIds.has(idStr)) {
      const seed = { ...p0 };
      ensureDegRad(seed);
      await upsertPlaceDoc(seed);
    }
  }

// 3) 실시간 구독 → 화면 렌더
db.collection("places").onSnapshot((ss) => {
  const arr = [];
  ss.forEach(doc => {
    const d = doc.data() || {};

    // 좌표를 숫자로 보정
    const lat = toNum(d.lat);
    const lon = toNum(d.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn("[snapshot] skip invalid lat/lon doc:", doc.id, d);
      return; // 좌표가 없거나 문자열이면 건너뜀
    }

    // id 보정
    const idNum = Number(doc.id);
    const id = Number.isFinite(idNum) ? idNum : (Number(d.id) || doc.id);

    // 항목 구성
    const item = {
      id,
      name: d.name ?? "",
      address: d.address ?? "",
      lat, lon,
      deg: (typeof d.deg === "number") ? d.deg : undefined,
      rad: (typeof d.rad === "number") ? d.rad : undefined,
    };
    arr.push(item);
  });

  // 전역 데이터 교체
  window.PLACES = arr;

  // 유효 좌표만으로 bounds 맞추기
  const validLatLngs = arr.filter(isValidPlace).map(p => [p.lat, p.lon]);
  if (validLatLngs.length) {
    map.fitBounds(validLatLngs);
  } else {
    console.warn("[snapshot] no valid lat/lon to fitBounds");
  }

  renderAll();
}, (err) => {
  console.error("[firebase] onSnapshot error:", err);
  // 오류 시라도 로컬 렌더
  renderAll();
});

/* ---------- 초기화 ---------- */
async function initMap() {
  await initFirebase();

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

  // Firestore 구독(없으면 로컬 렌더)
  await subscribePlacesAndRender();
}


window.addEventListener("load", initMap);

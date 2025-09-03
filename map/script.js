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

const DEFAULT_DEG = 270;
const DEFAULT_RAD = 100;

/* ✅ /map/index.html 에서 <base href="/map/"> 를 쓰므로
   상대경로 "data/universities.json" => /map/data/universities.json 로 정확히 해석됨 */
const UNIVERSITY_JSON = "/data/universities.json";

let db = null;
const isDbMode = () => !!db;
let firstSnapshot = true;

/* ---------- 유틸 ---------- */
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function isValidLatLng(lat, lon) { return Number.isFinite(lat) && Number.isFinite(lon); }
function isValidPlace(p) { return isValidLatLng(p?.lat, p?.lon); }

function setLabelPositionFromDegRad(p, rec) {
  if (!rec || !rec.marker || !rec.baseLL) return;
  if (typeof p.deg !== "number" || typeof p.rad !== "number") return;
  const basePt = map.latLngToLayerPoint(rec.baseLL);
  const radDeg = p.deg * Math.PI / 180;
  const dx = Math.cos(radDeg) * p.rad;
  const dy = Math.sin(radDeg) * p.rad;
  const labelPt = L.point(basePt.x + dx, basePt.y + dy);
  const labelLL = map.layerPointToLatLng(labelPt);
  rec.marker.setLatLng(labelLL);
  updateLeaderLine(rec.baseLL, rec.marker, rec.line);
}
function getPlaceById(id) {
  return (window.PLACES || []).find(p => String(p.id) === String(id));
}

/* ---------- Firebase ---------- */
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

/* ---------- 유틸: deg/rad 보장 ---------- */
function ensureDegRad(p) {
  if (typeof p.deg !== "number") p.deg = Math.random() * 360;
  if (typeof p.rad !== "number") p.rad = 80 + Math.random() * 120;
}

/* ---------- GeoJSON(시·도 실루엣/경계) ---------- */
function addKoreaSilhouetteFromLocal() {
  fetch(SIDO_GEOJSON)
    .then(r => r.json())
    .then(geo => {
      // 실루엣
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

      // 경계선
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

/* ---------- 선분-사각형 경계 교차 ---------- */
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

  const tl = L.DomUtil.getPosition(iconEl);
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
  const rad = Math.hypot(dx, dy);
  let deg = Math.atan2(dy, dx) * 180 / Math.PI;
  if (deg < 0) deg += 360;
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
    const lat = toNum(p.lat), lon = toNum(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn("[upsert] invalid lat/lon, abort", p);
      return;
    }
    const payload = {
      id: Number(p.id) || p.id,
      name: p.name ?? "",
      address: p.address ?? "",
      lat, lon,
      deg: (typeof p.deg === "number") ? p.deg : undefined,
      rad: (typeof p.rad === "number") ? p.rad : undefined
    };
    await db.collection("places").doc(String(payload.id)).set(payload, { merge: true });
  } catch (e) {
    console.error("[firebase] upsert failed:", e);
  }
}

/* ---------- 지도에 한 항목 추가 (점/라벨/선) ---------- */
function addPlaceToMap(p, alsoAddTab = true) {
  if (!isValidPlace(p)) {
    console.warn("[addPlaceToMap] skip invalid place:", p);
    return;
  }
  if (!isDbMode()) {
    if (typeof p.deg !== "number" || typeof p.rad !== "number") {
      ensureDegRad(p);
    }
  }

  const baseLL = L.latLng(p.lat, p.lon);
  const basePt = map.latLngToLayerPoint(baseLL);

  const radDeg = (typeof p.deg === "number" ? p.deg : DEFAULT_DEG) * Math.PI / 180;
  const R      = (typeof p.rad === "number" ? p.rad : DEFAULT_RAD);
  const dx  = Math.cos(radDeg) * R;
  const dy  = Math.sin(radDeg) * R;

  const labelPt = L.point(basePt.x + dx, basePt.y + dy);
  const labelLL = map.layerPointToLatLng(labelPt);

  // 점(빨강)
  const dot = L.circleMarker(baseLL, {
    radius: 4, color: "#FF0000", fill: true,
    fillColor: "#FF0000", fillOpacity: 1, pane: "pane-markers"
  }).addTo(labelsLayer);

  // 라벨(이름+주소)
  const html =
    '<div class="poi-label">' +
      '<div class="title">' + (p.name || '이름없음') + '</div>' +
      '<div class="addr">'  + (p.address || '주소 없음') + '</div>' +
    '</div>';
  const icon = L.divIcon({ html, className: '', iconSize: null, iconAnchor: [0, 0] });
  const marker = L.marker(labelLL, {
    icon, draggable: true, autoPan: true, interactive: true, pane: "pane-markers"
  }).addTo(labelsLayer);

  // 리더 라인
  const line = L.polyline([baseLL, labelLL], {
    color: "#FF0000", weight: 2.5, opacity: 1, pane: "pane-lines"
  }).addTo(linesLayer);

  setTimeout(() => updateLeaderLine(baseLL, marker, line), 0);
  marker.on("drag",    e => updateLeaderLine(baseLL, e.target, line));
  marker.on("dragend", async (e) => {
    updateLeaderLine(baseLL, e.target, line);
    const { deg, rad } = computeDegRad(baseLL, e.target);
    p.deg = deg; p.rad = rad;
    await saveDegRad(p.id, deg, rad);
  });

  layerById[p.id] = { marker, line, dot, baseLL };
  if (alsoAddTab) appendTab(p);
}

/* ---------- 전체 렌더 ---------- */
function renderAll() {
  if (labelsLayer) labelsLayer.removeFrom(map);
  if (linesLayer)  linesLayer.removeFrom(map);

  labelsLayer = L.layerGroup().addTo(map);
  linesLayer  = L.layerGroup().addTo(map);

  (window.PLACES || []).forEach(p => {
    if (!isValidPlace(p)) return;
    if (isDbMode() && (typeof p.deg !== "number" || typeof p.rad !== "number")) return;
    if (!isDbMode()) {
      if (typeof p.deg !== "number" || typeof p.rad !== "number") ensureDegRad(p);
    }
    addPlaceToMap(p, false);
  });

  rebuildTabs();
  console.log("[render] rendered places:", (window.PLACES || []).length);
}
/* ---------- 패널 토글 공통 ---------- */
function setupPanelToggle(containerId, toggleBtnId, storageKey) {
  const $container = document.getElementById(containerId);
  const $toggle = document.getElementById(toggleBtnId);
  if (!$container || !$toggle) return;

  // 접힘 상태 복원
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "collapsed") {
      $container.classList.add("collapsed");
      $toggle.textContent = "+";
      $toggle.setAttribute("aria-label", "펼치기");
    } else {
      $toggle.textContent = "−";
      $toggle.setAttribute("aria-label", "접기");
    }
  } catch (_) {}

  // 토글 동작
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

function rebuildTabs() {
  const list = document.getElementById("tabListRight"); // ← 변경
  if (!list) return;
  list.innerHTML = (window.PLACES || []).map(p => tabItemHTML(p)).join("");
  bindTabEvents();
}
function appendTab(p) {
  const list = document.getElementById("tabListRight"); // ← 변경
  if (!list) return;
  const div = document.createElement("div");
  div.innerHTML = tabItemHTML(p);
  list.appendChild(div.firstElementChild);
  bindSingleTabEvents(p.id);
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

      // 입력 폼
      '<div class="row"><input id="in_name" type="text" placeholder="이름 (필수)" /></div>' +
      '<div class="row"><input id="in_addr" type="text" placeholder="주소 (선택)" /></div>' +
      '<div class="row">' +
        '<input id="in_lat" type="number" step="0.000001" placeholder="위도 (필수)" />' +
        '<input id="in_lon" type="number" step="0.000001" placeholder="경도 (필수)" />' +
      '</div>' +
      '<button class="btn" id="btn_add">추가</button>' +
      '<div class="hint">라벨은 추가 후 드래그해서 위치를 조정할 수 있어요.</div>' +

      // 구분선
      '<hr class="divider" />' +

      // 장소 목록 (← 여기로 이사)
      '<div class="panel-header small">' +
        '<h3 class="panel-title">장소 목록</h3>' +
      '</div>' +
      '<div id="tabListRight" class="tab-list"></div>' +

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

  document.getElementById("btn_add").onclick = async () => {
    if (!db) {
      alert("Firebase에 연결되지 않았어요. config.js와 Firestore 설정을 확인해주세요.");
      return;
      rebuildTabs();
}

    const name = (document.getElementById("in_name").value || "").trim();
    const address = (document.getElementById("in_addr").value || "").trim();
    const lat = parseFloat(document.getElementById("in_lat").value);
    const lon = parseFloat(document.getElementById("in_lon").value);

    if (!name || isNaN(lat) || isNaN(lon)) {
      alert("이름, 위도, 경도는 필수입니다.");
      return;
    }

    const ids = (window.PLACES || []).map(p => Number(p.id) || 0);
    const newId = ids.length ? Math.max(...ids) + 1 : 1;

    const p = {
      id: newId,
      name,
      address: address || "주소 없음",
      lat,
      lon,
      deg: Math.random() * 360,
      rad: 80 + Math.random() * 120
    };

    await db.collection("places").doc(String(newId)).set(p, { merge: true });

    document.getElementById("in_name").value = "";
    document.getElementById("in_addr").value = "";
    document.getElementById("in_lat").value = "";
    document.getElementById("in_lon").value = "";
  };
}

/* ---------- Firestore 구독 ---------- */
async function subscribePlacesAndRender() {
  if (!db) { renderAll(); return; }

  db.collection("places").onSnapshot((ss) => {
    const arr = [];
    ss.forEach(doc => {
      const d = doc.data() || {};
      const lat = Number(d.lat), lon = Number(d.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const idNum = Number(doc.id);
      const id = Number.isFinite(idNum) ? idNum : (Number(d.id) || doc.id);

      arr.push({
        id,
        name: d.name ?? "",
        address: d.address ?? "",
        lat, lon,
        deg: (typeof d.deg === "number") ? d.deg : undefined,
        rad: (typeof d.rad === "number") ? d.rad : undefined
      });
    });

    window.PLACES = arr;

    if (firstSnapshot) {
      firstSnapshot = false;
      const latlngs = arr.map(p => [p.lat, p.lon]);
      if (latlngs.length) map.fitBounds(latlngs);
    }

    renderAll();
  }, (err) => {
    console.error("[firebase] onSnapshot error:", err);
    renderAll();
  });
}

/* ---------- 🎓 대학교 로더 (깃발 + 상시 라벨) ---------- */
async function loadUniversities() {
  try {
    const res = await fetch(UNIVERSITY_JSON, { cache: "no-store" });
    console.log("[univ] fetch", { requested: UNIVERSITY_JSON, resolved: res.url, ok: res.ok });
    if (!res.ok) throw new Error(`fetch fail ${res.status} ${res.statusText}`);
    const raw = await res.json();

    const data = raw.map(u => ({
      name: u.name ?? u.title ?? "",
      address: u.address ?? u.addr ?? "",
      lat: Number(u.lat ?? u.latitude),
      lon: Number(u.lon ?? u.lng ?? u.long ?? u.longitude),
    }));

    const bad = data.filter(u => !Number.isFinite(u.lat) || !Number.isFinite(u.lon));
    const ok  = data.filter(u =>  Number.isFinite(u.lat) &&  Number.isFinite(u.lon));
    if (bad.length) console.warn("[univ] skipped invalid coords:", bad);

    if (window.universityLayer) {
      window.universityLayer.removeFrom(map);
      window.universityLayer = null;
    }

    if (!map.getPane("pane-univ")) {
      const paneUniv = map.createPane("pane-univ");
      paneUniv.style.zIndex = 720; // markers(700)보다 위
    }

    window.universityLayer = L.layerGroup().addTo(map);

    ok.forEach(u => {
      // 아이콘을 좌표 정중앙 기준으로 앵커(가운데, 아래끝)로 설정
      const icon = L.divIcon({
        className: "",
        html: "🚩",
        iconSize: [22, 22],
        iconAnchor: [11, 22], // 중앙-아래
      });

      L.marker([u.lat, u.lon], { icon, pane: "pane-univ", title: u.name })
        .addTo(window.universityLayer)
        .bindTooltip(u.name, {
          permanent: true,
          direction: "top",
          offset: [0, -6],
          className: "uni-label"
        })
        .bindPopup(`<b>${u.name}</b>${u.address ? `<br>${u.address}` : ""}`);
    });

    console.log(`[univ] loaded: total=${raw.length}, ok=${ok.length}, skipped=${bad.length}`);
  } catch (e) {
    // JSON 대신 HTML이 돌아오면 여기로 옴 (예: 잘못된 경로로 index.html이 리라이트됨)
    console.error("[univ] load error:", e);
  }
}

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
  injectRightPanel();

  map.on("zoomend viewreset", () => {
    Object.entries(layerById).forEach(([id, rec]) => {
      const p = getPlaceById(id);
      if (p) setLabelPositionFromDegRad(p, rec);
    });
  });

  map.on("move resize", () => {
    Object.values(layerById).forEach(rec => {
      if (rec && rec.marker && rec.line && rec.baseLL) {
        updateLeaderLine(rec.baseLL, rec.marker, rec.line);
      }
    });
  });

  await subscribePlacesAndRender();
  await loadUniversities();
}

window.addEventListener("load", initMap);

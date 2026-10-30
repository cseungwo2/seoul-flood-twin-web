// 지도: OpenFreeMap positron(포스터 결로 다시 칠함) + 3D 지형 · 힐셰이드 + 물(canvas) + 구 경보 색 + 도로 · 건물(가까이서만) + 랜드마크 + 대피소.
import { addLandmarks3D } from './landmarks3d.js';

const BASE = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
const BUILD_Z = 13.5;
export const BUILD_OP = ['interpolate', ['linear'], ['zoom'], BUILD_Z, 0, BUILD_Z + 0.4, 0.92]; // 건물 불투명도(경로 볼 때 반투명 → 되돌릴 값)
const TILE_MAXZ = 14; // prep/build_tiles.mjs 의 MAXZ 와 같게. 더 확대하면 z14 타일을 늘려 씀(z18 까지 모양 차이 없음)
const WATER = [0xffa1470d, 0xfff5a542, 0xfff9ca90]; // ABGR(리틀 엔디언): #0D47A1 · #42A5F5 · #90CAF9
const MOUNTAINS = [
  ['북한산', 126.9775, 37.6589], ['도봉산', 127.0157, 37.6987], ['수락산', 127.0820, 37.6981], ['인왕산', 126.9578, 37.5853],
  ['남산', 126.9882, 37.5512], ['아차산', 127.1037, 37.5714], ['관악산', 126.9636, 37.4447],
];
const LABEL = ['coalesce', ['get', 'name:ko'], ['get', 'name']];

/** positron 을 포스터 결(미색 바탕 · 청회색 물 · 올리브 녹지 · 한글 이름)로 바꿈. */
function restyle(style) {
  const paint = {
    background: { 'background-color': '#ECE8E0' },
    park: { 'fill-color': '#C9D7B4' },
    landcover_wood: { 'fill-color': '#B7C99E' },
    landuse_residential: { 'fill-color': '#E6E1D8' },
    water: { 'fill-color': '#C9D6DE' },
    waterway: { 'line-color': '#B4C6D1' },
    building: { 'fill-color': '#E2DCD1', 'fill-outline-color': '#D6CFC3' },
  };
  const drop = /^(label_country|label_state|label_city_capital|highway-shield|road_shield|airport|aeroway)/;
  style.layers = style.layers.filter((l) => !drop.test(l.id));
  for (const l of style.layers) {
    Object.assign((l.paint ??= {}), paint[l.id] || {});
    if (l.id === 'waterway') l.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3];
    if (l.id === 'building') l.maxzoom = BUILD_Z;
    if (/^(highway|tunnel|road_)/.test(l.id) && l.type === 'line' && l.id !== 'highway_path') l.maxzoom = BUILD_Z; // 그 위로는 도로 면(아스팔트) + 중앙선
    if (l.id === 'highway_path') l.paint = { 'line-color': '#8A7A60', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 1.4], 'line-dasharray': [2, 2] }; // 등산로 · 오솔길
    if (/^railway/.test(l.id) && l.type === 'line') l.maxzoom = 14.5;
    if (l.type === 'symbol' && l.layout?.['text-field']) {
      l.layout['text-field'] = LABEL;
      if (/^label_(village|town|other)/.test(l.id)) l.minzoom = Math.max(l.minzoom || 0, 12.5);
      if (/^label_city/.test(l.id)) l.minzoom = 13;
      l.paint['text-color'] = /water/.test(l.id) ? '#6E8796' : '#6B665E';
    }
  }
  return style;
}

/** web/data 의 png → ImageData(색 보정 · 미리 곱하기 없이 원값 그대로). */
async function pngData(name) {
  const bmp = await createImageBitmap(await (await fetch(BASE + 'data/' + name)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0);
  return x.getImageData(0, 0, bmp.width, bmp.height);
}

/** gu_id.png(R = 구 번호 model gn 순서, A 0 = 서울 밖) → 칸별 구 번호, 255 = 밖. flood_onset.png 와 같은 틀. */
async function guIds() {
  const { data, width, height } = await pngData('gu_id.png'), n = width * height, gid = new Uint8Array(n).fill(255);
  for (let i = 0; i < n; i++) if (data[i * 4 + 3]) gid[i] = data[i * 4];
  return gid;
}

/** flood_onset.png → 강우마다 다시 칠하는 canvas. R/G/B = 0.15/0.30/0.50 m 에 처음 닿는 실제 강우, 255 = 안 닿음, A 0 = 바깥.
 *  draw(rain, pumpL): pumpL[gi] = 양수기가 깎은 수위(cm, model pumpLevelCm) · null = 그대로. 그 구 칸은 L 보다 깊은 등급을 L 의 등급으로 낮춤. */
async function waterCanvas(gid) {
  const bmp = await pngData('flood_onset.png'), src = bmp.data;
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  const n = bmp.width * bmp.height;
  // 칸마다 하나의 값만 보면 되게: 칸 i 가 깊음/중간/얕음이 되는 강우를 미리 꺼내 둠
  const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n), wet = [];
  const deep = new Uint8Array(n).fill(255); // 칸이 0.3 m 에 처음 닿는 강우(255 = 안 닿음) — 대피 경로용
  for (let i = 0; i < n; i++) {
    if (src[i * 4 + 3] === 0 || src[i * 4] === 255) continue; // 바깥이거나 0.15 m 에 안 닿는 칸
    r[i] = src[i * 4]; g[i] = src[i * 4 + 1]; b[i] = src[i * 4 + 2]; wet.push(i); deep[i] = g[i];
  }
  const idx = Uint32Array.from(wet);
  const img = ctx.createImageData(bmp.width, bmp.height);
  const out = new Uint32Array(img.data.buffer);
  return {
    canvas, deep, g, b, w: bmp.width, h: bmp.height,
    draw(rain, pumpL = []) {
      out.fill(0);
      // 구별 가장 깊게 칠할 등급(0 = 0.50 m · 1 = 0.30 m · 2 = 0.15 m): L ≥ 50 → 0(그대로), 30 ≤ L < 50 → 1, L < 30 → 2(L ≥ trigger 15)
      const top = new Uint8Array(256);
      pumpL.forEach((L, gi) => { if (L != null) top[gi] = L >= 50 ? 0 : L >= 30 ? 1 : 2; });
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const c = b[i] <= rain ? 0 : g[i] <= rain ? 1 : r[i] <= rain ? 2 : 3;
        out[i] = c > 2 ? 0 : WATER[Math.max(c, top[gid[i]])];
      }
      ctx.putImageData(img, 0, 0);
    },
  };
}

/** persona_onset_a/b.png(R G B = 시민 유형 0 1 2 / 3 4 5) → 예상 피해 지역 canvas. 칸값 = 그 유형 생활 공간이 인명 위해 수심에 처음 닿는 강우, 255 = 아님 · 안 닿음.
 *  draw(rain, mask, rad): mask = 켠 유형 비트(1 << p), 0 = 아무것도 안 그림. 칸에 켠 유형이 여럿이면 먼저 잠기는 유형(같으면 앞 번호).
 *  rad = 칸을 사방 rad 칸 넓혀 칠함(구 전체 줌에서 20 m 칸이 1 px 아래로 사라지지 않게 — 표시용, 판정은 칸 그대로).
 *  block[gi] = 물막이판이 막은 P3 몫(model barrierShare, null = 없음), bh[gi] = 물막이판 높이(m). gid · wg · wb = 구 번호 · 0.30 · 0.50 m 도달 강우(flood_onset).
 *  only = 고른 구(그 구 칸만 칠함), null = 서울 전체. */
async function zoneCanvas(colors, gid, wg, wb) {
  const px = await Promise.all(['a', 'b'].map((k) => pngData(`persona_onset_${k}.png`)));
  const { width: W, height: H } = px[0], n = W * H;
  const on = [0, 1, 2, 3, 4, 5].map(() => new Uint8Array(n));
  for (let p = 0; p < 6; p++) { const d = px[p < 3 ? 0 : 1].data, c = p % 3; for (let i = 0; i < n; i++) on[p][i] = d[i * 4 + 3] ? d[i * 4 + c] : 255; }
  const cells = [];
  for (let i = 0; i < n; i++) if (on.some((o) => o[i] < 255)) cells.push(i);
  const idx = Uint32Array.from(cells);
  const abgr = colors.map((h) => 0xff000000 | (parseInt(h.slice(5, 7), 16) << 16) | (parseInt(h.slice(3, 5), 16) << 8) | parseInt(h.slice(1, 3), 16));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H), out = new Uint32Array(img.data.buffer);
  const p3 = Uint32Array.from(cells.filter((i) => on[2][i] < 255)), cut = new Uint8Array(n);
  /** 물막이판이 막은 P3 칸(1). 구마다 '잠긴 P3 칸 수 × 몫'(반올림)만큼, 막을 수 있는 칸 중 얕은 칸부터 뺌.
   *  막을 수 없는 칸 = 물막이판 높이 이상이 확실한 칸(bh ≤ 0.30 → 0.30 m 도달 칸, bh ≤ 0.50 → 0.50 m 도달 칸).
   *  얕은 순서 = 수심 등급(0.15~0.30 → 0.30~0.50 → 0.50~) → 0.15 m 에 늦게 닿은 칸 먼저 → 칸 번호(결정적). */
  function blockedP3(rain, block, bh) {
    cut.fill(0);
    if (!block.some((v) => v > 0)) return null;
    const wet = new Uint32Array(256), keys = block.map(() => []);
    for (let k = 0; k < p3.length; k++) {
      const i = p3[k], gi = gid[i];
      if (on[2][i] > rain || !(block[gi] > 0)) continue;
      wet[gi]++;
      const cls = wb[i] <= rain ? 2 : wg[i] <= rain ? 1 : 0;
      if ((cls === 2 && bh[gi] <= 0.5) || (cls >= 1 && bh[gi] <= 0.3)) continue;
      keys[gi].push(cls * 2 ** 30 + (255 - on[2][i]) * 2 ** 22 + i); // 칸 번호 i < 2²² (1854 × 1521)
    }
    keys.forEach((ks, gi) => {
      const a = Float64Array.from(ks).sort(), m = Math.min(a.length, Math.round(block[gi] * wet[gi]));
      for (let k = 0; k < m; k++) cut[a[k] % 2 ** 22] = 1;
    });
    return cut;
  }
  return {
    canvas,
    draw(rain, mask, rad = 0, block = [], bh = [], only = null) {
      out.fill(0);
      const cut = (mask >> 2) & 1 ? blockedP3(rain, block, bh) : null;
      for (let k = 0; mask && k < idx.length; k++) {
        const i = idx[k];
        if (only != null && gid[i] !== only) continue;
        let b = 255, bp = -1;
        for (let p = 0; p < 6; p++) if ((mask >> p) & 1 && on[p][i] < b && !(p === 2 && cut?.[i])) { b = on[p][i]; bp = p; }
        if (bp < 0 || b > rain) continue;
        const c = abgr[bp], x = i % W, y = (i - x) / W;
        for (let yy = Math.max(0, y - rad); yy <= Math.min(H - 1, y + rad); yy++)
          for (let xx = Math.max(0, x - rad); xx <= Math.min(W - 1, x + rad); xx++) out[yy * W + xx] = c;
      }
      ctx.putImageData(img, 0, 0);
    },
  };
}

/** 건물 색: 대표점 칸이 켠 유형(mask)의 인명 위해 수심에 닿았으면 그 유형 색(여럿이면 먼저 잠기는 유형), 아니면 높이별 회색. o0..o5 = 타일 속성. */
const BUILD_GREY = ['interpolate', ['linear'], ['get', 'h'], 3, '#E9E4DA', 40, '#DCD5C9', 120, '#CFC7BA'];
const onP = (p) => ['coalesce', ['get', `o${p}`], 999];
function buildColor(rain, mask, colors) {
  const ps = [0, 1, 2, 3, 4, 5].filter((p) => (mask >> p) & 1), last = ps.at(-1);
  if (!ps.length) return BUILD_GREY;
  if (ps.length === 1) return ['case', ['<=', onP(last), rain], colors[last], BUILD_GREY];
  return ['let', 'm', ['min', ...ps.map(onP)],
    ['case', ['>', ['var', 'm'], rain], BUILD_GREY, ...ps.slice(0, -1).flatMap((p) => [['==', onP(p), ['var', 'm']], colors[p]]), colors[last]]];
}


const bboxOf = (geom) => {
  const b = [180, 90, -180, -90];
  const walk = (a) => (typeof a[0] === 'number' ? (b[0] = Math.min(b[0], a[0]), b[1] = Math.min(b[1], a[1]), b[2] = Math.max(b[2], a[0]), b[3] = Math.max(b[3], a[1])) : a.forEach(walk));
  walk(geom.coordinates);
  return b;
};

/**
 * createMap({ container, meta, onSelect(gi), view?, colors, barrierH })
* colors = 시민 유형 6색(panels TWIN_COLORS → M.persona[].color)
 * → Promise<{ map, setRain(r, zoneMask), setSelected(gi) }>
 */
export async function createMap({ container, meta, onSelect, view, colors, barrierH = [] }) {
  const [style, gu, shelters] = await Promise.all([
    fetch('https://tiles.openfreemap.org/styles/positron').then((r) => r.json()),
    fetch(BASE + 'data/gu.geojson').then((r) => r.json()),
    fetch(BASE + 'data/shelters.geojson').then((r) => r.json()),
  ]);
  const narrow = matchMedia('(max-width: 860px)').matches;
  const seoul = gu.features.map((f) => bboxOf(f.geometry)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  // 휴대폰: 기울이지 않고 서울 경계에 맞춤(기울이면 지도 아래에 빈 띠가 생김)
  const camera = narrow ? { bounds: seoul, fitBoundsOptions: { padding: 8 }, pitch: 0, bearing: 0 } : { center: [126.985, 37.556], zoom: 10.35, pitch: 38, bearing: -8 };
  const map = new maplibregl.Map({
    container, style: restyle(style), ...camera,
    maxBounds: [[126.55, 37.30], [127.40, 37.82]], minZoom: 9, maxPitch: 70,
    bearingDegreesPerPixelMoved: 0.35, pitchDegreesPerPixelMoved: -0.25, // 오른쪽 끌기 회전 · 기울기 감도(기본 0.8 · −0.5의 약 절반)
    localIdeographFontFamily: '"SeoulNamsan", "Malgun Gothic", sans-serif', attributionControl: { compact: true },
    cooperativeGestures: narrow, preserveDrawingBuffer: new URLSearchParams(location.search).has('shot'),
    locale: { 'CooperativeGesturesHandler.MobileHelpText': '지도는 두 손가락으로 움직입니다', 'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + 스크롤로 확대 · 축소', 'CooperativeGesturesHandler.MacHelpText': '⌘ + 스크롤로 확대 · 축소' },
  });
  if (view) map.jumpTo(view);
  map.scrollZoom.setWheelZoomRate(1 / 900); // 휠 확대 감도(기본 1/450의 절반)
  map.dragPan.enable({ linearity: 0.3, easing: (t) => 1 - (1 - t) ** 3, maxSpeed: 700, deceleration: 4000 }); // 왼쪽 끌기 뒤 미끄러짐 줄임(기본 1400 · 2500)
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  await new Promise((res) => map.on('load', res));
  if (narrow) map.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');

  // 지형(3D 높이 · 음영)은 없어도 되는 층 — 실패하면 평평한 지도로 계속
  try {
  const [tl, tr, br, bl] = meta.onset_corners;
  const bounds = [tl[0], br[1], br[0], tl[1]];
  const t = meta.terrain;
  // 서울에 걸친 타일만 있음(meta.terrain.list) → 나머지는 높이 0 타일로 채워 404 를 내지 않음
  const have = new Set(t.list);
  const flat = await new Promise((res) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.fillStyle = 'rgb(128,0,0)'; x.fillRect(0, 0, 256, 256); c.toBlob((b) => b.arrayBuffer().then(res)); });
  const local = async (key) => {
    if (!have.has(key)) return { data: flat.slice(0) };
    const r = await fetch(`${BASE}data/terrain/${key}.png`);
    return { data: await r.arrayBuffer() };
  };
  // 3D 땅 = 5 m DEM(도심이 평평하게 맞음). 산 음영 = AWS Terrain Tiles(매끈함, 5 m DEM 은 등고선 계단 줄무늬) — 못 받으면 5 m DEM
  maplibregl.addProtocol('dem', ({ url }) => local(url.slice(6)));
  maplibregl.addProtocol('dems', async ({ url }) => {
    const key = url.slice(7);
    try {
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`);
      if (r.ok) return { data: await r.arrayBuffer() };
    } catch { /* 아래로 */ }
    return local(key);
  });
  const dem = { type: 'raster-dem', tiles: ['dem://{z}/{x}/{y}'], encoding: t.encoding, tileSize: t.tileSize, minzoom: t.minzoom, maxzoom: t.maxzoom, bounds };
  map.addSource('dem', dem);
  map.addSource('dem-shade', { ...dem, tiles: ['dems://{z}/{x}/{y}'] });
  map.setTerrain({ source: 'dem', exaggeration: 1.5 });
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-shade', paint: { 'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 13, 0.75, 15.5, 0.15], 'hillshade-shadow-color': '#4F5C40', 'hillshade-highlight-color': 'rgba(250, 251, 240, 0.55)', 'hillshade-accent-color': '#6E7A58' } },
    map.getStyle().layers.find((l) => ['transportation', 'building'].includes(l['source-layer']))?.id); // 숲 색 위 · 도로 아래
  } catch (e) { console.info('지형 없이 계속:', e.message); }
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

  // 물: 강우가 바뀔 때만 canvas 를 다시 칠하고 한 프레임만 올림(play → 그린 뒤 pause)
  const gid = await guIds();
  const water = await waterCanvas(gid);
  water.draw(0);
  map.addSource('water-depth', { type: 'canvas', canvas: water.canvas, coordinates: meta.onset_corners, animate: false });
  const wsrc = map.getSource('water-depth');

  // 건물 · 도로: 정적 벡터 타일(prep/build_tiles.mjs, 레이어 b = 건물 · r = 도로) — 화면에 걸친 칸만 작업자가 받아 그림
  map.addSource('city', { type: 'vector', tiles: [BASE + 'data/tiles/{z}/{x}/{y}.pbf'], minzoom: 13, maxzoom: TILE_MAXZ, bounds: seoul });
  // 바탕 도로 면: OSM 도로 중심선을 등급별 폭(대략 실제 m, 줌 따라 2배씩)으로 그어 도로 면 자료가 빈 곳도 길이 보이게(중앙선만 떠 있는 곳 없앰)
  const roadW = (m) => ['interpolate', ['exponential', 2], ['zoom'], BUILD_Z, m * 0.12, 18, m * 2.6];
  map.addLayer({ id: 'roads-line', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: BUILD_Z,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]], ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#55585D', ['primary', 'secondary'], '#606368', '#787B80'],
      'line-width': ['match', ['get', 'class'], ['motorway', 'trunk'], roadW(24), 'primary', roadW(20), 'secondary', roadW(15), 'tertiary', roadW(11), 'minor', roadW(7), roadW(4)] } }, firstSymbol);
  map.addLayer({ id: 'roads', type: 'fill', source: 'city', 'source-layer': 'r', minzoom: BUILD_Z, paint: {
    'fill-color': ['match', ['get', 'class'], '고속', '#55585D', '간선', '#606368', '#787B80'], 'fill-outline-color': '#4A4D51' } }, firstSymbol); // 아스팔트
  map.addLayer({ id: 'water-depth', type: 'raster', source: 'water-depth', paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, firstSymbol);
  // 예상 피해 지역(시민 유형 생활 공간이 인명 위해 수심에 잠기는 칸): 서울 전체 줌에선 너무 잘아 숨기고, 구를 띄우면(≈ 11.5~) 보임. 건물이 서면 건물 색이 이어받아 옅게
  const zone = await zoneCanvas(colors, gid, water.g, water.b);
  map.addSource('persona-zone', { type: 'canvas', canvas: zone.canvas, coordinates: meta.onset_corners, animate: false });
  const zsrc = map.getSource('persona-zone');
  // ponytail: 줌 단계 3개로 넓힘(z < 12.5 → 2칸, < BUILD_Z → 1칸, 그 위 0). 더 매끈하게는 줌마다 rad 를 연속으로
  const zoneRad = () => (map.getZoom() < 12.5 ? 2 : map.getZoom() < BUILD_Z ? 1 : 0);
  let zoneState = { rain: 0, pick: 0, rad: -1, block: [], only: null }; // pick = 켠 유형 비트, block = 구별 물막이판 몫, only = 고른 구
  const drawZone = (st) => {
    if (['rain', 'pick', 'rad', 'block', 'only'].every((k) => st[k] === zoneState[k])) return false;
    zoneState = st; zone.draw(st.rain, st.pick, st.rad, st.block, barrierH, st.only); return true;
  };
  const redrawZone = (ch) => { if (drawZone({ ...zoneState, ...ch })) { zsrc.play(); map.once('render', () => zsrc.pause()); } };
  map.on('zoomend', () => redrawZone({ rad: zoneRad() }));
  map.addLayer({ id: 'persona-zone', type: 'raster', source: 'persona-zone', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 11.6, 0.85, BUILD_Z, 0.85, BUILD_Z + 0.4, 0.45],
    'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, firstSymbol);

  // 중앙선(OSM 도로 중심선): 큰길 = 노란 겹실선, 중간 길 = 노란 점선. 일방통행(상 · 하행이 따로 그려진 길)은 제외
  const twoWay = ['!', ['in', ['get', 'oneway'], ['literal', [1, -1]]]];
  const onRoad = (cls) => ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', cls]], ['!=', ['get', 'brunnel'], 'tunnel'], twoWay];
  const w = (a, b) => ['interpolate', ['linear'], ['zoom'], BUILD_Z, a, 18, b];
  map.addLayer({ id: 'center-solid', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: BUILD_Z, filter: onRoad(['trunk', 'primary', 'secondary']),
    paint: { 'line-color': '#F2C200', 'line-width': w(0.5, 1.6), 'line-gap-width': w(0.5, 1.8) } }, 'water-depth');
  map.addLayer({ id: 'center-dash', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: BUILD_Z, filter: onRoad(['tertiary']),
    paint: { 'line-color': '#F2C200', 'line-width': w(0.5, 1.6), 'line-dasharray': [4, 3] } }, 'water-depth');

  map.addSource('gu', { type: 'geojson', data: gu, promoteId: 'gi' });
  // 구 색 없음(10/31 승우: 판정은 오른쪽 패널로). 투명 면은 구 클릭 · 구 찾기(queryRenderedFeatures)용으로만 둠
  map.addLayer({ id: 'gu-fill', type: 'fill', source: 'gu', paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, map.getLayer('hillshade') ? 'hillshade' : firstSymbol);
  // 지도 색 = 침수 수심 · 예상 피해 지역 · 대피시설만(10/31 승우: 회복 구역 · 정보 없음 빗금 뺌)
  const sel = ['boolean', ['feature-state', 'selected'], false];
  map.addLayer({ id: 'gu-line', type: 'line', source: 'gu', paint: {
    'line-color': '#8C857A', 'line-width': 0.9 } }, firstSymbol); // 고른 구도 선은 같게(표시는 안쪽 번짐만)

  const guBox = gu.features.map((f) => ({ gn: f.properties.gn, gi: f.properties.gi, b: bboxOf(f.geometry) })); // 구 범위(띄우기 · 걷는 길 불러오기)
  try {
    await addLandmarks3D(map, { partsUrl: BASE + 'data/landmark_parts.geojson' });
    map.setLayerZoomRange('landmark-parts', 12.5, 24);
  } catch (e) { console.info('특이 건물 없이 계속:', e.message); }
  map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'city', 'source-layer': 'b', minzoom: BUILD_Z, paint: {
    'fill-extrusion-color': buildColor(0, null, colors),
    'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': BUILD_OP,
    'fill-extrusion-vertical-gradient': true } }, map.getLayer('landmark-parts') ? 'landmark-parts' : undefined);
  map.on('click', 'buildings', (e) => api.onBuilding?.(e.lngLat)); // 건물 클릭 → 대피 경로 안내 묻기
  map.on('mouseenter', 'buildings', () => { map.getCanvas().style.cursor = 'pointer'; });
  const lgShelter = document.getElementById('lg-shelter'); // 점이 보이는 줌(≥ 11)에서만 범례에
  const shelterLegend = () => { lgShelter.hidden = map.getZoom() < 11; };
  map.on('zoomend', shelterLegend); shelterLegend();

  map.addSource('shelters', { type: 'geojson', data: shelters });
  map.addLayer({ id: 'shelters', type: 'circle', source: 'shelters', minzoom: 11, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 15, 5],
    'circle-color': ['case', ['==', ['get', '침수위험구역포함'], '포함'], '#FFFFFF', '#262626'],
    'circle-stroke-color': ['case', ['==', ['get', '침수위험구역포함'], '포함'], '#8D0022', '#FFFFFF'],
    'circle-stroke-width': ['case', ['==', ['get', '침수위험구역포함'], '포함'], 2, 1] } });

  map.addSource('mountains', { type: 'geojson', data: { type: 'FeatureCollection', features: MOUNTAINS.map(([name, x, y]) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [x, y] } })) } });
  map.addLayer({ id: 'mountains', type: 'symbol', source: 'mountains', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 14, 'text-offset': [0, -0.6] },
    paint: { 'text-color': '#5C5A3C', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4 } });
  map.addLayer({ id: 'gu-label', type: 'symbol', source: 'gu', maxzoom: 13.5, layout: { 'text-field': ['get', 'gn'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 12.5, 12, 16] },
    paint: { 'text-color': '#262626', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 } });

  // 고르기(마우스를 올리면 손가락 커서만, 내용은 클릭 → 오른쪽 패널)
  map.on('mousemove', 'gu-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'gu-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'gu-fill', (e) => { const gi = e.features?.[0]?.properties.gi; if (gi != null && !api.routeMode && map.getZoom() < BUILD_Z) onSelect(gi); }); // 대피 경로 모드 · 건물이 보이는 확대에선 클릭 = 경로

  // 서울 밖은 바탕색으로 덮음(맨 위). 우리 자료는 전부 서울 안
  map.addSource('seoul-mask', { type: 'geojson', data: BASE + 'data/seoul_mask.geojson' });
  map.addLayer({ id: 'seoul-mask', type: 'fill', source: 'seoul-mask', paint: { 'fill-color': '#F2EEE7' } });

  // 고른 구 띄우기: 구로 날아가 기울이고, 선 없이 구 안쪽으로만 크림슨 번짐(line-offset). 다른 구는 흐리게 하지 않음(10/31)
  // 번짐 3겹: 경계에서 가장 진하고(좁게) 안쪽으로 갈수록 넓고 옅게 → 안쪽 그라데이션. [폭, 흐림, 안쪽으로 밀기, 불투명도]
  const GLOW = {};
  [[6, 3, 3, 0.85], [16, 12, 11, 0.45], [30, 24, 26, 0.22]].forEach(([w, bl, off, op], i) => {
    const id = `gu-glow${i}`; GLOW[id] = op;
    map.addLayer({ id, type: 'line', source: 'gu', filter: ['==', ['get', 'gi'], -1], layout: { 'line-join': 'round' },
      paint: { 'line-color': '#8D0022', 'line-width': w, 'line-blur': bl, 'line-offset': off, 'line-opacity': 0, 'line-opacity-transition': { duration: 300 } } }, 'seoul-mask');
  });
  const home = { ...camera, bounds: undefined };
  const back = document.getElementById('mapback');
  const lift = (gi) => {
    // 누르는 즉시 번짐을 새 구로 옮김(끄고 이동 뒤 다시 켜면 깜빡여 보임)
    for (const [id, op] of Object.entries(GLOW)) { map.setFilter(id, ['==', ['get', 'gi'], gi]); map.setPaintProperty(id, 'line-opacity', op); }
    const b = guBox.find((g) => g.gi === gi).b;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, pitch: narrow ? 0 : 52, bearing: map.getBearing(), duration: 1200 });
    back.hidden = false;
  };
  const unlift = () => {
    for (const id of Object.keys(GLOW)) map.setPaintProperty(id, 'line-opacity', 0);
    if (narrow) map.fitBounds(seoul, { padding: 8, pitch: 0, bearing: 0 }); else map.flyTo({ ...home, duration: 1200 });
    back.hidden = true;
    onSelect(null); // 서울 전체로 돌아가면 고른 구도 풂
  };
  back.addEventListener('click', unlift);
  // 서울 밖(구가 없는 곳)을 누르면 서울 전체 보기로
  map.on('click', (e) => { if (!api.routeMode && !map.queryRenderedFeatures(e.point, { layers: ['gu-fill'] }).length) unlift(); });

  let selected = null;
  const api = {
    map, routeMode: false, base: BASE, guBox, shelters,
    water: { deep: water.deep, w: water.w, h: water.h, corners: meta.onset_corners },
    /** pick = 예상 피해 지역을 켠 시민 유형 비트(0 = 끔). 강우 · 켠 유형 · 양수기 · 물막이판이 바뀔 때만 부름.
     *  pumpL[gi] = model pumpLevelCm, block[gi] = model barrierShare(구별, null = 효과 없음). */
    setRain(r, pick = 0, pumpL = [], block = []) {
      water.draw(r, pumpL); drawZone({ rain: r, pick, rad: zoneRad(), block, only: selected });
      wsrc.play(); zsrc.play();
      map.once('render', () => { wsrc.pause(); zsrc.pause(); });
      map.setPaintProperty('buildings', 'fill-extrusion-color', buildColor(r, pick, colors));
    },
    /** fly = 사용자가 고름 → 그 구로 날아가 띄움. 처음 그릴 때는 표시만. */
    setSelected(gi, fly = false) {
      if (selected != null) map.setFeatureState({ source: 'gu', id: selected }, { selected: false });
      selected = gi;
      if (gi != null) map.setFeatureState({ source: 'gu', id: gi }, { selected: true });
      redrawZone({ only: gi }); // 예상 피해 지역 = 고른 구 칸만(없으면 서울 전체)
      if (fly) lift(gi);
    },
  };
  return api;
}

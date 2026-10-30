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

/** flood_onset.png → 강우마다 다시 칠하는 canvas. R/G/B = 0.15/0.30/0.50 m 에 처음 닿는 실제 강우, 255 = 안 닿음, A 0 = 바깥. */
async function waterCanvas() {
  const blob = await (await fetch(BASE + 'data/flood_onset.png')).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const src = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
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
    canvas, deep, w: bmp.width, h: bmp.height,
    draw(rain) {
      out.fill(0);
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        out[i] = b[i] <= rain ? WATER[0] : g[i] <= rain ? WATER[1] : r[i] <= rain ? WATER[2] : 0;
      }
      ctx.putImageData(img, 0, 0);
    },
  };
}

/** persona_onset_a/b.png(R G B = 시민 유형 0 1 2 / 3 4 5) → 예상 피해 지역 canvas. 칸값 = 그 유형 생활 공간이 인명 위해 수심에 처음 닿는 강우, 255 = 아님 · 안 닿음.
 *  draw(rain, mask, rad): mask = 켠 유형 비트(1 << p), 0 = 아무것도 안 그림. 칸에 켠 유형이 여럿이면 먼저 잠기는 유형(같으면 앞 번호).
 *  rad = 칸을 사방 rad 칸 넓혀 칠함(구 전체 줌에서 20 m 칸이 1 px 아래로 사라지지 않게 — 표시용, 판정은 칸 그대로). */
async function zoneCanvas(colors) {
  const px = await Promise.all(['a', 'b'].map(async (k) => {
    const bmp = await createImageBitmap(await (await fetch(`${BASE}data/persona_onset_${k}.png`)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    return x.getImageData(0, 0, bmp.width, bmp.height);
  }));
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
  return {
    canvas,
    draw(rain, mask, rad = 0) {
      out.fill(0);
      for (let k = 0; mask && k < idx.length; k++) {
        const i = idx[k];
        let b = 255, bp = -1;
        for (let p = 0; p < 6; p++) if ((mask >> p) & 1 && on[p][i] < b) { b = on[p][i]; bp = p; }
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

function hatch() {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d');
  x.strokeStyle = '#262626'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, 8); x.lineTo(8, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
  return x.getImageData(0, 0, 8, 8);
}

const bboxOf = (geom) => {
  const b = [180, 90, -180, -90];
  const walk = (a) => (typeof a[0] === 'number' ? (b[0] = Math.min(b[0], a[0]), b[1] = Math.min(b[1], a[1]), b[2] = Math.max(b[2], a[0]), b[3] = Math.max(b[3], a[1])) : a.forEach(walk));
  walk(geom.coordinates);
  return b;
};

/**
 * createMap({ container, meta, noInfo: Set<gi>, onSelect(gi), view? })
* colors = 시민 유형 6색(panels TWIN_COLORS → M.persona[].color)
 * → Promise<{ map, setRain(r, zoneMask), setClass(clsByGi), setHatch(gis), setSelected(gi) }>
 */
export async function createMap({ container, meta, noInfo, onSelect, view, colors }) {
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
    localIdeographFontFamily: '"SeoulNamsan", "Malgun Gothic", sans-serif', attributionControl: { compact: true },
    cooperativeGestures: narrow, preserveDrawingBuffer: new URLSearchParams(location.search).has('shot'),
    locale: { 'CooperativeGesturesHandler.MobileHelpText': '지도는 두 손가락으로 움직입니다', 'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + 스크롤로 확대 · 축소', 'CooperativeGesturesHandler.MacHelpText': '⌘ + 스크롤로 확대 · 축소' },
  });
  if (view) map.jumpTo(view);
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
  const water = await waterCanvas();
  water.draw(0);
  map.addSource('water-depth', { type: 'canvas', canvas: water.canvas, coordinates: meta.onset_corners, animate: false });
  const wsrc = map.getSource('water-depth');

  // 건물 · 도로: 정적 벡터 타일(prep/build_tiles.mjs, 레이어 b = 건물 · r = 도로) — 화면에 걸친 칸만 작업자가 받아 그림
  map.addSource('city', { type: 'vector', tiles: [BASE + 'data/tiles/{z}/{x}/{y}.pbf'], minzoom: 13, maxzoom: TILE_MAXZ, bounds: seoul });
  map.addLayer({ id: 'roads', type: 'fill', source: 'city', 'source-layer': 'r', minzoom: BUILD_Z, paint: {
    'fill-color': ['match', ['get', 'class'], '고속', '#55585D', '간선', '#606368', '#787B80'], 'fill-outline-color': '#4A4D51' } }, firstSymbol); // 아스팔트
  map.addLayer({ id: 'water-depth', type: 'raster', source: 'water-depth', paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, firstSymbol);
  // 예상 피해 지역(시민 유형 생활 공간이 인명 위해 수심에 잠기는 칸): 서울 전체 줌에선 너무 잘아 숨기고, 구를 띄우면(≈ 11.5~) 보임. 건물이 서면 건물 색이 이어받아 옅게
  const zone = await zoneCanvas(colors);
  map.addSource('persona-zone', { type: 'canvas', canvas: zone.canvas, coordinates: meta.onset_corners, animate: false });
  const zsrc = map.getSource('persona-zone');
  // ponytail: 줌 단계 3개로 넓힘(z < 12.5 → 2칸, < BUILD_Z → 1칸, 그 위 0). 더 매끈하게는 줌마다 rad 를 연속으로
  const zoneRad = () => (map.getZoom() < 12.5 ? 2 : map.getZoom() < BUILD_Z ? 1 : 0);
  let zoneState = { rain: 0, pick: 0, rad: -1 }; // pick = 켠 유형 비트
  const drawZone = (st) => {
    if (st.rain === zoneState.rain && st.pick === zoneState.pick && st.rad === zoneState.rad) return false;
    zoneState = st; zone.draw(st.rain, st.pick, st.rad); return true;
  };
  map.on('zoomend', () => { if (drawZone({ ...zoneState, rad: zoneRad() })) { zsrc.play(); map.once('render', () => zsrc.pause()); } });
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

  map.addImage('hatch', hatch());
  map.addSource('gu', { type: 'geojson', data: gu, promoteId: 'gi' });
  // 구 색 = 가장 급한 시민 유형의 '대피 경보까지 남은 시간' 등급(app.js alertClass): 0 대피 시간 부족 · 1 ≤15분 · 2 15~25 · 3 25~35 · 4 >35 · 5 위험 없음
  const cls = ['coalesce', ['feature-state', 'cls'], 5];
  const op = (k) => ['match', cls, 0, 0.70 * k, 1, 0.55 * k, 2, 0.40 * k, 3, 0.25 * k, 4, 0.12 * k, 0];
  // 지형 음영 · OSM 물 아래에 깔아 색이 지형과 섞이고, 침수 물(0.85)은 그 위
  map.addLayer({ id: 'gu-fill', type: 'fill', source: 'gu', paint: {
    'fill-color': '#8D0022', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, op(1), 13.5, op(0.25)] } }, map.getLayer('hillshade') ? 'hillshade' : firstSymbol);
  // 회복 구역: 켠 대응 자원으로 위험 인원이 줄어든 비율(0~1) → 초록. 자원이 다 꺼지면 안 보임
  map.addLayer({ id: 'gu-recover', type: 'fill', source: 'gu', paint: {
    'fill-color': '#2E7D4F', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, ['*', 0.65, ['coalesce', ['feature-state', 'rec'], 0]], 13.5, ['*', 0.25, ['coalesce', ['feature-state', 'rec'], 0]]] } }, firstSymbol);
  map.addLayer({ id: 'gu-hatch', type: 'fill', source: 'gu', filter: ['in', ['get', 'gi'], ['literal', [...noInfo]]],
    paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.15 } }, firstSymbol);
  const sel = ['boolean', ['feature-state', 'selected'], false];
  map.addLayer({ id: 'gu-line', type: 'line', source: 'gu', paint: {
    'line-color': ['case', sel, '#8D0022', '#8C857A'], 'line-width': ['case', sel, 2.6, 0.9] } }, firstSymbol);

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
  map.addLayer({ id: 'mountains', type: 'symbol', source: 'mountains', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, -0.6] },
    paint: { 'text-color': '#5C5A3C', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4 } });
  map.addLayer({ id: 'gu-label', type: 'symbol', source: 'gu', maxzoom: 13.5, layout: { 'text-field': ['get', 'gn'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 10.5, 12, 14] },
    paint: { 'text-color': '#262626', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 } });

  // 고르기(마우스를 올리면 손가락 커서만, 내용은 클릭 → 오른쪽 패널)
  map.on('mousemove', 'gu-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'gu-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'gu-fill', (e) => { const gi = e.features?.[0]?.properties.gi; if (gi != null && !api.routeMode && map.getZoom() < BUILD_Z) onSelect(gi); }); // 대피 경로 모드 · 건물이 보이는 확대에선 클릭 = 경로

  // 서울 밖은 바탕색으로 덮음(맨 위). 우리 자료는 전부 서울 안
  map.addSource('seoul-mask', { type: 'geojson', data: BASE + 'data/seoul_mask.geojson' });
  map.addLayer({ id: 'seoul-mask', type: 'fill', source: 'seoul-mask', paint: { 'fill-color': '#F2EEE7' } });

  // 고른 구 띄우기: 구로 날아가 기울이고, 테두리에 은은한 빛(번진 선)을 두르고, 다른 구는 흐리게
  map.addLayer({ id: 'gu-dim', type: 'fill', source: 'gu', filter: ['==', ['get', 'gi'], -1],
    paint: { 'fill-color': '#F2EEE7', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 700 } } }, 'seoul-mask');
  const glow = (id, width, blur, op) => map.addLayer({ id, type: 'line', source: 'gu', filter: ['==', ['get', 'gi'], -1], layout: { 'line-join': 'round' },
    paint: { 'line-color': '#8D0022', 'line-width': width, 'line-blur': blur, 'line-opacity': 0, 'line-opacity-transition': { duration: 900 } } }, 'seoul-mask');
  glow('gu-glow', 18, 14, 0.35);
  glow('gu-edge', 3, 0, 0.95);
  const GLOW = { 'gu-glow': 0.35, 'gu-edge': 0.95 };
  const home = { ...camera, bounds: undefined };
  const back = document.getElementById('mapback');
  const lift = (gi) => {
    for (const id of Object.keys(GLOW)) { map.setFilter(id, ['==', ['get', 'gi'], gi]); map.setPaintProperty(id, 'line-opacity', 0); }
    map.setFilter('gu-dim', ['!=', ['get', 'gi'], gi]);
    map.setPaintProperty('gu-dim', 'fill-opacity', 0.65);
    const b = guBox.find((g) => g.gi === gi).b;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, pitch: narrow ? 0 : 52, bearing: map.getBearing(), duration: 1200 });
    map.once('moveend', () => { for (const [id, op] of Object.entries(GLOW)) map.setPaintProperty(id, 'line-opacity', op); });
    back.hidden = false;
  };
  const unlift = () => {
    for (const id of Object.keys(GLOW)) map.setPaintProperty(id, 'line-opacity', 0);
    map.setPaintProperty('gu-dim', 'fill-opacity', 0);
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
    /** pick = 예상 피해 지역을 켠 시민 유형 비트(0 = 끔). 강우 · 켠 유형이 바뀔 때만 부름. */
    setRain(r, pick = 0) {
      water.draw(r); drawZone({ rain: r, pick, rad: zoneRad() });
      wsrc.play(); zsrc.play();
      map.once('render', () => { wsrc.pause(); zsrc.pause(); });
      map.setPaintProperty('buildings', 'fill-extrusion-color', buildColor(r, pick, colors));
    },
    setClass(cl) { cl.forEach((c, gi) => map.setFeatureState({ source: 'gu', id: gi }, { cls: c })); },
    setRecover(share) { share.forEach((v, gi) => map.setFeatureState({ source: 'gu', id: gi }, { rec: v })); },
    /** 빗금 = 지금 보는 자원이 '정보 없음'인 구. */
    setHatch(gis) { map.setFilter('gu-hatch', ['in', ['get', 'gi'], ['literal', gis]]); },
    /** fly = 사용자가 고름 → 그 구로 날아가 띄움. 처음 그릴 때는 표시만. */
    setSelected(gi, fly = false) {
      if (selected != null) map.setFeatureState({ source: 'gu', id: selected }, { selected: false });
      selected = gi;
      if (gi != null) map.setFeatureState({ source: 'gu', id: gi }, { selected: true });
      if (fly) lift(gi);
    },
  };
  return api;
}

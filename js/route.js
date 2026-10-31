// 대피 경로: 지도에 핀을 찍으면 잠긴 길(0.3 m 이상 = 인명 위해 수심)과 계단을 피해 가장 가까운 대피시설까지 걷는 길.
// 길 = OpenStreetMap 걷는 길(web/data/walk/{구}.json, prep/fetch_walk.py). 강우가 바뀌면 다시 찾음.
import { BUILD_OP } from './map.js?v=9bb3c60';
export const SPEED = [0.47, 0.47, 0.65, 0.65, 0.65, 0.65]; // m/s, 시민 유형 순서 — model.json evac.speed_ms 와 같음(동일본대지진 도보 대피 실측, prep/persona.py)
const M_LAT = 110540, MAX_M = 6000, NEAR = 0.03;      // 위도 1° ≈ m, 6 km 넘으면 포기, 핀 주변 약 3 km 구만 불러옴

const dist = (x1, y1, x2, y2) => { const k = Math.cos((y1 * Math.PI) / 180) * 111320; return Math.hypot((x2 - x1) * k, (y2 - y1) * M_LAT); };

/** 이진 힙(최소). [거리, 노드] */
class Heap {
  constructor() { this.a = []; }
  push(d, v) { const a = this.a; a.push([d, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * initRoute({ map, base, guBox, shelters, water: {deep, w, h, corners}, getGu(lngLat) → gi | null, persona, getAlert(gi, p), getRain() })
 * → { toggle(on), update() }
 */
export function initRoute({ map, base, guBox, shelters, water, getGu, persona, getAlert, getRain }) {
  // 걷는 길 그래프(불러온 구를 노드 id 로 합침)
  const X = [], Y = [], adj = [], key = new Map(), loaded = new Map();
  const [tl, , br] = water.corners;
  const onsetAt = (x, y) => { // 그 자리가 0.3 m 에 처음 닿는 강우(255 = 안 닿음)
    const px = Math.floor(((x - tl[0]) / (br[0] - tl[0])) * water.w), py = Math.floor(((tl[1] - y) / (tl[1] - br[1])) * water.h);
    return px < 0 || py < 0 || px >= water.w || py >= water.h ? 255 : water.deep[py * water.w + px];
  };
  const grid = new Map(), G = 0.002; // 가까운 노드 찾기용 격자(약 200 m)
  const gk = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  const add = (data) => {
    const local = data.id.map((id, i) => {
      if (key.has(id)) return key.get(id);
      const v = X.length; key.set(id, v); X.push(data.c[2 * i]); Y.push(data.c[2 * i + 1]); adj.push([]);
      const k = gk(X[v], Y[v]); (grid.get(k) ?? grid.set(k, []).get(k)).push(v);
      return v;
    });
    const steps = new Set(data.s);
    data.w.forEach((way, wi) => {
      for (let j = 1; j < way.length; j++) {
        const a = local[way[j - 1]], b = local[way[j]], len = dist(X[a], Y[a], X[b], Y[b]);
        let on = 255; // 길 위 약 10 m 간격으로 가장 먼저 잠기는 강우
        const n = Math.max(1, Math.ceil(len / 10));
        for (let s = 0; s <= n; s++) on = Math.min(on, onsetAt(X[a] + ((X[b] - X[a]) * s) / n, Y[a] + ((Y[b] - Y[a]) * s) / n));
        const e = { a, b, len, on, st: steps.has(wi) };
        adj[a].push(e); adj[b].push(e);
      }
    });
  };
  const ensure = (x, y) => Promise.all(guBox.filter((g) => g.b[0] - NEAR < x && x < g.b[2] + NEAR && g.b[1] - NEAR < y && y < g.b[3] + NEAR).map((g) => {
    if (!loaded.has(g.gi)) loaded.set(g.gi, fetch(`${base}data/walk/${encodeURIComponent(g.gn)}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => d && add(d)).catch(() => loaded.delete(g.gi)));
    return loaded.get(g.gi);
  }));
  const nearest = (x, y, ok = () => true) => {
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 2 && best < 0; r++) { // 격자 3×3 → 5×5
      const cx = Math.floor(x / G), cy = Math.floor(y / G);
      for (let i = -r - 1; i <= r + 1; i++) for (let j = -r - 1; j <= r + 1; j++) for (const v of grid.get(`${cx + i},${cy + j}`) ?? []) {
        if (!ok(v)) continue;
        const d = dist(x, y, X[v], Y[v]); if (d < bd) { bd = d; best = v; }
      }
    }
    return best < 0 ? null : { v: best, d: bd };
  };

  // 지도 층
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 17, 15] } }, 'seoul-mask');
  map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2E7D4F', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4.5, 17, 10] } }, 'seoul-mask');
  // 길 안내처럼: 선 위에 진행 방향 흰 화살표
  const arrow = document.createElement('canvas'); arrow.width = arrow.height = 24;
  { const c = arrow.getContext('2d'); c.strokeStyle = '#fff'; c.lineWidth = 3.5; c.lineCap = c.lineJoin = 'round'; c.beginPath(); c.moveTo(8, 5); c.lineTo(16, 12); c.lineTo(8, 19); c.stroke(); }
  map.addImage('route-arrow', arrow.getContext('2d').getImageData(0, 0, 24, 24), { pixelRatio: 2 });
  map.addLayer({ id: 'route-arrow', type: 'symbol', source: 'route', layout: { 'symbol-placement': 'line', 'symbol-spacing': 50, 'icon-image': 'route-arrow',
    'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, 'seoul-mask');
  map.moveLayer('seoul-mask'); // 가리개는 계속 맨 위
  const tag = (text, cls) => { const el = document.createElement('div'); el.className = `navtag ${cls}`; el.textContent = text; return el; };
  const pin = new maplibregl.Marker({ element: tag('출발', 'from'), anchor: 'bottom' });
  const goal = new maplibregl.Marker({ element: tag('도착', 'to'), anchor: 'bottom' });
  const card = document.getElementById('route-card'), btn = document.getElementById('route-btn');
  let on = false, start = null, timer = 0;

  async function solve(fit = false) {
    if (!start) return;
    const [x, y] = start, rain = getRain();
    // 폰(≤700): 유형별 표는 접어 둠(펼치면 지도를 70 % 가림, 10/31 승우). 다시 그릴 때는 펼친 상태 유지
    const more = card.querySelector('.rc-more'), moreOpen = more ? more.open : !matchMedia('(max-width: 700px)').matches;
    card.hidden = false; card.innerHTML = '<p class="rc-h">대피 경로 찾는 중…</p>';
    await ensure(x, y);
    const sv = shelters.features.map((f) => ({ f, n: nearest(...f.geometry.coordinates) })).filter((s) => s.n && s.n.d < 150);
    const goalOf = new Map(sv.map((s) => [s.n.v, s.f]));
    const open = (e) => !e.st && e.on > rain; // 계단 · 잠긴 길 제외
    const s0 = nearest(x, y, (v) => adj[v].some(open));
    const gi = getGu(start), startWet = onsetAt(x, y) <= rain;
    let found = null; const D = new Map(), prev = new Map();
    if (s0) {
      const h = new Heap(); D.set(s0.v, s0.d); h.push(s0.d, s0.v);
      while (h.size) {
        const [d, v] = h.pop();
        if (d > D.get(v)) continue;
        if (goalOf.has(v)) { found = v; break; }
        if (d > MAX_M) break;
        for (const e of adj[v]) {
          if (!open(e)) continue;
          const u = e.a === v ? e.b : e.a, nd = d + e.len;
          if (nd < (D.get(u) ?? Infinity)) { D.set(u, nd); prev.set(u, v); h.push(nd, u); }
        }
      }
    }
    if (found == null) {
      map.getSource('route').setData({ type: 'FeatureCollection', features: [] }); goal.remove();
      card.innerHTML = `<button type="button" class="rc-x" aria-label="경로 지우기">✕</button><p class="rc-h">도달 가능한 대피시설 없음</p><p class="rc-s">${sv.length ? '주변 도로가 침수되었거나 6 km 이내에 대피시설이 없습니다' : '이 지역은 대피시설 정보가 없습니다'}</p>`;
      return;
    }
    const line = [[x, y]]; for (let v = found; v != null; v = prev.get(v)) line.splice(1, 0, [X[v], Y[v]]);
    const f = goalOf.get(found), m = D.get(found);
    line.push(f.geometry.coordinates);
    map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
    goal.setLngLat(f.geometry.coordinates).addTo(map);
    if (fit) { // 새 경로: 경로 전체가 보이게(오른쪽 아래 카드 자리는 비움)
      const xs = line.map((c) => c[0]), ys = line.map((c) => c[1]);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: matchMedia('(max-width: 1180px)').matches ? { top: 40, left: 30, right: 30, bottom: Math.round(map.getContainer().clientHeight * (moreOpen ? 0.55 : 0.35)) } : { top: 80, left: 60, right: 60, bottom: 260 }, pitch: 30, maxZoom: 17, duration: 1000 });
    }
    const n = { ok: 0, no: 0 };
    const rows = persona.map((pp, p) => {
      const min = m / SPEED[p] / 60, a = gi == null ? null : getAlert(gi, p);
      // 대피 가능 여부 = 꼬리표(대피 가능 · 대피 곤란 · 대피 불필요) + 인명 피해까지 남는/넘는 분
      if (a?.toDanger != null) n[min <= a.toDanger ? 'ok' : 'no']++;
      const verdict = a?.toDanger == null ? '<span class="tag na">대피 불필요</span>'
        : min <= a.toDanger ? `<span class="tag ok">대피 가능</span><small>여유 ${Math.round(a.toDanger - min)}분</small>` : `<span class="tag no">대피 곤란</span><small>${Math.round(min - a.toDanger)}분 초과</small>`;
      return `<tr><td><span class="pn"><i class="chip" style="background:${pp.color}"></i>${pp.name}</span></td><td class="v">${Math.max(1, Math.round(min))}분</td><td><span class="vd">${verdict}</span></td></tr>`;
    }).join('');
    const p = f.properties, cap = p.수용인원명 != null ? `${Math.round(p.수용인원명).toLocaleString('ko-KR')}명` : '–';
    card.innerHTML = `<button type="button" class="rc-x" aria-label="경로 지우기">✕</button><p class="rc-k">가장 가까운 대피시설</p><p class="rc-h">${p.시설명}</p>
      <dl class="rc-f"><div><dt>거리</dt><dd>${(m / 1000).toFixed(2)} km</dd></div><div><dt>수용 인원</dt><dd>${cap}</dd></div><div><dt>위치</dt><dd>${p.자치구} ${p.행정동}</dd></div></dl>
      ${startWet ? '<p class="rc-w">출발 위치가 침수 중입니다</p>' : ''}<details class="rc-more"${moreOpen ? ' open' : ''}><summary>시민 유형별 대피 가능 여부 <span>${n.ok + n.no ? `${n.no ? `<b class="no">곤란 ${n.no}</b> ` : ''}${n.ok ? `<b class="ok">가능 ${n.ok}</b>` : ''}` : '대피 불필요'}</span></summary>
      <table><thead><tr><th>시민 유형</th><th class="v">도보 시간</th><th>대피 가능 여부</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }

  // 경로를 보는 동안 3D 건물을 반투명하게(지형 위 선은 건물에 가려지므로)
  const ghost = (v) => map.getLayer('buildings') && map.setPaintProperty('buildings', 'fill-extrusion-opacity', v ? 0.3 : BUILD_OP);
  const go = (ll) => { ghost(true); start = [ll.lng, ll.lat]; pin.setLngLat(start).addTo(map); solve(true); };
  const clear = () => { ghost(false); start = null; pin.remove(); goal.remove(); card.hidden = true; map.getSource('route').setData({ type: 'FeatureCollection', features: [] }); };
  map.on('click', (e) => { if (on) go(e.lngLat); });
  card.addEventListener('click', (e) => { if (e.target.closest('.rc-x')) clear(); });

  // 건물 클릭 → "대피 경로로 안내할까요?" → 안내 = 그 건물에서 가장 가까운 대피시설
  const ask = new maplibregl.Popup({ closeButton: false, maxWidth: '240px', className: 'askpop', offset: 6 });
  const offer = (ll) => {
    if (on) return; // 경로 모드에선 바로 핀
    const el = document.createElement('div');
    el.innerHTML = '<p>이 건물에서 가장 가까운 대피시설로 안내할까요?</p><div class="ask-b"><button type="button" class="go">안내</button><button type="button" class="no">취소</button></div>';
    el.querySelector('.go').addEventListener('click', () => { ask.remove(); go(ll); });
    el.querySelector('.no').addEventListener('click', () => ask.remove());
    ask.setLngLat(ll).setDOMContent(el).addTo(map);
    el.querySelector('.go').focus();
  };

  const toggle = (v = !on) => {
    on = v; btn.setAttribute('aria-pressed', String(on)); map.getCanvas().style.cursor = on ? 'crosshair' : '';
    btn.textContent = on ? '대피 경로 끄기' : '대피 경로';
    if (!on) clear();
  };
  btn.hidden = false;
  btn.addEventListener('click', () => toggle());
  return {
    get on() { return on; },
    offer,
    toggle,
    /** 강우 · 대피 판단이 바뀌면 다시 찾기(슬라이더를 끄는 동안 너무 자주 안 돌게 150 ms 모음). */
    update() { if (start) { clearTimeout(timer); timer = setTimeout(solve, 150); } },
  };
}

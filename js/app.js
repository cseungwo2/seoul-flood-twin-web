// 상태 S 하나를 슬라이더 · 지도 · 패널이 같이 봄. 슬라이더 → rAF 로 한 번에 갱신(ARSM 곡선 포함).
import { alert, barrierShare, demand, pumpLevelCm, recovered } from './model.js';
import { createMap } from './map.js';
import { initPanels } from './panels.js';
import { createRain } from './rain.js';
import { initRoute } from './route.js';
import { initWeather } from './weather.js';

const [M, meta] = await Promise.all(['data/model.json', 'data/meta.json'].map((u) => fetch(u).then((r) => r.json())));
const Q = new URLSearchParams(location.search);
const S = { rain: Q.has('rain') ? Math.max(0, Math.min(174, +Q.get('rain') || 0)) : 100,
  mult: { shelter: 0, barrier: 0, pump: 0, volunteers: 0 }, zone: 0 }; // zone = 지도에 예상 피해 지역을 켠 시민 유형 비트(1 << p, 처음엔 모두 끔) // 처음엔 대응 자원 전부 꺼짐(포스터 값)
let sel = Q.has('gu') && M.gn.includes(Q.get('gu')) ? M.gn.indexOf(Q.get('gu')) : null; // 처음엔 서울 전체(고른 구 없음)
const VIEWS = { yeouido: { center: [126.9375, 37.5218], zoom: 15, pitch: 62, bearing: -25 } };

let A = [];      // A[gi][p] = alert()
let status = []; // 구별 가장 급한 상태 late | now | safe (KPI)
let worst = [];  // 구별 가장 급한 시민 유형 index(없으면 null) — 거주 적은 유형은 판정 제외
const computeAlerts = () => {
  A = M.gn.map((_, gi) => M.persona.map((_, p) => alert(M, S, gi, p)));
  worst = A.map((row, gi) => row.reduce((w, a, p) => (M.low[gi][p] || a.status === 'safe' || (w != null && row[w].alertIn <= a.alertIn) ? w : p), null));
  status = worst.map((p, gi) => (p == null ? 'safe' : A[gi][p].status));
};

const panels = initPanels({ M, S, sel, onChange: () => schedule(), onSelect: (gi) => select(gi) });
// 상단 실시간 날씨: '실제 강우 적용' = 지난 1시간 강수를 강우 슬라이더에(0~174)
initWeather((mm) => { const el = document.getElementById('s-rain'); el.value = Math.max(0, Math.min(174, Math.round(mm))); el.dispatchEvent(new Event('input')); });
let twin = null;   // 지도는 없어도 됨: 패널 · 지표 · 문장은 model.json 만으로 먼저 그림
const rainFx = createRain(document.getElementById('rain'));

// 패널 폭 손잡이: 끌기 · ← → 키. 폭 = 200 px ~ 화면 45 %
const grid = document.querySelector('.grid');
const setW = (side, w) => grid.style.setProperty(side === 'left' ? '--lw' : '--rw', `${Math.max(200, Math.min(w, innerWidth * 0.45))}px`);
for (const g of document.querySelectorAll('.gutter')) {
  const side = g.dataset.side, panel = document.querySelector(`.panel.${side}`), fold = g.querySelector('.fold');
  const arrow = (open) => (side === 'left') === open ? '‹' : '›';
  let keep = '';
  fold.addEventListener('click', () => {
    const open = panel.classList.toggle('folded') === false;
    if (open) grid.style.setProperty(side === 'left' ? '--lw' : '--rw', keep); else { keep = `${panel.offsetWidth || 296}px`; grid.style.setProperty(side === 'left' ? '--lw' : '--rw', '0px'); }
    fold.textContent = arrow(open);
    fold.setAttribute('aria-label', `${side === 'left' ? '왼쪽' : '오른쪽'} 패널 ${open ? '접기' : '펴기'}`);
  });
  g.addEventListener('pointerdown', (e) => {
    if (e.target === fold || panel.classList.contains('folded')) return;
    g.setPointerCapture(e.pointerId); g.classList.add('drag');
    const r = grid.getBoundingClientRect();
    g.onpointermove = (ev) => setW(side, side === 'left' ? ev.clientX - r.left - 16 - 5 : r.right - 16 - 5 - ev.clientX);
  });
  g.addEventListener('pointerup', () => { g.onpointermove = null; g.classList.remove('drag'); });
  g.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
    if (d) { e.preventDefault(); setW(side, panel.offsetWidth + (side === 'left' ? d : -d)); }
  });
}

let lastPaint = '', frame = 0, REC = [], route = null;
function render() {
  frame = 0;
  computeAlerts();
  rainFx.set(S.rain);
  route?.update();
  // 물 · 예상 피해 지역은 강우 · 켠 유형 · 양수기 · 물막이판이 바뀔 때만 다시 칠함(한 번 ≈ 수십 ms)
  const paint = `${S.rain}|${S.zone}|${S.mult.pump}|${S.mult.barrier}`;
  if (twin && paint !== lastPaint) {
    lastPaint = paint;
    twin.setRain(S.rain, S.zone, M.gn.map((_, gi) => pumpLevelCm(M, S, gi)), M.gn.map((_, gi) => barrierShare(M, S, gi)));
    zoneLegend();
  }
  let people = 0, saved = 0;
  REC = M.gn.map((_, gi) => recovered(M, S, gi));
  for (let gi = 0; gi < M.gn.length; gi++) { for (const d of demand(M, S, gi)) people += d; saved += REC[gi].saved; }
  panels.kpi({ rain: S.rain, alertN: status.filter((s) => s !== 'safe').length, lateN: status.filter((s) => s === 'late').length, people, saved });
  showSel(); // 6곡선 계산 ≈ 1 ms → 늦추지 않고 매번 다시 그림
}
function showSel() {
  panels.pick(sel == null);
  if (sel != null) { panels.gu(sel, A[sel]); panels.arsm(sel); }
}
function zoneLegend() {
  const ps = M.persona.filter((_, p) => (S.zone >> p) & 1), el = document.getElementById('lg-zone');
  el.hidden = document.getElementById('lg-zone-h').hidden = !ps.length; // 켠 유형이 없으면 범례도 숨김
  if (!ps.length) return;
  el.querySelector('.sw').style.background = ps.length === 1 ? ps[0].color : `linear-gradient(90deg, ${ps.map((q) => q.color).join(', ')})`;
  el.querySelector('span').textContent = `예상 피해 지역(${ps.length > 2 ? `${ps.length}개 시민 유형` : ps.map((q) => q.name).join(' · ')})`; // 셋 이상이면 개수만(범례가 길어지지 않게)
}
function schedule() { if (!frame) frame = requestAnimationFrame(render); }
/** gi = null → 고른 구 없음(서울 전체). */
function select(gi) {
  sel = gi;
  twin?.setSelected(gi, gi != null);
  showSel();
}
render();
try {
  twin = await createMap({ container: 'map', meta, view: VIEWS[Q.get('view')], colors: M.persona.map((p) => p.color), barrierH: M.res.barrier_h, onSelect: (gi) => select(gi) });
  twin.setSelected(sel);
  try {
    route = initRoute({ map: twin.map, base: twin.base, guBox: twin.guBox, shelters: twin.shelters, water: twin.water, persona: M.persona, getRain: () => S.rain,
      getAlert: (gi, p) => A[gi][p],
      getGu: ([x, y]) => twin.map.queryRenderedFeatures(twin.map.project([x, y]), { layers: ['gu-fill'] })[0]?.properties.gi ?? null });
    const syncMode = () => { twin.routeMode = route.on; };
    twin.onBuilding = route.offer;
    document.getElementById('route-btn').addEventListener('click', syncMode);
  } catch (e) { console.info('대피 경로 없이 계속:', e.message); }
  render();
  if (!matchMedia('(max-width: 860px)').matches) document.getElementById('legend').open = true; // 휴대폰은 접힌 채 시작
} catch (e) {
  console.info('지도 없이 계속:', e.message);
  document.getElementById('mapfail').hidden = false;
  document.getElementById('legend').hidden = true;
}
window.twin = { M, S, map: twin?.map, ready: true }; // 확인용(스크린샷 · 수치 대조)

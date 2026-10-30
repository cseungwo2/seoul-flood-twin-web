// 패널: 왼쪽 슬라이더 · 위 지표 줄 · 오른쪽 선택 구(경보 문장 + 위험 인원 막대 · ARSM 곡선).
import { sentence, demand, arsmCurve, lifeShown } from './model.js';

export const RES = [
  { k: 'shelter', f: 'shelter_cap', name: '대피시설 수용 인원', short: '대피시설', unit: '명' },
  { k: 'barrier', f: 'barrier_n', name: '물막이판', short: '물막이판', unit: '개소' },
  { k: 'pump', f: 'pump_lpm', name: '이동식 양수기', short: '이동식 양수기', unit: 'L/min' },
  { k: 'volunteers', f: 'volunteers', name: '의용소방대 · 자율방재단', short: '의용소방대 · 자율방재단', unit: '명' },
];
export const STATUS_WORD = { late: '즉시 대피', now: '대피 권고', safe: '해당 없음' };
export const RANK = { late: 2, now: 1, safe: 0 };
const Y_TICKS = [0.1, 0.5, 1, 2, 5, 10, 100];
const Y_LO = 0.1, Y_HI = 100; // 이 밖의 값은 축 끝에 붙임(0 = 바닥, 100 이상 = 천장)
// 트윈 전용 시민 유형 색(포스터와 다름): 한 그래프에 6선이 겹쳐도 구분되게 색각 검사(dataviz validator) 통과한 조합
const TWIN_COLORS = ['#b5175e', '#e0592a', '#1baf7a', '#eda100', '#8e5ac8', '#8b5a00']; // 파랑 없음: 침수 수심(파랑)과 안 겹치게(10/31)
// 축 끝에 붙은 선끼리 겹치지 않게 유형마다 살짝 위아래로 띄움(로그 눈금에서 배수)
const NUDGE = [0, 1, 2, 3, 4, 5].map((p) => 1.07 ** (p - 2.5));
const $ = (id) => document.getElementById(id);
const fmt = (x) => Math.round(x).toLocaleString('ko-KR');
export const pct = (x) => `${x.toFixed(1)} %`;
/** 잠깐 떴다가 2초 뒤 저절로 사라지는 알림. */
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

Chart.defaults.font.family = '"SeoulNamsan", "Malgun Gothic", sans-serif';
Chart.defaults.font.weight = 500;
Chart.defaults.font.size = 14;
Chart.defaults.color = '#5E5A54';
Chart.defaults.animation = false;

// y < 1 옅은 띠 + y = 1 '안전 마진 소진' 가로선 + 지금 강우 세로선 + '인명 위해 인원 0명'
const guides = {
  id: 'guides',
  beforeDatasetsDraw(ch) {
    const { ctx, chartArea: a, scales: { y } } = ch, py = y.getPixelForValue(1);
    ctx.save(); ctx.fillStyle = 'rgba(141, 0, 34, 0.05)'; ctx.fillRect(a.left, py, a.right - a.left, a.bottom - py); ctx.restore();
  },
  afterDatasetsDraw(ch, _a, o) {
    const { ctx, chartArea: a, scales: { x, y } } = ch;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#8D0022'; ctx.setLineDash([4, 3]);
    const py = y.getPixelForValue(1);
    ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#8D0022'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = '600 13px "SeoulNamsan", "Malgun Gothic", sans-serif';
    ctx.fillText('안전 마진 소진', a.left + 4, py - 2);
    const px = x.getPixelForValue(o.rain);
    ctx.strokeStyle = '#262626';
    ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
    ctx.fillStyle = '#262626'; ctx.textAlign = px > a.right - 60 ? 'right' : 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`${o.rain} mm/h`, px + (ctx.textAlign === 'right' ? -4 : 4), a.top + 2);
    if (o.noDemand) { // 세로선보다 나중에 그려 글자가 위에 오게
      // 곡선은 위험이 시작되는 강우(약 55 mm/h 넘어)부터 있어 왼쪽 아래가 빔 → 거기에 씀
      ctx.fillStyle = '#5E5A54'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '600 14px "SeoulNamsan", "Malgun Gothic", sans-serif';
      const t = '인명 위해 인원 0명', ty = a.top + (a.bottom - a.top) * 0.80;
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(a.left + 4, ty - 10, ctx.measureText(t).width + 8, 20); // 강우 세로선이 글자를 지나가도 읽히게
      ctx.fillStyle = '#5E5A54'; ctx.fillText(t, a.left + 8, ty);
    }
    ctx.restore();
  },
};
export function initPanels({ M, S, sel, onChange, onSelect }) {
  // 경보 표 줄 누르기 = 그 시민 유형의 예상 피해 지역을 지도에 켜기/끄기(여럿 켤 수 있음) — S.zone 비트
  const pickLine = (li) => { if (!li) return; S.zone ^= 1 << +li.dataset.p; onChange(); };
  $('lines').addEventListener('click', (e) => pickLine(e.target.closest('li[data-p]')));
  $('lines').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLine(e.target.closest('li[data-p]')); } });
  const narrow = matchMedia('(max-width: 860px)').matches;

  // 슬라이더
  const rain = $('s-rain');
  const setRainUi = () => {
    rain.value = S.rain; $('o-rain').textContent = S.rain;
    document.querySelectorAll('.quick button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rain === S.rain)));
  };
  rain.addEventListener('input', () => { S.rain = +rain.value; setRainUi(); onChange(); });
  document.querySelectorAll('.quick button').forEach((b) => b.addEventListener('click', () => { S.rain = +b.dataset.rain; setRainUi(); onChange(); }));
  setRainUi();
  const bind = (id, key, fmtOut) => {
    const el = $(id); el.value = S[key]; $(id.replace('s-', 'o-')).textContent = fmtOut(S[key]);
    el.addEventListener('input', () => { S[key] = +el.value; $(id.replace('s-', 'o-')).textContent = fmtOut(S[key]); onChange(); });
  };

  // 자원마다 따로 접는 칸
  $('res').innerHTML = '<div class="sec grp">대응 자원</div>' + RES.map((r) => {
    return `<details class="sec sec-res res-item off" open><summary><span>${r.name}</span>
      <input type="checkbox" role="switch" class="tog" id="t-${r.k}" aria-label="${r.name} 켜기"></summary>
      <label class="row" for="s-${r.k}"><span>지금 보유량 대비</span><output id="o-${r.k}">100 %</output></label>
      <input id="s-${r.k}" type="range" min="0" max="300" step="10" value="100" disabled>
      <p class="res-na" id="na-${r.k}" hidden></p></details>`;
  }).join('');
  if (narrow) document.querySelectorAll('.sec-judge, .sec-res').forEach((d) => { d.open = false; });
  for (const r of RES) {
    const el = $(`s-${r.k}`);
    // 스위치 꺼짐 = 그 자원 0(포스터 값). 켜면 슬라이더 값만큼
    const item = el.closest('.res-item'), tog = $(`t-${r.k}`);
    const apply = () => {
      S.mult[r.k] = tog.checked ? +el.value / 100 : 0;
      el.disabled = !tog.checked; item.classList.toggle('off', !tog.checked);
      onChange();
    };
    tog.addEventListener('change', () => {
      const v = $('s-gu').value, gi = v === '' ? null : +v; // 고른 구에 이 자원 자료가 없으면 켜지 않고 알림만
      if (gi != null && tog.checked && M.res[r.f][gi] == null) { tog.checked = false; toast(`${M.gn[gi]} ${r.short} 정보 없음`); return; }
      apply(); if (gi != null) resNA(gi);
    });
    el.addEventListener('input', () => { $(`o-${r.k}`).textContent = `${el.value} %`; apply(); });
  }
  // 켜 둔 자원인데 고른 구에 자료가 없으면 스위치는 그대로 두고 회색 한 줄로 알림(서울 전체 설정이라 끄지 않음)
  function resNA(gi) {
    for (const r of RES) {
      const p = $(`na-${r.k}`);
      p.hidden = !($(`t-${r.k}`).checked && M.res[r.f][gi] == null);
      p.textContent = `${M.gn[gi]}는 정보 없음`;
    }
  }

  // 구 고르기
  const guSel = $('s-gu');
  guSel.innerHTML = '<option value="" disabled>자치구 선택</option>' + M.gn.map((n, gi) => [n, gi]).sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([n, gi]) => `<option value="${gi}">${n}</option>`).join(''); // 가나다순
  guSel.value = sel ?? '';
  guSel.addEventListener('change', () => onSelect(+guSel.value));

  // 그래프
  const persona = M.persona;
  persona.forEach((p, i) => { p.color = TWIN_COLORS[i]; }); // 경보 표 · 대피 경로 표도 같은 색을 씀
  const arsmChart = new Chart($('c-arsm'), {
    type: 'line',
    data: { datasets: persona.map((p) => ({ label: p.name, data: [], borderColor: p.color, backgroundColor: p.color, borderWidth: 2, pointRadius: 0, spanGaps: false })) },
    options: {
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 150, easing: 'linear' }, // 자원을 바꾸는 대로 따라 움직임
      maintainAspectRatio: false, parsing: false, normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: M.rain.at(-1), ticks: { stepSize: 25 }, grid: { display: false }, title: { display: true, text: '시간당 강우 (mm/h)' } },
        y: { type: 'logarithmic', min: Y_LO * NUDGE[0] * 0.97, max: Y_HI * NUDGE[5] * 1.03, afterBuildTicks: (ax) => { ax.ticks = Y_TICKS.map((value) => ({ value })); },
          ticks: { callback: (v) => (v === Y_LO ? '0' : v === Y_HI ? '100+' : String(v)) }, grid: { color: '#EFEBE4' }, border: { display: false }, title: { display: true, text: '안전 마진 (필요한 대응의 몇 배)' } },
      },
      plugins: {
        legend: { display: false }, // 범례는 그래프 위 HTML 격자(#arsm-lg)
        tooltip: { callbacks: { title: (it) => `${it[0].parsed.x} mm/h`, label: (it) => `${it.dataset.label} ${it.raw?.v == null ? '수요 없음' : it.raw.v.toFixed(2)}` } },
        guides: { rain: S.rain },
      },
    },
    plugins: [guides],
  });
  const lg = $('arsm-lg');
  lg.innerHTML = persona.map((p, i) => `<li><button type="button" data-i="${i}" aria-pressed="true"><i class="chip" style="background:${p.color}"></i><span>${p.name}</span></button></li>`).join('');
  const lgBtn = [...lg.querySelectorAll('button')];
  lgBtn.forEach((b, i) => b.addEventListener('click', () => {
    const on = !arsmChart.isDatasetVisible(i);
    arsmChart.setDatasetVisibility(i, on); arsmChart.update();
    b.classList.toggle('off', !on); b.setAttribute('aria-pressed', on);
  }));
  return {
    kpi({ rain, alertN, lateN, people, saved }) {
      $('k-saved').textContent = fmt(saved);
      $('k-alert').textContent = alertN; $('k-late').textContent = lateN; $('k-people').textContent = fmt(people);
    },
    /** 선택 구 문장 · 위험 인원(막대, 구 안 최대 = 꽉 참) · 자원 보유량. alerts = 그 구의 alert() 6개. */
    /** 고른 구 없음(처음 · 서울 밖 클릭) = 안내 한 줄만, 있음 = 경보 · 안전 마진. */
    pick(none) {
      $('gu-pick').hidden = !none;
      document.querySelectorAll('.panel.right > details').forEach((d) => { d.hidden = none; });
      if (!none) return;
      guSel.value = ''; $('gu-count').textContent = '';
      RES.forEach((r) => { $(`na-${r.k}`).hidden = true; });
    },
    gu(gi, alerts) {
      guSel.value = gi; resNA(gi);
      const r = Math.round(S.rain), D = demand(M, S, gi), dMax = Math.max(1, ...D), L = lifeShown(M, S, gi);
      const order = [0, 1, 2, 3, 4, 5].sort((a, b) => RANK[alerts[b].status] - RANK[alerts[a].status] || a - b);
      // 한 줄 = 한 유형: 판정 · 인명 피해까지 남은 시간 · 대피 인원(막대, 해당 없음이면 회색). 긴 설명은 마우스를 올리면(title)
      const head = '<li class="lh" aria-hidden="true"><span>지도</span><span>시민 유형</span><span>판정</span><span title="인명 피해 우려 수심에 닿기까지 남은 시간">인명 피해까지</span><span>대피 인원</span></li>';
      const focusP = document.activeElement?.closest?.('#lines li[data-p]')?.dataset.p; // 다시 그려도 키보드 초점 유지
      $('lines').innerHTML = head + order.map((p) => {
        const a = alerts[p], st = a.status;
        const when = st === 'safe' ? '–' : `${Math.max(1, Math.round(a.toDanger))}분`;
        const tip = `${sentence(M, S, gi, p)} · 생활 공간 인명 피해 수심 노출 ${pct(L[p].v)}${L[p].adj ? ` (자원 반영 후 ${pct(L[p].after)})` : ''}${M.low[gi][p] ? ' · 거주 적음(지도 판정 제외)' : ''}`;
        const on = (S.zone >> p) & 1, col = persona[p].color; // 칩: 켬 = 꽉 찬 색, 끔 = 테두리만
        return `<li class="${st}${on ? ' on' : ''}" data-p="${p}" role="button" tabindex="0" aria-pressed="${!!on}" title="${tip} · 누르면 지도에 예상 피해 지역 ${on ? '끄기' : '켜기'}"><i class="chip" style="background:${on ? col : 'transparent'};box-shadow:inset 0 0 0 2px ${col}"></i>
          <span class="nm">${persona[p].name}</span><span class="st">${STATUS_WORD[st]}</span><span class="when">${when}</span>
          <span class="ppl"><b>${fmt(D[p])}</b><span class="track"><i style="width:${(D[p] / dMax) * 100}%;background:${persona[p].color}"></i></span></span></li>`;
      }).join('');
      if (focusP != null) $('lines').querySelector(`li[data-p="${focusP}"]`)?.focus();
      const n = { late: 0, now: 0, safe: 0 };
      alerts.forEach((a) => n[a.status]++);
      $('gu-count').innerHTML = [['late', '즉시 대피'], ['now', '대피 권고'], ['safe', '해당 없음']] // 판정별 유형 수 = 칸 3개
        .map(([k, w]) => `<span class="gc ${k}"><em>${w}</em><b>${n[k]}</b></span>`).join('');
      arsmChart.options.plugins.guides.rain = r;
      arsmChart.options.plugins.guides.noDemand = !D.some((d) => d > 0);
      arsmChart.draw();
    },
    /** ARSM 곡선(선택 구만, 매 갱신마다). */
    arsm(gi) {
      const na = M.res.shelter_cap[gi] == null;
      $('arsm-box').hidden = na; lg.hidden = na; $('arsm-na').hidden = !na;
      arsmChart.options.plugins.guides.rain = Math.round(S.rain);
      if (!na) persona.forEach((pp, p) => {
        const c = arsmCurve(M, S, gi, p), ds = arsmChart.data.datasets[p];
        // 로그 눈금이라 0(자리 다 참)은 바닥, 100 이상은 천장에 붙이고 유형마다 살짝 띄움. 툴팁은 실제 값
        const at = (v) => (v <= Y_LO ? Y_LO * NUDGE[p] : v >= Y_HI ? Y_HI * NUDGE[p] : v);
        ds.data = c.rain.map((x, i) => ({ x, y: c.value[i] == null ? null : at(c.value[i]), v: c.value[i] }));
        const none = c.value.every((v) => v == null);
        ds.label = none ? `${pp.name}: 수요 없음` : pp.name;
        lgBtn[p].classList.toggle('none', none); lgBtn[p].title = none ? '이 구에는 대응 수요 없음' : '';
      });
      arsmChart.update(); // 값이 바뀌면 선이 부드럽게 오르내림
    },
  };
}

// 계산 모듈(순수 함수): model.json(M) + 화면 상태 S → 대피 경보 · 양수기 · 물막이판 · ARSM.
// S = {rain, mult: {shelter, barrier, pump, volunteers}}, mult 1 = 현재 보유량. 대피 시간은 M.evac(유형별 고정값).
// 페르소나 index: 0 재해취약자 · 1 아동 · 청소년 · 2 재해취약주택 거주민 · 3 야외 노동자 · 4 외국인 유학생 · 5 근로자.

const CELL_M2 = 400;                           // 20 m 칸
const HIST = { 0: ['res', 30], 2: ['res', 15], 5: ['com', 50] };   // hist 로 다시 계산하는 페르소나: [분포, 인명 위해 cm]
const SHELTER_ORDER = [2, 0, 1, 4, 3, 5];       // 10/28 R2: P3 → P1 → P2 → P5 → P4 → P6

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
const ri = (M, rain) => Math.max(0, Math.min(M.rain.length - 1, Math.round(fin(rain))));
// 화면 경계값 정리: NaN · Infinity 가 계산 밖으로 새지 않게. mult < 0 → 0.
const norm = (S) => ({ ...S, rain: fin(S.rain),
  mult: Object.fromEntries(['shelter', 'barrier', 'pump', 'volunteers'].map((k) => [k, Math.max(0, fin(S.mult?.[k]))])) });
const binOf = (m) => Math.round(m * 100);
const sum = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i]; return s; };

/** 칸 수심 분포 hist(1 cm 칸 개수)에서 수위 L(cm) 위로 남는 물 부피(m³). 칸 b 의 수심 = b cm. */
function volumeAbove(hist, L) {
  let v = 0;
  for (let b = L + 1; b < hist.length; b++) v += hist[b] * (b - L) / 100 * CELL_M2;
  return v;
}

/** 부피 V(m³)를 퍼냈을 때의 수위 L(cm, ≥ trigger). 이분 탐색 — 1 cm 단위라 남는 부피는 버림(보수적). */
function pumpCut(hist, V, T) {
  if (!(V > 0)) return hist.length - 1;
  let lo = T, hi = hist.length - 1;               // vol(L) 은 L 에 대해 감소, vol(hi) = 0
  while (lo < hi) { const mid = (lo + hi) >> 1; if (volumeAbove(hist, mid) <= V) hi = mid; else lo = mid + 1; }
  return lo;
}

const clip = (hist, L) => { const h = hist.slice(0, L + 1); h[L] += sum(hist, L + 1); return h.concat(new Array(hist.length - L - 1).fill(0)); };

/** 이동식 양수기: V = lpm × mult × 60 / 1000 m³ (1시간, 재유입 없음). trigger 이상 칸만 퍼내며 깊은 칸부터 L 로 낮춤. lpm null → 그대로. */
export function pumpLevel(hist, lpm, mult, trigger) {
  if (lpm == null) return hist;
  return clip(hist, pumpCut(hist, lpm * mult * 60 / 1000, binOf(trigger)));
}

/** 양수기 수위 L(cm) at 강우 index r: 구마다 양수기 한 풀을 RES ∪ COM 칸이 같이 씀. 양수기 자료 없음 → null. */
function pumpL(M, S, gi, r) {
  const lpm = M.res.pump_lpm[gi];
  if (lpm == null) return null;
  const res = M.hist.res[gi][r], com = M.hist.com[gi][r];
  return pumpCut(res.map((v, b) => v + com[b]), lpm * S.mult.pump * 60 / 1000, binOf(M.trigger_m));
}

/** 양수기 적용 후 그 강우의 RES · COM 분포. */
function pumpedHists(M, S, gi, r) {
  const res = M.hist.res[gi][r], com = M.hist.com[gi][r], L = pumpL(M, S, gi, r);
  return L == null ? { res, com } : { res: clip(res, L), com: clip(com, L) };
}

/** 지도용: S.rain 에서 양수기가 깎은 수위 L(cm). 양수기 자료 없음 · 0배 → null(지도 그대로). */
export function pumpLevelCm(M, S, gi) {
  S = norm(S);
  return S.mult.pump > 0 ? pumpL(M, S, gi, ri(M, S.rain)) : null;
}

/**
 * 양수기 → 물막이판 적용 후 인명 위해 노출 비율(%) at 강우 index r.
 * P1 · P3 = RES 분포(0.30 · 0.15 m), P6 = COM 분포(0.50 m), P2 · P4 · P5 = M.life 그대로(EDU · 도로 분포 없음).
 * 물막이판(P3 만, 반지하 출입구): 양수기 후 수심 ∈ [trigger, barrier_h) 인 RES 칸 비율 f 가 막을 수 있는 몫.
 *   counts[P3] = 반지하 가구. 막는 가구 = min(barrier_n × mult, f × counts[P3]) — 1개소 = 1가구(포스터 make_margin_1028).
 */
function lifeAt(M, S, gi, p, r) {
  if (!HIST[p]) return M.life[gi][p][r];
  const [key, harm] = HIST[p];
  const h = pumpedHists(M, S, gi, r)[key];
  const tot = sum(h);
  if (!tot) return 0;
  let pct = sum(h, harm) / tot * 100;
  const n = M.res.barrier_n[gi], bh = M.res.barrier_h[gi], cnt = M.counts[gi][p];
  if (p === 2 && n != null && bh != null && cnt > 0) {
    const f = sum(h, binOf(M.trigger_m), binOf(bh)) / tot;
    pct = Math.max(0, pct - Math.min(n * S.mult.barrier, f * cnt) / cnt * 100);
  }
  return pct;
}

/**
 * 화면 · 수요에 쓰는 인명 위해 노출 비율(%) at 강우 index r — 포스터 표(M.life)에 자원 효과만 더한 꼴.
 * P1 · P3 · P6: M.life + (양수기 · 물막이판 적용 hist % − 둘 다 0배 hist %), [0, 100]. 그 밖 = M.life.
 * 물막이판 몫(P3)은 lifeAt 안에서 '막은 가구 ÷ 가구'로 빠지므로 × counts 하면 막은 가구만큼 줄어든 가구 수가 됨.
 * 양수기 · 물막이판 자료가 없는 구는 차이가 정확히 0 → M.life 그대로(포스터와 같은 값).
 */
function shownAt(M, S, gi, p, r) {
  const base = M.life[gi][p][r];
  if (!HIST[p] || (M.res.pump_lpm[gi] == null && (p !== 2 || M.res.barrier_n[gi] == null))) return base;
  const none = { ...S, mult: { ...S.mult, pump: 0, barrier: 0 } };
  return Math.min(100, Math.max(0, base + (lifeAt(M, S, gi, p, r) - lifeAt(M, none, gi, p, r))));
}

/** 지도용: 물막이판이 막은 몫(0~1) = 1 − P3 노출 %(물막이판 반영) ÷ 같은 상태에서 물막이판만 끈 노출 % — 오른쪽 표(shownAt)와 같은 비율.
 *  물막이판 자료 없음 · 0배 · 노출 0 → null. */
export function barrierShare(M, S, gi) {
  S = norm(S);
  if (!(S.mult.barrier > 0) || M.res.barrier_n[gi] == null) return null;
  const r = ri(M, S.rain), off = shownAt(M, { ...S, mult: { ...S.mult, barrier: 0 } }, gi, 2, r);
  return off > 0 ? 1 - shownAt(M, S, gi, 2, r) / off : null;
}

/** shownAt 의 공개판: S.rain 에서 시민 유형 p 의 인명 위해 노출 비율(%). */
export function shownLife(M, S, gi, p) {
  S = norm(S);
  return shownAt(M, S, gi, p, ri(M, S.rain));
}

/** 화면 노출 %: v = 포스터 값(M.life, 자원은 물 위치를 안 바꿈), after = 자원 반영 후(위험 인원 · 경보 · ARSM 출처),
 *  adj = 둘 차이 ≥ 0.05 %p(화면에 '자원 반영 후' 따로 표시). */
export function lifeShown(M, S, gi) {
  S = norm(S);
  const r = ri(M, S.rain);
  return M.persona.map((_, p) => { const v = M.life[gi][p][r], after = shownAt(M, S, gi, p, r); return { v, after, adj: Math.abs(after - v) >= 0.05 }; });
}

/** life 곡선(S 주면 자원 적용 후 = shownAt)이 cut(%)에 처음 닿는 실제 강우(선형 보간), 없으면 null.
 *  cut ≤ 0 → 가장 작은 양의 cut 으로 봄: life > 0 인 첫 강우. */
export function onsetRain(M, gi, p, cut, S) {
  if (S) S = norm(S);
  cut = fin(cut);
  const y = (r) => (S ? shownAt(M, S, gi, p, r) : M.life[gi][p][r]);
  const hit = (v) => (cut > 0 ? v >= cut : v > 0);
  let prev = y(0);
  if (hit(prev)) return M.rain[0];
  for (let r = 1; r < M.rain.length; r++) {
    const cur = y(r);
    if (hit(cur)) return cut > 0 ? M.rain[r - 1] + (cut - prev) / (cur - prev) * (M.rain[r] - M.rain[r - 1]) : M.rain[r];
    prev = cur;
  }
  return null;
}

/** 임계까지 남은 시간(분) = 60 × onset ÷ rain (1시간 균일 강우). rain ≤ 0 · onset null · rain < onset(이 비로는 안 닿음) → null. */
export function minutesToDanger(onset, rain) {
  if (onset == null || !(rain > 0) || !Number.isFinite(rain) || rain < onset) return null;
  return Math.min(60, 60 * onset / rain);
}

/** 대피 시간(분) = 준비 + 구별 대피소 거리 ÷ 보행 속도(M.evac, prep/persona.py EVAC_*). */
export function evacMin(M, gi, p) {
  const e = M.evac;
  return e.prep_min[p] + e.dist_m[gi][p] / e.speed_ms[p] / 60;
}

/** 판정 {status: 'late'(즉시 대피) | 'now'(대피 권고) | 'safe'(해당 없음), toDanger, evac, alertIn, onset}.
 *  인명 피해까지(toDanger) = 이 비가 이어질 때 대피 인원의 절반이 인명 위해 수심에 닿기까지(문턱 % 없음:
 *  지금 노출 % 의 절반에 처음 닿는 강우 → 60 × 그 강우 ÷ 지금 강우). 노출 0 → 해당 없음.
 *  ('한 칸이라도 닿는 시점'은 모형이 76 mm/h 부터 물을 만들어 모든 유형 · 구가 같아짐 → 절반 시점을 씀)
 *  toDanger ≤ 대피 시간 → 즉시 대피, 그보다 길면 대피 권고. alertIn = toDanger − 대피 시간(여유). */
export function alert(M, S, gi, p) {
  S = norm(S);
  const now = shownAt(M, S, gi, p, ri(M, S.rain)), evac = evacMin(M, gi, p);
  const onset = now > 0 ? onsetRain(M, gi, p, now / 2, S) : onsetRain(M, gi, p, 0, S);
  const toDanger = now > 0 ? minutesToDanger(onset, S.rain) : null;
  if (toDanger == null) return { status: 'safe', toDanger: null, evac, alertIn: null, onset };
  const alertIn = toDanger - evac;
  return { status: alertIn <= 0 ? 'late' : 'now', toDanger, evac, alertIn, onset };
}

/** 페르소나별 위험 인원(명) = counts × shownAt(양수기 · 물막이판 반영 노출 %) / 100. P3 은 가구라 × hh_size(2.2명, 포스터 make_scen_1028). */
export function demand(M, S, gi) {
  S = norm(S);
  const r = ri(M, S.rain);
  return M.counts[gi].map((c, p) => c * shownAt(M, S, gi, p, r) / 100 * (p === 2 ? M.hh_size : 1));
}

function capacityWith(M, S, gi, D, toDangerP1) {
  const cap = M.res.shelter_cap[gi], vol = M.res.volunteers[gi];
  if (cap == null) return D.map(() => null);
  const C = new Array(6).fill(null);
  let pool = cap * S.mult.shelter;
  for (const p of SHELTER_ORDER) {
    // 역량 = 그 차례에 남은 자리(D 로 자르지 않음 → ARSM > 1 = 여유). 자리는 실제로 데려간 만큼만 씀.
    let c = pool;
    if (p === 0) c = vol == null ? null : Math.min(pool, vol * S.mult.volunteers * (toDangerP1 ?? 60) / Math.max(1, evacMin(M, gi, 0)));
    C[p] = c;
    const took = Math.min(pool, fin(D[p]), c ?? Infinity);
    pool -= took;
    C.taken = (C.taken ?? 0) + took;   // 대피시설에 실제로 들어간 인원(회복 인원 계산용)
  }
  return C;
}

/**
 * 대응 역량: 대피소(shelter_cap × mult)를 P3 → P1 → P2 → P5 → P4 → P6 순서로 배정.
 * P1 은 의용소방대 · 자율방재단 지원 한도 volunteers × mult × toDanger(P1) / 대피 시간(P1) 으로도 제한
 * (이 비에서 위험이 안 오면 toDanger = 60분). shelter_cap null → 전부 null.
 * volunteers null → P1 역량 null(지원 한도를 모름)이지만 P1 은 대피소 자리 min(남은 자리, D[P1])를 그대로 차지함.
 */
/** 의용소방대 · 자율방재단(재해취약자 P1 대피 지원): 투입 시한(분) = P1 인명 피해까지 − P1 대피 시간(alertIn),
 *  지원 가능 인원 = 대원 × mult × 인명 피해까지 ÷ 대피 시간(capacity 의 P1 지원 한도와 같은 식), 필요 = P1 대피 인원.
 *  대원 자료 없음 → null, 이 비에서 P1 위험 없음 → deadline null. */
export function volunteerPlan(M, S, gi) {
  S = norm(S);
  const vol = M.res.volunteers[gi];
  if (vol == null) return null;
  const a = alert(M, S, gi, 0), need = demand(M, S, gi)[0];
  if (a.toDanger == null) return { deadline: null, help: 0, need };
  return { deadline: a.alertIn, help: vol * S.mult.volunteers * a.toDanger / Math.max(1, a.evac), need };
}

export function capacity(M, S, gi, D) {
  S = norm(S);
  return capacityWith(M, S, gi, D, alert(M, S, gi, 0).toDanger);
}

const ZERO = { shelter: 0, barrier: 0, pump: 0, volunteers: 0 };
/** 회복 인원: 자원을 다 껐을 때 위험 인원(base) 대비, 양수기 · 물막이판으로 줄어든 인원 + 대피시설에 들어간 인원(saved). */
export function recovered(M, S, gi) {
  const base = sum(demand(M, { ...S, mult: ZERO }, gi)), D = demand(M, S, gi);
  return { base, saved: Math.max(0, base - sum(D)) + (capacity(M, S, gi, D).taken ?? 0) };
}

/** ARSM = C ÷ D. D ≤ 0 → null("수요 없음"), C null → null. */
export function arsm(C, D) {
  return C == null || !(D > 0) || !Number.isFinite(C / D) ? null : C / D;
}

/** 강우 0~174 전 구간 ARSM 곡선. */
export function arsmCurve(M, S, gi, p) {
  S = norm(S);
  const onsetP1 = onsetRain(M, gi, 0, 0, S);          // 강우와 무관 → 한 번만
  const value = M.rain.map((rain) => {
    const s = { ...S, rain }, D = demand(M, s, gi);
    return arsm(capacityWith(M, s, gi, D, minutesToDanger(onsetP1, rain))[p], D[p]);
  });
  return { rain: M.rain.slice(), value };
}

const particle = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? '은' : '는'; };

/** 화면 문장(스펙 6-2 틀). 분 · 강우는 정수. */
export function sentence(M, S, gi, p) {
  const name = M.persona[p].name.replace(/\s*·\s*/g, ' · ');
  const a = alert(M, S, gi, p), rain = Math.round(fin(S.rain));
  const head = `${M.gn[gi]}의 ${name}${particle(name)} 시간당 ${rain} mm`;
  if (rain <= 0) return `${M.gn[gi]}의 ${name}${particle(name)} 비가 오지 않아 해당 없음`;
  if (a.status === 'safe') return a.onset == null
    ? `${head}, 이 강우 범위(0~${M.rain.at(-1)} mm/h)에서는 인명 피해 수심에 닿지 않음`
    : `${head}, 이 강우에서는 인명 피해 수심에 닿지 않음 (약 ${Math.round(a.onset)} mm/h부터 닿음)`;
  const t = `${head}가 이어지면 약 ${Math.max(1, Math.round(a.toDanger))}분 뒤 인명 피해 수심, 대피에 약 ${Math.round(a.evac)}분 → `;
  return t + (a.status === 'late' ? '즉시 대피' : `대피 권고 (여유 ${Math.round(a.alertIn)}분)`);
}

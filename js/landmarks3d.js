// 특이 건물 3D: (1) OSM part 단 쌓기(fill-extrusion) + (2) 곡면 손 모형(three.js custom layer).
// 손 모형 자리·크기는 landmark_parts.geojson 의 최상위 `hand` 목록(prep/landmarks_osm.py 가 OSM 바닥에서 계산).
// 손 모형이 대신 그리는 part 는 `hand` 속성이 있어 (1) 에서 빠진다.
// three.js 는 addLandmarks3D 안에서 동적 import — 못 받으면(행사장 와이파이 등) 손 모형 없이 단 쌓기만.
let THREE;

const C = {
  wall: '#E9E4DA', stone: '#CFC9BE', grey: '#B9B6B0', dark: '#4A4A4A', roof: '#4A4A4A',
  column: '#8D4A52', // 궁궐 기둥(크림슨 #8D0022 의 저채도)
  blue: '#2F5D8A', glass: '#B7C4CE', gold: '#CBBF9E', green: '#8A9A7A', dirt: '#A89C8A', dome: '#A9B5B0', red: '#A0625C',
};
const mats = {};
const mat = (c) => (mats[c] ??= new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));

// ---------- 기하 도우미 (지역 좌표: x 동, y 북, z 위, 단위 m) ----------
function faces(list) { // list: [[[x,y,z],...], ...] 볼록 다각형들 → 평면 음영 BufferGeometry
  const p = [];
  for (const f of list) for (let i = 1; i < f.length - 1; i++) p.push(...f[0], ...f[i], ...f[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
// rings: [{pts:[[x,y],...], z: 숫자 | (x,y)=>숫자}] 같은 점 개수. 이웃 고리끼리 띠로 잇고 마지막 고리는 뚜껑(cap).
function loft(rings, cap = true) {
  const R = rings.map(({ pts, z }) => pts.map(([x, y]) => [x, y, typeof z === 'function' ? z(x, y) : z]));
  const list = [];
  for (let k = 0; k < R.length - 1; k++) {
    const a = R[k], b = R[k + 1], n = a.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; list.push([a[i], a[j], b[j], b[i]]); }
  }
  if (cap) list.push(R[R.length - 1]);
  return faces(list);
}
const scaleRing = (pts, s, sy = s) => pts.map(([x, y]) => [x * s, y * sy]);
// 긴 축(rot °) 방향만 sx, 짧은 축은 sy 배율
const scaleAxis = (pts, rot, sx, sy) => {
  const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map(([x, y]) => { const u = (x * c + y * s) * sx, v = (-x * s + y * c) * sy; return [u * c - v * s, u * s + v * c]; });
};
const ellipse = (rx, ry, n = 32) => Array.from({ length: n }, (_, i) => [rx * Math.cos(2 * Math.PI * i / n), ry * Math.sin(2 * Math.PI * i / n)]);
const rsquare = (a, p = 6, n = 32) => Array.from({ length: n }, (_, i) => { // 초타원(모서리 둥근 사각)
  const t = 2 * Math.PI * i / n, c = Math.cos(t), s = Math.sin(t);
  return [a * Math.sign(c) * Math.abs(c) ** (2 / p), a * Math.sign(s) * Math.abs(s) ** (2 / p)];
});
// 바닥 고리를 profile [[z, 배율], ...] 로 쌓음(중심 = 지역 원점)
const loftFoot = (foot, profile, cap = true) => loft(profile.map(([z, s]) => ({ pts: scaleRing(foot, s), z })), cap);
function box(w, d, h, z0 = 0, x = 0, y = 0) {
  const g = new THREE.BoxGeometry(w, d, h); g.translate(x, y, z0 + h / 2); return g;
}
function cyl(rTop, rBot, h, z0 = 0, seg = 24) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg); g.rotateX(Math.PI / 2); g.translate(0, 0, z0 + h / 2); return g;
}
// 한식 지붕: 처마 L×W, 높이 h. gable=0 → 우진각(사면), 0.5 → 팔작(위쪽 절반이 박공). 처마 모서리 살짝 들림.
function koreanRoof(L, W, h, z0, gable = 0.5) {
  const ex = L / 2, ey = W / 2, lift = h * 0.18, ztop = z0 + h;
  const xr = ex - ey * 0.9; // 용마루 반길이
  const zg = z0 + h * (1 - gable * 0.8), yg = ey * gable * 0.55, xg = xr + (ex - xr) * gable * 0.25;
  const c = (sx, sy) => [sx * ex, sy * ey, z0 + lift];
  const m = (sx, sy) => [sx * ex * 0.8, sy * ey, z0]; // 처마 가운데는 낮게(곡선 흉내)
  const list = [];
  for (const sy of [-1, 1]) { // 앞뒤 긴 면
    list.push([c(-1, sy), m(-1, sy), m(1, sy), c(1, sy), [xg, sy * yg, zg], [-xg, sy * yg, zg]]);
    list.push([[-xg, sy * yg, zg], [xg, sy * yg, zg], [xr, 0, ztop], [-xr, 0, ztop]]);
  }
  for (const sx of [-1, 1]) { // 옆면 + 합각(박공 삼각)
    list.push([c(sx, -1), c(sx, 1), [sx * xg, yg, zg], [sx * xg, -yg, zg]]);
    list.push([[sx * xg, -yg, zg], [sx * xg, yg, zg], [sx * xr, 0, ztop]]);
  }
  list.push([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)]); // 처마 밑면(옆에서 지붕이 얇은 판처럼 떠 보이지 않게)
  return faces(list);
}
function gableRoof(L, W, h, z0) { // 맞배: 두 경사면 + 양 박공
  const x = L / 2, y = W / 2, t = z0 + h;
  return faces([[[-x, -y, z0], [x, -y, z0], [x, 0, t], [-x, 0, t]], [[-x, y, z0], [-x, 0, t], [x, 0, t], [x, y, z0]],
    [[x, -y, z0], [x, y, z0], [x, 0, t]], [[-x, -y, z0], [-x, 0, t], [-x, y, z0]]]);
}
function columns(L, W, nx, ny, h, z0, r = 0.35) { // 가장자리 기둥 줄
  const gs = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (i && j && i < nx - 1 && j < ny - 1) continue;
    gs.push(box(r * 2, r * 2, h, z0, -L / 2 + L * i / (nx - 1), -W / 2 + W * j / (ny - 1)));
  }
  return gs;
}
const M = (g, c) => new THREE.Mesh(g, mat(c));
const group = (...meshes) => { const o = new THREE.Group(); meshes.flat().forEach((m) => o.add(m)); return o; };
const many = (gs, c) => gs.map((g) => M(g, c));

// 회전된 직사각(L 긴 변 = 지역 x) 위에 짓는 모형은 rot 로 돌리고, 바닥(foot)을 쓰는 모형은 돌리지 않음.
// 높이 값 출처는 task-5b-report.md 의 표.
const BUILD = {
  lotte({ foot }) { // 555 m, 위로 갈수록 가늘어지는 둥근 사각, 꼭대기 랜턴(갈라진 왕관)
    const a = Math.sqrt(polyArea(foot)) / 2, rings = [];
    for (let z = 0; z <= 500; z += 50) rings.push({ pts: rsquare(a * (1 - 0.62 * (z / 500) ** 1.4), 5), z });
    const top = rings[rings.length - 1].pts, g = a * 0.05;
    // 왕관(랜턴): 500 m 위는 가운데가 갈라진 두 쪽이 555 m 까지 모이며 가늘어짐
    const half = (sy) => [[top[0][0], 0], ...top.filter(([, y]) => sy * y > 0), [-top[0][0], 0]].map(([x, y]) => [x, y + sy * g]);
    const crown = (sy) => M(loft([1, 0.92, 0.6, 0.3].map((k, i) => ({ pts: scaleRing(half(sy), k), z: [500, 520, 548, 555][i] }))), C.glass);
    return group(M(loft(rings), C.glass), crown(1), crown(-1));
  },
  namsan({ foot }) { // 기둥 + 전망대 원반(OSM part 88~112 m) + 안테나(~236.7 m)
    const rd = Math.sqrt(polyArea(foot) / Math.PI), rs = rd * 0.42;
    return group(
      M(cyl(rs, rs * 1.7, 14, 0), C.wall), M(cyl(rs, rs, 74, 14), C.wall),
      M(cyl(rd, rd * 0.7, 12, 88), C.grey), M(cyl(rd * 1.04, rd, 12, 100), C.glass), M(cyl(rd * 0.55, rd * 1.04, 6, 112), C.wall),
      M(cyl(rs * 0.55, rs * 0.7, 40, 118, 12), C.wall),
      ...[0, 1, 2, 3, 4].map((i) => M(cyl(rs * (0.5 - i * 0.07), rs * (0.55 - i * 0.07), 15.7, 158 + i * 15.7, 8), i % 2 ? C.wall : C.red)),
    );
  },
  b63({ foot, rot }) { // 249.6 m 금색 유리 한 덩어리: 바닥(몸체 + 120 m 날개) → 위로 갈수록 긴 축이 오목하게 좁아지는 사다리꼴 입면
    const H = 249.6, ring = (z) => ({ pts: scaleAxis(foot, rot, 1 - 0.42 * (z / H) ** 1.5, 1 - 0.12 * (z / H)), z });
    return group(M(loft([0, 40, 80, 120, 160, 200, 230, H, H + 2.4].map((z) => (z > H ? { ...ring(H), z } : ring(z)))), C.gold));
  },
  geunjeongjeon({ L, W }, k = 1) { // 중층 팔작. 높이 = OSM part(기단 1 m · 아래 지붕 7.3~10.5 · 위 지붕 14.2~25.4 m), k = 높이 배율
    const o = group(
      M(box(L * 1.5, W * 1.6, 0.5, 0), C.stone), M(box(L * 1.2, W * 1.25, 0.5, 0.5), C.stone),
      many(columns(L * 0.8, W * 0.74, 7, 5, 6.3, 1, 0.4), C.column), M(box(L * 0.74, W * 0.68, 6.3, 1), C.wall),
      M(koreanRoof(L, W, 3.2, 7.3, 0), C.roof),
      M(box(L * 0.62, W * 0.52, 3.7, 10.5), C.column), M(koreanRoof(L * 0.9, W * 0.84, 11.2, 14.2, 0.5), C.roof),
    );
    o.scale.z = k;
    return o;
  },
  injeongjeon(p) { // 창덕궁 인정전: 근정전과 같은 중층 팔작, 높이는 정면 길이 비로 줄임(추정)
    return BUILD.geunjeongjeon(p, Math.min(1, p.L / 38.1));
  },
  jongmyo({ L, W }) { // 종묘 정전: 넓은 월대 위 긴 단층 맞배(19칸), 높이 추정
    return group(M(box(L * 1.05, W * 1.8, 1.2, 0), C.stone), many(columns(L * 0.96, W * 0.5, 20, 2, 4.2, 1.2, 0.3), C.column),
      M(box(L * 0.96, W * 0.45, 4.2, 1.2), C.wall), M(gableRoof(L * 1.02, W * 1.05, 5.5, 5.4), C.roof));
  },
  heunginjimun(p) { // 흥인지문: 석축 누각 + 동쪽 반원 옹성
    const o = BUILD.gate2(1)(p), R = p.L * 0.7, n = 14, list = [];
    const side = Math.cos(((p.rot + 90) * Math.PI) / 180) > 0 ? 1 : -1; // 지역 +y 가 동쪽이면 1
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * i / n, a1 = Math.PI * (i + 1) / n;
      const P = (a, r, z) => [r * Math.cos(a), side * (p.W / 2 + r * Math.sin(a) * 0.8), z];
      list.push([P(a0, R, 0), P(a1, R, 0), P(a1, R, 6), P(a0, R, 6)], [P(a0, R - 3, 6), P(a0, R, 6), P(a1, R, 6), P(a1, R - 3, 6)],
        [P(a0, R - 3, 0), P(a0, R - 3, 6), P(a1, R - 3, 6), P(a1, R - 3, 0)]);
    }
    o.add(M(faces(list), C.stone));
    return o;
  },
  dome({ foot }, wall, rise, c = C.wall) { // 벽 + 낮은 돔
    const prof = [[0, 1], [wall, 1]];
    for (let i = 1; i <= 6; i++) { const t = i / 6 * Math.PI / 2; prof.push([wall + rise * Math.sin(t), Math.max(Math.cos(t), 0.05)]); }
    return group(M(loftFoot(foot, prof), c));
  },
  museum({ L, W }) { // 국립중앙박물관: 긴 두 동 + 가운데 열린마당, 위를 잇는 지붕 판(높이 추정)
    const H = 30, g = L * 0.12;
    return group(M(box(L / 2 - g, W, H, 0, -(L / 4 + g / 2)), C.stone), M(box(L / 2 - g, W, H, 0, L / 4 + g / 2), C.stone),
      M(box(L * 1.02, W * 1.1, 2, H), C.wall), M(box(g * 2, W * 0.3, 2, 0), C.grey));
  },
  peaceGate({ L, W }) { // 세계평화의문: 기둥 4개 위 양끝이 들린 날개 지붕(높이 24 m = OSM)
    const H = 24, list = [], n = 8;
    for (let i = 0; i < n; i++) {
      const x0 = -L / 2 + L * i / n, x1 = -L / 2 + L * (i + 1) / n, z = (x) => H - 6 + 6 * (2 * x / L) ** 2;
      list.push([[x0, -W / 2, z(x0)], [x1, -W / 2, z(x1)], [x1, W / 2, z(x1)], [x0, W / 2, z(x0)]]);
    }
    return group(M(faces(list), C.grey), ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([i, j]) => M(box(3, 3, H - 6, 0, i * L * 0.12, j * W * 0.3), C.stone)));
  },
  gyeonghoeru({ L, W }) { // 연못 위 돌기둥 위 누각, 팔작
    return group(
      M(box(L * 1.08, W * 1.1, 1.0, 0), C.stone), many(columns(L * 0.95, W * 0.92, 8, 6, 4.4, 1, 0.45), C.stone),
      M(box(L, W, 0.8, 5.4), C.stone), many(columns(L * 0.92, W * 0.88, 8, 6, 3.6, 6.2, 0.3), C.column),
      M(box(L * 0.6, W * 0.5, 3.6, 6.2), C.wall), M(koreanRoof(L * 1.14, W * 1.2, 6.8, 9.6, 0.5), C.roof),
    );
  },
  gate2(n) { // 석축 + 중층 우진각 누각. 높이 = 광화문 OSM part(석축 7 · 아래 지붕 9.5~12 · 위 지붕 14.9~18.4 m). n = 홍예문 수
    const H0 = 7, xs = n === 3 ? [-1, 0, 1] : [0];
    return ({ L, W }) => { // 광화문(폭 13 m)보다 깊은 문은 누각 높이를 폭에 비례해 키움(지붕 경사 유지)
      const k = Math.min(2, Math.max(1, W / 13)), r1 = 2.5 * k, b2 = 2.9 * k, r2 = 3.5 * k;
      return group(
        M(box(L, W, H0, 0), C.stone), ...xs.map((i) => M(box(L * 0.09, W * 1.02, H0 * 0.55, 0, i * L * 0.27), C.dark)),
        M(box(L * 0.66, W * 0.62, 2.5 * k, H0), C.column), M(koreanRoof(L * 0.94, W * 1.0, r1, H0 + 2.5 * k, 0), C.roof),
        M(box(L * 0.56, W * 0.45, b2, H0 + 2.5 * k + r1), C.column), M(koreanRoof(L * 0.86, W * 0.86, r2, H0 + 2.5 * k + r1 + b2, 0), C.roof),
      );
    };
  },
  cheongwadae({ L, W }) { // 본관 가운데: 1층(0~7 m, OSM part) 위 2층 몸체 7~15 + 청기와 팔작 15~25 m(OSM part 높이)
    return group(
      M(box(L * 0.8, W * 0.7, 8, 7), C.wall), many(columns(L * 0.8, W * 0.74, 8, 4, 8, 7, 0.45), C.wall),
      M(koreanRoof(L, W, 10, 15, 0.5), C.blue),
    );
  },
  assembly({ domeR }) { // 국회의사당: 몸체 122 × 81 m(위키백과) + 열주 24 + 돔(OSM part 43~61 m)
    const L = 122, W = 81;
    const g = [M(box(L * 0.96, W * 0.94, 31, 0), C.wall), M(box(L, W, 2, 31), C.stone), M(box(L * 0.82, W * 0.74, 10, 33), C.wall)];
    g.push(...many(columns(L * 1.0, W * 0.98, 8, 6, 31, 0, 1.0), C.stone)); // 8+8+4+4 = 24 기둥
    g.push(M(cyl(domeR, domeR, 3, 40), C.wall), M(loft(Array.from({ length: 7 }, (_, i) => {
      const t = i / 6 * Math.PI / 2; return { pts: ellipse(domeR * Math.cos(t) + 0.01, domeR * Math.cos(t) + 0.01, 24), z: 43 + 18 * Math.sin(t) };
    }), false), C.dome));
    return group(g);
  },
  cityhall({ L, W }) { // 신청사: 뒤는 서고 앞(face 쪽)은 파도처럼 앞으로 숙인 유리. 높이 = 13층 추정 59 m
    const H = 59, d = W / 2;
    const sec = [[-d, 0], [d * 0.1, 0], [d * 0.55, H * 0.3], [d * 1.25, H * 0.62], [d * 1.75, H * 0.8], [d * 1.45, H * 0.93], [d * 0.4, H], [-d, H * 0.96]];
    const s = new THREE.Shape(sec.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, L / 2, 0); // 단면 (y, z), 길이 방향 y
    g.rotateZ(Math.PI / 2); // 길이 방향 → x, 앞(+단면 x) → +y
    return group(M(g, C.glass)); // 앞 = 지역 +y
  },
  ddp({ foot }) { // 둥근 모서리 덩어리, 최고 29 m
    return group(M(loftFoot(foot, [[0, 0.97], [3, 1], [18, 1], [25, 0.95], [28, 0.86], [29, 0.75]]), C.grey));
  },
  bowl({ foot }, H, inner, opt = {}) { // 경기장: 바깥 벽 → 관중석 경사 → 안쪽 벽, 가운데 그라운드
    const rim = opt.rim ?? (() => H);
    const g = [M(loft([{ pts: foot, z: 0 }, { pts: foot, z: rim }, { pts: scaleRing(foot, inner), z: H * 0.18 }, { pts: scaleRing(foot, inner), z: 0.3 }], false), C.wall),
      M(loft([{ pts: scaleRing(foot, inner), z: 0.3 }]), C.green)];
    if (opt.roof) g.push(M(loft([{ pts: foot, z: rim }, { pts: scaleRing(foot, opt.roof), z: (x, y) => rim(x / opt.roof, y / opt.roof) + 2 }], false), C.grey));
    return g;
  },
  jamsilBaseball({ foot, home }) { // 2층 부채꼴 관중석: 홈플레이트 뒤 높고(32 m 추정) 외야는 낮음(10 m), 내야 다이아몬드
    const h = (home * Math.PI) / 180, R = Math.sqrt(polyArea(foot) / Math.PI);
    const near = (x, y) => Math.max(0, Math.cos(Math.atan2(y, x) - h) + 0.15) / 1.15; // 홈 쪽 1 → 외야 0
    const rim = (x, y) => 10 + 22 * near(x, y) ** 1.3, tier = (x, y) => 4 + 10 * near(x, y);
    const fx = (k) => scaleRing(foot, k);
    const stands = loft([{ pts: foot, z: 0 }, { pts: foot, z: rim }, { pts: fx(0.86), z: (x, y) => rim(x / 0.86, y / 0.86) * 0.62 },
      { pts: fx(0.8), z: (x, y) => tier(x / 0.8, y / 0.8) }, { pts: fx(0.66), z: 1.2 }, { pts: fx(0.66), z: 0.3 }], false);
    const roof = loft([{ pts: foot, z: (x, y) => rim(x, y) + 0.5 }, { pts: fx(0.84), z: (x, y) => rim(x / 0.84, y / 0.84) * near(x / 0.84, y / 0.84) + 0.5 }], false);
    const c = [Math.cos(h) * R * 0.32, Math.sin(h) * R * 0.32], d = R * 0.2; // 다이아몬드 중심은 홈 쪽으로
    const dia = [0, 1, 2, 3].map((i) => [c[0] + d * Math.cos(h + i * Math.PI / 2), c[1] + d * Math.sin(h + i * Math.PI / 2)]);
    return group(M(stands, C.wall), M(roof, C.grey), M(loft([{ pts: fx(0.66), z: 0.3 }]), C.green), M(loft([{ pts: dia, z: 0.4 }]), C.dirt));
  },
  worldcup(p) { // 지붕 막(방패연) + 기둥 16개, 기둥 꼭대기 49 m(추정)
    const H = 49, g = BUILD.bowl(p, 30, 0.6, { roof: 0.72 });
    p.foot.filter((_, i) => i % Math.max(1, Math.round(p.foot.length / 16)) === 0)
      .forEach(([x, y]) => { const m = M(box(1.2, 1.2, H, 0, x, y), C.grey); g.push(m); });
    return group(g);
  },
  olympic(p) { // 달항아리 곡선: 긴 축 양끝이 낮고 옆이 높은 지붕선(높이 추정)
    const r = (p.rot * Math.PI) / 180, a = p.L / 2;
    return group(BUILD.bowl(p, 45, 0.6, { roof: 0.78, rim: (x, y) => 45 - 20 * ((x * Math.cos(r) + y * Math.sin(r)) / a) ** 2 }));
  },
  opera({ foot }) { // 예술의전당 오페라하우스: 몸체 + 갓 지붕(넓은 챙 + 둥근 갓모자), 높이 추정
    return group(M(loftFoot(foot, [[0, 0.96], [22, 0.96]]), C.wall), M(loftFoot(foot, [[22, 1.06], [23.5, 1.06]]), C.roof),
      M(loftFoot(foot, [[23.5, 0.5], [36, 0.47], [38, 0.4]]), C.roof));
  },
  seoulStation({ L, W }) { // 문화역서울284(구 서울역): 2층 몸체 + 가운데 드럼 위 돔, 높이 추정
    const r = Math.min(W * 0.22, 9);
    return group(M(box(L, W, 13, 0), C.wall), M(box(L * 0.3, W * 1.06, 15, 0), C.stone), M(cyl(r, r, 4, 15), C.stone),
      M(loft(Array.from({ length: 6 }, (_, i) => { const t = i / 5 * Math.PI / 2; return { pts: ellipse(r * Math.cos(t) + 0.01, r * Math.cos(t) + 0.01, 20), z: 19 + r * 1.1 * Math.sin(t) }; }), false), C.dome));
  },
  myeongdong({ L, W, rot }) { // 명동대성당: 본당(벽 15 m + 맞배 23 m = OSM) + 북쪽 끝 종탑 첨탑(45 m 추정)
    const end = Math.sin((rot * Math.PI) / 180) >= 0 ? 1 : -1, x = end * (L / 2 - 4);
    return group(M(box(L, W * 0.6, 15, 0), C.stone), M(gableRoof(L, W * 0.62, 8, 15), C.roof),
      M(box(8, 8, 30, 0, x, 0), C.stone), M(cyl(0.3, 4.6, 15, 30, 4), C.roof));
  },
  warMemorial({ foot }) { // 전쟁기념관 전시실: 낮은 몸체 + 가운데 드럼 위 돔(최고 45 m = OSM)
    return group(M(loftFoot(foot, [[0, 1], [24, 1]]), C.stone),
      M(cyl(13, 13, 6, 24), C.wall), M(loft(Array.from({ length: 6 }, (_, i) => { const t = i / 5 * Math.PI / 2; return { pts: ellipse(13 * Math.cos(t) + 0.01, 13 * Math.cos(t) + 0.01, 20), z: 30 + 15 * Math.sin(t) }; }), false), C.dome));
  },
  botanic({ foot }) { // 서울식물원 온실: 낮은 몸체 위 가운데가 오목한 유리 접시 지붕(높이 추정)
    return group(M(loftFoot(foot, [[0, 1], [8, 1]]), C.wall), M(loftFoot(foot, [[8, 1], [18, 1.02], [13, 0.35]]), C.glass));
  },
  gocheok({ foot }) { // 고척스카이돔: 벽 + 돔, 그라운드에서 지붕까지 67.59 m
    const prof = [[0, 1], [30, 1]]; // 벽 30 m(추정) 위 넓고 납작한 돔
    for (let i = 1; i <= 8; i++) { const t = i / 8 * Math.PI / 2; prof.push([30 + 37.6 * Math.sin(t) ** 0.8, Math.max(Math.cos(t) ** 0.7, 0.05)]); }
    return group(M(loftFoot(foot, prof), C.wall));
  },
  tradetower({ foot }) { // 228 m, 꼭대기 사면을 비스듬히 깎음
    return group(M(loftFoot(foot, [[0, 1], [205, 1], [222, 0.8], [228, 0.55]]), C.grey));
  },
  parc1({ foot, H, L, W, rot }) { // 파크원 타워: 유리 몸체 + 붉은 수직 메가 프레임(모서리 4개), 높이 = OSM
    const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([i, j]) => [i * L / 2 * 0.97, j * W / 2 * 0.97]);
    return group(M(loftFoot(foot, [[0, 1], [H - 4, 1]]), C.glass),
      ...corners.map(([x, y]) => M(box(3, 3, H, 0, x * c - y * s, x * s + y * c), C.red)));
  },
};
function polyArea(pts) { let a = 0; pts.forEach(([x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; a += x * v - u * y; }); return Math.abs(a / 2); }

export const MODELS = { // hand 목록의 id → 만드는 함수 (id 는 prep/landmarks_osm.py HAND 와 같아야 함)
  lotte: BUILD.lotte, namsan: BUILD.namsan, b63: BUILD.b63,
  geunjeongjeon: BUILD.geunjeongjeon, gyeonghoeru: BUILD.gyeonghoeru, gwanghwamun: BUILD.gate2(3),
  cheongwadae: BUILD.cheongwadae, sungnyemun: BUILD.gate2(1), assembly: BUILD.assembly, cityhall: BUILD.cityhall,
  ddp: BUILD.ddp, jamsil_baseball: BUILD.jamsilBaseball, gocheok: BUILD.gocheok, worldcup: BUILD.worldcup,
  olympic: BUILD.olympic, tradetower: BUILD.tradetower, parc1: BUILD.parc1, parc1_t2: BUILD.parc1,
  museum: BUILD.museum, peace_gate: BUILD.peaceGate, jangchung: (p) => BUILD.dome(p, 12, 14), kspo_dome: (p) => BUILD.dome(p, 14, 22),
  jongmyo: BUILD.jongmyo, injeongjeon: BUILD.injeongjeon, heunginjimun: BUILD.heunginjimun,
  opera: BUILD.opera, seoul_station: BUILD.seoulStation, myeongdong: BUILD.myeongdong, war_memorial: BUILD.warMemorial, botanic: BUILD.botanic,
};
const ROTATED = new Set(['geunjeongjeon', 'gyeonghoeru', 'gwanghwamun', 'cheongwadae', 'sungnyemun', 'assembly', 'cityhall',
  'museum', 'peace_gate', 'jongmyo', 'injeongjeon', 'heunginjimun', 'seoul_station', 'myeongdong']);

// 지형: custom layer 의 z=0 은 화면 중심 지반고(transform.elevation, 과장 포함)라서
// 모형 바닥 z = 그 자리 지반고(과장 포함) − 중심 지반고. queryTerrainElevation 이 바로 이 값을 돌려줌.
// fill-extrusion 도 바닥 가운데(centroid) 지반고에 앉으므로 모형도 중심점 지반고를 씀.
// DEM 타일이 아직 안 왔으면(값 0) prep 의 20 m 지반고 z0 × 과장으로 대신함. 지형이 꺼져 있으면 0.
function placeOnGround(map, objs) {
  const t = map.getTerrain && map.getTerrain();
  const ex = t ? (t.exaggeration ?? 1) : 0, cam = t ? (map.transform.elevation || 0) : 0;
  for (const o of objs) {
    if (!o.userData.ll) continue;
    let z = 0;
    if (t) {
      const q = map.queryTerrainElevation(o.userData.ll);
      z = q != null && Math.abs(q + cam) > 1e-6 ? q : o.userData.z0 * ex - cam;
    }
    o.position.z = z;
  }
}

export async function addLandmarks3D(map, { partsUrl, modelsBase } = {}) { // modelsBase: 손 모형이 절차 생성이라 지금은 안 씀
  const res = await fetch(partsUrl);
  if (!res.ok) throw new Error(`landmark parts ${res.status}: ${partsUrl}`);
  const data = await res.json();
  map.addSource('landmark-parts', { type: 'geojson', data });
  map.addLayer({
    id: 'landmark-parts', type: 'fill-extrusion', source: 'landmark-parts',
    filter: ['!', ['has', 'hand']],
    paint: {
      'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'min_h'], 'fill-extrusion-opacity': 1,
    },
  });
  try { THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'); } catch (e) {
    console.info('three.js 못 불러옴 — 특이 건물은 단 쌓기만:', e.message);
    return [];
  }
  const hand = (data.hand || []).filter((d) => MODELS[d.id]);
  const o = maplibregl.MercatorCoordinate.fromLngLat([126.978, 37.566], 0);
  const s = o.meterInMercatorCoordinateUnits();
  const base = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).scale(new THREE.Vector3(s, -s, s));
  map.addLayer({
    id: 'landmarks-3d', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-0.6, -1, 1.6); this.scene.add(sun);
      for (const d of hand) {
        const obj = MODELS[d.id](d);
        const p = maplibregl.MercatorCoordinate.fromLngLat([d.lon, d.lat], 0);
        obj.position.set((p.x - o.x) / s, -(p.y - o.y) / s, 0);
        if (ROTATED.has(d.id)) obj.rotation.z = (d.rot * Math.PI) / 180;
        if (d.face != null && Math.cos(((d.face - d.rot - 90) * Math.PI) / 180) < 0) obj.rotation.z += Math.PI; // 앞(+y)을 face 쪽으로
        obj.name = d.id;
        obj.userData = { ll: [d.lon, d.lat], z0: d.z0 || 0 };
        this.scene.add(obj);
      }
      this.renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },
    render(gl, matrix) {
      placeOnGround(map, this.scene.children);
      this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(base);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
    },
  });
  return hand;
}

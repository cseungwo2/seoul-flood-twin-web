// 지도 위 빗줄기: 개수 · 길이 · 속도 = 시간당 강우에 비례(0 이면 멈춤). 보기용 장식이라 계산과 무관.
export function createRain(canvas) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let rain = 0, drops = [], raf = 0;
  const fit = () => {
    const d = devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * d; canvas.height = canvas.clientHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (!raf) raf = requestAnimationFrame(tick);
  };
  function tick() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const k = Math.min(1, rain / 174);                        // 0 이슬비 → 1 폭우
    const n = Math.round(k ** 1.4 * (w * h) / 900);
    ctx.clearRect(0, 0, w, h);
    if (!n) { drops = []; raf = 0; return; }
    while (drops.length < n) drops.push({ x: Math.random() * (w + h * 0.4), y: Math.random() * 2 * h - h, v: 0.7 + Math.random() * 0.6 });
    drops.length = n;
    ctx.fillStyle = `rgba(30, 40, 56, ${0.22 * k ** 1.5})`;   // 비 거셀수록 어둡게
    ctx.fillRect(0, 0, w, h);
    const len = 6 + 34 * k, sp = 5 + 25 * k, slant = 0.05 + 0.3 * k; // 길이 · 속도 · 기울기 모두 커짐
    ctx.strokeStyle = `rgba(55, 90, 140, ${0.3 + 0.4 * k})`; ctx.lineWidth = 0.8 + 1.2 * k; ctx.beginPath();
    for (const d of drops) {
      if (!still.matches) { d.y += sp * d.v; d.x -= sp * d.v * slant; }
      if (d.y > h + len || d.x < -len) { d.x = Math.random() * (w + h * 0.4); d.y = -len; }
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + len * slant, d.y - len);
    }
    ctx.stroke();
    raf = still.matches ? 0 : requestAnimationFrame(tick); // 움직임 줄이기 설정이면 멈춘 한 장만
  }
  new ResizeObserver(fit).observe(canvas);
  return { set(r) { rain = r; if (!raf) raf = requestAnimationFrame(tick); } };
}

// 상단 실시간 서울 날씨: Open-Meteo(키 없음 · CORS 허용). 시각은 30초, 날씨는 10분마다. 실패하면 칸을 숨김.
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m&hourly=precipitation&past_hours=1&forecast_hours=1&timezone=Asia%2FSeoul';
const DAY = ['일', '월', '화', '수', '목', '금', '토'];

/** onApply(mmPerHour): '실제 강우 적용' 을 누르면 지난 1시간 강수(mm = mm/h)를 넘김. */
export function initWeather(onApply) {
  const $ = (id) => document.getElementById(id);
  let rain = null;
  const clock = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    $('wx-date').textContent = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}(${DAY[d.getDay()]})`;
    $('wx-time').textContent = `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const load = async () => {
    try {
      const j = await (await fetch(URL)).json();
      // 현재 강우량(mm/h) = hourly 강수(그 시각까지 지난 1시간 합 mm) 중 지금 시각(정시 내림)의 값
      const hour = j.current.time.slice(0, 13) + ':00', i = j.hourly.time.indexOf(hour);
      rain = i < 0 ? j.hourly.precipitation.at(-1) : j.hourly.precipitation[i];
      $('wx-temp').textContent = j.current.temperature_2m.toFixed(1);
      $('wx-rain').textContent = rain.toFixed(1);
      $('wx').hidden = false;
    } catch (e) { console.info('날씨 없이 계속:', e.message); $('wx').hidden = true; }
  };
  $('wx-apply').addEventListener('click', () => { if (rain != null) onApply(rain); });
  clock(); setInterval(clock, 30e3);
  load(); setInterval(load, 600e3);
}

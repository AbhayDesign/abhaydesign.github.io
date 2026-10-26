/* Live weather circle for Noida – data from https://open-meteo.com/ (no API key needed) */
(() => {
  const root = document.querySelector("[data-weather]");
  if (!root) return;

  const LAT = 28.5355;
  const LON = 77.391;
  const TZ = "Asia/Kolkata";
  const REFRESH_MS = 15 * 60 * 1000;

  const API =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${LAT}&longitude=${LON}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m" +
    `&timezone=${encodeURIComponent(TZ)}`;

  const $ = (sel) => root.querySelector(sel);
  const els = {
    button: $(".weather-circle"),
    temp: $("[data-temp]"),
    time: $("[data-time]"),
    date: $("[data-date]"),
    cond: $("[data-cond]"),
    feels: $("[data-feels]"),
    humidity: $("[data-humidity]"),
    wind: $("[data-wind]"),
    rain: $("[data-rain]"),
  };

  /* WMO weather codes -> label + icon (day / night variants resolved below) */
  const describe = (code, isDay) => {
    if (code === 0) return { label: isDay ? "Clear sky" : "Clear night", icon: isDay ? "sun" : "moon" };
    if (code === 1) return { label: "Mostly clear", icon: isDay ? "sun" : "moon" };
    if (code === 2) return { label: "Partly cloudy", icon: isDay ? "partly-day" : "partly-night" };
    if (code === 3) return { label: "Overcast", icon: "cloud" };
    if (code === 45 || code === 48) return { label: "Foggy", icon: "fog" };
    if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "rain" };
    if (code >= 61 && code <= 67) return { label: "Rain", icon: "rain" };
    if (code >= 71 && code <= 77) return { label: "Snow", icon: "snow" };
    if (code >= 80 && code <= 82) return { label: "Rain showers", icon: "rain" };
    if (code === 85 || code === 86) return { label: "Snow showers", icon: "snow" };
    if (code >= 95) return { label: "Thunderstorm", icon: "storm" };
    return { label: "Cloudy", icon: "cloud" };
  };

  /* ---------- Live clock (Noida time) ---------- */
  const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
  const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });

  const tick = () => {
    const now = new Date();
    const t = timeFmt.format(now).toUpperCase();
    if (els.time.textContent !== t) els.time.textContent = t;
    els.date.textContent = dateFmt.format(now);
  };
  tick();
  setInterval(tick, 1000);

  /* ---------- Weather ---------- */
  const render = (c) => {
    const isDay = c.is_day === 1;
    const { label, icon } = describe(c.weather_code, isDay);
    const temp = Math.round(c.temperature_2m);

    root.dataset.icon = icon;
    root.dataset.night = String(!isDay);

    els.temp.textContent = `${temp}°`;
    els.cond.textContent = label;
    els.feels.textContent = `${Math.round(c.apparent_temperature)}°C`;
    els.humidity.textContent = `${Math.round(c.relative_humidity_2m)}%`;
    els.wind.textContent = `${Math.round(c.wind_speed_10m)} km/h`;
    els.rain.textContent = `${c.precipitation} mm`;

    els.button.setAttribute("aria-label", `Weather in Noida: ${temp} degrees Celsius, ${label.toLowerCase()}. Show details.`);
  };

  const showError = () => {
    els.temp.textContent = "–°";
    els.cond.textContent = "Weather unavailable right now";
  };

  const load = async () => {
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.current) throw new Error("No current data");
      render(data.current);
    } catch (err) {
      console.warn("Weather fetch failed:", err);
      showError();
    }
  };

  load();
  setInterval(load, REFRESH_MS);

  /* ---------- Open on tap / click (hover & focus are handled in CSS) ---------- */
  const setOpen = (open) => {
    root.classList.toggle("is-open", open);
    els.button.setAttribute("aria-expanded", String(open));
  };

  els.button.addEventListener("click", () => setOpen(!root.classList.contains("is-open")));
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
})();

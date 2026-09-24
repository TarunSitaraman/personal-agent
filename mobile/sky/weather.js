// Live conditions from Open-Meteo (free, no key). Mapped onto the five looks the sky knows.
export function conditionFromCode(code) {
  if (code == null) return 'clear';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'haze';
  if (code >= 2) return 'cloudy'; // overcast, snow and anything else grey
  return 'clear';
}

export async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=weather_code,temperature_2m&timezone=auto';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const d = await r.json();
  return {
    condition: conditionFromCode(d.current?.weather_code),
    temp: typeof d.current?.temperature_2m === 'number' ? Math.round(d.current.temperature_2m) : null,
  };
}

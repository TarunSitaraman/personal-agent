// Ties the sky to the real world: sun position every minute, weather every 15 minutes.
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { sunPosition, dayPart } from './solar';
import { skyPalette } from './palette';
import { fetchWeather } from './weather';

const MINUTE = 60 * 1000;
const WEATHER_EVERY = 15 * MINUTE;
const FIXED_BLUE_HOUR = -4; // elevation used when "Sky follows the sun" is off

export function useSky(settings) {
  const [now, setNow] = useState(() => new Date());
  const [wx, setWx] = useState({ condition: 'clear', temp: null });
  const [systemReduce, setSystemReduce] = useState(false);
  const { lat, lon } = settings.place;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduce);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!settings.liveWeather) { setWx({ condition: 'clear', temp: null }); return undefined; }
    let alive = true;
    const load = () => fetchWeather(lat, lon)
      .then(w => { if (alive) setWx(w); })
      .catch(() => {}); // offline: keep the last sky rather than flicker to clear
    load();
    const id = setInterval(load, WEATHER_EVERY);
    return () => { alive = false; clearInterval(id); };
  }, [lat, lon, settings.liveWeather]);

  return useMemo(() => {
    const sun = sunPosition(now, lat, lon);
    const elevation = settings.followSun ? sun.elevation : FIXED_BLUE_HOUR;
    // Glow follows the sun across the screen: east on the left in the morning, west on the right.
    const sunX = 0.18 + Math.max(0, Math.min(1, (sun.azimuth - 90) / 180)) * 0.64;
    return {
      palette: skyPalette(elevation, wx.condition),
      sunX: settings.followSun ? sunX : 0.5,
      label: dayPart(now, sun.elevation),
      condition: wx.condition,
      temp: wx.temp,
      reduceMotion: settings.reduceMotion || systemReduce,
      now,
    };
  }, [now, lat, lon, wx, settings.followSun, settings.reduceMotion, systemReduce]);
}

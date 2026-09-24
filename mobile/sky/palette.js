// The "blue hour" palette: keyframes by sun elevation, then weather treatment. Pure functions so
// the whole look can be checked without a device.

const KEYS = [
  // Night sits on the splash navy (#050d2c), not black: dark enough behind text, still blue.
  { e: -40, top: [5, 13, 44], mid: [5, 11, 34], hor: [10, 20, 52], glow: [60, 100, 230, 0], warm: 0, stars: 1 },
  { e: -18, top: [5, 13, 44], mid: [5, 11, 34], hor: [10, 20, 52], glow: [60, 100, 230, 0], warm: 0, stars: 1 },
  { e: -12, top: [5, 13, 44], mid: [7, 15, 42], hor: [16, 34, 88], glow: [60, 100, 230, 0.35], warm: 0, stars: 0.7 },
  { e: -6, top: [5, 13, 44], mid: [10, 26, 68], hor: [29, 68, 184], glow: [90, 140, 255, 0.55], warm: 0, stars: 0.35 },
  { e: -2, top: [7, 16, 43], mid: [26, 58, 138], hor: [63, 111, 224], glow: [110, 160, 255, 0.6], warm: 0.28, stars: 0.1 },
  { e: 6, top: [11, 29, 74], mid: [31, 79, 176], hor: [111, 155, 255], glow: [140, 180, 255, 0.55], warm: 0.14, stars: 0 },
  { e: 30, top: [12, 37, 96], mid: [29, 86, 200], hor: [91, 143, 255], glow: [143, 180, 255, 0.5], warm: 0, stars: 0 },
  { e: 70, top: [13, 42, 110], mid: [37, 99, 216], hor: [106, 160, 255], glow: [169, 198, 255, 0.5], warm: 0, stars: 0 },
];

export const WEATHER = {
  clear: { dark: 1, sat: 1, glow: 1, clouds: 0, rain: 0, drops: 0, stars: 1, haze: 0 },
  cloudy: { dark: 0.86, sat: 0.7, glow: 0.6, clouds: 1, rain: 0, drops: 0, stars: 0, haze: 0 },
  haze: { dark: 0.95, sat: 0.75, glow: 0.8, clouds: 0, rain: 0, drops: 0, stars: 0, haze: 1 },
  rain: { dark: 0.74, sat: 0.55, glow: 0.4, clouds: 1.3, rain: 1, drops: 1, stars: 0, haze: 0 },
  storm: { dark: 0.62, sat: 0.5, glow: 0.3, clouds: 1.6, rain: 1.6, drops: 1.4, stars: 0, haze: 0 },
};

const TOP_CAP = [13, 42, 110]; // #0d2a6e — the top of the screen sits behind text, so it never gets brighter
const CITY_GLOW = [46, 58, 100]; // clouds at night catch the city's light from below
const FLOOR = [4, 6, 15]; // #04060f

const lerp = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

function keyAt(e) {
  if (e <= KEYS[0].e) return KEYS[0];
  const last = KEYS[KEYS.length - 1];
  if (e >= last.e) return last;
  const i = KEYS.findIndex(k => k.e > e);
  const a = KEYS[i - 1], b = KEYS[i];
  const t = (e - a.e) / (b.e - a.e);
  return {
    top: mixC(a.top, b.top, t), mid: mixC(a.mid, b.mid, t), hor: mixC(a.hor, b.hor, t),
    glow: mixC(a.glow, b.glow, t), warm: lerp(a.warm, b.warm, t), stars: lerp(a.stars, b.stars, t),
  };
}

// Weather only ever dims: desaturate toward luminance, then darken.
function treat(c, w) {
  const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return c.map(v => (l + (v - l) * w.sat) * w.dark);
}

const rgb = c => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`;
const rgba = (c, a) => `rgba(${c.slice(0, 3).map(v => Math.round(v)).join(',')},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export function skyPalette(elevation, weather = 'clear') {
  const w = WEATHER[weather] || WEATHER.clear;
  const k = keyAt(elevation);
  const top = treat(k.top, w).map((v, i) => Math.min(v, TOP_CAP[i]));
  const mid = treat(k.mid, w);
  const hor = treat(k.hor, w);
  const night = Math.max(0, Math.min(1, (-6 - elevation) / 12)); // 0 at dusk, 1 by full night
  return {
    stops: [rgb(top), rgb(mid), rgb(hor), rgb(mixC(hor, FLOOR, 0.6)), rgb(FLOOR)],
    positions: [0, 0.4, 0.71, 0.82, 1],
    glow: rgba(treat(k.glow, w), k.glow[3] * w.glow),
    glowAlpha: k.glow[3] * w.glow,
    warm: k.warm * w.glow,
    stars: k.stars * w.stars,
    cloud: rgb(mixC(treat(k.mid, { ...w, sat: w.sat * 0.6 }).map(v => v * 0.82), CITY_GLOW, night * 0.75)),
    cloudAmount: w.clouds,
    haze: w.haze,
    rain: w.rain,
    drops: w.drops,
    storm: weather === 'storm',
    hor: rgb(hor),
    top: rgb(top),
  };
}

// Sun position from date and coordinates (low-precision almanac formula, good to ~0.5° — plenty
// for colouring a sky). Elevation drives the palette; azimuth decides where the glow sits.
const RAD = Math.PI / 180;

export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((((gmst * 15 + lon - ra) % 360) + 540) % 360 - 180) * RAD;
  const la = lat * RAD;
  const elevation = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / RAD;
  const az = Math.atan2(
    -Math.sin(ha) * Math.cos(dec),
    Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(ha),
  ) / RAD;
  return { elevation, azimuth: (az + 360) % 360 };
}

// What to call this part of the day. Follows the clock, except around sunrise/sunset where the
// sun itself is the better signal.
export function dayPart(date, elevation) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (elevation <= -6) return 'Night';
  if (elevation <= 0) return 'Blue hour';
  if (elevation <= 12 && h >= 12) return 'Golden hour';
  if (h < 11) return 'Morning';
  if (h < 15) return 'Midday';
  return 'Afternoon';
}

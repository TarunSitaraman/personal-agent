// Blu design tokens. One accent, glass as the only material, Helvetica (TeX Gyre Heros) everywhere.
// Heros ships only Regular and Bold, embedded at build time by the expo-font plugin; on Android the
// family name is the file name. Never combine these with fontWeight — Android would synthesise a
// fake bold on top of the real one.
export const C = {
  bg: '#04060f',
  ink: '#050d2c',
  accent: '#82a9ff',
  text: '#f4f7ff',
  text2: 'rgba(228,236,255,0.66)',
  text3: 'rgba(228,236,255,0.40)',
  line: 'rgba(255,255,255,0.10)',
  glass: 'rgba(20,32,70,0.38)',
  glassStrong: 'rgba(10,18,44,0.82)',
  rim: 'rgba(255,255,255,0.16)',
  danger: '#ff8f8f',
};

export const F = {
  regular: { fontFamily: 'Heros-Regular' },
  bold: { fontFamily: 'Heros-Bold' },
};

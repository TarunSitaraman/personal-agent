// Blu design tokens, modelled on iOS dark-mode semantics: label/secondary/tertiary text, grey
// fills, grouped cells, system blue. Type is Heros (Helvetica) — Regular and Bold are the only
// weights, embedded by the expo-font plugin; never add fontWeight on top (Android fakes a bolder
// bold). Colour means something: blue acts, red warns, everything else is a shade of label.
export const C = {
  bg: '#04060f',
  ink: '#050d2c',
  accent: '#0A84FF', // iOS system blue (dark)
  green: '#30D158',
  orange: '#FF9F0A',
  red: '#FF453A',

  label: '#FFFFFF',
  label2: 'rgba(235,235,245,0.62)',
  label3: 'rgba(235,235,245,0.32)',

  separator: 'rgba(84,84,88,0.55)',
  fill: 'rgba(118,118,128,0.24)', // buttons, fields, segmented track
  tinted: 'rgba(10,132,255,0.16)', // "bordered" buttons: tinted fill, blue label

  cell: '#131725', // grouped cell, navy-shifted secondarySystemGroupedBackground
  sheet: '#0c0f1a', // sheet background
  material: 'rgba(19,23,37,0.92)', // floating bar and toast over moving content
};

const R = 'Heros-Regular';
const B = 'Heros-Bold';

export const F = { regular: { fontFamily: R }, bold: { fontFamily: B } };

// The iOS text styles, with tracking tightened for Helvetica's wider set.
export const T = {
  largeTitle: { fontFamily: B, fontSize: 34, lineHeight: 41, letterSpacing: -0.7, color: C.label },
  title2: { fontFamily: B, fontSize: 22, lineHeight: 28, letterSpacing: -0.35, color: C.label },
  title3: { fontFamily: B, fontSize: 20, lineHeight: 25, letterSpacing: -0.25, color: C.label },
  headline: { fontFamily: B, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: C.label },
  body: { fontFamily: R, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: C.label },
  callout: { fontFamily: R, fontSize: 16, lineHeight: 21, letterSpacing: -0.15, color: C.label },
  subhead: { fontFamily: R, fontSize: 15, lineHeight: 20, letterSpacing: -0.1, color: C.label2 },
  footnote: { fontFamily: R, fontSize: 13, lineHeight: 18, color: C.label2 },
  caption: { fontFamily: R, fontSize: 12, lineHeight: 16, color: C.label2 },
  // Small uppercase group header, as in Settings.
  groupHeader: { fontFamily: R, fontSize: 13, lineHeight: 18, color: C.label2, textTransform: 'uppercase', letterSpacing: 0.2 },
};

export const RADIUS = { cell: 12, card: 16, sheet: 16, button: 14 };
export const HAIRLINE = 0.5;

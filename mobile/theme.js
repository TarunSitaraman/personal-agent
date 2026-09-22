// Blu design tokens. The look is the approved mockups (dark glass over a live sky, one pastel
// accent taken from the sky's blue); the structure borrows iOS conventions (text styles, sheets
// with Done, grouped settings). Type is Heros (Helvetica), Regular and Bold only, embedded by the
// expo-font plugin — never add fontWeight on top (Android fakes a bolder bold).
export const C = {
  bg: '#04060f',
  ink: '#07122e', // text on accent and on white
  accent: '#82a9ff',
  accentGlow: 'rgba(130,169,255,0.45)',
  red: '#ff9b9b',
  doneBg: '#1d6b4a', doneInk: '#c9f5dd', // swipe reveals, muted so they sit in the night palette
  laterBg: '#6b4c1d', laterInk: '#f5e3c9',

  label: '#FFFFFF',
  label2: 'rgba(235,238,250,0.66)',
  label3: 'rgba(235,238,250,0.40)',
  hairline: 'rgba(255,255,255,0.13)',

  // Glass: a top-lit gradient, a thin rim and a brighter top edge, as in the mockups' .glass.
  glassTop: 'rgba(255,255,255,0.13)',
  glassBottom: 'rgba(255,255,255,0.04)',
  glassRim: 'rgba(255,255,255,0.17)',
  glassEdge: 'rgba(255,255,255,0.32)',
  sheet: 'rgba(8,13,32,0.94)', // under a sheet's glass, so text stays readable over the sky
  chip: 'rgba(255,255,255,0.07)',
  chipRim: 'rgba(255,255,255,0.15)',
};

const R = 'Heros-Regular';
const B = 'Heros-Bold';

export const F = { regular: { fontFamily: R }, bold: { fontFamily: B } };

// Text styles. Primary lines are bold (the mockups' voice); descriptive text is regular.
export const T = {
  hero: { fontFamily: B, fontSize: 42, lineHeight: 44, letterSpacing: -1.5, color: C.label },
  title: { fontFamily: B, fontSize: 22, lineHeight: 27, letterSpacing: -0.4, color: C.label },
  headline: { fontFamily: B, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: C.label },
  body: { fontFamily: R, fontSize: 16, lineHeight: 23, color: C.label },
  sub: { fontFamily: R, fontSize: 14, lineHeight: 19, color: C.label2 },
  small: { fontFamily: R, fontSize: 12, lineHeight: 16, color: C.label3 },
  // The mockups' .lab: small bold uppercase, widely tracked.
  label: { fontFamily: B, fontSize: 11, lineHeight: 14, letterSpacing: 1.3, textTransform: 'uppercase', color: C.label2 },
};

export const RADIUS = { chip: 14, card: 18, group: 18, sheet: 30, button: 999 };
export const HAIRLINE = 1;
export const SPRING = { damping: 18, stiffness: 260, mass: 0.8 };

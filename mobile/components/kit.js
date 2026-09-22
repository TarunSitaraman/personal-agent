// The element kit from the approved mockups (component-sheet-v2 / app-screens), in React Native.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  SlideInDown, SlideOutUp, useDerivedValue,
} from 'react-native-reanimated';
import { Canvas, RoundedRect, SweepGradient, vec, useClock } from '@shopify/react-native-skia';
import Press from './Press';
import { C, T, RADIUS } from '../theme';

// Small bold uppercase label; `link` adds the chevron that says "tap me".
export function Label({ children, link, color, style }) {
  return <Text style={[T.label, color && { color }, style]}>{children}{link ? '  ›' : ''}</Text>;
}

// Chip: default, `accent` (solid), `line` (accent outline), `warn`. Springs on press.
export function Chip({ title, onPress, kind = 'default', size = 'medium' }) {
  const small = size === 'small';
  return (
    <Press onPress={onPress} style={[s.chip, small && s.chipSmall, kind === 'accent' && s.chipAccent, kind === 'line' && s.chipLine]}>
      <Text style={[s.chipText, small && { fontSize: 12 }, kind === 'accent' && { color: C.ink }, kind === 'line' && { color: '#c3d4ff' }, kind === 'warn' && { color: C.red }]}>
        {title}
      </Text>
    </Press>
  );
}

// A string whose characters roll into place when they change, like a departures board.
export function Rolling({ text, style }) {
  const flat = StyleSheet.flatten(style) || {};
  const height = flat.lineHeight || Math.round((flat.fontSize || 14) * 1.25);
  return (
    <View style={s.rollRow}>
      {String(text).split('').map((ch, i) => (
        <View key={i} style={[s.rollCell, { height }]}>
          <Animated.Text key={ch} entering={SlideInDown.duration(260)} exiting={SlideOutUp.duration(220)} style={style}>
            {ch}
          </Animated.Text>
        </View>
      ))}
    </View>
  );
}

// "in 50m", "15h 20m", "now" — a countdown to `iso`, re-rendered by the caller every minute.
export function countdown(iso, now) {
  const m = Math.round((new Date(iso) - now) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.round(h / 24)} days`;
}

// Shimmering placeholder line for first load.
export function Skeleton({ width = '80%', height = 12, style }) {
  const o = useSharedValue(0.35);
  useEffect(() => { o.value = withRepeat(withTiming(0.9, { duration: 800 }), -1, true); }, []);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width, height, borderRadius: height / 2, backgroundColor: 'rgba(255,255,255,0.10)' }, anim, style]} />;
}

// The one special button (the mockups' ShinyButton): a light that runs round a dark capsule.
// Used only for sign-in, so its rarity is what makes it special.
export function ShinyButton({ title, onPress, disabled, busy }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const clock = useClock();
  const spin = useDerivedValue(() => [{ rotate: ((clock.value / 3000) % 1) * Math.PI * 2 }]);
  const { w, h } = box;
  return (
    <Press onPress={onPress} disabled={disabled || busy} style={[s.shiny, (disabled || busy) && { opacity: 0.45 }]} onLayout={e => setBox(e.nativeEvent.layout)}>
      {w ? (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <RoundedRect x={0.5} y={0.5} width={w - 1} height={h - 1} r={h / 2} style="stroke" strokeWidth={1.5}>
            <SweepGradient
              c={vec(w / 2, h / 2)}
              transform={spin}
              origin={vec(w / 2, h / 2)}
              colors={['rgba(79,125,255,0)', '#4f7dff', '#ffffff', '#4f7dff', 'rgba(79,125,255,0)', 'rgba(79,125,255,0)']}
              positions={[0, 0.07, 0.14, 0.21, 0.28, 1]}
            />
          </RoundedRect>
        </Canvas>
      ) : null}
      <Text style={[T.headline, { color: '#fff' }]}>{busy ? 'Connecting…' : title}</Text>
    </Press>
  );
}

// Input that glows accent when focused.
export function GlowInput(props) {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.label3}
      {...props}
      onFocus={e => { setFocus(true); props.onFocus?.(e); }}
      onBlur={e => { setFocus(false); props.onBlur?.(e); }}
      style={[s.input, focus && s.inputFocus, props.style]}
    />
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.chip, backgroundColor: C.chip, borderWidth: 1, borderColor: C.chipRim },
  chipSmall: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12 },
  chipAccent: { backgroundColor: C.accent, borderColor: C.accent },
  chipLine: { backgroundColor: 'transparent', borderColor: 'rgba(130,169,255,0.55)' },
  chipText: { fontFamily: 'Heros-Bold', fontSize: 13, color: '#e2e6f5' },
  rollRow: { flexDirection: 'row', overflow: 'hidden' },
  rollCell: { overflow: 'hidden' },
  shiny: { height: 52, borderRadius: 26, backgroundColor: '#060b1c', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  input: {
    height: 52, borderRadius: 14, paddingHorizontal: 16, color: C.label, fontSize: 16, fontFamily: 'Heros-Bold',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  inputFocus: { borderColor: 'rgba(130,169,255,0.75)', shadowColor: C.accent, shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
});

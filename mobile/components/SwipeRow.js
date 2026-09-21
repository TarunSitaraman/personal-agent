// A todo row. Swipe right to finish, left to snooze an hour; tap for details. No box around it —
// rows are separated by rhythm and a hairline, not cards.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, runOnJS, Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { C, F } from '../theme';

const TRIGGER = 96;

export default function SwipeRow({ title, meta, onPress, onDone, onSnooze }) {
  const x = useSharedValue(0);
  const armed = useSharedValue(0);

  const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate(e => {
      x.value = e.translationX;
      const now = Math.abs(e.translationX) > TRIGGER ? 1 : 0;
      if (now !== armed.value) { armed.value = now; if (now) runOnJS(tick)(); }
    })
    .onEnd(e => {
      if (e.translationX > TRIGGER) {
        x.value = withTiming(500, { duration: 180 }, () => runOnJS(onDone)());
      } else if (e.translationX < -TRIGGER) {
        x.value = withSpring(0);
        runOnJS(onSnooze)();
      } else {
        x.value = withSpring(0);
      }
      armed.value = 0;
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const doneStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [10, TRIGGER], [0, 1], Extrapolation.CLAMP) }));
  const snoozeStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-10, -TRIGGER], [0, 1], Extrapolation.CLAMP) }));

  return (
    <View style={s.wrap}>
      <Animated.Text style={[s.under, s.left, doneStyle]}>Done</Animated.Text>
      <Animated.Text style={[s.under, s.right, snoozeStyle]}>Snooze 1h</Animated.Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}>
            <View style={s.ring} />
            <Text style={s.title} numberOfLines={2}>{title}</Text>
            {meta ? <Text style={s.meta}>{meta}</Text> : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, gap: 14 },
  ring: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.6, borderColor: 'rgba(228,236,255,0.5)' },
  title: { flex: 1, ...F.bold, fontSize: 17, color: C.text, lineHeight: 22 },
  meta: { ...F.bold, fontSize: 13, color: C.accent },
  under: { position: 'absolute', top: 0, bottom: 0, textAlignVertical: 'center', ...F.bold, fontSize: 14 },
  left: { left: 0, color: C.accent },
  right: { right: 0, color: C.text2 },
});

// A todo, as a Reminders row: tap the circle to complete, tap the row for details, swipe right to
// complete or left for "Later" (snooze an hour). Lives inside a Group, which passes `last`, or
// with `plain` directly on the sky: then the row is transparent and each action colour fills only
// the strip the row has uncovered, so it never shows through the text.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, runOnJS, Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Icon from './Icon';
import { C, T, HAIRLINE } from '../theme';

const TRIGGER = 90;

export default function SwipeRow({ title, meta, overdue, onPress, onDone, onSnooze, last, plain }) {
  const x = useSharedValue(0);
  const armed = useSharedValue(0);
  const [ticked, setTicked] = useState(false);

  const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  // Tapping the circle fills it first, so the completion is seen before the row leaves.
  const tapCircle = () => {
    if (ticked) return;
    setTicked(true);
    setTimeout(onDone, 260);
  };

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
        x.value = withTiming(600, { duration: 200 }, () => runOnJS(onDone)());
      } else if (e.translationX < -TRIGGER) {
        x.value = withSpring(0, { damping: 20 });
        runOnJS(onSnooze)();
      } else {
        x.value = withSpring(0, { damping: 20 });
      }
      armed.value = 0;
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const doneStyle = useAnimatedStyle(() => (plain
    ? { width: Math.max(0, x.value) }
    : { opacity: interpolate(x.value, [0, 24], [0, 1], Extrapolation.CLAMP) }));
  const laterStyle = useAnimatedStyle(() => (plain
    ? { width: Math.max(0, -x.value) }
    : { opacity: interpolate(x.value, [0, -24], [0, 1], Extrapolation.CLAMP) }));

  return (
    <View style={[s.wrap, plain && s.plain]}>
      <Animated.View style={[s.under, { left: 0, backgroundColor: C.accent, justifyContent: 'flex-start' }, !plain && { right: 0 }, doneStyle]}>
        <Icon name="check" size={22} color="#fff" stroke={2.6} />
      </Animated.View>
      <Animated.View style={[s.under, { right: 0, backgroundColor: C.orange, justifyContent: 'flex-end' }, !plain && { left: 0 }, laterStyle]}>
        <Text style={[T.headline, { color: '#fff' }]}>Later</Text>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[s.row, plain && s.plain, rowStyle]}>
          <Pressable onPress={tapCircle} hitSlop={10} style={[s.circleHit, plain && s.circleHitPlain]} accessibilityRole="checkbox" accessibilityLabel={`Complete ${title}`}>
            <View style={[s.circle, ticked && s.circleOn]}>
              {ticked ? <Icon name="check" size={13} color="#fff" stroke={3} /> : null}
            </View>
          </Pressable>
          <Pressable onPress={onPress} style={({ pressed }) => [s.main, !last && s.separator, plain && s.plainSeparator, plain && last && { borderBottomWidth: 0 }, pressed && { opacity: 0.6 }]}>
            <Text style={[T.body, ticked && { color: C.label3 }]} numberOfLines={2}>{title}</Text>
            {meta ? <Text style={[T.subhead, { marginTop: 2 }, overdue && { color: C.red }]}>{meta}</Text> : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: C.cell },
  under: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  row: { flexDirection: 'row', backgroundColor: C.cell },
  circleHit: { width: 52, alignItems: 'center', paddingTop: 13 },
  circleHitPlain: { width: 38, alignItems: 'flex-start' },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.label3, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: C.accent, borderColor: C.accent },
  main: { flex: 1, paddingVertical: 12, paddingRight: 16, minHeight: 50, justifyContent: 'center' },
  separator: { borderBottomWidth: HAIRLINE, borderBottomColor: C.separator },
  plain: { backgroundColor: 'transparent', overflow: 'hidden' },
  plainSeparator: { borderBottomWidth: HAIRLINE, borderBottomColor: 'rgba(255,255,255,0.12)' },
});

// A todo row on the sky, as in the mockups: tap the circle and it fills and ticks with a spring
// while the title fades; tap the row for details; swipe right for Done, left for Later. Each
// action colour fills only the strip the row uncovers, so it never shows through the text.
import React from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, interpolate, Extrapolation, FadeInDown,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Icon from './Icon';
import { C, T, SPRING } from '../theme';

const TRIGGER = 90;

export default function SwipeRow({ title, meta, overdue, onPress, onDone, onSnooze, last, index = 0 }) {
  const x = useSharedValue(0);
  const armed = useSharedValue(0);
  const ticked = useSharedValue(0);

  const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  // The circle fills first, so the completion is seen before the row leaves.
  const tapCircle = () => {
    if (ticked.value) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    ticked.value = withSpring(1, SPRING);
    setTimeout(onDone, 420);
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
        x.value = withSpring(0, SPRING);
        runOnJS(onSnooze)();
      } else {
        x.value = withSpring(0, SPRING);
      }
      armed.value = 0;
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const doneStrip = useAnimatedStyle(() => ({ width: Math.max(0, x.value) }));
  const laterStrip = useAnimatedStyle(() => ({ width: Math.max(0, -x.value) }));
  const circle = useAnimatedStyle(() => ({
    backgroundColor: ticked.value > 0.5 ? C.accent : 'transparent',
    borderColor: ticked.value > 0.5 ? C.accent : 'rgba(255,255,255,0.45)',
    transform: [{ scale: interpolate(ticked.value, [0, 0.6, 1], [1, 1.15, 1.06], Extrapolation.CLAMP) }],
  }));
  const checkmark = useAnimatedStyle(() => ({ opacity: ticked.value, transform: [{ scale: 0.4 + ticked.value * 0.6 }] }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: 1 - ticked.value * 0.55 }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(320)} style={s.wrap}>
      <Animated.View style={[s.strip, { left: 0, backgroundColor: C.doneBg, justifyContent: 'flex-start' }, doneStrip]}>
        <Text style={[s.stripText, { color: C.doneInk }]}>Done</Text>
      </Animated.View>
      <Animated.View style={[s.strip, { right: 0, backgroundColor: C.laterBg, justifyContent: 'flex-end' }, laterStrip]}>
        <Text style={[s.stripText, { color: C.laterInk }]}>Later</Text>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[s.row, !last && s.hairline, rowStyle]}>
          <Pressable onPress={tapCircle} hitSlop={12} style={s.circleHit} accessibilityRole="checkbox" accessibilityLabel={`Complete ${title}`}>
            <Animated.View style={[s.circle, circle]}>
              <Animated.View style={checkmark}><Icon name="check" size={12} color={C.ink} stroke={3.2} /></Animated.View>
            </Animated.View>
          </Pressable>
          <Pressable onPress={onPress} style={({ pressed }) => [s.main, pressed && { opacity: 0.6 }]}>
            <Animated.Text style={[T.headline, titleStyle]} numberOfLines={2}>{title}</Animated.Text>
            {meta ? <Text style={[T.sub, { marginTop: 2, fontSize: 13 }, overdue && { color: C.red }]}>{meta}</Text> : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  strip: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  stripText: { fontFamily: 'Heros-Bold', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  hairline: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.hairline },
  circleHit: { width: 34, paddingTop: 14 },
  circle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, paddingVertical: 13, paddingRight: 4, minHeight: 50, justifyContent: 'center' },
});

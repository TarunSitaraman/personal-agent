// A glass sheet: springs up over a dimmed screen, grabber on top, title and Done, drag down (or
// tap outside, or Back) to close. Rendered in the root view rather than a Modal so the sky stays behind it.
import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions, BackHandler } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SheetHeader } from './ui';
import Glass from './Glass';
import { C, RADIUS } from '../theme';

const SPRING = { damping: 22, stiffness: 240, mass: 0.9 }; // a touch of overshoot, as in the mockups

export default function Sheet({ open, onClose, title, heightRatio = 0.9, children }) {
  const { height: H } = useWindowDimensions();
  const h = Math.round(H * heightRatio);
  const y = useSharedValue(h);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      y.value = withSpring(0, SPRING);
    } else {
      y.value = withTiming(h, { duration: 230 }, done => { if (done) runOnJS(setMounted)(false); });
    }
  }, [open, h]);

  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);

  const drag = Gesture.Pan()
    .onUpdate(e => { y.value = Math.max(0, e.translationY); })
    .onEnd(e => {
      if (e.translationY > h * 0.2 || e.velocityY > 900) runOnJS(onClose)();
      else y.value = withSpring(0, SPRING);
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, h], [1, 0]) }));

  if (!mounted) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[s.sheet, { height: h }, sheetStyle]}>
        <Glass radius={RADIUS.sheet} base={C.sheet} shadow={false} style={StyleSheet.absoluteFill} />
        <GestureDetector gesture={drag}>
          <View>
            <View style={s.grabberZone}><View style={s.grabber} /></View>
            {title != null ? <SheetHeader title={title} onDone={onClose} /> : null}
          </View>
        </GestureDetector>
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(2,3,10,0.5)' },
  sheet: {
    position: 'absolute', left: 6, right: 6, bottom: -RADIUS.sheet,
    borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, overflow: 'hidden', paddingBottom: RADIUS.sheet,
  },
  grabberZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
});

// An iOS-style page sheet: rises over a dimmed screen, grabber on top, drag down (or tap outside,
// or Back) to close. Rendered in the root view rather than a Modal so the sky stays behind it.
import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions, BackHandler } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SheetHeader } from './ui';
import { C, RADIUS } from '../theme';

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };

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
        <GestureDetector gesture={drag}>
          <View>
            <View style={s.grabberZone}><View style={s.grabber} /></View>
            {title ? <SheetHeader title={title} onDone={onClose} /> : null}
          </View>
        </GestureDetector>
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.sheet,
    borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, overflow: 'hidden',
  },
  grabberZone: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(235,235,245,0.3)' },
});

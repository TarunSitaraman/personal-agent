// Bottom sheet over the sky: springs up, drag the handle down (or tap outside, or Back) to close.
// Rendered in the root view rather than a Modal, so the live sky stays visible behind it.
import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions, BackHandler } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Glass from './Glass';
import { C } from '../theme';

const SPRING = { damping: 24, stiffness: 240, mass: 0.9 };

export default function Sheet({ open, onClose, heightRatio = 0.88, children }) {
  const { height: H } = useWindowDimensions();
  const h = Math.round(H * heightRatio);
  const y = useSharedValue(h);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      y.value = withSpring(0, SPRING);
    } else {
      y.value = withTiming(h, { duration: 220 }, done => { if (done) runOnJS(setMounted)(false); });
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
      if (e.translationY > h * 0.22 || e.velocityY > 900) runOnJS(onClose)();
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
        <Glass radius={30} tint={C.glassStrong} style={StyleSheet.absoluteFill} />
        <GestureDetector gesture={drag}>
          <View style={s.handleZone}><View style={s.handle} /></View>
        </GestureDetector>
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(2,4,12,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden' },
  handleZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  handle: { width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
});

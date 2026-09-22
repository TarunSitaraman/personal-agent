// One glass toast at a time above the bar. When it offers Undo, a thin accent bar drains across
// its bottom edge for exactly as long as Undo is possible.
import React, { useEffect } from 'react';
import { Text, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import Glass from './Glass';
import { C, T } from '../theme';

export const TOAST_MS = 4000;

export default function Toast({ toast, onDismiss, bottom }) {
  const left = useSharedValue(1);

  useEffect(() => {
    if (!toast) return undefined;
    left.value = 1;
    left.value = withTiming(0, { duration: TOAST_MS, easing: Easing.linear });
    const id = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);

  const drain = useAnimatedStyle(() => ({ width: `${left.value * 100}%` }));

  if (!toast) return null;
  return (
    <Animated.View key={toast.id} entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(160)} style={[s.wrap, { bottom }]}>
      <Glass radius={18} base="rgba(8,13,32,0.88)" style={s.toast}>
        <Text style={[T.headline, { fontSize: 14, flex: 1 }]} numberOfLines={1}>{toast.text}</Text>
        {toast.onUndo ? (
          <Pressable hitSlop={12} onPress={() => { toast.onUndo(); onDismiss(); }}>
            <Text style={[T.headline, { fontSize: 14, color: C.accent }]}>Undo</Text>
          </Pressable>
        ) : null}
        {toast.onUndo ? <View style={s.track}><Animated.View style={[s.bar, drain]} /></View> : null}
      </Glass>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 18, right: 18 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, height: 50, overflow: 'hidden' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  bar: { height: 2, backgroundColor: C.accent },
});

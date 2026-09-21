// One notice at a time, a compact capsule above the bar, with an optional Undo.
import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { C, T } from '../theme';

export const TOAST_MS = 4000;

export default function Toast({ toast, onDismiss, bottom }) {
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
      <Animated.View key={toast.id} entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(160)} style={s.capsule}>
        <Text style={[T.subhead, { color: C.label, flexShrink: 1 }]} numberOfLines={1}>{toast.text}</Text>
        {toast.onUndo ? (
          <Pressable hitSlop={12} onPress={() => { toast.onUndo(); onDismiss(); }}>
            <Text style={[T.subhead, { color: C.accent, fontFamily: 'Heros-Bold' }]}>Undo</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  capsule: {
    flexDirection: 'row', alignItems: 'center', gap: 14, maxWidth: '100%',
    paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: C.material,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
});

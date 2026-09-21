// One toast at a time, above the assistant bar, with an optional Undo.
import React, { useEffect } from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import Glass from './Glass';
import { C, F } from '../theme';

export const TOAST_MS = 4000;

export default function Toast({ toast, onDismiss, bottom }) {
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <Animated.View key={toast.id} entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(160)} style={[s.wrap, { bottom }]}>
      <Glass radius={18} tint={C.glassStrong} style={s.glass}>
        <Text style={s.text} numberOfLines={1}>{toast.text}</Text>
        {toast.onUndo ? (
          <Pressable hitSlop={10} onPress={() => { toast.onUndo(); onDismiss(); }}>
            <Text style={s.undo}>Undo</Text>
          </Pressable>
        ) : null}
      </Glass>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  glass: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, gap: 12 },
  text: { flex: 1, ...F.bold, fontSize: 14, color: C.text },
  undo: { ...F.bold, fontSize: 14, color: C.accent },
});

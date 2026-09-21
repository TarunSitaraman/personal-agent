// The pinned field at the bottom: the one way in to talk to Blu or add something. Styled as an
// iOS search field on a floating material, with no glow.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import { C, T } from '../theme';

export const BAR_HEIGHT = 52;

export default function AssistantBar({ onPress, bottom }) {
  return (
    <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Ask Blu"
        style={({ pressed }) => [s.bar, pressed && { opacity: 0.85 }]}
      >
        <Text style={[T.body, { flex: 1, color: C.label3 }]}>Ask Blu or add a reminder</Text>
        <View style={s.send}><Icon name="arrowUp" size={16} color="#fff" stroke={2.8} /></View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  bar: {
    height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, flexDirection: 'row', alignItems: 'center',
    paddingLeft: 20, paddingRight: 8, backgroundColor: C.material,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
});

// The pinned glass bar: the one way in to talk to Blu or add something.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Glass from './Glass';
import Icon from './Icon';
import { C, F } from '../theme';

export const BAR_HEIGHT = 58;

export default function AssistantBar({ onPress, bottom }) {
  return (
    <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Ask Blu">
        {({ pressed }) => (
          <Glass radius={BAR_HEIGHT / 2} style={[s.bar, pressed && { transform: [{ scale: 0.985 }] }]}>
            <Text style={s.placeholder}>Ask Blu, or add something</Text>
            <View style={s.send}><Icon name="arrowUp" size={18} color={C.ink} stroke={2.6} /></View>
          </Glass>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  bar: { height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingLeft: 22, paddingRight: 8 },
  placeholder: { flex: 1, ...F.bold, fontSize: 16, color: C.text2 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
});

// The pinned glass bar: the one way in to talk to Blu or add something.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Glass from './Glass';
import Icon from './Icon';
import Press from './Press';
import { C } from '../theme';

export const BAR_HEIGHT = 56;

export default function AssistantBar({ onPress, bottom }) {
  return (
    <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
      <Press onPress={onPress} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Ask Blu">
        <Glass radius={BAR_HEIGHT / 2} base="rgba(8,13,32,0.55)" style={s.bar}>
          <Text style={s.placeholder}>Remind, note, ask…</Text>
          <View style={s.go}><Icon name="arrowUp" size={17} color={C.ink} stroke={2.8} /></View>
        </Glass>
      </Press>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14 },
  bar: { height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingLeft: 22, paddingRight: 8 },
  placeholder: { flex: 1, fontFamily: 'Heros-Bold', fontSize: 15, color: 'rgba(235,238,250,0.78)' },
  go: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});

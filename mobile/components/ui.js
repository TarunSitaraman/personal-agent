// Structure, iOS-style — grouped lists, rows, a segmented control, a sheet header with Done — in
// the mockups' glass. Every sheet composes these, so spacing, hairlines and press states match.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import Press from './Press';
import { Label } from './kit';
import { C, T, RADIUS } from '../theme';

// A grouped list in a faint glass container. Rows draw their own hairlines; Group tells each
// whether it is last.
export function Group({ children, style }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[s.group, style]}>
      {items.map((child, i) => React.cloneElement(child, { last: i === items.length - 1 }))}
    </View>
  );
}

// A row: bold title, optional regular subtitle, and on the right a value, a check or a chevron.
export function Row({ title, subtitle, value, chevron, check, destructive, tint, onPress, last, numberOfLines = 2, right }) {
  const body = (
    <View style={[s.rowMain, !last && s.hairline]}>
      <View style={{ flex: 1 }}>
        <Text style={[T.headline, destructive && { color: C.red }, tint && { color: C.accent }]} numberOfLines={numberOfLines}>{title}</Text>
        {subtitle ? <Text style={[T.sub, { marginTop: 2 }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
      {value != null ? <Text style={[T.headline, { color: C.label2, fontSize: 15 }]} numberOfLines={1}>{value}</Text> : null}
      {check ? <Icon name="check" size={18} color={C.accent} stroke={2.6} /> : null}
      {chevron ? <Icon name="chevronRight" size={16} color={C.label3} stroke={2.4} /> : null}
    </View>
  );
  if (!onPress) return <View style={s.row}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && s.pressed]}>
      {body}
    </Pressable>
  );
}

// Label above a group or list, with an optional action on the right.
export function SectionHeader({ title, action, onAction, style }) {
  return (
    <View style={[s.header, style]}>
      <Label>{title}</Label>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          {({ pressed }) => <Label color={C.accent} style={pressed && { opacity: 0.5 }}>{action}</Label>}
        </Pressable>
      ) : null}
    </View>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <View style={s.seg}>
      {options.map(([key, label]) => {
        const on = key === value;
        return (
          <Press key={key} scaleTo={0.97} onPress={() => onChange(key)} style={[s.segItem, on && s.segOn]}>
            <Text style={[T.headline, { fontSize: 13, color: on ? C.label : C.label2 }]}>{label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

// Sheet navigation bar: centred title, Done on the right.
export function SheetHeader({ title, onDone }) {
  return (
    <View style={s.sheetHeader}>
      <Text style={T.headline}>{title}</Text>
      {onDone ? (
        <Pressable onPress={onDone} hitSlop={12} style={s.done}>
          {({ pressed }) => <Text style={[T.headline, { color: C.accent }, pressed && { opacity: 0.4 }]}>Done</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  group: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.group, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', overflow: 'hidden' },
  row: { paddingLeft: 16 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingVertical: 12, paddingRight: 16 },
  hairline: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.hairline },
  pressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 4 },
  seg: { flexDirection: 'row', padding: 3, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.07)' },
  segItem: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  segOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  sheetHeader: { height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  done: { position: 'absolute', right: 18, top: 0, bottom: 0, justifyContent: 'center' },
});

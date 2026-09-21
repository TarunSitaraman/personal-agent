// iOS building blocks: inset grouped lists, rows, section headers, buttons, segmented control.
// Every screen composes these, so spacing, separators and press states stay identical everywhere.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import { C, T, RADIUS, HAIRLINE } from '../theme';

// Inset grouped container; children are Rows. Separators are drawn by the rows themselves.
export function Group({ children, style }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[s.group, style]}>
      {items.map((child, i) => React.cloneElement(child, { last: i === items.length - 1 }))}
    </View>
  );
}

// A list row. `inset` is where the separator starts (after a leading control, like Reminders).
export function Row({ title, subtitle, value, chevron, check, destructive, tint, leading, onPress, last, inset = 16, numberOfLines = 2, children }) {
  const body = (
    <View style={s.rowInner}>
      {leading ? <View style={s.leading}>{leading}</View> : null}
      <View style={[s.rowMain, !last && { borderBottomWidth: HAIRLINE, borderBottomColor: C.separator }]}>
        <View style={{ flex: 1 }}>
          {children || (
            <>
              <Text style={[T.body, destructive && { color: C.red }, tint && { color: C.accent }]} numberOfLines={numberOfLines}>{title}</Text>
              {subtitle ? <Text style={[T.subhead, s.subtitle]} numberOfLines={2}>{subtitle}</Text> : null}
            </>
          )}
        </View>
        {value != null ? <Text style={[T.body, { color: C.label2 }]} numberOfLines={1}>{value}</Text> : null}
        {check ? <Icon name="check" size={18} color={C.accent} stroke={2.4} /> : null}
        {chevron ? <Icon name="chevronRight" size={16} color={C.label3} stroke={2.4} /> : null}
      </View>
    </View>
  );
  const pad = { paddingLeft: leading ? 12 : inset };
  if (!onPress) return <View style={[s.row, pad]}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pad, pressed && s.pressed]}>
      {body}
    </Pressable>
  );
}

// A section title above a group, with an optional trailing action ("Show All").
export function SectionHeader({ title, action, onAction, small }) {
  return (
    <View style={[s.header, small && s.headerSmall]}>
      <Text style={small ? T.groupHeader : T.title3}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          {({ pressed }) => <Text style={[T.body, { color: C.accent }, pressed && { opacity: 0.4 }]}>{action}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

// filled: solid blue, white label. tinted: blue-tinted fill, blue label. gray: grey fill, white label.
export function Button({ title, onPress, kind = 'filled', size = 'medium', style, disabled }) {
  const big = size === 'large';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn, big ? s.btnLarge : s.btnMedium,
        kind === 'filled' && { backgroundColor: C.accent },
        kind === 'tinted' && { backgroundColor: C.tinted },
        kind === 'gray' && { backgroundColor: C.fill },
        (pressed || disabled) && { opacity: disabled ? 0.35 : 0.7 },
        style,
      ]}
    >
      <Text style={[big ? T.headline : [T.subhead, { fontFamily: 'Heros-Bold' }], { color: kind === 'tinted' ? C.accent : C.label }]}>{title}</Text>
    </Pressable>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <View style={s.seg}>
      {options.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable key={key} onPress={() => onChange(key)} style={[s.segItem, on && s.segOn]}>
            <Text style={[T.footnote, { color: C.label, fontFamily: on ? 'Heros-Bold' : 'Heros-Regular' }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Sheet navigation bar: centred title, Done on the right, as in an iOS page sheet.
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
  group: { backgroundColor: C.cell, borderRadius: RADIUS.cell, overflow: 'hidden' },
  row: { backgroundColor: C.cell },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  leading: { width: 40, alignItems: 'center', justifyContent: 'center', paddingRight: 4 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingVertical: 11, paddingRight: 16 },
  subtitle: { marginTop: 2 },
  pressed: { backgroundColor: '#1d2233' },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 4 },
  headerSmall: { paddingHorizontal: 16, marginBottom: 6 },
  btn: { alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  btnMedium: { paddingHorizontal: 16, height: 34 },
  btnLarge: { height: 50, borderRadius: RADIUS.button, paddingHorizontal: 20 },
  seg: { flexDirection: 'row', backgroundColor: C.fill, borderRadius: 9, padding: 2 },
  segItem: { flex: 1, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segOn: { backgroundColor: '#636366' },
  sheetHeader: { height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  done: { position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' },
});

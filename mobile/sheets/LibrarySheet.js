// Everything, not just what's next: todos, upcoming events, notes.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwipeRow from '../components/SwipeRow';
import { when, ago } from '../format';
import { C, F } from '../theme';

const TABS = [['todos', 'Todos'], ['upcoming', 'Upcoming'], ['notes', 'Notes']];

export default function LibrarySheet({ tab, onTab, board, onOpenItem, onDone, onSnooze }) {
  const insets = useSafeAreaInsets();
  const { todos, events, notes } = board;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.segment}>
        {TABS.map(([key, label]) => (
          <Pressable key={key} onPress={() => onTab(key)} style={[s.seg, tab === key && s.segOn]}>
            <Text style={[s.segText, tab === key && s.segTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 30 }}>
        {tab === 'todos' && (todos.length ? todos.map(t => (
          <SwipeRow
            key={t.id}
            title={t.content}
            meta={t.remind_at ? when(t.remind_at) : null}
            onPress={() => onOpenItem({ kind: 'todo', item: t })}
            onDone={() => onDone(t)}
            onSnooze={() => onSnooze(t)}
          />
        )) : <Empty text="Nothing open." />)}

        {tab === 'upcoming' && (events.length ? events.map(e => (
          <Pressable key={e.id} onPress={() => onOpenItem({ kind: 'event', item: e })} style={s.row}>
            <Text style={s.time}>{when(e.start_at)}</Text>
            <Text style={s.title}>{e.title}</Text>
          </Pressable>
        )) : <Empty text="Nothing scheduled." />)}

        {tab === 'notes' && (notes.length ? notes.map(n => (
          <Pressable key={n.id} onPress={() => onOpenItem({ kind: 'note', item: n })} style={s.row}>
            <Text style={s.noteText} numberOfLines={4}>{n.content}</Text>
            <Text style={s.noteMeta}>{ago(n.created_at)}</Text>
          </Pressable>
        )) : <Empty text="No notes yet." />)}
      </ScrollView>
    </View>
  );
}

const Empty = ({ text }) => <Text style={s.empty}>{text}</Text>;

const s = StyleSheet.create({
  segment: { flexDirection: 'row', marginHorizontal: 22, marginBottom: 10, padding: 4, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)' },
  seg: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  segOn: { backgroundColor: 'rgba(130,169,255,0.18)' },
  segText: { ...F.bold, fontSize: 14, color: C.text2 },
  segTextOn: { color: C.text },
  row: { paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  time: { ...F.bold, fontSize: 13, color: C.accent, marginBottom: 4 },
  title: { ...F.bold, fontSize: 17, color: C.text },
  noteText: { ...F.regular, fontSize: 16, lineHeight: 22, color: C.text },
  noteMeta: { ...F.bold, fontSize: 12, color: C.text3, marginTop: 6 },
  empty: { ...F.bold, fontSize: 20, color: C.text3, marginTop: 40 },
});

// Library, from the mockup ("10 · Library"): a segmented control, then todos, upcoming events
// under day labels with accent times, or notes.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwipeRow from '../components/SwipeRow';
import { Segmented } from '../components/ui';
import { Label, Halo } from '../components/kit';
import { when, ago, clock, dayTitle } from '../format';
import { C, T } from '../theme';

const TABS = [['todos', 'Todos'], ['upcoming', 'Upcoming'], ['notes', 'Notes']];

function byDay(events) {
  const days = [];
  for (const e of events) {
    const title = dayTitle(e.start_at);
    const last = days[days.length - 1];
    if (last && last.title === title) last.items.push(e);
    else days.push({ title, items: [e] });
  }
  return days;
}

export default function LibrarySheet({ tab, onTab, board, onOpenItem, onDone, onSnooze }) {
  const insets = useSafeAreaInsets();
  const { todos, events, notes } = board;
  const now = new Date();

  return (
    <View style={{ flex: 1 }}>
      <View style={s.segWrap}><Segmented options={TABS} value={tab} onChange={onTab} /></View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Animated.View key={tab} entering={FadeIn.duration(220)}>
          {tab === 'todos' && (todos.length ? todos.map((t, i) => (
            <SwipeRow
              key={t.id}
              index={i}
              last={i === todos.length - 1}
              title={t.content}
              meta={t.remind_at ? when(t.remind_at) : null}
              overdue={!!t.remind_at && new Date(t.remind_at) < now}
              onPress={() => onOpenItem({ kind: 'todo', item: t })}
              onDone={() => onDone(t)}
              onSnooze={() => onSnooze(t)}
            />
          )) : <Empty title="Nothing open." body="Anything you ask Blu to remember lands here." />)}

          {tab === 'upcoming' && (events.length ? byDay(events).map((day, d) => (
            <Animated.View key={day.title} entering={FadeInDown.delay(d * 60).duration(300)}>
              <Label style={s.day}>{day.title}</Label>
              {day.items.map((e, i) => (
                <Pressable key={e.id} onPress={() => onOpenItem({ kind: 'event', item: e })} style={({ pressed }) => [s.ev, i === day.items.length - 1 && { borderBottomWidth: 0 }, pressed && { opacity: 0.6 }]}>
                  <Text style={s.tm}>{clock(new Date(e.start_at))}</Text>
                  <Text style={[T.headline, { flex: 1 }]} numberOfLines={2}>{e.title}</Text>
                </Pressable>
              ))}
            </Animated.View>
          )) : <Empty title="Nothing scheduled." body="Events you add through Blu appear here." />)}

          {tab === 'notes' && (notes.length ? notes.map((n, i) => (
            <Animated.View key={n.id} entering={FadeInDown.delay(i * 50).duration(300)}>
              <Pressable onPress={() => onOpenItem({ kind: 'note', item: n })} style={({ pressed }) => [s.note, pressed && { opacity: 0.6 }]}>
                <Text style={[T.headline, { lineHeight: 22 }]} numberOfLines={3}>{n.content}</Text>
                <Text style={[T.small, { marginTop: 4 }]}>{ago(n.created_at)}</Text>
              </Pressable>
            </Animated.View>
          )) : <Empty title="No notes yet." body={'Say "Note: …" to Blu to save one.'} />)}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Empty({ title, body }) {
  return (
    <View style={s.empty}>
      <Halo size={60} />
      <Text style={[T.title, { marginTop: 14 }]}>{title}</Text>
      <Text style={[T.sub, { textAlign: 'center', marginTop: 6 }]}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  segWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  day: { marginTop: 18, marginBottom: 2 },
  ev: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.hairline },
  tm: { fontFamily: 'Heros-Bold', fontSize: 13, color: C.accent, width: 74 },
  note: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.hairline },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30 },
});

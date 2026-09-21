// Everything, not just what's next: reminders, upcoming events grouped by day, and notes.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwipeRow from '../components/SwipeRow';
import { Group, Row, SectionHeader, Segmented } from '../components/ui';
import { when, ago, clock, dayTitle } from '../format';
import { C, T } from '../theme';

const TABS = [['todos', 'Reminders'], ['upcoming', 'Upcoming'], ['notes', 'Notes']];

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 32 }}>
        {tab === 'todos' && (todos.length ? (
          <Group>
            {todos.map(t => (
              <SwipeRow
                key={t.id}
                title={t.content}
                meta={t.remind_at ? when(t.remind_at) : null}
                overdue={!!t.remind_at && new Date(t.remind_at) < now}
                onPress={() => onOpenItem({ kind: 'todo', item: t })}
                onDone={() => onDone(t)}
                onSnooze={() => onSnooze(t)}
              />
            ))}
          </Group>
        ) : <Empty title="No Reminders" body="Anything you ask Blu to remember shows up here." />)}

        {tab === 'upcoming' && (events.length ? byDay(events).map(day => (
          <View key={day.title} style={{ marginBottom: 22 }}>
            <SectionHeader title={day.title} small />
            <Group>
              {day.items.map(e => (
                <Row key={e.id} title={e.title} value={clock(new Date(e.start_at))} chevron numberOfLines={1} onPress={() => onOpenItem({ kind: 'event', item: e })} />
              ))}
            </Group>
          </View>
        )) : <Empty title="Nothing Scheduled" body="Events you add through Blu appear here." />)}

        {tab === 'notes' && (notes.length ? (
          <Group>
            {notes.map(n => (
              <Row key={n.id} title={n.content} subtitle={ago(n.created_at)} numberOfLines={3} chevron onPress={() => onOpenItem({ kind: 'note', item: n })} />
            ))}
          </Group>
        ) : <Empty title="No Notes" body={'Say "Note: …" to Blu to save one.'} />)}
      </ScrollView>
    </View>
  );
}

function Empty({ title, body }) {
  return (
    <View style={s.empty}>
      <Text style={T.title3}>{title}</Text>
      <Text style={[T.subhead, { textAlign: 'center', marginTop: 6 }]}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  segWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
});

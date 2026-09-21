// Today: a summary page in the manner of Apple's own apps — date line and large title, an Up Next
// card, then grouped sections for reminders, what's coming, something to remember, and Blu's
// latest message. Everything deeper opens as a sheet.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import SwipeRow from '../components/SwipeRow';
import { Group, Row, SectionHeader, Button } from '../components/ui';
import { when, relative, ago, plain, restates, longDate } from '../format';
import { C, T, RADIUS } from '../theme';

const SHOWN_TODOS = 5;
const SHOWN_EVENTS = 3;
const CONDITION = { clear: 'Clear', cloudy: 'Cloudy', haze: 'Haze', rain: 'Rain', storm: 'Thunderstorms' };

// Tapping one opens the assistant with the text in place; `send` ones go straight through.
const SUGGESTIONS = [
  { label: 'Remind Me', text: 'Remind me to ' },
  { label: 'New Note', text: 'Note: ' },
  { label: 'Tomorrow', text: "What's on tomorrow?", send: true },
];

// The next event however far off, else the top reminder. With nothing at all: what got done
// today, or simply that nothing is scheduled.
function upNext(events, todos, now, doneToday) {
  const next = events[0];
  if (next) {
    const rel = relative(next.start_at, now);
    return { kind: 'event', item: next, title: next.title, sub: rel ? `${when(next.start_at, now)} · ${rel}` : when(next.start_at, now) };
  }
  if (todos.length) return { kind: 'todo', item: todos[0], title: todos[0].content, sub: todos[0].remind_at ? when(todos[0].remind_at, now) : 'Top of your list' };
  if (doneToday > 0) return { title: 'All Done', sub: `${doneToday} completed today` };
  const h = now.getHours();
  return { title: 'Nothing Scheduled', sub: h >= 22 || h < 5 ? 'Nothing open tonight.' : "Tell Blu what's next." };
}

export default function NowScreen({
  board, sky, hideSuggestions, onOpenSettings, onOpenLibrary, onOpenItem, onOpenAssistant, onSuggest, onDone, onSnooze, onReview, bottomInset,
}) {
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  const { todos, events, latest, learning, doneToday, loaded } = board;
  const now = sky.now;
  const next = upNext(events, todos, now, doneToday);
  const later = (next.kind === 'event' ? events.slice(1) : events).slice(0, SHOWN_EVENTS);
  const openTodos = next.kind === 'todo' ? todos.slice(1) : todos;

  const onRefresh = useCallback(async () => {
    setPulling(true);
    await board.refresh();
    setPulling(false);
  }, [board]);

  const weather = [sky.temp != null ? `${sky.temp}°` : null, CONDITION[sky.condition]].filter(Boolean).join(' ');

  return (
    <ScrollView
      style={StyleSheet.absoluteFill}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: bottomInset + 28, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={C.label2} colors={[C.accent]} progressBackgroundColor={C.cell} />}
    >
      <View style={s.titleBar}>
        <View style={{ flex: 1 }}>
          <Text style={s.date}>{longDate(now)}{weather ? `  ·  ${weather}` : ''}</Text>
          <Text style={T.largeTitle}>Today</Text>
        </View>
        <Pressable onPress={onOpenSettings} hitSlop={8} accessibilityLabel="Settings" style={({ pressed }) => [s.circleBtn, pressed && { opacity: 0.6 }]}>
          <Icon name="gear" size={19} color={C.label} stroke={1.9} />
        </Pressable>
      </View>

      {board.error && loaded ? <Text style={[T.footnote, { color: C.red, marginBottom: 12, paddingHorizontal: 4 }]}>Can't reach Blu. Pull down to try again.</Text> : null}

      {loaded ? (
        <Pressable
          disabled={!next.kind}
          onPress={() => onOpenItem({ kind: next.kind, item: next.item })}
          style={({ pressed }) => [s.upNext, pressed && { opacity: 0.8 }]}
        >
          <View style={[s.accentBar, !next.kind && { backgroundColor: C.green }]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.upNextLabel, !next.kind && { color: C.green }]}>{next.kind === 'event' ? 'Up Next' : next.kind === 'todo' ? 'Top Reminder' : 'Today'}</Text>
            <Text style={T.title2} numberOfLines={3}>{next.title}</Text>
            <Text style={[T.subhead, { marginTop: 4 }]}>{next.sub}</Text>
          </View>
        </Pressable>
      ) : <View style={s.upNextPlaceholder} />}

      {openTodos.length ? (
        <View style={s.section}>
          <SectionHeader title="Reminders" action={todos.length > 1 ? 'Show All' : null} onAction={() => onOpenLibrary('todos')} />
          <Group>
            {openTodos.slice(0, SHOWN_TODOS).map(t => (
              <SwipeRow
                key={t.id}
                title={t.content}
                meta={t.remind_at ? when(t.remind_at, now) : null}
                overdue={!!t.remind_at && new Date(t.remind_at) < now}
                onPress={() => onOpenItem({ kind: 'todo', item: t })}
                onDone={() => onDone(t)}
                onSnooze={() => onSnooze(t)}
              />
            ))}
          </Group>
        </View>
      ) : null}

      {later.length ? (
        <View style={s.section}>
          <SectionHeader title="Coming Up" action="Show All" onAction={() => onOpenLibrary('upcoming')} />
          <Group>
            {later.map(e => (
              <Row key={e.id} title={e.title} subtitle={when(e.start_at, now)} chevron numberOfLines={1} onPress={() => onOpenItem({ kind: 'event', item: e })} />
            ))}
          </Group>
        </View>
      ) : null}

      {learning ? (
        <View style={s.section}>
          <SectionHeader title="Worth Remembering" />
          <View style={s.card}>
            {learning.topic && !restates(learning.topic, learning.content) ? <Text style={[T.footnote, { marginBottom: 4 }]}>{learning.topic}</Text> : null}
            <Text style={T.body} numberOfLines={6}>{learning.content}</Text>
            <View style={s.cardActions}>
              <Button title="Got It" onPress={() => onReview(learning, true)} />
              <Button title="Review Again" kind="gray" onPress={() => onReview(learning, false)} />
            </View>
          </View>
        </View>
      ) : null}

      {latest ? (
        <View style={s.section}>
          <SectionHeader title="From Blu" />
          <Pressable onPress={onOpenAssistant} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
            <View style={s.cardTop}>
              <Text style={T.footnote}>{ago(latest.created_at, now)}</Text>
              <Icon name="chevronRight" size={14} color={C.label3} stroke={2.4} />
            </View>
            <Text style={T.callout} numberOfLines={4}>{plain(latest.text)}</Text>
          </Pressable>
        </View>
      ) : null}

      {loaded && !todos.length && !hideSuggestions ? (
        <View style={s.section}>
          <SectionHeader title="Suggestions" />
          <View style={s.suggestions}>
            {SUGGESTIONS.map(sg => <Button key={sg.label} title={sg.label} kind="tinted" onPress={() => onSuggest(sg)} />)}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  titleBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4, marginBottom: 18, marginTop: 8 },
  date: { ...T.footnote, fontFamily: 'Heros-Bold', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  circleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  upNext: { flexDirection: 'row', gap: 12, backgroundColor: C.cell, borderRadius: RADIUS.card, padding: 16 },
  upNextPlaceholder: { height: 108, borderRadius: RADIUS.card, backgroundColor: C.cell, opacity: 0.5 },
  accentBar: { width: 4, borderRadius: 2, backgroundColor: C.accent },
  upNextLabel: { ...T.footnote, fontFamily: 'Heros-Bold', color: C.accent, marginBottom: 4 },
  section: { marginTop: 28 },
  card: { backgroundColor: C.cell, borderRadius: RADIUS.cell, padding: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

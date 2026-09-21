// The one screen. The sky is the surface: a quiet status line, open space, then — in thumb reach —
// what's next as a large headline straight on the sky, and the rest as plain rows with hairlines.
// No boxes except the one thing asking for an answer. Type, colour and controls follow iOS; every
// deeper view is a sheet.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import SwipeRow from '../components/SwipeRow';
import { Button } from '../components/ui';
import { when, relative, ago, plain, restates } from '../format';
import { C, T, RADIUS, HAIRLINE } from '../theme';

const SHOWN_TODOS = 5;
const SHOWN_EVENTS = 3;
const CONDITION = { clear: 'Clear', cloudy: 'Cloudy', haze: 'Haze', rain: 'Rain', storm: 'Thunderstorms' };

// Tapping one opens the assistant with the text in place; `send` ones go straight through.
const SUGGESTIONS = [
  { label: 'Remind Me', text: 'Remind me to ' },
  { label: 'New Note', text: 'Note: ' },
  { label: "What's Tomorrow?", text: "What's on tomorrow?", send: true },
];

// The next event however far off, else the top reminder. With nothing at all: what got done
// today, or simply that nothing is scheduled.
function upNext(events, todos, now, doneToday) {
  const next = events[0];
  if (next) {
    const rel = relative(next.start_at, now);
    return { kind: 'event', item: next, label: 'Up Next', title: next.title, sub: rel ? `${when(next.start_at, now)} · ${rel}` : when(next.start_at, now) };
  }
  if (todos.length) {
    const t = todos[0];
    return { kind: 'todo', item: t, label: 'Top Reminder', title: t.content, sub: t.remind_at ? when(t.remind_at, now) : 'No reminder set' };
  }
  if (doneToday > 0) return { label: 'Today', title: 'All done.', sub: `${doneToday} completed today` };
  const h = now.getHours();
  return { label: 'Today', title: h >= 22 || h < 5 ? 'Quiet night.' : 'Nothing open.', sub: "Tell Blu what's next." };
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

  const status = [sky.label, sky.temp != null ? `${sky.temp}°` : null, sky.condition !== 'clear' ? CONDITION[sky.condition] : null]
    .filter(Boolean).join(' · ');

  return (
    <ScrollView
      style={StyleSheet.absoluteFill}
      contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 10, paddingBottom: bottomInset + 24, paddingHorizontal: 22 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={C.label2} colors={[C.accent]} progressBackgroundColor={C.cell} />}
    >
      <View style={s.topRow}>
        <Text style={s.status}>{status}</Text>
        <Pressable onPress={onOpenSettings} hitSlop={8} accessibilityLabel="Settings" style={({ pressed }) => [s.circleBtn, pressed && { opacity: 0.6 }]}>
          <Icon name="gear" size={19} color={C.label} stroke={1.9} />
        </Pressable>
      </View>

      {/* Pushes everything below toward the thumb; collapses once content fills the screen. */}
      <View style={s.spacer} />

      {loaded ? (
        <Pressable disabled={!next.kind} onPress={() => onOpenItem({ kind: next.kind, item: next.item })} style={({ pressed }) => [s.hero, pressed && { opacity: 0.7 }]}>
          <Text style={s.kicker}>{next.label}</Text>
          <Text style={s.headline} numberOfLines={3}>{next.title}</Text>
          <Text style={s.sub}>{next.sub}</Text>
        </Pressable>
      ) : null}
      {board.error && loaded ? <Text style={[T.footnote, { color: C.red, marginTop: -18, marginBottom: 24 }]}>Can't reach Blu. Pull down to try again.</Text> : null}

      {openTodos.length ? (
        <View style={s.section}>
          <Header title="Reminders" action={todos.length > 1 ? 'Show All' : null} onAction={() => onOpenLibrary('todos')} />
          {openTodos.slice(0, SHOWN_TODOS).map((t, i, arr) => (
            <SwipeRow
              key={t.id}
              plain
              last={i === arr.length - 1}
              title={t.content}
              meta={t.remind_at ? when(t.remind_at, now) : null}
              overdue={!!t.remind_at && new Date(t.remind_at) < now}
              onPress={() => onOpenItem({ kind: 'todo', item: t })}
              onDone={() => onDone(t)}
              onSnooze={() => onSnooze(t)}
            />
          ))}
        </View>
      ) : null}

      {later.length ? (
        <View style={s.section}>
          <Header title="Coming Up" action="Show All" onAction={() => onOpenLibrary('upcoming')} />
          {later.map((e, i) => (
            <Pressable
              key={e.id}
              onPress={() => onOpenItem({ kind: 'event', item: e })}
              style={({ pressed }) => [s.eventRow, i === later.length - 1 && { borderBottomWidth: 0 }, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.eventTime}>{when(e.start_at, now)}</Text>
              <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{e.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {learning ? (
        <View style={s.section}>
          <Header title="Worth Remembering" />
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
        <Pressable onPress={onOpenAssistant} style={({ pressed }) => [s.section, pressed && { opacity: 0.6 }]}>
          <Header title={`From Blu · ${ago(latest.created_at, now)}`} />
          <Text style={T.callout} numberOfLines={4}>{plain(latest.text)}</Text>
        </Pressable>
      ) : null}

      {loaded && !todos.length && !hideSuggestions ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll} contentContainerStyle={s.chips}>
          {SUGGESTIONS.map(sg => <Button key={sg.label} title={sg.label} kind="tinted" onPress={() => onSuggest(sg)} />)}
        </ScrollView>
      ) : null}
    </ScrollView>
  );
}

// Small uppercase section label, with an optional blue action on the right.
function Header({ title, action, onAction }) {
  return (
    <View style={s.header}>
      <Text style={T.groupHeader}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          {({ pressed }) => <Text style={[T.subhead, { color: C.accent }, pressed && { opacity: 0.4 }]}>{action}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { ...T.subhead, fontFamily: 'Heros-Bold' },
  circleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
  spacer: { flexGrow: 1, minHeight: 40 },
  hero: { marginBottom: 34 },
  kicker: { ...T.groupHeader, fontFamily: 'Heros-Bold', paddingHorizontal: 0, marginBottom: 8 },
  headline: { fontFamily: 'Heros-Bold', fontSize: 36, lineHeight: 41, letterSpacing: -0.9, color: C.label },
  sub: { ...T.body, color: C.label2, marginTop: 8 },
  section: { marginBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 },
  eventRow: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 13, borderBottomWidth: HAIRLINE, borderBottomColor: 'rgba(255,255,255,0.12)' },
  eventTime: { ...T.subhead, width: 128 },
  card: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.card, padding: 16, marginTop: 8 },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  chipScroll: { marginHorizontal: -22, flexGrow: 0 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 22 },
});

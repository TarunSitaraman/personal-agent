// The one screen. The headline is what's next — not a greeting. Below it, what's open, what's
// coming, something worth remembering, and the last thing Blu said. Content sits in the lower
// part of the screen, in thumb reach, with the sky above; everything else lives in sheets.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Glass from '../components/Glass';
import Icon from '../components/Icon';
import SwipeRow from '../components/SwipeRow';
import { when, relative, ago, plain, clock } from '../format';
import { C, F } from '../theme';

const SHOWN_TODOS = 5;
const SHOWN_EVENTS = 3;
const CONDITION = { clear: 'Clear', cloudy: 'Cloudy', haze: 'Haze', rain: 'Rain', storm: 'Storm' };

// Tapping one opens the assistant with the text in place; `send` ones go straight through.
const SUGGESTIONS = [
  { label: 'Remind me…', text: 'Remind me to ' },
  { label: 'Note…', text: 'Note: ' },
  { label: "What's on tomorrow?", text: "What's on tomorrow?", send: true },
];

// The next event however far off, else the top todo, else nothing.
function headline(events, todos, now) {
  const next = events[0];
  if (next) {
    const rel = relative(next.start_at, now);
    return { title: next.title, sub: rel ? `${rel} · ${when(next.start_at, now)}` : when(next.start_at, now), usedEvent: true };
  }
  if (todos.length) return { title: todos[0].content, sub: 'Top of your list', usedEvent: false };
  return null;
}

export default function NowScreen({
  board, sky, onOpenSettings, onOpenLibrary, onOpenItem, onOpenAssistant, onSuggest, onDone, onSnooze, onReview, bottomInset,
}) {
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  const { todos, events, latest, learning, loaded } = board;
  const now = sky.now;
  const head = headline(events, todos, now);
  const later = (head?.usedEvent ? events.slice(1) : events).slice(0, SHOWN_EVENTS);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    await board.refresh();
    setPulling(false);
  }, [board]);

  const status = [
    clock(now), sky.label, sky.temp != null ? `${sky.temp}°` : null,
    sky.condition !== 'clear' ? CONDITION[sky.condition] : null,
  ].filter(Boolean).join(' · ');

  return (
    <ScrollView
      style={StyleSheet.absoluteFill}
      contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 14, paddingBottom: bottomInset + 20, paddingHorizontal: 24 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.ink} />}
    >
      <View style={s.topRow}>
        <Text style={s.status}>{status}</Text>
        <Pressable onPress={onOpenSettings} hitSlop={8} accessibilityLabel="Settings">
          {({ pressed }) => (
            <Glass radius={21} style={[s.gear, pressed && { transform: [{ scale: 0.94 }] }]}>
              <Icon name="sliders" size={18} />
            </Glass>
          )}
        </Pressable>
      </View>

      {/* Pushes everything below toward the thumb; collapses once content fills the screen. */}
      <View style={s.spacer} />

      <View style={s.hero}>
        {!loaded ? null : head ? (
          <>
            <Text style={s.kicker}>{head.usedEvent ? 'Next' : 'Now'}</Text>
            <Text style={s.headline} numberOfLines={3}>{head.title}</Text>
            <Text style={s.sub}>{head.sub}</Text>
          </>
        ) : (
          <>
            <Text style={s.headline}>Nothing open.</Text>
            <Text style={s.sub}>Tell Blu what's next.</Text>
          </>
        )}
        {board.error && loaded ? <Text style={s.error}>Can't reach Blu right now. Pull to retry.</Text> : null}
      </View>

      {todos.length ? (
        <View style={s.section}>
          <SectionHead label="Open" count={todos.length} onMore={() => onOpenLibrary('todos')} />
          {todos.slice(0, SHOWN_TODOS).map(t => (
            <SwipeRow
              key={t.id}
              title={t.content}
              meta={t.remind_at ? when(t.remind_at, now) : null}
              onPress={() => onOpenItem({ kind: 'todo', item: t })}
              onDone={() => onDone(t)}
              onSnooze={() => onSnooze(t)}
            />
          ))}
        </View>
      ) : null}

      {later.length ? (
        <View style={s.section}>
          <SectionHead label="Coming up" onMore={() => onOpenLibrary('upcoming')} />
          {later.map(e => (
            <Pressable key={e.id} onPress={() => onOpenItem({ kind: 'event', item: e })} style={({ pressed }) => [s.eventRow, pressed && { opacity: 0.6 }]}>
              <Text style={s.eventTime}>{when(e.start_at, now)}</Text>
              <Text style={s.eventTitle} numberOfLines={1}>{e.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {learning ? (
        <View style={s.section}>
          <SectionHead label="Worth remembering" />
          <Glass radius={22} style={s.learning}>
            {learning.topic ? <Text style={s.learnTopic}>{learning.topic}</Text> : null}
            <Text style={s.learnText} numberOfLines={5}>{learning.content}</Text>
            <View style={s.learnActions}>
              <Pill label="Got it" primary onPress={() => onReview(learning, true)} />
              <Pill label="Again" onPress={() => onReview(learning, false)} />
            </View>
          </Glass>
        </View>
      ) : null}

      {latest ? (
        <Pressable onPress={onOpenAssistant} style={({ pressed }) => [s.section, pressed && { opacity: 0.6 }]}>
          <SectionHead label={`From Blu · ${ago(latest.created_at, now)}`} />
          <Text style={s.latest} numberOfLines={4}>{plain(latest.text)}</Text>
        </Pressable>
      ) : null}

      {loaded && !todos.length ? (
        <View style={s.chips}>
          {SUGGESTIONS.map(sg => <Pill key={sg.label} label={sg.label} onPress={() => onSuggest(sg)} />)}
        </View>
      ) : null}
    </ScrollView>
  );
}

function SectionHead({ label, count, onMore }) {
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionLabel}>{label}{count != null ? `  ${count}` : ''}</Text>
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={10} style={s.more}>
          <Text style={s.moreText}>All</Text>
          <Icon name="chevronRight" size={14} color={C.text2} stroke={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Pill({ label, primary, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.pill, primary && s.pillPrimary, pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }]}>
      <Text style={[s.pillText, primary && { color: C.ink }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { ...F.bold, fontSize: 14, color: C.text2 },
  gear: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  spacer: { flexGrow: 1, minHeight: 48 },
  hero: { marginBottom: 36 },
  kicker: { ...F.bold, fontSize: 14, color: C.accent, marginBottom: 10 },
  headline: { ...F.bold, fontSize: 36, lineHeight: 40, color: C.text, letterSpacing: -0.8 },
  sub: { ...F.bold, fontSize: 17, color: C.text2, marginTop: 10 },
  error: { ...F.bold, fontSize: 13, color: C.danger, marginTop: 14 },
  section: { marginBottom: 30 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionLabel: { ...F.bold, fontSize: 13, color: C.text3, letterSpacing: 0.2 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreText: { ...F.bold, fontSize: 13, color: C.text2 },
  eventRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 13, gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  eventTime: { ...F.bold, fontSize: 14, color: C.accent, width: 118 },
  eventTitle: { flex: 1, ...F.bold, fontSize: 17, color: C.text },
  learning: { padding: 18, marginTop: 8 },
  learnTopic: { ...F.bold, fontSize: 13, color: C.accent, marginBottom: 6 },
  learnText: { ...F.bold, fontSize: 17, lineHeight: 23, color: C.text },
  learnActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  latest: { ...F.regular, fontSize: 16, lineHeight: 23, color: C.text, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.rim },
  pillPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  pillText: { ...F.bold, fontSize: 14, color: C.text },
});

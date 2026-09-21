// The one screen. The headline is what's next — not a greeting. Below it, what's open, what's
// coming, and the last thing Blu said. Everything else lives in sheets.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Glass from '../components/Glass';
import Icon from '../components/Icon';
import SwipeRow from '../components/SwipeRow';
import { when, relative, ago, plain } from '../format';
import { C, F } from '../theme';

const SHOWN_TODOS = 5;
const SHOWN_EVENTS = 3;
const CONDITION = { clear: 'Clear', cloudy: 'Cloudy', haze: 'Haze', rain: 'Rain', storm: 'Storm' };

function headline(events, todos, now) {
  const next = events[0];
  if (next && new Date(next.start_at) - now < 36 * 3600 * 1000) {
    const rel = relative(next.start_at, now);
    return { title: next.title, sub: rel ? `${rel} · ${when(next.start_at, now)}` : when(next.start_at, now), usedEvent: true };
  }
  if (todos.length) return { title: todos[0].content, sub: 'Top of your list', usedEvent: false };
  return null;
}

export default function NowScreen({ board, sky, onOpenSettings, onOpenLibrary, onOpenItem, onOpenAssistant, onDone, onSnooze, bottomInset }) {
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  const { todos, events, latest, loaded } = board;
  const now = sky.now;
  const head = headline(events, todos, now);
  const later = (head?.usedEvent ? events.slice(1) : events).slice(0, SHOWN_EVENTS);

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
      contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: bottomInset + 24, paddingHorizontal: 24 }}
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

      {latest ? (
        <Pressable onPress={onOpenAssistant} style={({ pressed }) => [s.section, pressed && { opacity: 0.6 }]}>
          <SectionHead label={`From Blu · ${ago(latest.created_at, now)}`} />
          <Text style={s.latest} numberOfLines={4}>{plain(latest.text)}</Text>
        </Pressable>
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

const s = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { ...F.bold, fontSize: 14, color: C.text2 },
  gear: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  hero: { marginTop: 56, marginBottom: 40, minHeight: 150 },
  kicker: { ...F.bold, fontSize: 14, color: C.accent, marginBottom: 10 },
  headline: { ...F.bold, fontSize: 42, lineHeight: 46, color: C.text, letterSpacing: -1 },
  sub: { ...F.bold, fontSize: 17, color: C.text2, marginTop: 12 },
  error: { ...F.bold, fontSize: 13, color: C.danger, marginTop: 14 },
  section: { marginBottom: 34 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionLabel: { ...F.bold, fontSize: 13, color: C.text3, letterSpacing: 0.2 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreText: { ...F.bold, fontSize: 13, color: C.text2 },
  eventRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 13, gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  eventTime: { ...F.bold, fontSize: 14, color: C.accent, width: 118 },
  eventTitle: { flex: 1, ...F.bold, fontSize: 17, color: C.text },
  latest: { ...F.regular, fontSize: 16, lineHeight: 23, color: C.text, marginTop: 8 },
});

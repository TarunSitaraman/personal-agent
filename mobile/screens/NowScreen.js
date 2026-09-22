// Now — the one screen, built from the approved mockup (app-screens.html, "1 · Now"): date and a
// glass gear, the weather, then NEXT as a large headline with a rolling countdown, OPEN todos,
// what's coming, something to remember, and Blu's latest brief. Everything deeper is a sheet.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import Glass from '../components/Glass';
import Press from '../components/Press';
import SwipeRow from '../components/SwipeRow';
import { Label, Chip, Rolling, countdown, Halo, Skeleton } from '../components/kit';
import { when, clock, ago, plain, restates } from '../format';
import { C, T } from '../theme';

const SHOWN_TODOS = 5;
const SHOWN_EVENTS = 3;
const LONG_BRIEF = 150; // characters; about what three lines hold at this size
const CONDITION = { clear: 'Clear', cloudy: 'Cloudy', haze: 'Humid haze', rain: 'Rain', storm: 'Thunderstorms' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tapping one opens the assistant with the text in place; `send` ones go straight through.
const SUGGESTIONS = [
  { label: 'Remind me…', text: 'Remind me to ' },
  { label: 'Note…', text: 'Note: ' },
  { label: "What's on tomorrow?", text: "What's on tomorrow?", send: true },
];

const BRIEF_KIND = { brief: 'Morning brief', evening: 'Evening brief', nudge: 'Nudge', reminder: 'Reminder', event: 'Starting soon', goal: 'One big thing', weekly: 'Weekly review', pulse: 'Tech pulse' };

// A line that is true about an empty day, never filler.
function emptyLine(doneToday, now) {
  if (doneToday > 0) return `${doneToday} done today. Nothing else open.`;
  const h = now.getHours();
  return h >= 20 || h < 5 ? 'Quiet night. Nothing open.' : "Nothing open. Tell Blu what's next.";
}

export default function NowScreen({
  board, sky, hideSuggestions, onOpenSettings, onOpenLibrary, onOpenItem, onOpenAssistant, onSuggest, onDone, onSnooze, onReview, bottomInset,
}) {
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const { todos, events, latest, learning, doneToday, loaded } = board;
  const now = sky.now;
  const next = events[0];
  const later = events.slice(1, 1 + SHOWN_EVENTS);
  const empty = loaded && !next && !todos.length;

  const onRefresh = useCallback(async () => {
    setPulling(true);
    await board.refresh();
    setPulling(false);
  }, [board]);

  const dateLine = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} · ${clock(now)}`;
  const weather = [CONDITION[sky.condition], sky.temp != null ? `${sky.temp}°` : null].filter(Boolean).join(' · ');

  return (
    <ScrollView
      style={StyleSheet.absoluteFill}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: bottomInset + 28, paddingHorizontal: 22 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.ink} />}
    >
      <View style={s.top}>
        <Label>{dateLine}</Label>
        <Press onPress={onOpenSettings} hitSlop={10} accessibilityLabel="Settings">
          <Glass radius={20} style={s.gear}><Icon name="gear" size={17} color="#fff" stroke={2} /></Glass>
        </Press>
      </View>
      <Text style={s.weather}>{weather}</Text>

      {!loaded ? (
        <View style={{ marginTop: 40, gap: 14 }}>
          <Skeleton width="30%" /><Skeleton width="75%" height={34} /><Skeleton width="55%" />
        </View>
      ) : null}

      {next ? (
        <Animated.View entering={FadeInDown.duration(380)} style={s.heroBlock}>
          <Label>Next</Label>
          <Pressable onPress={() => onOpenItem({ kind: 'event', item: next })}>
            {({ pressed }) => <Text style={[T.hero, s.hero, pressed && { opacity: 0.7 }]} numberOfLines={3}>{next.title}</Text>}
          </Pressable>
          <View style={s.subRow}>
            <Text style={[T.sub, { flex: 1 }]} numberOfLines={1}>{when(next.start_at, now)}</Text>
            <Rolling text={countdown(next.start_at, now)} style={s.countdown} />
          </View>
        </Animated.View>
      ) : null}

      {todos.length ? (
        <View style={[s.section, !next && { marginTop: 44 }]}>
          <Pressable onPress={() => onOpenLibrary('todos')} hitSlop={8}><Label link>{`Open · ${todos.length}`}</Label></Pressable>
          <View style={{ marginTop: 4 }}>
            {todos.slice(0, SHOWN_TODOS).map((t, i, arr) => (
              <SwipeRow
                key={t.id}
                index={i}
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
        </View>
      ) : null}

      {empty ? (
        <Animated.View entering={FadeInDown.duration(420)} style={s.empty}>
          <Halo still={sky.reduceMotion} />
          <Text style={[T.title, { marginTop: 16 }]}>{doneToday > 0 ? 'All done.' : 'Nothing open.'}</Text>
          <Text style={[T.sub, { marginTop: 6, textAlign: 'center' }]}>{emptyLine(doneToday, now)}</Text>
        </Animated.View>
      ) : null}

      {later.length ? (
        <View style={s.section}>
          <Pressable onPress={() => onOpenLibrary('upcoming')} hitSlop={8}><Label link>Coming up</Label></Pressable>
          {later.map((e, i) => (
            <Animated.View key={e.id} entering={FadeInDown.delay(i * 60).duration(320)}>
              <Pressable onPress={() => onOpenItem({ kind: 'event', item: e })} style={({ pressed }) => [s.ev, i === later.length - 1 && { borderBottomWidth: 0 }, pressed && { opacity: 0.6 }]}>
                <Text style={s.evTime}>{when(e.start_at, now)}</Text>
                <Text style={[T.headline, { flex: 1 }]} numberOfLines={1}>{e.title}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      ) : null}

      {learning ? (
        <Animated.View entering={FadeInDown.duration(380)} style={s.section}>
          <Label>Worth remembering</Label>
          <Glass radius={18} style={s.card}>
            {learning.topic && !restates(learning.topic, learning.content) ? <Label color={C.accent} style={{ marginBottom: 6 }}>{learning.topic}</Label> : null}
            <Text style={[T.headline, { lineHeight: 23 }]} numberOfLines={6}>{learning.content}</Text>
            <View style={s.chips}>
              <Chip title="Got it" kind="accent" onPress={() => onReview(learning, true)} />
              <Chip title="Again" onPress={() => onReview(learning, false)} />
            </View>
          </Glass>
        </Animated.View>
      ) : null}

      {latest ? (
        <Animated.View layout={LinearTransition.springify().damping(20)} style={s.section}>
          <Pressable onPress={onOpenAssistant} hitSlop={8}>
            <Label link>{`${BRIEF_KIND[latest.kind] || 'From Blu'} · ${ago(latest.created_at, now)}`}</Label>
          </Pressable>
          <Pressable onPress={() => setBriefOpen(o => !o)}>
            <Text style={[T.body, s.brief]} numberOfLines={briefOpen ? undefined : 3}>{plain(latest.text)}</Text>
            {!briefOpen && plain(latest.text).length > LONG_BRIEF ? <Text style={[T.small, { marginTop: 4 }]}>Tap to read more</Text> : null}
          </Pressable>
        </Animated.View>
      ) : null}

      {loaded && !todos.length && !hideSuggestions ? (
        <Animated.View entering={FadeInDown.delay(120).duration(320)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll} contentContainerStyle={s.chipRow}>
            {SUGGESTIONS.map(sg => <Chip key={sg.label} title={sg.label} kind={sg.send ? 'line' : 'default'} onPress={() => onSuggest(sg)} />)}
          </ScrollView>
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  weather: { fontFamily: 'Heros-Bold', fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  heroBlock: { marginTop: 44 },
  hero: { marginTop: 8, marginBottom: 8 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  countdown: { fontFamily: 'Heros-Bold', fontSize: 15, lineHeight: 19, color: C.accent },
  section: { marginTop: 32 },
  ev: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.hairline },
  evTime: { fontFamily: 'Heros-Bold', fontSize: 13, color: C.accent, width: 124 },
  card: { padding: 18, marginTop: 10 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 14 },
  brief: { color: 'rgba(255,255,255,0.82)', marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 56, marginBottom: 8 },
  chipScroll: { marginHorizontal: -22, marginTop: 28, flexGrow: 0 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 22 },
});

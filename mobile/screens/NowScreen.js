// Now — the one screen, built from the approved mockup (app-screens.html, "1 · Now"): date and
// weather beside Blu's orb, then NEXT as a large headline with a rolling countdown, OPEN todos,
// what's coming, something to remember, and Blu's latest brief. Everything deeper is a sheet.
// The orb is Blu: tap to talk, long-press (or tap the date) for Settings. See mobile/DESIGN.md.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Glass from '../components/Glass';
import Press from '../components/Press';
import Orb from '../components/Orb';
import SwipeRow from '../components/SwipeRow';
import { Label, Chip, Rolling, Skeleton } from '../components/kit';
import { pickNext, countdown } from '../nextUp';
import { when, clock, ago, plain, restates } from '../format';
import { C, T } from '../theme';

const SHOWN_TODOS = 5;
const SHOWN_EVENTS = 3;
const ORB_SIZE = 58;
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
  if (doneToday > 0) return doneToday + ' done today. Nothing else open.';
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
  const next = pickNext(events, todos, now);
  const openTodos = next?.kind === 'todo' ? todos.slice(1) : todos;
  const later = events.slice(1, 1 + SHOWN_EVENTS);
  const empty = loaded && !next;

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
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: bottomInset + 28, paddingHorizontal: 22 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.ink} />}
    >
      <View style={s.top}>
        <Pressable onPress={onOpenSettings} hitSlop={10} style={{ flex: 1 }} accessibilityLabel="Settings">
          <Label>{dateLine}</Label>
          <Text style={s.weather}>{weather}</Text>
        </Pressable>
        <Press
          onPress={onOpenAssistant}
          onLongPress={onOpenSettings}
          delayLongPress={380}
          hitSlop={6}
          scaleTo={0.9}
          accessibilityLabel="Talk to Blu"
          accessibilityHint="Long-press for settings"
        >
          <Orb size={ORB_SIZE} still={sky.reduceMotion} />
        </Press>
      </View>

      {!loaded ? (
        <View style={{ marginTop: 40, gap: 14 }}>
          <Skeleton width="30%" /><Skeleton width="75%" height={34} /><Skeleton width="55%" />
        </View>
      ) : null}

      {next ? (
        <Animated.View entering={FadeInDown.duration(380)} style={s.heroBlock}>
          <Label>{next.label}</Label>
          <Pressable onPress={() => onOpenItem({ kind: next.kind, item: next.item })}>
            {({ pressed }) => (
              <Text style={[T.hero, s.hero, next.title.length > 40 && s.heroLong, pressed && { opacity: 0.7 }]} numberOfLines={3}>
                {next.title}
              </Text>
            )}
          </Pressable>
          <View style={s.subRow}>
            <Text style={[T.sub, { flex: 1 }]} numberOfLines={1}>{next.sub}</Text>
            {next.at && new Date(next.at) > now ? <Rolling text={countdown(next.at, now)} style={s.countdown} /> : null}
          </View>
        </Animated.View>
      ) : null}

      {empty ? (
        <Animated.View entering={FadeInDown.duration(420)} style={s.empty}>
          <Orb size={132} still={sky.reduceMotion} />
          <Text style={[T.title, { marginTop: 8 }]}>{doneToday > 0 ? 'All done.' : 'Nothing open.'}</Text>
          <Text style={[T.sub, { marginTop: 6, textAlign: 'center' }]}>{emptyLine(doneToday, now)}</Text>
        </Animated.View>
      ) : null}

      {openTodos.length ? (
        <View style={s.section}>
          <Pressable onPress={() => onOpenLibrary('todos')} hitSlop={8}><Label link>{`Open · ${todos.length}`}</Label></Pressable>
          <View style={{ marginTop: 4 }}>
            {openTodos.slice(0, SHOWN_TODOS).map((t, i, arr) => (
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
  top: { flexDirection: 'row', alignItems: 'center', marginRight: -8 },
  weather: { fontFamily: 'Heros-Bold', fontSize: 15, color: 'rgba(255,255,255,0.88)', marginTop: 4 },
  heroBlock: { marginTop: 40 },
  hero: { marginTop: 8, marginBottom: 8 },
  heroLong: { fontSize: 32, lineHeight: 36, letterSpacing: -1 }, // a long todo title still fits in three lines
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  countdown: { fontFamily: 'Heros-Bold', fontSize: 15, lineHeight: 19, color: C.accent },
  section: { marginTop: 32 },
  ev: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.hairline },
  evTime: { fontFamily: 'Heros-Bold', fontSize: 13, color: C.accent, width: 124 },
  card: { padding: 18, marginTop: 10 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 14 },
  brief: { color: 'rgba(255,255,255,0.82)', marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 32, marginBottom: 8 },
  chipScroll: { marginHorizontal: -22, marginTop: 28, flexGrow: 0 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 22 },
});

// One todo, event or note, from the mockup ("5 · Item sheet"): the title large, its details, then
// snooze presets and actions as chips — one filled accent chip, never two.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Label, Chip } from '../components/kit';
import { when, ago } from '../format';
import { C, T } from '../theme';

export default function ItemSheet({ entry, onDone, onSnooze, onAsk }) {
  if (!entry || !entry.item) return null;
  const { kind, item } = entry;
  const title = kind === 'event' ? item.title : item.content;
  const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
  const overdue = kind === 'todo' && item.remind_at && new Date(item.remind_at) < new Date();

  const meta = kind === 'event'
    ? when(item.start_at)
    : kind === 'todo'
      ? [item.remind_at ? `Reminder ${when(item.remind_at)}` : 'No reminder', `added ${ago(item.created_at)}`].join(' · ')
      : `Saved ${ago(item.created_at)}`;

  return (
    <ScrollView contentContainerStyle={s.body}>
      <Animated.View entering={FadeInDown.duration(300)}>
        <Label>{kind === 'todo' ? 'Todo' : kind === 'event' ? 'Event' : 'Note'}</Label>
        <Text style={[kind === 'note' ? [T.body, { fontSize: 18, lineHeight: 26 }] : T.title, { marginTop: 6 }]}>{title}</Text>
        <Text style={[T.sub, { marginTop: 6 }, overdue && { color: C.red }]}>{overdue ? `Overdue · ${meta}` : meta}</Text>
        {tags.length ? <Text style={[T.sub, { marginTop: 10 }]}>Tagged <Text style={{ fontFamily: 'Heros-Bold', color: C.label }}>{tags.join(', ')}</Text></Text> : null}
      </Animated.View>

      {kind === 'todo' ? (
        <Animated.View entering={FadeInDown.delay(80).duration(300)}>
          <Label style={{ marginTop: 22 }}>Snooze</Label>
          <View style={s.chips}>
            <Chip title="1 hour" onPress={() => onSnooze(item, 'in 1 hour')} />
            <Chip title="Tonight 9pm" onPress={() => onSnooze(item, 'tonight at 9pm')} />
            <Chip title="Tomorrow 8am" onPress={() => onSnooze(item, 'tomorrow at 8am')} />
          </View>
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeInDown.delay(140).duration(300)} style={[s.chips, { marginTop: 22 }]}>
        {kind === 'todo' ? <Chip title="Mark done" kind="accent" onPress={() => onDone(item)} /> : null}
        <Chip title="Ask Blu" kind={kind === 'todo' ? 'default' : 'accent'} onPress={() => onAsk(title)} />
      </Animated.View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 40 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },
});

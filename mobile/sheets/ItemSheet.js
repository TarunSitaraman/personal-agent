// One reminder, event or note: the text, its details as a grouped list, then actions as rows —
// the way iOS presents an item and what you can do with it.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Group, Row } from '../components/ui';
import { when, ago } from '../format';
import { C, T } from '../theme';

export default function ItemSheet({ entry, onDone, onSnooze, onAsk }) {
  if (!entry || !entry.item) return null;
  const { kind, item } = entry;
  const title = kind === 'event' ? item.title : item.content;
  const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
  const overdue = kind === 'todo' && item.remind_at && new Date(item.remind_at) < new Date();

  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={kind === 'note' ? [T.body, { fontSize: 19, lineHeight: 26 }] : T.title2}>{title}</Text>

      <Group style={s.group}>
        {kind === 'event' ? <Row title="Starts" value={when(item.start_at)} /> : null}
        {kind === 'todo' ? <Row title="Reminder" value={item.remind_at ? when(item.remind_at) : 'None'} /> : null}
        {kind === 'todo' && overdue ? <Row title="Status" value="Overdue" /> : null}
        {kind !== 'event' ? <Row title={kind === 'note' ? 'Saved' : 'Added'} value={ago(item.created_at)} /> : null}
        {tags.length ? <Row title="Tags" value={tags.join(', ')} /> : null}
      </Group>

      {kind === 'todo' ? (
        <Group style={s.group}>
          <Row title="Mark as Done" tint onPress={() => onDone(item)} />
          <Row title="Remind Me in 1 Hour" tint onPress={() => onSnooze(item, 'in 1 hour')} />
          <Row title="Tonight at 9 PM" tint onPress={() => onSnooze(item, 'tonight at 9pm')} />
          <Row title="Tomorrow at 8 AM" tint onPress={() => onSnooze(item, 'tomorrow at 8am')} />
        </Group>
      ) : null}

      <Group style={s.group}>
        <Row title="Ask Blu About This" tint onPress={() => onAsk(title)} />
      </Group>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  group: { marginTop: 22 },
});

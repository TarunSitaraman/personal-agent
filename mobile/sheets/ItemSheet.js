// One todo, event or note, with the actions that make sense for it.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { when, ago } from '../format';
import { C, F } from '../theme';

export default function ItemSheet({ entry, onDone, onSnooze, onAsk }) {
  if (!entry) return null;
  const { kind, item } = entry;
  const title = kind === 'event' ? item.title : item.content;
  const meta = kind === 'event'
    ? when(item.start_at)
    : kind === 'todo'
      ? (item.remind_at ? `Reminder ${when(item.remind_at)}` : `Added ${ago(item.created_at)}`)
      : `Saved ${ago(item.created_at)}`;
  const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];

  return (
    <View style={s.body}>
      <Text style={s.kind}>{kind === 'todo' ? 'Todo' : kind === 'event' ? 'Event' : 'Note'}</Text>
      <Text style={[s.title, kind === 'note' && s.noteTitle]}>{title}</Text>
      <Text style={s.meta}>{meta}</Text>
      {tags.length ? <Text style={s.tags}>{tags.join('  ·  ')}</Text> : null}

      <View style={s.actions}>
        {kind === 'todo' ? (
          <>
            <Action label="Done" primary onPress={() => onDone(item)} />
            <Action label="In 1 hour" onPress={() => onSnooze(item, 'in 1 hour')} />
            <Action label="Tonight 9pm" onPress={() => onSnooze(item, 'tonight at 9pm')} />
            <Action label="Tomorrow 8am" onPress={() => onSnooze(item, 'tomorrow at 8am')} />
          </>
        ) : null}
        <Action label="Ask Blu about this" onPress={() => onAsk(title)} />
      </View>
    </View>
  );
}

function Action({ label, primary, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.action, primary && s.primary, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }]}>
      <Text style={[s.actionText, primary && s.primaryText]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingTop: 6 },
  kind: { ...F.bold, fontSize: 13, color: C.accent, marginBottom: 10 },
  title: { ...F.bold, fontSize: 30, lineHeight: 35, color: C.text, letterSpacing: -0.5 },
  noteTitle: { ...F.regular, fontSize: 19, lineHeight: 27, letterSpacing: 0 },
  meta: { ...F.bold, fontSize: 15, color: C.text2, marginTop: 12 },
  tags: { ...F.bold, fontSize: 13, color: C.text3, marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 30 },
  action: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)' },
  primary: { backgroundColor: C.accent },
  actionText: { ...F.bold, fontSize: 15, color: C.text },
  primaryText: { color: C.ink },
});

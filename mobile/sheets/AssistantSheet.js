// The conversation: replies plus everything Blu sent on its own (briefs, reminders, nudges).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { chat, getMessages } from '../api';
import { when, plain } from '../format';
import { C, T } from '../theme';

const GAP_MS = 30 * 60 * 1000; // a timestamp heads a message only after a pause this long

const KIND_LABEL = {
  reminder: 'Reminder', event: 'Starting Soon', brief: 'Morning Brief', evening: 'Evening Brief',
  nudge: 'Nudge', goal: 'One Big Thing', pulse: 'Tech Pulse', weekly: 'Weekly Review',
};

// Server rows are newest-first, which is what an inverted list wants.
const toItems = rows => rows.map(r => ({ id: String(r.id), mine: r.from === 'me', kind: r.kind, text: r.text, at: r.created_at }));

// `seed` comes from a suggestion chip: its text is placed in the box, or sent when seed.send.
export default function AssistantSheet({ open, seed, onChanged }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + 10 }));

  const sendText = useCallback(async raw => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    const at = new Date().toISOString();
    setItems(prev => [{ id: `me-${at}`, mine: true, kind: 'chat', text, at }, ...prev]);
    setBusy(true);
    try {
      const d = await chat(text);
      setItems(prev => [{ id: `blu-${Date.now()}`, mine: false, kind: 'chat', text: d.reply || '…', at: new Date().toISOString() }, ...prev]);
      onChanged?.(); // the reply may have added or changed a todo
    } catch {
      setItems(prev => [{ id: `err-${Date.now()}`, mine: false, kind: 'error', text: "Couldn't reach Blu. Try again.", at: new Date().toISOString() }, ...prev]);
    } finally {
      setBusy(false);
    }
  }, [busy, onChanged]);

  const send = useCallback(() => sendText(input), [sendText, input]);

  useEffect(() => {
    if (!open) return undefined;
    // Send only after the thread loads, or the load would overwrite the message just sent.
    getMessages()
      .then(rows => setItems(toItems(rows)))
      .catch(() => {})
      .finally(() => { if (seed?.send) sendText(seed.text); });
    if (seed?.send) return undefined;
    if (seed) setInput(seed.text);
    const id = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(id);
  }, [open, seed]);

  // The list is inverted (newest first), so the message before this one in time is at index + 1.
  const render = ({ item, index }) => {
    const older = items[index + 1];
    const showTime = item.at && (!older || !older.at || new Date(item.at) - new Date(older.at) > GAP_MS);
    const proactive = !item.mine && item.kind && item.kind !== 'chat' && item.kind !== 'error';
    return (
      <View>
        {showTime ? <Text style={s.time}>{when(item.at)}</Text> : null}
        <View style={[s.msg, item.mine ? s.mine : s.theirs]}>
          {proactive ? <Text style={s.kind}>{KIND_LABEL[item.kind] || 'Update'}</Text> : null}
          <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleTheirs]}>
            <Text style={[T.body, item.kind === 'error' && { color: C.red }]}>{item.mine ? item.text : plain(item.text)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Animated.View style={[{ flex: 1 }, lift]}>
      <FlatList
        inverted
        data={items}
        keyExtractor={i => i.id}
        renderItem={render}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={busy ? <View style={[s.msg, s.theirs, s.bubble, s.bubbleTheirs]}><ActivityIndicator color={C.label2} size="small" /></View> : null}
        ListEmptyComponent={<Text style={s.empty}>Ask anything, or just say what needs doing.</Text>}
      />
      <View style={s.inputRow}>
        <View style={s.field}>
        <TextInput
          ref={inputRef}
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message"
          placeholderTextColor={C.label3}
          multiline
          maxLength={1000}
        />
        {input.trim() ? (
          <Pressable onPress={send} disabled={busy} style={[s.send, busy && { opacity: 0.4 }]} accessibilityLabel="Send" hitSlop={8}>
            <Icon name="arrowUp" size={16} color="#fff" stroke={2.8} />
          </Pressable>
        ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 12, paddingVertical: 10 },
  empty: { ...T.subhead, textAlign: 'center', marginTop: 40, transform: [{ scaleY: -1 }] },
  time: { ...T.caption, color: C.label3, textAlign: 'center', marginTop: 14, marginBottom: 6 },
  msg: { marginVertical: 2, maxWidth: '80%' },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  kind: { ...T.caption, marginBottom: 3, marginLeft: 12, marginTop: 6 },
  bubble: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18 },
  bubbleMine: { backgroundColor: C.accent },
  bubbleTheirs: { backgroundColor: '#26262B' },
  inputRow: { paddingHorizontal: 12, paddingTop: 8 },
  field: {
    flexDirection: 'row', alignItems: 'flex-end', minHeight: 38, borderRadius: 19,
    borderWidth: 1, borderColor: 'rgba(84,84,88,0.8)', paddingLeft: 14, paddingRight: 4, paddingVertical: 3,
  },
  input: { flex: 1, maxHeight: 130, color: C.label, fontSize: 17, fontFamily: 'Heros-Regular', paddingTop: 6, paddingBottom: 6 },
  send: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
});

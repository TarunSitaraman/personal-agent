// The conversation: replies plus everything Blu sent on its own (briefs, reminders, nudges).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { chat, getMessages } from '../api';
import { when, plain } from '../format';
import { C, F } from '../theme';

const KIND_LABEL = {
  reminder: 'Reminder', event: 'Starting soon', brief: 'Morning brief', evening: 'Evening brief',
  nudge: 'Nudge', goal: 'One big thing', pulse: 'Tech pulse', weekly: 'Weekly review',
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

  const render = ({ item }) => {
    const proactive = !item.mine && item.kind && item.kind !== 'chat' && item.kind !== 'error';
    return (
      <View style={[s.msg, item.mine ? s.mine : s.theirs]}>
        {proactive ? <Text style={s.kind}>{KIND_LABEL[item.kind] || 'Update'}</Text> : null}
        <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleTheirs, proactive && s.bubbleProactive]}>
          <Text style={[s.text, item.mine && s.textMine, item.kind === 'error' && { color: C.danger }]}>{item.mine ? item.text : plain(item.text)}</Text>
        </View>
        {item.at ? <Text style={[s.time, item.mine && { textAlign: 'right' }]}>{when(item.at)}</Text> : null}
      </View>
    );
  };

  return (
    <Animated.View style={[{ flex: 1 }, lift]}>
      <Text style={s.title}>Blu</Text>
      <FlatList
        inverted
        data={items}
        keyExtractor={i => i.id}
        renderItem={render}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={busy ? <View style={[s.msg, s.theirs]}><ActivityIndicator color={C.accent} /></View> : null}
        ListEmptyComponent={<Text style={s.empty}>Ask anything, or just say what needs doing.</Text>}
      />
      <View style={s.inputRow}>
        <TextInput
          ref={inputRef}
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message Blu"
          placeholderTextColor={C.text3}
          multiline
          maxLength={1000}
        />
        <Pressable onPress={send} disabled={!input.trim() || busy} style={[s.send, (!input.trim() || busy) && { opacity: 0.35 }]} accessibilityLabel="Send">
          <Icon name="arrowUp" size={18} color={C.ink} stroke={2.6} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  title: { ...F.bold, fontSize: 22, color: C.text, paddingHorizontal: 22, paddingBottom: 6 },
  list: { paddingHorizontal: 16, paddingVertical: 10 },
  empty: { ...F.bold, fontSize: 15, color: C.text3, textAlign: 'center', marginTop: 40, transform: [{ scaleY: -1 }] },
  msg: { marginVertical: 5, maxWidth: '86%' },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  kind: { ...F.bold, fontSize: 12, color: C.accent, marginBottom: 5, marginLeft: 4 },
  bubble: { paddingHorizontal: 15, paddingVertical: 11, borderRadius: 20 },
  bubbleMine: { backgroundColor: C.accent, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: 'rgba(255,255,255,0.07)', borderBottomLeftRadius: 6 },
  bubbleProactive: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(130,169,255,0.45)' },
  text: { ...F.regular, fontSize: 16, lineHeight: 22, color: C.text },
  textMine: { ...F.bold, color: C.ink },
  time: { ...F.regular, fontSize: 11, color: C.text3, marginTop: 4, marginHorizontal: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 8 },
  input: {
    flex: 1, minHeight: 48, maxHeight: 140, borderRadius: 24, paddingHorizontal: 18, paddingTop: 13, paddingBottom: 13,
    backgroundColor: 'rgba(255,255,255,0.08)', color: C.text, fontSize: 16, ...F.bold,
  },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
});

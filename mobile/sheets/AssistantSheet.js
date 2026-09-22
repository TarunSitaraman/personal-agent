// The conversation, built from the approved mockup ("3 · Assistant"): your messages as white
// bubbles, Blu's replies as cards with a glowing accent edge, briefs and reminders as dashed cards
// in the same thread, action chips under the newest reply, and bobbing dots while Blu thinks.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import Glass from '../components/Glass';
import Press from '../components/Press';
import { Label, Chip, Dots } from '../components/kit';
import { chat, getMessages } from '../api';
import { when, plain } from '../format';
import { C, T } from '../theme';

const GAP_MS = 30 * 60 * 1000; // a timestamp heads a message only after a pause this long

const KIND_LABEL = {
  reminder: 'Reminder', event: 'Starting soon', brief: 'Morning brief', evening: 'Evening brief',
  nudge: 'Nudge', goal: 'One big thing', pulse: 'Tech pulse', weekly: 'Weekly review',
};

// Under the newest reply: "undo" routes to the agent's undo_last, which also records a correction.
const REPLY_CHIPS = [
  { title: 'Undo', text: 'undo that', kind: 'line' },
  { title: 'Tell me more', text: 'Tell me more' },
];
// Above the input when it is empty.
const QUICK = ["What's open?", "What's on tomorrow?", 'Plan my day'];

// Server rows are newest-first, which is what an inverted list wants.
const toItems = rows => rows.map(r => ({ id: String(r.id), mine: r.from === 'me', kind: r.kind, text: r.text, at: r.created_at }));

// `seed` comes from a suggestion chip: its text is placed in the box, or sent when seed.send.
export default function AssistantSheet({ open, seed, onChanged }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null); // id of a reply received in this session
  const inputRef = useRef(null);
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + 12 }));

  const sendText = useCallback(async raw => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    setFresh(null);
    const at = new Date().toISOString();
    setItems(prev => [{ id: `me-${at}`, mine: true, kind: 'chat', text, at }, ...prev]);
    setBusy(true);
    try {
      const d = await chat(text);
      const id = `blu-${Date.now()}`;
      setItems(prev => [{ id, mine: false, kind: 'chat', text: d.reply || '…', at: new Date().toISOString() }, ...prev]);
      setFresh(id);
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
    setFresh(null);
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
      <Animated.View entering={index < 2 ? FadeInDown.duration(260) : undefined}>
        {showTime ? <Text style={s.time}>{when(item.at)}</Text> : null}
        {item.mine ? (
          <View style={s.me}><Text style={s.meText}>{item.text}</Text></View>
        ) : proactive ? (
          <View style={s.pro}>
            <Label style={{ opacity: 0.8 }}>{KIND_LABEL[item.kind] || 'Update'}</Label>
            <Text style={[T.body, { fontSize: 14, lineHeight: 20, marginTop: 4, color: 'rgba(255,255,255,0.85)' }]}>{plain(item.text)}</Text>
          </View>
        ) : (
          <View style={s.resp}>
            <View style={[s.edge, item.kind === 'error' && { backgroundColor: C.red, shadowColor: C.red }]} />
            <Text style={[T.body, item.kind === 'error' && { color: C.red }]}>{plain(item.text)}</Text>
            {item.id === fresh ? (
              <View style={s.chips}>
                {REPLY_CHIPS.map(c => <Chip key={c.title} title={c.title} kind={c.kind} size="small" onPress={() => sendText(c.text)} />)}
              </View>
            ) : null}
          </View>
        )}
      </Animated.View>
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
        ListHeaderComponent={busy ? <View style={{ paddingLeft: 6, paddingTop: 6 }}><Dots /></View> : null}
        ListEmptyComponent={<Text style={s.empty}>Ask anything, or just say what needs doing.</Text>}
      />
      {!input && !busy ? (
        <View style={s.quick}>
          {QUICK.map(q => <Chip key={q} title={q} size="small" onPress={() => sendText(q)} />)}
        </View>
      ) : null}
      <Glass radius={26} base="rgba(8,13,32,0.6)" style={s.bar}>
        <TextInput
          ref={inputRef}
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Reply…"
          placeholderTextColor="rgba(235,238,250,0.55)"
          multiline
          maxLength={1000}
        />
        <Press onPress={send} disabled={!input.trim() || busy} style={[s.go, (!input.trim() || busy) && { opacity: 0.4 }]} accessibilityLabel="Send">
          <Icon name="arrowUp" size={17} color={C.ink} stroke={2.8} />
        </Press>
      </Glass>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 9 },
  empty: { ...T.sub, textAlign: 'center', marginTop: 40, transform: [{ scaleY: -1 }] },
  time: { ...T.small, textAlign: 'center', marginVertical: 8 },
  me: { alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 5 },
  meText: { fontFamily: 'Heros-Bold', fontSize: 15, lineHeight: 20, color: '#0b0b0e' },
  resp: {
    alignSelf: 'flex-start', maxWidth: '92%', borderRadius: 18, paddingVertical: 12, paddingLeft: 17, paddingRight: 14,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)',
  },
  edge: {
    position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: C.accent,
    shadowColor: C.accent, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  pro: {
    alignSelf: 'flex-start', maxWidth: '92%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)',
  },
  chips: { flexDirection: 'row', gap: 6, marginTop: 10 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 10 },
  bar: { marginHorizontal: 12, minHeight: 52, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 18, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, maxHeight: 130, color: C.label, fontSize: 15, fontFamily: 'Heros-Bold', paddingTop: 10, paddingBottom: 10 },
  go: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});

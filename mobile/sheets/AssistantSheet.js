// The conversation, built from the approved mockup ("3 · Assistant"): your messages as white
// bubbles, Blu's replies as cards with a glowing accent edge, briefs and reminders as dashed cards
// in the same thread, action chips under the newest reply, and Blu's orb spinning up while it
// thinks. Voice notes work like WhatsApp's: with the box empty the button is a mic.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icon from '../components/Icon';
import Glass from '../components/Glass';
import Press from '../components/Press';
import Orb from '../components/Orb';
import VoicePanel, { useVoiceNote, mmss } from '../components/VoicePanel';
import { Label, Chip } from '../components/kit';
import { chat, getMessages, sendVoice } from '../api';
import { when, plain } from '../format';
import { C, T } from '../theme';

const GAP_MS = 30 * 60 * 1000; // a timestamp heads a message only after a pause this long

const KIND_LABEL = {
  reminder: 'Reminder', event: 'Starting soon', brief: 'Morning brief', evening: 'Evening brief',
  nudge: 'Nudge', goal: 'One big thing', pulse: 'Tech pulse', weekly: 'Weekly review',
};

// Chips under the newest reply. A todo that came back without a reminder gets the same follow-up
// WhatsApp sends ("Want a reminder for this?"); anything else gets Undo / Tell me more. Undo routes
// to the agent's undo_last, which also records a classifier correction.
function replyChips(text) {
  const added = /^Todo added: "(.+)"$/.exec(String(text).trim());
  if (added) {
    const what = added[1];
    return [
      { title: 'Tonight 9pm', text: `remind me about "${what}" tonight at 9pm`, kind: 'line' },
      { title: 'Tomorrow 8am', text: `remind me about "${what}" tomorrow at 8am`, kind: 'line' },
      { title: 'Undo', text: 'undo that' },
    ];
  }
  return [{ title: 'Undo', text: 'undo that', kind: 'line' }, { title: 'Tell me more', text: 'Tell me more' }];
}

// Above the input when it is empty.
const QUICK = ["What's open?", "What's on tomorrow?", 'Plan my day'];

// Server rows are newest-first, which is what an inverted list wants.
const toItems = rows => rows.map(r => ({ id: String(r.id), mine: r.from === 'me', kind: r.kind, text: r.text, at: r.created_at }));

// `seed` comes from a suggestion chip or the home bar: text placed in the box, text sent at once
// (seed.send), or a voice note started straight away (seed.voice).
export default function AssistantSheet({ open, seed, onChanged }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null); // id of a reply received in this session
  const inputRef = useRef(null);
  const voice = useVoiceNote();
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + 12 }));

  const addReply = useCallback(text => {
    const id = `blu-${Date.now()}`;
    setItems(prev => [{ id, mine: false, kind: 'chat', text: text || '…', at: new Date().toISOString() }, ...prev]);
    setFresh(id);
  }, []);

  const addError = useCallback(text => {
    setItems(prev => [{ id: `err-${Date.now()}`, mine: false, kind: 'error', text, at: new Date().toISOString() }, ...prev]);
  }, []);

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
      addReply(d.reply);
      onChanged?.(); // the reply may have added or changed a todo
    } catch {
      addError("Couldn't reach Blu. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, onChanged, addReply, addError]);

  const send = useCallback(() => sendText(input), [sendText, input]);

  const startVoice = useCallback(async () => {
    if (busy || voice.recording) return;
    try {
      inputRef.current?.blur();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await voice.start();
    } catch (e) {
      addError(e.message || "Couldn't start recording."); // toasts are hidden while a sheet is open
    }
  }, [busy, voice, addError]);

  // Stop and send: the note shows as "Voice note · 0:07" until the transcript replaces it.
  const stopVoice = useCallback(async () => {
    let note;
    try { note = await voice.stop(); } catch { addError("Couldn't save the recording."); return; }
    if (!note) return; // a mis-tap shorter than a word
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const id = `me-voice-${Date.now()}`;
    setFresh(null);
    setItems(prev => [{ id, mine: true, kind: 'voice', text: `Voice note · ${mmss(note.ms)}`, at: new Date().toISOString() }, ...prev]);
    setBusy(true);
    try {
      const d = await sendVoice(note.base64, note.mime);
      setItems(prev => prev.map(m => (m.id === id ? { ...m, text: d.transcript, heard: true } : m)));
      addReply(d.reply);
      onChanged?.();
    } catch (e) {
      addError(/422/.test(e.message) ? "Couldn't make out any words. Try again a little closer." : "Couldn't send the voice note. Try again.");
    } finally {
      setBusy(false);
    }
  }, [voice, onChanged, addReply, addError]);

  const cancelVoice = useCallback(() => { voice.cancel().catch(() => {}); }, [voice]);

  useEffect(() => {
    if (!open) {
      if (voice.recording) voice.cancel().catch(() => {}); // closing the sheet discards a recording
      return undefined;
    }
    setFresh(null);
    setLoaded(false);
    // Send only after the thread loads, or the load would overwrite the message just sent.
    getMessages()
      .then(rows => setItems(toItems(rows)))
      .catch(() => {})
      .finally(() => {
        setLoaded(true);
        if (seed?.send) sendText(seed.text);
        if (seed?.voice) startVoice();
      });
    if (seed?.send || seed?.voice) return undefined;
    if (seed) setInput(seed.text);
    const id = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(id);
  }, [open, seed]);

  // The list is inverted (newest first), so the message before this one in time is at index + 1.
  const render = ({ item, index }) => {
    const older = items[index + 1];
    const showTime = item.at && (!older || !older.at || new Date(item.at) - new Date(older.at) > GAP_MS);
    const proactive = !item.mine && item.kind && !['chat', 'error'].includes(item.kind);
    return (
      <Animated.View entering={index < 2 ? FadeInDown.duration(260) : undefined}>
        {showTime ? <Text style={s.time}>{when(item.at)}</Text> : null}
        {item.mine ? (
          <View style={s.me}>
            {item.kind === 'voice' ? (
              <View style={s.voiceTag}>
                <Icon name="mic" size={12} color="#0b0b0e" stroke={2.6} />
                <Text style={s.voiceTagText}>{item.heard ? 'Heard' : 'Sending'}</Text>
              </View>
            ) : null}
            <Text style={[s.meText, item.kind === 'voice' && !item.heard && { opacity: 0.55 }]}>{item.text}</Text>
          </View>
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
                {replyChips(item.text).map(c => <Chip key={c.title} title={c.title} kind={c.kind} size="small" onPress={() => sendText(c.text)} />)}
              </View>
            ) : null}
          </View>
        )}
      </Animated.View>
    );
  };

  const typing = input.trim().length > 0;
  const empty = loaded && !items.length && !busy;

  return (
    <Animated.View style={[{ flex: 1 }, lift]}>
      <View style={{ flex: 1 }}>
        <FlatList
          inverted
          data={items}
          keyExtractor={i => i.id}
          renderItem={render}
          contentContainerStyle={s.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={busy ? <View style={{ paddingTop: 4 }}><Orb size={46} thinking /></View> : null}
        />
        {/* Outside the list: an inverted list flips its empty component, and on Android that
            mirrors the text horizontally as well as vertically. */}
        {empty ? (
          <View style={s.emptyWrap} pointerEvents="none">
            <Orb size={120} />
            <Text style={s.empty}>Ask anything, say what needs doing, or hold a thought with the mic.</Text>
          </View>
        ) : null}
      </View>

      {voice.recording ? (
        <VoicePanel voice={voice} onStop={stopVoice} onCancel={cancelVoice} />
      ) : (
        <>
          {!typing && !busy ? (
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
              placeholder="Reply, or tap the mic…"
              placeholderTextColor="rgba(235,238,250,0.55)"
              multiline
              maxLength={1000}
            />
            {typing ? (
              <Press onPress={send} disabled={busy} style={[s.go, busy && { opacity: 0.4 }]} accessibilityLabel="Send">
                <Icon name="arrowUp" size={17} color={C.ink} stroke={2.8} />
              </Press>
            ) : (
              <Press onPress={startVoice} disabled={busy} style={[s.go, busy && { opacity: 0.4 }]} accessibilityLabel="Record a voice note">
                <Icon name="mic" size={18} color={C.ink} stroke={2.4} />
              </Press>
            )}
          </Glass>
        </>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 9 },
  emptyWrap: { position: 'absolute', left: 0, right: 0, top: 30, alignItems: 'center', paddingHorizontal: 30 },
  empty: { ...T.sub, textAlign: 'center', marginTop: 4 },
  time: { ...T.small, textAlign: 'center', marginVertical: 8 },
  me: { alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 5 },
  meText: { fontFamily: 'Heros-Bold', fontSize: 15, lineHeight: 20, color: '#0b0b0e' },
  voiceTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  voiceTagText: { fontFamily: 'Heros-Bold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(11,11,14,0.55)' },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 10 },
  bar: { marginHorizontal: 12, minHeight: 52, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 18, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, maxHeight: 130, color: C.label, fontSize: 15, fontFamily: 'Heros-Bold', paddingTop: 10, paddingBottom: 10 },
  go: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});

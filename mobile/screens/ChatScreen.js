import React, { useState, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chat, getMessages } from '../api';
import { C, FONT } from '../theme';

const GREETING = { id: 'greeting', role: 'blu', kind: 'chat', text: "Hey, I'm Blu. What's on your mind?", created_at: null };

// Labels for proactive messages, which render distinctly from replies.
const KIND_LABEL = {
  reminder: 'Reminder', event: 'Starting soon', brief: 'Morning brief', evening: 'Evening brief',
  nudge: 'Nudge', goal: 'One Big Thing', pulse: 'Tech pulse', weekly: 'Weekly review',
};

// Server rows are newest-first; the list renders oldest-first like any chat.
function toItems(rows) {
  return rows.slice().reverse().map(r => ({
    id: r.id,
    role: r.from === 'me' ? 'user' : 'blu',
    kind: r.kind,
    text: r.text,
    created_at: r.created_at,
  }));
}

export default function ChatScreen() {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  // Reload on every focus: a notification tap lands here, and the message it announced must be
  // in the list. The newest message is at the bottom, so scroll there once loaded.
  useFocusEffect(useCallback(() => {
    let alive = true;
    getMessages()
      .then(rows => {
        if (!alive) return;
        setMessages(rows.length ? toItems(rows) : [GREETING]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
      })
      .catch(() => {}); // keep whatever is on screen; a transient failure should not blank it
    return () => { alive = false; };
  }, []));

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg = { id: Date.now().toString(), role: 'user', kind: 'chat', text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const d = await chat(text);
      const bluMsg = { id: (Date.now() + 1).toString(), role: 'blu', kind: 'chat', text: d.reply || '…', created_at: new Date().toISOString() };
      setMessages(prev => [...prev, bluMsg]);
    } catch {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'blu', text: 'Something went wrong. Try again.' }]);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, loading]);

  const renderItem = ({ item }) => {
    const isUser = item.role === 'user';
    const proactive = !isUser && item.kind && item.kind !== 'chat';
    // Each message's own time; the old code rendered new Date() for every message.
    const time = item.created_at
      ? new Date(item.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : '';
    return (
      <View style={[s.msgWrap, isUser ? s.msgRight : s.msgLeft]}>
        {proactive ? <Text style={s.kindLabel}>{KIND_LABEL[item.kind] || 'Update'}</Text> : null}
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleBlu, proactive && s.bubbleProactive]}>
          <Text style={[s.bubbleText, isUser && s.bubbleTextUser]}>{item.text}</Text>
        </View>
        {time ? <Text style={[s.msgTime, isUser && { textAlign: 'right' }]}>{time}</Text> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Blu</Text>
        <View style={s.onlineWrap}>
          <View style={s.onlineDot} />
          <Text style={s.onlineText}>online</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            loading ? (
              <View style={[s.msgWrap, s.msgLeft]}>
                <View style={s.bubbleBlu}>
                  <View style={s.typingDots}>
                    <View style={s.dot} />
                    <View style={[s.dot, { opacity: 0.5 }]} />
                    <View style={[s.dot, { opacity: 0.25 }]} />
                  </View>
                </View>
              </View>
            ) : null
          }
        />

        <View style={s.inputBar}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message Blu…"
            placeholderTextColor={C.t3}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={send}
          />
          <TouchableOpacity style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]} onPress={send} disabled={!input.trim() || loading}>
            {loading
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={s.sendIcon}>↑</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  title: { fontSize: 17, ...FONT.bold, color: C.t1 },
  onlineWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.srq },
  onlineText: { fontSize: 12, ...FONT.medium, color: C.srq },
  list: { padding: 16, gap: 8, paddingBottom: 8 },
  msgWrap: { maxWidth: '82%', gap: 3 },
  msgLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  msgRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: 16, padding: 12 },
  bubbleUser: { backgroundColor: C.hex, borderBottomRightRadius: 4 },
  bubbleBlu: { backgroundColor: C.s2, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, ...FONT.medium, color: C.t1, lineHeight: 20 },
  bubbleTextUser: { color: '#000' },
  msgTime: { fontSize: 10, color: C.t3, paddingHorizontal: 2 },
  kindLabel: { fontSize: 10, ...FONT.bold, color: C.per, letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 2 },
  bubbleProactive: { borderColor: C.per },
  typingDots: { flexDirection: 'row', gap: 4, alignItems: 'center', paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.t3 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.s1,
  },
  input: {
    flex: 1, backgroundColor: C.s2, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: C.t1, fontSize: 14, ...FONT.regular, maxHeight: 120,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 12, backgroundColor: C.hex,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { fontSize: 18, ...FONT.bold, color: '#000' },
});

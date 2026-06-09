import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import HexPet from '../components/HexPet';
import { C } from '../theme';
import { chat } from '../api';

export default function PetScreen() {
  const [messages, setMessages] = useState([
    { id: '0', from: 'hex', text: "Hey Tarun! I'm Hex — tap me to say hi, or type anything below 👾" },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef();

  const send = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg = { id: Date.now().toString(), from: 'user', text: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const { reply } = await chat(trimmed);
      const hexMsg = { id: (Date.now() + 1).toString(), from: 'hex', text: reply || '...' };
      setMessages(prev => [...prev, hexMsg]);
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), from: 'hex', text: "I had trouble connecting right now. Try again?" }]);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      {/* Pet floats over the chat — positioned in lower-right */}
      <HexPet initialX={220} initialY={80} onChat={() => send("Hey Hex, what's up?")} />

      <KeyboardAvoidingView
        style={s.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <View style={[s.bubble, item.from === 'user' ? s.userBubble : s.hexBubble]}>
              {item.from === 'hex' && <Text style={s.sender}>Hex</Text>}
              <Text style={item.from === 'user' ? s.userText : s.hexText}>{item.text}</Text>
            </View>
          )}
        />

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="Ask Hex anything…"
            placeholderTextColor={C.t3}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            editable={!loading}
          />
          <TouchableOpacity
            style={[s.sendBtn, loading && s.sendDisabled]}
            onPress={() => send(input)}
            disabled={loading}
          >
            <Text style={s.sendTxt}>{loading ? '…' : '↑'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  kav: { flex: 1 },
  list: { padding: 16, paddingBottom: 8 },
  bubble: {
    maxWidth: '78%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  hexBubble: { backgroundColor: C.s2 || '#1e1e2e', alignSelf: 'flex-start' },
  userBubble: { backgroundColor: C.hex || '#7C3AED', alignSelf: 'flex-end' },
  sender: { fontSize: 10, fontWeight: '700', color: C.t3, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  hexText: { color: C.t1, fontSize: 14, lineHeight: 20 },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.s1,
  },
  input: {
    flex: 1,
    backgroundColor: C.s2 || '#1e1e2e',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: C.t1,
    fontSize: 14,
    marginRight: 8,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.hex || '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  sendTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
});

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Glass from '../components/Glass';
import { verifyToken } from '../api';
import { setToken } from '../auth';
import { C, F } from '../theme';

// First launch, and whenever the server rejects the stored token. The token is checked against
// the server before it is stored, so a typo never gets saved.
export default function TokenScreen({ onSignedIn }) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + 24 }));

  const connect = async () => {
    const token = value.trim();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyToken(token);
      await setToken(token);
      onSignedIn();
    } catch {
      setError("That key wasn't accepted. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  const ready = value.trim() && !busy;
  return (
    <Animated.View style={[s.root, { paddingTop: insets.top + 80 }, lift]}>
      <View>
        <Text style={s.title}>Blu</Text>
        <Text style={s.hint}>Paste your key to connect. It stays encrypted on this phone.</Text>
      </View>
      <View style={{ gap: 12 }}>
        <Glass radius={20} blur={false}>
          <TextInput
            style={s.input}
            value={value}
            onChangeText={setValue}
            placeholder="Key"
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            onSubmitEditing={connect}
          />
        </Glass>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable onPress={connect} disabled={!ready} style={[s.btn, !ready && { opacity: 0.4 }]}>
          {busy ? <ActivityIndicator color={C.ink} /> : <Text style={s.btnText}>Connect</Text>}
        </Pressable>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  title: { ...F.bold, fontSize: 56, color: C.text, letterSpacing: -2 },
  hint: { ...F.bold, fontSize: 17, lineHeight: 24, color: C.text2, marginTop: 12, maxWidth: 300 },
  input: { paddingHorizontal: 20, paddingVertical: 17, color: C.text, fontSize: 16, ...F.bold },
  error: { ...F.bold, fontSize: 14, color: C.danger },
  btn: { backgroundColor: C.accent, borderRadius: 20, paddingVertical: 17, alignItems: 'center' },
  btnText: { ...F.bold, fontSize: 16, color: C.ink },
});

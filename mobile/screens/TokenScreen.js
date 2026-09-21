import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { verifyToken } from '../api';
import { setToken } from '../auth';
import { C, T, RADIUS } from '../theme';

// First launch, and whenever the server rejects the stored key. The key is checked against the
// server before it is stored, so a typo never gets saved.
export default function TokenScreen({ onSignedIn }) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + 20 }));

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

  return (
    <Animated.View style={[s.root, { paddingTop: insets.top + 72 }, lift]}>
      <View>
        <Text style={T.largeTitle}>Welcome to Blu</Text>
        <Text style={[T.body, { color: C.label2, marginTop: 10 }]}>
          Enter your key to connect this phone. It's stored encrypted on the device.
        </Text>
      </View>
      <View>
        <View style={s.field}>
          <TextInput
            style={s.input}
            value={value}
            onChangeText={setValue}
            placeholder="Key"
            placeholderTextColor={C.label3}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            onSubmitEditing={connect}
          />
        </View>
        {error ? <Text style={[T.footnote, { color: C.red, marginTop: 8, paddingHorizontal: 4 }]}>{error}</Text> : null}
        <View style={{ marginTop: 16 }}>
          {busy
            ? <View style={s.busy}><ActivityIndicator color="#fff" /></View>
            : <Button title="Continue" size="large" onPress={connect} disabled={!value.trim()} />}
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, justifyContent: 'space-between' },
  field: { backgroundColor: C.cell, borderRadius: RADIUS.cell },
  input: { height: 50, paddingHorizontal: 16, color: C.label, fontSize: 17, fontFamily: 'Heros-Regular' },
  busy: { height: 50, borderRadius: RADIUS.button, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
});

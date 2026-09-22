import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlowInput, ShinyButton } from '../components/kit';
import { verifyToken } from '../api';
import { setToken } from '../auth';
import { C, T } from '../theme';

// First launch, and whenever the server rejects the stored key — from the mockup ("8 · Sign in").
// The key is checked against the server before it is stored, so a typo never gets saved.
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

  return (
    <Animated.View style={[s.root, { paddingTop: insets.top + 110 }, lift]}>
      <Animated.View entering={FadeInDown.duration(500)}>
        <Text style={s.brand}>Blu</Text>
        <Text style={[T.body, { color: 'rgba(255,255,255,0.72)', marginTop: 10, maxWidth: 300 }]}>
          Paste your key to connect. It's stored encrypted on this phone.
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(120).duration(500)} style={{ gap: 14 }}>
        <GlowInput
          value={value}
          onChangeText={setValue}
          placeholder="Key"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          onSubmitEditing={connect}
        />
        {error ? <Text style={[T.sub, { color: C.red }]}>{error}</Text> : null}
        <ShinyButton title="Connect" onPress={connect} disabled={!value.trim()} busy={busy} />
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  brand: { fontFamily: 'Heros-Bold', fontSize: 60, lineHeight: 62, letterSpacing: -2.5, color: '#fff' },
});

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlowInput, ShinyButton } from '../components/kit';
import { verifyToken } from '../api';
import { setToken } from '../auth';
import { C, T } from '../theme';

// The fallback to number + PIN (screens/AuthFlow.js): paste the long key. Needed once to set a
// PIN on an account that has none. The key is checked against the server before it is stored,
// so a typo never gets saved.
export default function TokenScreen({ onSignedIn, onBack }) {
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
    <Animated.View style={[s.root, { paddingTop: insets.top + 16 }, lift]}>
      {onBack ? <Pressable onPress={onBack} hitSlop={12} style={{ alignSelf: 'flex-start' }}><Text style={s.link}>‹ Back</Text></Pressable> : null}
      <Animated.View entering={FadeInDown.duration(500)} style={{ marginTop: 60 }}>
        <Text style={s.brand}>Blu</Text>
        <Text style={[T.body, { color: 'rgba(255,255,255,0.72)', marginTop: 10, maxWidth: 300 }]}>
          Paste your key to connect. It's stored encrypted on this phone. Next, you can set a PIN so this is the last time.
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(120).duration(500)} style={{ gap: 14, marginTop: 'auto' }}>
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
  root: { flex: 1, paddingHorizontal: 24 },
  brand: { fontFamily: 'Heros-Bold', fontSize: 60, lineHeight: 62, letterSpacing: -2.5, color: '#fff' },
  link: { fontFamily: 'Heros-Bold', fontSize: 14, color: C.accent },
});

// Choose a PIN, type it again, saved. Shown full-screen right after a key sign-in (with Skip),
// and inside Settings to set or change it. Weak PINs come back from the server with the reason.
import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import PinInput from './PinInput';
import { Label } from './kit';
import { setPin } from '../api';
import { C, T } from '../theme';

export default function SetPin({ onDone, onSkip, autoFocus = true }) {
  const ref = useRef(null);
  const [first, setFirst] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onPin = async pin => {
    setError(null);
    if (!first) { setFirst(pin); ref.current?.clear(); return; }
    if (pin !== first) { setFirst(null); setError("Those didn't match. Choose one again."); ref.current?.reject(); return; }
    setBusy(true);
    try {
      const res = await setPin(pin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onDone(res.number);
    } catch (e) {
      setFirst(null);
      setError(e.message);
      ref.current?.reject();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Label>{first ? 'Type it once more' : 'Choose a six-digit PIN'}</Label>
      <PinInput ref={ref} onComplete={onPin} disabled={busy} autoFocus={autoFocus} />
      {error ? <Text style={[T.sub, { color: C.red }]}>{error}</Text> : null}
      {busy ? <Text style={T.sub}>Saving…</Text> : null}
      {onSkip ? (
        <Pressable onPress={onSkip} hitSlop={10} style={{ marginTop: 10 }}>
          <Text style={s.link}>Not now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  link: { fontFamily: 'Heros-Bold', fontSize: 14, color: C.accent },
});

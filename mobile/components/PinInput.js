// Six-digit PIN entry: six glass cells over a hidden number-pad input. Filled cells show a dot,
// the next cell glows accent, a wrong PIN shakes the row, and the sixth digit submits.
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { C } from '../theme';

const LENGTH = 6;

const PinInput = forwardRef(function PinInput({ onComplete, disabled, autoFocus = true }, ref) {
  const [value, setValue] = useState('');
  const input = useRef(null);
  const x = useSharedValue(0);

  useImperativeHandle(ref, () => ({
    // Called by the parent when the server says no: shake, buzz, clear, ready for another go.
    reject() {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      x.value = withSequence(
        withTiming(-10, { duration: 50 }), withTiming(10, { duration: 50 }),
        withTiming(-7, { duration: 50 }), withTiming(7, { duration: 50 }), withTiming(0, { duration: 50 }),
      );
      setValue('');
      setTimeout(() => input.current?.focus(), 60);
    },
    clear() { setValue(''); },
    focus() { input.current?.focus(); },
  }));

  useEffect(() => {
    if (value.length === LENGTH) onComplete(value);
  }, [value]);

  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityLabel="Enter your six-digit PIN">
      <Animated.View style={[s.row, shake]}>
        {Array.from({ length: LENGTH }, (_, i) => {
          const filled = i < value.length;
          const active = i === value.length && !disabled;
          return (
            <View key={i} style={[s.cell, active && s.active]}>
              {filled ? <View style={s.dot} /> : null}
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={t => setValue(t.replace(/\D/g, '').slice(0, LENGTH))}
        keyboardType="number-pad"
        maxLength={LENGTH}
        autoFocus={autoFocus}
        editable={!disabled}
        secureTextEntry
        textContentType="oneTimeCode"
        style={s.hidden}
        caretHidden
      />
    </Pressable>
  );
});

export default PinInput;

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cell: {
    flex: 1, aspectRatio: 0.82, maxWidth: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  active: { borderColor: 'rgba(130,169,255,0.8)', backgroundColor: 'rgba(130,169,255,0.08)' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.label },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});

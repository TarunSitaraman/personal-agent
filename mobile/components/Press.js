// Pressable that gives way under the finger: a quick spring scale, like a physical button.
import React from 'react';
import { Pressable } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { SPRING } from '../theme';

const APressable = Animated.createAnimatedComponent(Pressable);

export default function Press({ style, scaleTo = 0.95, onPressIn, onPressOut, children, ...rest }) {
  const k = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));
  return (
    <APressable
      {...rest}
      onPressIn={e => { k.value = withSpring(scaleTo, SPRING); onPressIn?.(e); }}
      onPressOut={e => { k.value = withSpring(1, SPRING); onPressOut?.(e); }}
      style={[style, anim]}
    >
      {children}
    </APressable>
  );
}

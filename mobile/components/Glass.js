// The only material in the app: blurred, tinted, with a thin light rim on the top edge.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { C } from '../theme';

export default function Glass({ style, radius = 24, tint = C.glass, children, ...rest }) {
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]} {...rest}>
      <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, {
          borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: C.rim,
          borderTopColor: 'rgba(255,255,255,0.32)',
        }]}
      />
      {children}
    </View>
  );
}

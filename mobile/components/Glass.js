// The only material in the app: tinted, with a thin light rim on the top edge, and blurred where
// content moves behind it. Android's blur samples the element's own children too, which smears a
// halo around text and buttons — so anything sitting in the page (over a smooth sky gradient,
// where blur adds nothing) passes blur={false} and gets the tint alone.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { C } from '../theme';

export default function Glass({ style, radius = 24, tint = C.glass, blur = true, children, ...rest }) {
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]} {...rest}>
      {blur ? <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} /> : null}
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

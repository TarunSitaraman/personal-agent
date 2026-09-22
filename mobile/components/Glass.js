// The one material, as in the mockups' .glass: a top-lit gradient, a thin rim, a brighter top
// edge and a soft drop shadow. Drawn, not blurred — Android's blur samples the element's own
// children and smears a halo around text.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';

export default function Glass({ style, radius = 22, base, shadow = true, children, ...rest }) {
  return (
    <View style={[{ borderRadius: radius }, shadow && s.shadow, style]} {...rest}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
        {base ? <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} /> : null}
        <LinearGradient colors={[C.glassTop, C.glassBottom]} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: C.glassRim, borderTopColor: C.glassEdge }]} />
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  shadow: { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
});

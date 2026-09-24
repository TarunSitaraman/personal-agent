// Blu's presence: a living orb drawn by a Skia runtime shader (orbShader.js). It idles slowly and
// turns faster while Blu is thinking. With reduced motion it holds still on one frame.
import React from 'react';
import { View } from 'react-native';
import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { ORB_SKSL, ORB_COLORS } from './orbShader';

const effect = Skia.RuntimeEffect.Make(ORB_SKSL); // null if the device's Skia rejects it

const IDLE = { spin: 0.3, pace: 1 };
const THINKING = { spin: 1.4, pace: 2.2 };

export default function Orb({ size = 64, thinking = false, still = false }) {
  const clock = useClock();
  const m = thinking ? THINKING : IDLE;
  const uniforms = useDerivedValue(() => {
    const t = still ? 1.3 : (clock.value / 1000) * m.pace;
    return {
      iTime: t,
      iResolution: [size, size],
      rot: t * m.spin,
      noiseScale: 0.65,
      innerRadius: 0.1,
      c0: ORB_COLORS.c0,
      c1: ORB_COLORS.c1,
      c2: ORB_COLORS.c2,
    };
  }, [size, thinking, still]);

  if (!effect) return <View style={{ width: size, height: size }} />;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}

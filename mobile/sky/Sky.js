// The living background: a Skia canvas behind every screen. Gradient + sun glow + stars from the
// sun's real elevation, then clouds, three depths of distant rain, and drops sliding on the "window".
// Lightning lights only the low clouds — never a full-screen flash — and is off with reduced motion.
import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas, Rect, LinearGradient, RadialGradient, Circle, Oval, Group, Blur, Points, Path, Skia,
  vec, useClock,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

// Deterministic pseudo-random, so stars and drops don't jump between renders.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function useStars(W, H) {
  return useMemo(() => {
    const r = rng(7);
    return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H * 0.62 }));
  }, [W, H]);
}

function RainLayer({ clock, W, H, count, speed, len, width, alpha, seed, still }) {
  const seeds = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: count }, () => [r() * (W + 80) - 40, r(), 0.8 + r() * 0.4]);
  }, [W, count, seed]);
  const pts = useDerivedValue(() => {
    const t = still ? 0 : clock.value / 1000;
    const out = [];
    for (let i = 0; i < seeds.length; i++) {
      const [x0, ph, sp] = seeds[i];
      const y = (((ph + t * speed * sp) % 1) * 1.15 - 0.1) * H;
      const x = x0 - y * 0.08;
      out.push({ x, y }, { x: x - len * 0.08, y: y + len });
    }
    return out;
  });
  return <Points points={pts} mode="lines" color={`rgba(200,220,255,${alpha})`} strokeWidth={width} strokeCap="round" />;
}

// A drop on the glass: not a circle — a lens flattened on top, heavier at the bottom, slightly
// lopsided. Its fill is the sky flipped (horizon colour on top), like real refraction.
function dropPath(w, h, lean) {
  const p = Skia.Path.Make();
  p.moveTo(0, -h * 0.5);
  p.cubicTo(w * 0.42 + lean, -h * 0.46, w * 0.55, h * 0.12, w * 0.3, h * 0.42);
  p.cubicTo(w * 0.12, h * 0.56, -w * 0.18, h * 0.56, -w * 0.34, h * 0.4);
  p.cubicTo(-w * 0.56, h * 0.1, -w * 0.4 + lean, -h * 0.46, 0, -h * 0.5);
  p.close();
  return p;
}

function Drop({ clock, d, H, top, hor, still }) {
  const path = useMemo(() => dropPath(d.w, d.h, d.lean), [d]);
  const transform = useDerivedValue(() => {
    const t = still ? 0 : clock.value / 1000;
    // Most drops cling; some let go and slide, faster as they go.
    const cyc = d.slide ? ((t * d.speed + d.phase) % 1) : 0;
    const y = d.y + (d.slide ? cyc * cyc * H * 0.9 : 0);
    return [{ translateX: d.x }, { translateY: (y % (H + 40)) - 20 }, { scaleY: d.slide ? 1 + cyc * 0.5 : 1 }];
  });
  return (
    <Group transform={transform}>
      <Path path={path}>
        <LinearGradient start={vec(0, -d.h / 2)} end={vec(0, d.h / 2)} colors={[hor, top]} />
      </Path>
      <Path path={path} style="stroke" strokeWidth={0.8} color="rgba(255,255,255,0.28)" />
      <Oval x={-d.w * 0.16} y={-d.h * 0.32} width={d.w * 0.18} height={d.h * 0.14} color="rgba(255,255,255,0.45)" />
    </Group>
  );
}

function useDrops(W, H, amount) {
  return useMemo(() => {
    const r = rng(42);
    const n = Math.round(14 * amount);
    return Array.from({ length: n }, () => {
      const w = 5 + r() * 10;
      return {
        x: r() * W, y: H * 0.35 + r() * H * 0.6, w, h: w * (1.15 + r() * 0.5), lean: (r() - 0.5) * w * 0.3,
        slide: r() < 0.35, speed: 0.05 + r() * 0.08, phase: r(),
      };
    });
  }, [W, H, amount]);
}

function Clouds({ clock, W, H, color, amount, storm, still }) {
  const shift = useDerivedValue(() => [{ translateX: still ? 0 : ((clock.value / 1000) * 6) % (W * 0.4) - W * 0.2 }]);
  // Lightning: brief double pulse every ~9s, only on the cloud bank near the horizon.
  const flash = useDerivedValue(() => {
    if (!storm || still) return 0;
    const c = (clock.value / 1000) % 9.3;
    return c < 0.1 ? 0.55 : c > 0.22 && c < 0.3 ? 0.35 : 0;
  });
  const blobs = [
    [0.1, 0.6, 0.7, 0.1], [0.45, 0.63, 0.8, 0.12], [-0.2, 0.68, 0.9, 0.12], [0.6, 0.72, 0.7, 0.1], [0.2, 0.52, 0.6, 0.08],
  ];
  return (
    <Group transform={shift} opacity={Math.min(1, 0.55 * amount)}>
      <Blur blur={28} />
      {blobs.map(([x, y, w, h], i) => (
        <Oval key={i} x={x * W} y={y * H} width={w * W} height={h * H} color={color} />
      ))}
      <Group opacity={flash}>
        {blobs.slice(0, 4).map(([x, y, w, h], i) => (
          <Oval key={`f${i}`} x={x * W} y={(y + 0.02) * H} width={w * W} height={h * H} color="rgb(170,190,255)" />
        ))}
      </Group>
    </Group>
  );
}

export default function Sky({ palette, sunX, reduceMotion }) {
  const { width: W, height: H } = useWindowDimensions();
  const clock = useClock();
  const stars = useStars(W, H);
  const drops = useDrops(W, H, palette.drops);
  const still = !!reduceMotion;
  const gy = H * 0.74;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={palette.stops} positions={palette.positions} />
      </Rect>

      {palette.glowAlpha > 0.01 ? (
        <Circle cx={sunX * W} cy={gy} r={W * 0.85}>
          <RadialGradient c={vec(sunX * W, gy)} r={W * 0.85} colors={[palette.glow, 'rgba(0,0,0,0)']} />
        </Circle>
      ) : null}

      {palette.warm > 0.01 ? (
        <Rect x={0} y={H * 0.64} width={W} height={H * 0.14}>
          <LinearGradient
            start={vec(0, H * 0.64)} end={vec(0, H * 0.78)}
            colors={['rgba(255,150,90,0)', `rgba(255,150,90,${(palette.warm * 0.55).toFixed(3)})`, 'rgba(255,150,90,0)']}
          />
        </Rect>
      ) : null}

      {palette.stars > 0.02 ? (
        <Points points={stars} mode="points" color="white" opacity={palette.stars * 0.75} strokeWidth={1.6} strokeCap="round" />
      ) : null}

      {palette.haze > 0 ? (
        <Rect x={0} y={H * 0.45} width={W} height={H * 0.4}>
          <LinearGradient start={vec(0, H * 0.45)} end={vec(0, H * 0.85)} colors={['rgba(160,175,210,0)', 'rgba(160,175,210,0.16)', 'rgba(160,175,210,0)']} />
        </Rect>
      ) : null}

      {palette.cloudAmount > 0 ? (
        <Clouds clock={clock} W={W} H={H} color={palette.cloud} amount={palette.cloudAmount} storm={palette.storm} still={still} />
      ) : null}

      {palette.rain > 0 ? (
        <Group>
          <RainLayer clock={clock} W={W} H={H} count={Math.round(90 * palette.rain)} speed={0.9} len={10} width={0.7} alpha={0.12} seed={1} still={still} />
          <RainLayer clock={clock} W={W} H={H} count={Math.round(45 * palette.rain)} speed={1.4} len={18} width={1} alpha={0.18} seed={2} still={still} />
          <RainLayer clock={clock} W={W} H={H} count={Math.round(16 * palette.rain)} speed={2.1} len={30} width={1.4} alpha={0.22} seed={3} still={still} />
        </Group>
      ) : null}

      {drops.map((d, i) => (
        <Drop key={i} clock={clock} d={d} H={H} top={palette.top} hor={palette.hor} still={still} />
      ))}
    </Canvas>
  );
}

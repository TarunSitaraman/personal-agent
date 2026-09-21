// A handful of line icons drawn with Skia (paths from Feather, MIT). No icon font, no emoji.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';

const PATHS = {
  arrowUp: 'M12 19V5 M5 12l7-7 7 7',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  close: 'M18 6L6 18 M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  clock: 'M12 2a10 10 0 1 0 0.01 0 M12 6v6l4 2',
  chevronRight: 'M9 18l6-6-6-6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
};

export default function Icon({ name, size = 20, color = '#f4f7ff', stroke = 2 }) {
  const path = useMemo(() => Skia.Path.MakeFromSVGString(PATHS[name]), [name]);
  const k = size / 24;
  if (!path) return <View style={{ width: size, height: size }} />; // unparseable path: keep the space, draw nothing
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Group transform={[{ scale: k }]}>
        <Path path={path} style="stroke" strokeWidth={stroke} strokeCap="round" strokeJoin="round" color={color} />
      </Group>
    </Canvas>
  );
}

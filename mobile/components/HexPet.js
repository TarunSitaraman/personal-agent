import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, Image, PanResponder, StyleSheet, TouchableOpacity, View } from 'react-native';

// Pre-require all frames so Metro bundles them statically
const FRAMES = {
  idle: [
    require('../assets/pet/idle/00.png'),
    require('../assets/pet/idle/01.png'),
    require('../assets/pet/idle/02.png'),
    require('../assets/pet/idle/03.png'),
    require('../assets/pet/idle/04.png'),
    require('../assets/pet/idle/05.png'),
  ],
  running: [
    require('../assets/pet/running/00.png'),
    require('../assets/pet/running/01.png'),
    require('../assets/pet/running/02.png'),
    require('../assets/pet/running/03.png'),
    require('../assets/pet/running/04.png'),
    require('../assets/pet/running/05.png'),
  ],
  'running-right': [
    require('../assets/pet/running-right/00.png'),
    require('../assets/pet/running-right/01.png'),
    require('../assets/pet/running-right/02.png'),
    require('../assets/pet/running-right/03.png'),
    require('../assets/pet/running-right/04.png'),
    require('../assets/pet/running-right/05.png'),
    require('../assets/pet/running-right/06.png'),
    require('../assets/pet/running-right/07.png'),
  ],
  'running-left': [
    require('../assets/pet/running-left/00.png'),
    require('../assets/pet/running-left/01.png'),
    require('../assets/pet/running-left/02.png'),
    require('../assets/pet/running-left/03.png'),
    require('../assets/pet/running-left/04.png'),
    require('../assets/pet/running-left/05.png'),
    require('../assets/pet/running-left/06.png'),
    require('../assets/pet/running-left/07.png'),
  ],
  waving: [
    require('../assets/pet/waving/00.png'),
    require('../assets/pet/waving/01.png'),
    require('../assets/pet/waving/02.png'),
    require('../assets/pet/waving/03.png'),
  ],
  jumping: [
    require('../assets/pet/jumping/00.png'),
    require('../assets/pet/jumping/01.png'),
    require('../assets/pet/jumping/02.png'),
    require('../assets/pet/jumping/03.png'),
    require('../assets/pet/jumping/04.png'),
  ],
  failed: [
    require('../assets/pet/failed/00.png'),
    require('../assets/pet/failed/01.png'),
    require('../assets/pet/failed/02.png'),
    require('../assets/pet/failed/03.png'),
    require('../assets/pet/failed/04.png'),
    require('../assets/pet/failed/05.png'),
    require('../assets/pet/failed/06.png'),
    require('../assets/pet/failed/07.png'),
  ],
  waiting: [
    require('../assets/pet/waiting/00.png'),
    require('../assets/pet/waiting/01.png'),
    require('../assets/pet/waiting/02.png'),
    require('../assets/pet/waiting/03.png'),
    require('../assets/pet/waiting/04.png'),
    require('../assets/pet/waiting/05.png'),
  ],
  review: [
    require('../assets/pet/review/00.png'),
    require('../assets/pet/review/01.png'),
    require('../assets/pet/review/02.png'),
    require('../assets/pet/review/03.png'),
    require('../assets/pet/review/04.png'),
    require('../assets/pet/review/05.png'),
  ],
};

const FRAME_MS = 120; // ~8fps
const PET_W = 96;
const PET_H = 104;

// Map tap count → animation sequence then back to idle
const TAP_SEQUENCES = [
  ['waving', 'idle'],
  ['jumping', 'idle'],
  ['review', 'idle'],
  ['waving', 'jumping', 'idle'],
];

export default function HexPet({ initialX = 40, initialY = 400, onChat }) {
  const pos = useRef(new Animated.ValueXY({ x: initialX, y: initialY })).current;
  const [state, setState] = useState('idle');
  const [frame, setFrame] = useState(0);
  const tapCount = useRef(0);
  const animTimer = useRef(null);
  const seqRef = useRef(null);
  const seqIdx = useRef(0);
  const dragStart = useRef({ x: initialX, y: initialY });
  const isDragging = useRef(false);

  // Frame ticker — advances frame index for the current state
  useEffect(() => {
    const frames = FRAMES[state] || FRAMES.idle;
    let idx = 0;
    animTimer.current = setInterval(() => {
      idx = (idx + 1) % frames.length;
      setFrame(idx);
    }, FRAME_MS);
    setFrame(0);
    return () => clearInterval(animTimer.current);
  }, [state]);

  // Play a sequence of states then settle on last
  const playSequence = useCallback((seq) => {
    seqRef.current = seq;
    seqIdx.current = 0;
    setState(seq[0]);

    const advance = () => {
      seqIdx.current += 1;
      if (seqIdx.current >= seq.length) return;
      const next = seq[seqIdx.current];
      setState(next);
      if (seqIdx.current < seq.length - 1) {
        // Duration = frame count × FRAME_MS for non-idle states
        const dur = (FRAMES[next]?.length || 6) * FRAME_MS * 2;
        setTimeout(advance, dur);
      }
    };

    const dur = (FRAMES[seq[0]]?.length || 6) * FRAME_MS * 2;
    setTimeout(advance, dur);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
      onPanResponderGrant: (_, g) => {
        isDragging.current = false;
        dragStart.current = { x: pos.x._value, y: pos.y._value };
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8) {
          isDragging.current = true;
          const dir = g.dx > 0 ? 'running-right' : 'running-left';
          setState(dir);
        }
        pos.setValue({ x: dragStart.current.x + g.dx, y: dragStart.current.y + g.dy });
      },
      onPanResponderRelease: (_, g) => {
        dragStart.current = { x: pos.x._value, y: pos.y._value };
        if (!isDragging.current) return; // handled by onPress
        setState('idle');
      },
    })
  ).current;

  const handleTap = () => {
    if (isDragging.current) return;
    const idx = tapCount.current % TAP_SEQUENCES.length;
    tapCount.current += 1;
    playSequence(TAP_SEQUENCES[idx]);
  };

  const frames = FRAMES[state] || FRAMES.idle;
  const src = frames[frame] || frames[0];

  return (
    <Animated.View style={[s.pet, pos.getLayout()]} {...panResponder.panHandlers}>
      <TouchableOpacity onPress={handleTap} onLongPress={onChat} activeOpacity={0.9}>
        <Image source={src} style={s.img} resizeMode="contain" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  pet: {
    position: 'absolute',
    width: PET_W,
    height: PET_H,
    zIndex: 999,
  },
  img: {
    width: PET_W,
    height: PET_H,
  },
});

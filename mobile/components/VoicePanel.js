// Voice notes, like WhatsApp's: record, stop, send. The panel follows the mockup ("4 · Voice"):
// a "Listening" label, a waveform driven by the real microphone level, the elapsed time, Cancel
// and a white Stop button. Transcription happens on the server (Whisper), not here.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import Press from './Press';
import { Label, Chip } from './kit';
import { C } from '../theme';

const BARS = 32;
const MAX_MS = 3 * 60 * 1000; // stop on its own after three minutes
const MIN_MS = 700; // shorter than this is a mis-tap, not a message
const RECORDING = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const MIME = 'audio/mp4'; // HIGH_QUALITY records AAC in an .m4a container

async function fileToBase64(uri) {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('could not read the recording'));
    r.readAsDataURL(blob);
  });
}

// Owns the microphone. start() asks for permission the first time; stop() resolves to
// { base64, mime, ms } or null when the recording was too short to be a message.
export function useVoiceNote() {
  const recorder = useAudioRecorder(RECORDING);
  const state = useAudioRecorderState(recorder, 80);
  const [levels, setLevels] = useState(() => Array(BARS).fill(0));
  const active = useRef(false);

  useEffect(() => {
    if (!state.isRecording) return;
    // Metering is dBFS (about -60 quiet to 0 loud); map it onto 0..1 for the bars.
    const db = typeof state.metering === 'number' ? state.metering : -60;
    const level = Math.max(0, Math.min(1, (db + 55) / 50));
    setLevels(prev => [...prev.slice(1), level]);
  }, [state.durationMillis]);

  const start = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) throw new Error('Microphone access is off. Allow it in Android settings.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    active.current = true;
    setLevels(Array(BARS).fill(0));
  };

  const finish = async keep => {
    if (!active.current) return null;
    active.current = false;
    const ms = state.durationMillis || 0;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (!keep || ms < MIN_MS || !recorder.uri) return null;
    return { base64: await fileToBase64(recorder.uri), mime: MIME, ms };
  };

  return {
    start,
    stop: () => finish(true),
    cancel: () => finish(false),
    recording: state.isRecording,
    ms: state.durationMillis || 0,
    levels,
    tooLong: (state.durationMillis || 0) >= MAX_MS,
  };
}

export const mmss = ms => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function VoicePanel({ voice, onStop, onCancel }) {
  // The three-minute cap stops and sends, as WhatsApp does.
  useEffect(() => { if (voice.tooLong) onStop(); }, [voice.tooLong]);

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(160)} style={s.panel}>
      <View style={s.head}>
        <View style={s.recDot} />
        <Label color={C.accent}>Listening</Label>
        <Text style={s.time}>{mmss(voice.ms)}</Text>
      </View>
      <View style={s.wave}>
        {voice.levels.map((l, i) => (
          <View key={i} style={[s.bar, { height: 4 + l * 40, opacity: 0.35 + l * 0.65 }]} />
        ))}
      </View>
      <View style={s.actions}>
        <Chip title="Cancel" onPress={onCancel} />
        <Press onPress={onStop} scaleTo={0.9} style={s.stop} accessibilityLabel="Stop and send">
          <View style={s.square} />
        </Press>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  panel: { marginHorizontal: 12, paddingTop: 14, paddingBottom: 12, paddingHorizontal: 18, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff6b6b' },
  time: { marginLeft: 'auto', fontFamily: 'Heros-Bold', fontSize: 14, color: C.label, fontVariant: ['tabular-nums'] },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52, marginVertical: 10 },
  bar: { width: 4, borderRadius: 2, backgroundColor: C.accent },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stop: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  square: { width: 16, height: 16, borderRadius: 4, backgroundColor: '#0b0b0e' },
});

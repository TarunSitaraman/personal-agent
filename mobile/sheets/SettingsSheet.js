// Settings: where the sky is, how alive it is, notifications, sign out.
import React, { useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings, CHENNAI } from '../settings';
import { sendTestPush } from '../api';
import { clearToken } from '../auth';
import { C, F } from '../theme';

export default function SettingsSheet({ onToast }) {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [locating, setLocating] = useState(false);
  const usingGps = settings.place.name !== CHENNAI.name;

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { onToast('Location permission was not given'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      update({ place: { name: 'Current location', lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) } });
      onToast('Sky follows your location');
    } catch {
      onToast("Couldn't get your location");
    } finally {
      setLocating(false);
    }
  };

  const testPush = async () => {
    try { await sendTestPush(); onToast('Test notification sent'); }
    catch { onToast("Couldn't send a test notification"); }
  };

  const version = [Constants.expoConfig?.version, Updates.updateId ? `update ${Updates.updateId.slice(0, 8)}` : 'built-in']
    .filter(Boolean).join(' · ');

  return (
    <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 30 }]}>
      <Text style={s.title}>Settings</Text>

      <Text style={s.group}>Sky</Text>
      <Row label="Location" value={usingGps ? `${settings.place.lat}°, ${settings.place.lon}°` : 'Chennai'} />
      <View style={s.chips}>
        <Chip label="Chennai" on={!usingGps} onPress={() => update({ place: CHENNAI })} />
        <Chip label={locating ? 'Locating…' : 'Use my location'} on={usingGps} onPress={useMyLocation} />
      </View>
      <Toggle label="Live weather" value={settings.liveWeather} onChange={v => update({ liveWeather: v })} />
      <Toggle label="Sky follows the sun" value={settings.followSun} onChange={v => update({ followSun: v })} />
      <Toggle label="Reduce motion" value={settings.reduceMotion} onChange={v => update({ reduceMotion: v })} />

      <Text style={s.group}>Notifications</Text>
      <Pressable onPress={testPush}><Row label="Send a test notification" accent /></Pressable>

      <Text style={s.group}>Account</Text>
      <Pressable onPress={() => clearToken()}><Row label="Sign out" danger /></Pressable>

      <Text style={s.version}>Blu {version}</Text>
    </ScrollView>
  );
}

function Row({ label, value, accent, danger }) {
  return (
    <View style={s.row}>
      <Text style={[s.label, accent && { color: C.accent }, danger && { color: C.danger }]}>{label}</Text>
      {value ? <Text style={s.value}>{value}</Text> : null}
    </View>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: 'rgba(255,255,255,0.14)', true: 'rgba(130,169,255,0.6)' }}
        thumbColor={value ? C.accent : '#c9d3ea'}
      />
    </View>
  );
}

function Chip({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && { color: C.text }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 24 },
  title: { ...F.bold, fontSize: 26, color: C.text, marginBottom: 8 },
  group: { ...F.bold, fontSize: 13, color: C.text3, marginTop: 24, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  label: { ...F.bold, fontSize: 16, color: C.text },
  value: { ...F.bold, fontSize: 15, color: C.text2 },
  chips: { flexDirection: 'row', gap: 10, paddingVertical: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)' },
  chipOn: { backgroundColor: 'rgba(130,169,255,0.22)' },
  chipText: { ...F.bold, fontSize: 14, color: C.text2 },
  version: { ...F.regular, fontSize: 12, color: C.text3, marginTop: 28 },
});

// Settings, from the mockup ("9 · Settings") in grouped iOS structure: each row a bold name with
// a quiet explanation, a checkmark for the sky's place, accent switches.
import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Group, Row, SectionHeader } from '../components/ui';
import { useSettings, CHENNAI } from '../settings';
import { sendTestPush } from '../api';
import { clearToken } from '../auth';
import { C, T } from '../theme';

export default function SettingsSheet({ onToast }) {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [locating, setLocating] = useState(false);
  const usingGps = settings.place.name !== CHENNAI.name;

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { onToast('Location access was not allowed'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      update({ place: { name: 'Current location', lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) } });
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

  const version = [Constants.expoConfig?.version, Updates.updateId ? `· ${Updates.updateId.slice(0, 8)}` : null].filter(Boolean).join(' ');

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: insets.bottom + 44 }}>
      <SectionHeader title="Sky" />
      <Group>
        <Row title="Chennai" subtitle="13.08°N, 80.27°E" check={!usingGps} onPress={() => update({ place: CHENNAI })} />
        <Row
          title={locating ? 'Locating…' : 'Current location'}
          subtitle={usingGps ? `${settings.place.lat}°, ${settings.place.lon}°` : 'Use GPS for sunrise, sunset and weather'}
          check={usingGps}
          onPress={useMyLocation}
        />
      </Group>

      <SectionHeader title="Look" style={{ marginTop: 26 }} />
      <Group>
        <Toggle title="Live weather" subtitle="Open-Meteo, every 15 minutes" value={settings.liveWeather} onChange={v => update({ liveWeather: v })} />
        <Toggle title="Sky follows the sun" subtitle="Off = fixed blue hour" value={settings.followSun} onChange={v => update({ followSun: v })} />
        <Toggle title="Reduce motion" subtitle="Also follows Android's setting" value={settings.reduceMotion} onChange={v => update({ reduceMotion: v })} />
      </Group>

      <SectionHeader title="Notifications" style={{ marginTop: 26 }} />
      <Group>
        <Row title="Send a test notification" subtitle="Reminders, briefs and nudges arrive here first" tint onPress={testPush} />
      </Group>

      <Group style={{ marginTop: 26 }}>
        <Row title="Sign out" destructive onPress={() => clearToken()} />
      </Group>

      <Text style={[T.small, s.version]}>Blu {version}</Text>
    </ScrollView>
  );
}

function Toggle({ title, subtitle, value, onChange, last }) {
  return (
    <Row
      title={title}
      subtitle={subtitle}
      last={last}
      right={(
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: 'rgba(255,255,255,0.14)', true: C.accent }}
          thumbColor={value ? C.ink : '#c9d3ea'}
        />
      )}
    />
  );
}

const s = StyleSheet.create({
  version: { textAlign: 'center', marginTop: 28 },
});

// Settings, laid out like the iOS Settings app: grouped rows, a checkmark for the chosen place,
// green switches, footers that explain, the version at the bottom.
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

  const version = [Constants.expoConfig?.version, Updates.updateId ? `(${Updates.updateId.slice(0, 8)})` : null].filter(Boolean).join(' ');

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 40 }}>
      <SectionHeader title="Sky Location" small />
      <Group>
        <Row title="Chennai" check={!usingGps} onPress={() => update({ place: CHENNAI })} />
        <Row
          title={locating ? 'Locating…' : 'Current Location'}
          subtitle={usingGps ? `${settings.place.lat}°, ${settings.place.lon}°` : null}
          check={usingGps}
          onPress={useMyLocation}
        />
      </Group>
      <Footer text="Sunrise, sunset and weather are calculated for this place." />

      <SectionHeader title="Appearance" small />
      <Group>
        <Toggle title="Live Weather" value={settings.liveWeather} onChange={v => update({ liveWeather: v })} />
        <Toggle title="Sky Follows the Sun" value={settings.followSun} onChange={v => update({ followSun: v })} />
        <Toggle title="Reduce Motion" value={settings.reduceMotion} onChange={v => update({ reduceMotion: v })} />
      </Group>
      <Footer text="With Sky Follows the Sun off, the background stays at blue hour." />

      <SectionHeader title="Notifications" small />
      <Group>
        <Row title="Send Test Notification" tint onPress={testPush} />
      </Group>

      <Group style={{ marginTop: 32 }}>
        <Row title="Sign Out" destructive onPress={() => clearToken()} />
      </Group>

      <Text style={[T.footnote, s.version]}>Blu {version}</Text>
    </ScrollView>
  );
}

function Toggle({ title, value, onChange, last }) {
  return (
    <Row title={title} last={last}>
      <View style={s.toggleRow}>
        <Text style={T.body}>{title}</Text>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: 'rgba(120,120,128,0.32)', true: C.green }}
          thumbColor="#FFFFFF"
        />
      </View>
    </Row>
  );
}

const Footer = ({ text }) => <Text style={[T.footnote, s.footer]}>{text}</Text>;

const s = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footer: { paddingHorizontal: 16, marginTop: 8, marginBottom: 28 },
  version: { textAlign: 'center', marginTop: 28, color: C.label3 },
});

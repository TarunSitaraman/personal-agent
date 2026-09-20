import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { verifyToken } from '../api';
import { setToken } from '../auth';
import { C, FONT } from '../theme';

// First launch, and whenever the server rejects the stored token. The token is checked against
// the server before it is stored, so a typo never gets saved.
export default function TokenScreen({ onSignedIn }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const connect = async () => {
    const token = value.trim();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyToken(token);
      await setToken(token);
      onSignedIn();
    } catch {
      setError("That token wasn't accepted. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.body}>
        <Text style={s.title}>Connect to Blu</Text>
        <Text style={s.hint}>Paste your dashboard token. It is stored encrypted on this phone.</Text>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={setValue}
          placeholder="Dashboard token"
          placeholderTextColor={C.t3}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          onSubmitEditing={connect}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <TouchableOpacity style={[s.btn, (!value.trim() || busy) && s.btnDisabled]} onPress={connect} disabled={!value.trim() || busy}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>Connect</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, ...FONT.bold, color: C.t1 },
  hint: { fontSize: 13, ...FONT.regular, color: C.t2, lineHeight: 19 },
  input: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, color: C.t1, fontSize: 14, ...FONT.regular,
  },
  error: { fontSize: 13, ...FONT.medium, color: C.red },
  btn: { backgroundColor: C.hex, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 15, ...FONT.bold, color: '#000' },
});

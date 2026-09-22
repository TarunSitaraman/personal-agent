// Getting into Blu. A landing page (the orb, Sign in, Create account), then sign-in with phone
// number + six-digit PIN, invite-only sign-up, or the long key as a fallback. The number is
// remembered, so after the first time only the PIN needs typing. Server rules: src/routes/auth.js.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Orb from '../components/Orb';
import PinInput from '../components/PinInput';
import { Label, Chip, ShinyButton, GlowInput } from '../components/kit';
import TokenScreen from './TokenScreen';
import { pinSignIn, pinSignUp } from '../api';
import { setToken, getSavedNumber, saveNumber } from '../auth';
import { C, T } from '../theme';

export default function AuthFlow({ onSignedIn }) {
  const [step, setStep] = useState('welcome'); // welcome | signin | signup | key
  const [number, setNumber] = useState('');

  useEffect(() => { getSavedNumber().then(n => { if (n) setNumber(n); }); }, []);

  if (step === 'key') {
    return <TokenScreen onBack={() => setStep('welcome')} onSignedIn={() => onSignedIn({ askForPin: true })} />;
  }
  if (step === 'signin' || step === 'signup') {
    return (
      <PinStep
        key={step}
        mode={step}
        number={number}
        setNumber={setNumber}
        onBack={() => setStep('welcome')}
        onUseKey={() => setStep('key')}
        onSwitch={() => setStep(step === 'signin' ? 'signup' : 'signin')}
        onSignedIn={onSignedIn}
      />
    );
  }
  return <Welcome onSignIn={() => setStep('signin')} onSignUp={() => setStep('signup')} onUseKey={() => setStep('key')} />;
}

function Welcome({ onSignIn, onSignUp, onUseKey }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 28 }]}>
      <Animated.View entering={FadeIn.duration(700)} style={s.hero}>
        <Orb size={220} />
        <Text style={s.brand}>Blu</Text>
        <Text style={s.tagline}>What's next, handled. Talk, type or tap — Blu remembers, reminds and keeps you on track.</Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(250).duration(500)} style={{ gap: 12 }}>
        <ShinyButton title="Sign in" onPress={onSignIn} />
        <View style={s.row}>
          <Chip title="Create account" onPress={onSignUp} />
          <Pressable onPress={onUseKey} hitSlop={10}><Text style={s.link}>Use a key instead</Text></Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function PinStep({ mode, number, setNumber, onBack, onUseKey, onSwitch, onSignedIn }) {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + 24 }));
  const pinRef = useRef(null);
  const [first, setFirst] = useState(null); // sign-up: the PIN typed once, awaiting confirmation
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const signUp = mode === 'signup';

  const finish = async res => {
    if (res.ok) {
      await setToken(res.data.token);
      await saveNumber(number.trim());
      onSignedIn({ askForPin: false });
      return;
    }
    setError(res.data?.error || 'Something went wrong. Try again.');
    pinRef.current?.reject();
  };

  const onPin = async pin => {
    setError(null);
    if (!number.trim()) { setError('Enter your phone number first.'); pinRef.current?.reject(); return; }
    if (signUp && !first) { setFirst(pin); pinRef.current?.clear(); return; }
    if (signUp && pin !== first) { setFirst(null); setError("Those PINs didn't match. Choose one again."); pinRef.current?.reject(); return; }
    setBusy(true);
    const res = signUp ? await pinSignUp(number.trim(), pin) : await pinSignIn(number.trim(), pin);
    setBusy(false);
    if (signUp && !res.ok) setFirst(null);
    finish(res);
  };

  const pinLabel = signUp ? (first ? 'Type it once more' : 'Choose a six-digit PIN') : 'PIN';

  return (
    <Animated.View style={[s.root, { paddingTop: insets.top + 16 }, lift]}>
      <Pressable onPress={onBack} hitSlop={12} style={s.back}><Text style={s.link}>‹ Back</Text></Pressable>
      <Animated.View entering={FadeInDown.duration(400)} style={{ gap: 6, marginTop: 28 }}>
        <Text style={s.title}>{signUp ? 'Create your account' : 'Sign in'}</Text>
        <Text style={[T.sub, { maxWidth: 320 }]}>
          {signUp ? 'Your WhatsApp number and a PIN. Sign-up is invite-only for now.' : 'Your WhatsApp number and your six-digit PIN.'}
        </Text>
      </Animated.View>

      <View style={{ gap: 22, marginTop: 30 }}>
        <View style={{ gap: 8 }}>
          <Label>Phone number</Label>
          <GlowInput
            value={number}
            onChangeText={setNumber}
            placeholder="+91 98765 43210"
            keyboardType="phone-pad"
            autoComplete="tel"
            returnKeyType="next"
            onSubmitEditing={() => pinRef.current?.focus()}
          />
        </View>
        <View style={{ gap: 8 }}>
          <Label>{pinLabel}</Label>
          <PinInput ref={pinRef} onComplete={onPin} disabled={busy} autoFocus={!!number} />
          {error ? <Text style={[T.sub, { color: C.red }]}>{error}</Text> : null}
          {busy ? <Text style={T.sub}>{signUp ? 'Creating your account…' : 'Signing in…'}</Text> : null}
        </View>
      </View>

      <View style={s.footer}>
        <Pressable onPress={onSwitch} hitSlop={10}>
          <Text style={s.link}>{signUp ? 'Have an account? Sign in' : 'New here? Create an account'}</Text>
        </Pressable>
        {!signUp ? (
          <Pressable onPress={onUseKey} hitSlop={10}><Text style={s.link}>No PIN yet? Use your key</Text></Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: 'Heros-Bold', fontSize: 64, lineHeight: 66, letterSpacing: -2.6, color: '#fff', marginTop: 6 },
  tagline: { ...T.body, color: 'rgba(255,255,255,0.72)', textAlign: 'center', marginTop: 10, maxWidth: 300 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { fontFamily: 'Heros-Bold', fontSize: 14, color: C.accent },
  back: { alignSelf: 'flex-start' },
  title: { fontFamily: 'Heros-Bold', fontSize: 34, lineHeight: 38, letterSpacing: -1, color: '#fff' },
  footer: { marginTop: 'auto', gap: 14, paddingTop: 24 },
});

// The dashboard token, held in Android's encrypted storage (expo-secure-store) instead of being
// compiled into the bundle. EXPO_PUBLIC_* values are inlined at build time, so a token read from
// one would ship inside the APK. See docs/superpowers/specs/2026-09-19-mobile-foundation-design.md.
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'dashboard_token';
let cached;                    // undefined = not read yet; '' = none stored
const signedOutListeners = new Set();

export async function getToken() {
  if (cached === undefined) {
    try {
      cached = await SecureStore.getItemAsync(KEY) || '';
    } catch {
      cached = '';
    }
  }
  return cached || null;
}

export async function setToken(token) {
  await SecureStore.setItemAsync(KEY, token);
  cached = token;
}

// Called on a 401: the token was rotated or revoked. Listeners return the app to the token screen.
export async function clearToken() {
  await SecureStore.deleteItemAsync(KEY);
  cached = '';
  signedOutListeners.forEach(fn => fn());
}

export function onSignedOut(fn) {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}

// The phone number last used to sign in, so next time only the PIN needs typing. Not a secret.
const NUMBER_KEY = 'blu.signin.number';
export const getSavedNumber = () => AsyncStorage.getItem(NUMBER_KEY).catch(() => null);
export const saveNumber = n => AsyncStorage.setItem(NUMBER_KEY, n).catch(() => {});

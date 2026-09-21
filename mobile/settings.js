// App preferences, stored on the phone. Nothing here is secret (the token lives in secure store).
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'blu.settings.v1';

export const CHENNAI = { name: 'Chennai', lat: 13.08, lon: 80.27 };

export const DEFAULTS = {
  place: CHENNAI, // or { name: 'Current location', lat, lon } once GPS is used
  liveWeather: true,
  followSun: true, // off = fixed blue hour
  reduceMotion: false,
};

const Ctx = createContext({ settings: DEFAULTS, update: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(raw => { if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) }); })
      .catch(() => {}); // unreadable storage: defaults are a fine answer
  }, []);

  const update = useCallback(patch => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ settings, update }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);

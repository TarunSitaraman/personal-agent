import React, { useCallback, useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';

import Sky from './sky/Sky';
import { useSky } from './sky/useSky';
import { SettingsProvider, useSettings } from './settings';
import { useBoard } from './board';
import { registerPushToken, snoozeTodo } from './api';
import { getToken, onSignedOut } from './auth';
import NowScreen from './screens/NowScreen';
import TokenScreen from './screens/TokenScreen';
import AssistantBar, { BAR_HEIGHT } from './components/AssistantBar';
import Sheet from './components/Sheet';
import Toast from './components/Toast';
import AssistantSheet from './sheets/AssistantSheet';
import LibrarySheet from './sheets/LibrarySheet';
import ItemSheet from './sheets/ItemSheet';
import SettingsSheet from './sheets/SettingsSheet';
import { C } from './theme';

// Show notifications as banners even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function setupPushNotifications() {
  if (!Device.isDevice) return; // push tokens only work on real devices
  const { status: existing } = await Notifications.getPermissionsAsync();
  const { status } = existing === 'granted'
    ? { status: existing }
    : await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'General', importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Todo Reminders', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync('briefs', { name: 'Daily Briefs', importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync('nudges', { name: 'Nudges', importance: Notifications.AndroidImportance.DEFAULT });
  }

  // The Expo push service needs an Expo token, which needs the EAS project id.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token);
  } catch {
    // Registration retries on every launch; WhatsApp stays the fallback meanwhile.
  }
}

function Home({ sky }) {
  const insets = useSafeAreaInsets();
  const board = useBoard();
  const [sheet, setSheet] = useState(null); // 'assistant' | 'library' | 'item' | 'settings'
  const [libraryTab, setLibraryTab] = useState('todos');
  const [entry, setEntry] = useState(null);
  const [toast, setToast] = useState(null);

  const barBottom = insets.bottom + 12;
  const close = useCallback(() => setSheet(null), []);
  const showToast = useCallback((text, onUndo) => setToast({ id: Date.now(), text, onUndo }), []);
  const dismissToast = useCallback(() => setToast(null), []);

  const openAssistant = useCallback(() => setSheet('assistant'), []);
  const openLibrary = useCallback(tab => { setLibraryTab(tab); setSheet('library'); }, []);
  const openItem = useCallback(e => { setEntry(e); setSheet('item'); }, []);

  const onDone = useCallback(todo => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const undo = board.complete(todo, () => showToast("Couldn't mark that done"));
    showToast(`Done · ${todo.content}`, undo);
    setSheet(s => (s === 'item' ? null : s));
  }, [board, showToast]);

  const onSnooze = useCallback((todo, phrase = 'in 1 hour') => {
    setSheet(s => (s === 'item' ? null : s));
    showToast('Snoozing…');
    snoozeTodo(todo.content, phrase)
      .then(() => { showToast(`Snoozed · ${phrase.replace(/^in /, '')}`); board.refresh(); })
      .catch(() => showToast("Couldn't snooze that"));
  }, [board, showToast]);

  // Any notification tap opens the conversation, where the full message is.
  useEffect(() => {
    setupPushNotifications();
    Notifications.getLastNotificationResponseAsync().then(r => { if (r) setSheet('assistant'); }).catch(() => {});
    const tapped = Notifications.addNotificationResponseReceivedListener(() => setSheet('assistant'));
    const received = Notifications.addNotificationReceivedListener(() => board.refresh());
    return () => { tapped.remove(); received.remove(); };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <NowScreen
        board={board}
        sky={sky}
        bottomInset={barBottom + BAR_HEIGHT}
        onOpenSettings={() => setSheet('settings')}
        onOpenLibrary={openLibrary}
        onOpenItem={openItem}
        onOpenAssistant={openAssistant}
        onDone={onDone}
        onSnooze={onSnooze}
      />
      <AssistantBar onPress={openAssistant} bottom={barBottom} />
      <Toast toast={sheet ? null : toast} onDismiss={dismissToast} bottom={barBottom + BAR_HEIGHT + 12} />

      <Sheet open={sheet === 'library'} onClose={close} heightRatio={0.84}>
        <LibrarySheet tab={libraryTab} onTab={setLibraryTab} board={board} onOpenItem={openItem} onDone={onDone} onSnooze={onSnooze} />
      </Sheet>
      <Sheet open={sheet === 'item'} onClose={close} heightRatio={0.56}>
        <ItemSheet
          entry={entry}
          onDone={onDone}
          onSnooze={onSnooze}
          onAsk={() => setSheet('assistant')}
        />
      </Sheet>
      <Sheet open={sheet === 'settings'} onClose={close} heightRatio={0.84}>
        <SettingsSheet onToast={showToast} />
      </Sheet>
      <Sheet open={sheet === 'assistant'} onClose={close} heightRatio={0.93}>
        <AssistantSheet open={sheet === 'assistant'} onChanged={board.refresh} />
      </Sheet>
    </View>
  );
}

function Root() {
  const { settings } = useSettings();
  const sky = useSky(settings);
  // 'loading' until secure storage is read; the token screen until a valid token is stored.
  const [authState, setAuthState] = useState('loading');

  useEffect(() => {
    getToken().then(t => setAuthState(t ? 'signedIn' : 'signedOut'));
    return onSignedOut(() => setAuthState('signedOut'));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <Sky palette={sky.palette} sunX={sky.sunX} reduceMotion={sky.reduceMotion} />
      {authState === 'signedIn' ? <Home sky={sky} /> : null}
      {authState === 'signedOut' ? <TokenScreen onSignedIn={() => setAuthState('signedIn')} /> : null}
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <Root />
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { createNavigationContainerRef } from '@react-navigation/native';

enableScreens();

import HomeScreen from './screens/HomeScreen';
import ChatScreen from './screens/ChatScreen';
import TodosScreen from './screens/TodosScreen';
import CalendarScreen from './screens/CalendarScreen';
import NotesScreen from './screens/NotesScreen';
import { C } from './theme';
import { registerPushToken } from './api';
import TokenScreen from './screens/TokenScreen';
import { getToken, onSignedOut } from './auth';

// Show notifications as banners even when the app is foregrounded.
// shouldShowBanner/shouldShowList replaced the deprecated shouldShowAlert (SDK 54).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const navigationRef = createNavigationContainerRef();

// Any notification tap opens the thread, where the full message is. The newest message is at the
// bottom and Chat scrolls there on load, so a just-delivered one is what you land on.
function openChat() {
  if (navigationRef.isReady()) navigationRef.navigate('Chat');
}

async function setupPushNotifications() {
  if (!Device.isDevice) return; // push tokens only work on real devices
  const { status: existing } = await Notifications.getPermissionsAsync();
  const { status } = existing === 'granted'
    ? { status: existing }
    : await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Todo Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync('briefs', {
      name: 'Daily Briefs',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync('nudges', {
      name: 'Nudges',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // The Expo push service needs an Expo token, which needs the EAS project id. The old code
  // called this without one and fell back to a raw FCM device token that Expo can never deliver to.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('[Push] No EAS projectId — run `eas init` in mobile/');
    return;
  }
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token);
  } catch (e) {
    console.warn('[Push] Registration failed:', e.message);
  }
}

const Tab = createBottomTabNavigator();

const NAV_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: C.bg, card: C.s1, border: C.line, text: C.t1 },
};

function TabIcon({ label, focused }) {
  const icons = { Home: '🏠', Chat: '💬', Todos: '☑️', Calendar: '📅', Notes: '📝' };
  const accs = { Home: C.hex, Chat: C.srq, Todos: C.hex, Calendar: C.per, Notes: C.per };
  const acc = accs[label] || C.hex;
  return (
    <View style={[s.iconWrap, focused && { borderTopColor: acc }]}>
      <Text style={s.iconEmoji}>{icons[label]}</Text>
      <Text style={[s.iconLabel, { color: focused ? acc : C.t2 }]}>{label}</Text>
    </View>
  );
}

export default function App() {
  // 'loading' until secure storage is read; the token screen until a valid token is stored.
  const [authState, setAuthState] = useState('loading');

  useEffect(() => {
    getToken().then(t => setAuthState(t ? 'signedIn' : 'signedOut'));
    return onSignedOut(() => setAuthState('signedOut'));
  }, []);

  // Register for push once signed in; re-registering on each launch is harmless (idempotent).
  useEffect(() => {
    if (authState === 'signedIn') setupPushNotifications();
  }, [authState]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(n => {
      console.log('[Push] Received:', n.request.content.title);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(() => openChat());
    return () => {
      received.remove();
      tapped.remove();
    };
  }, []);

  if (authState === 'loading') return null;
  if (authState === 'signedOut') {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <TokenScreen onSignedIn={() => setAuthState('signedIn')} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer
        theme={NAV_THEME}
        ref={navigationRef}
        onReady={() => {
          // A tap that launched the app from cold start is not delivered to the listener above.
          Notifications.getLastNotificationResponseAsync()
            .then(r => { if (r) openChat(); })
            .catch(() => {});
        }}
      >
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: {
              backgroundColor: C.s1,
              borderTopColor: C.line,
              borderTopWidth: 1,
              height: 72,
              paddingBottom: 0,
              paddingTop: 0,
            },
            tabBarShowLabel: false,
            tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
          })}
        >
          <Tab.Screen name="Home"     component={HomeScreen} />
          <Tab.Screen name="Chat"     component={ChatScreen} />
          <Tab.Screen name="Todos"    component={TodosScreen} />
          <Tab.Screen name="Calendar" component={CalendarScreen} />
          <Tab.Screen name="Notes"    component={NotesScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: 6,
    borderTopWidth: 2,
    borderTopColor: 'transparent',
    width: 64,
  },
  iconEmoji: { fontSize: 18, lineHeight: 22 },
  iconLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 3, textTransform: 'uppercase' },
});

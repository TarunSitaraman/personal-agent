import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

enableScreens();

import HomeScreen from './screens/HomeScreen';
import ChatScreen from './screens/ChatScreen';
import TodosScreen from './screens/TodosScreen';
import CalendarScreen from './screens/CalendarScreen';
import NotesScreen from './screens/NotesScreen';
import PetScreen from './screens/PetScreen';
import { C } from './theme';
import { registerPushToken } from './api';

// Show notifications as banners even when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
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

  const tokenData = await Notifications.getExpoPushTokenAsync().catch(() =>
    Notifications.getDevicePushTokenAsync()
  );
  const token = tokenData?.data;
  if (token) await registerPushToken(token).catch(e => console.warn('[Push] Register failed:', e.message));
}

const Tab = createBottomTabNavigator();

const NAV_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: C.bg, card: C.s1, border: C.line, text: C.t1 },
};

function TabIcon({ label, focused }) {
  const icons = { Home: '🏠', Chat: '💬', Todos: '☑️', Calendar: '📅', Notes: '📝', Hex: '👾' };
  const accs = { Home: C.hex, Chat: C.srq, Todos: C.hex, Calendar: C.per, Notes: C.per, Hex: C.per };
  const acc = accs[label] || C.hex;
  return (
    <View style={[s.iconWrap, focused && { borderTopColor: acc }]}>
      <Text style={s.iconEmoji}>{icons[label]}</Text>
      <Text style={[s.iconLabel, { color: focused ? acc : C.t2 }]}>{label}</Text>
    </View>
  );
}

export default function App() {
  const notifListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    setupPushNotifications();

    // Log foreground notifications (screens can add their own handlers later)
    notifListener.current = Notifications.addNotificationReceivedListener(n => {
      console.log('[Push] Received:', n.request.content.title, n.request.content.body);
    });

    // Handle notification tap — navigate based on data.type when navigation is ready
    responseListener.current = Notifications.addNotificationResponseReceivedListener(r => {
      const { type } = r.notification.request.content.data || {};
      console.log('[Push] Tapped:', type);
      // Navigation-based deep linking can be added here as screens are built out
    });

    return () => {
      Notifications.removeNotificationSubscription(notifListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={NAV_THEME}>
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
          <Tab.Screen name="Hex"      component={PetScreen} />
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

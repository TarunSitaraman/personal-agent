// Keeps the home-screen widget current. Two ways in:
//  - Android asks (added, resized, or the 30-minute updatePeriodMillis tick): the headless task
//    handler fetches with the stored key and renders.
//  - The app pushes (every successful board refresh, so completing or adding something shows on
//    the home screen at once) via refreshWidget().
// The last good snapshot is cached, so a fetch that fails offline shows stale data, not an error.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWidgetUpdate } from 'react-native-android-widget';
import BluNowWidget from './BluNowWidget';
import { pickNext, countdown } from '../nextUp';
import { getToken } from '../auth';
import { getTodos, getUpcoming } from '../api';

export const WIDGET_NAME = 'BluNow';
const CACHE = 'blu.widget.snapshot.v1';
// The widget redraws only every 30 minutes, so a countdown is shown only when it is far enough off
// that being up to half an hour stale doesn't mislead.
const COUNTDOWN_MIN_MS = 2 * 60 * 60 * 1000;

export function snapshotFrom(todos, events, now = new Date()) {
  const next = pickNext(events, todos, now);
  const far = next?.at && new Date(next.at) - now >= COUNTDOWN_MIN_MS;
  return {
    state: 'ready',
    next: next ? { label: next.label, title: next.title, sub: next.sub } : null,
    countdown: far ? countdown(next.at, now) : null,
    openCount: todos.length,
  };
}

async function load() {
  if (!(await getToken())) return { state: 'signedOut' };
  try {
    const [todos, events] = await Promise.all([getTodos(), getUpcoming()]);
    const snap = snapshotFrom(todos, events);
    AsyncStorage.setItem(CACHE, JSON.stringify(snap)).catch(() => {});
    return snap;
  } catch {
    const cached = await AsyncStorage.getItem(CACHE).catch(() => null);
    return cached ? JSON.parse(cached) : { state: 'ready', next: null };
  }
}

// Registered in index.js; runs headless when Android asks for the widget.
// Sized from widgetInfo (dp) so the layout fits whatever size the widget has been given.
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }) {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  renderWidget(<BluNowWidget snapshot={await load()} width={widgetInfo.width} height={widgetInfo.height} />);
}

// Called by the app with data it already has; no extra network request.
export function refreshWidget(todos, events) {
  const snap = snapshotFrom(todos, events);
  AsyncStorage.setItem(CACHE, JSON.stringify(snap)).catch(() => {});
  requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: info => <BluNowWidget snapshot={snap} width={info.width} height={info.height} />,
    widgetNotFound: () => {}, // no widget on the home screen: nothing to do
  }).catch(() => {});
}

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEvents, CTX_COLOR, fmtTime } from '../api';
import { C, FONT } from '../theme';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function buildEventMap(events, yr, mo) {
  const map = {};
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) map[d] = [];

  for (const ev of events) {
    const s = new Date(ev.start_at);
    if (ev.recurrence === 'none') {
      if (s.getFullYear() === yr && s.getMonth() === mo) {
        map[s.getDate()]?.push(ev);
      }
    } else {
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(yr, mo, d);
        const dow = date.getDay(), refDow = s.getDay();
        const isWeekday = dow >= 1 && dow <= 5;
        if (ev.recurrence === 'daily' ||
            (ev.recurrence === 'weekdays' && isWeekday) ||
            (ev.recurrence === 'weekly' && dow === refDow)) {
          const copy = { ...ev, start_at: new Date(date.getFullYear(), date.getMonth(), date.getDate(), s.getHours(), s.getMinutes()).toISOString() };
          map[d]?.push(copy);
        }
      }
    }
  }
  return map;
}

export default function CalendarScreen() {
  const [events, setEvents] = useState([]);
  const [eventMap, setEventMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const yr = now.getFullYear(), mo = now.getMonth(), today = now.getDate();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const firstDow = new Date(yr, mo, 1).getDay();
  const prevMonthDays = new Date(yr, mo, 0).getDate();

  const load = useCallback(async () => {
    try {
      const data = await getEvents();
      setEvents(data);
      setEventMap(buildEventMap(data, yr, mo));
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [yr, mo]);

  useEffect(() => { load(); }, [load]);

  const totalEvents = Object.values(eventMap).reduce((n, a) => n + a.length, 0);
  const upcoming = events.filter(ev => new Date(ev.start_at) >= now).slice(0, 8);

  const cells = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ day: prevMonthDays - firstDow + i + 1, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, other: false, events: eventMap[d] || [] });
  }
  const trailing = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
  for (let i = 1; i <= trailing; i++) cells.push({ day: i, other: true });

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>{MONTHS[mo]} {yr}</Text>
        <Text style={s.count}>{totalEvents} events</Text>
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={C.per} /></View>
        : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.t2} />}
          >
            {/* Day-of-week row */}
            <View style={s.dowRow}>
              {DAYS.map(d => <Text key={d} style={s.dowLabel}>{d}</Text>)}
            </View>

            {/* Calendar grid */}
            <View style={s.grid}>
              {cells.map((cell, i) => {
                const isToday = !cell.other && cell.day === today;
                const evs = cell.events || [];
                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.cell, isToday && s.cellToday]}
                    onPress={() => !cell.other && setSelectedDay(cell.day)}
                    disabled={cell.other}
                  >
                    <Text style={[s.cellNum, cell.other && s.cellNumOther, isToday && s.cellNumToday]}>
                      {cell.day}
                    </Text>
                    <View style={s.dotRow}>
                      {evs.slice(0, 3).map((ev, j) => (
                        <View key={j} style={[s.dot, { backgroundColor: CTX_COLOR[ev.context] || C.per }]} />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Upcoming list */}
            <View style={s.secHead}>
              <Text style={s.secTitle}>Upcoming</Text>
            </View>
            <View style={{ paddingHorizontal: 20, gap: 8, paddingBottom: 16 }}>
              {upcoming.length === 0
                ? <Text style={s.nil}>Nothing scheduled</Text>
                : upcoming.map((ev, i) => {
                  const c = CTX_COLOR[ev.context] || C.per;
                  return (
                    <View key={ev.id || i} style={s.evRow}>
                      <View style={[s.evBar, { backgroundColor: c }]} />
                      <View style={s.evContent}>
                        <Text style={s.evTitle} numberOfLines={1}>{ev.title}</Text>
                        <Text style={s.evTime}>{fmtTime(ev.start_at)}{ev.recurrence !== 'none' ? ` · ${ev.recurrence}` : ''}</Text>
                      </View>
                      <Text style={[s.evTag, { color: c }]}>{ev.context}</Text>
                    </View>
                  );
                })
              }
            </View>
          </ScrollView>
        )
      }

      {/* Day modal */}
      <Modal visible={selectedDay !== null} transparent animationType="slide" onRequestClose={() => setSelectedDay(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setSelectedDay(null)} />
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>{MONTHS_SHORT[mo]} {selectedDay}</Text>
          {(eventMap[selectedDay] || []).length === 0
            ? <Text style={s.nil}>Nothing scheduled</Text>
            : (eventMap[selectedDay] || []).map((ev, i) => {
              const c = CTX_COLOR[ev.context] || C.per;
              return (
                <View key={i} style={[s.sheetEv, i > 0 && { borderTopWidth: 1, borderTopColor: C.line }]}>
                  <Text style={s.sheetEvTime}>{fmtTime(ev.start_at)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sheetEvTitle}>{ev.title}</Text>
                    <Text style={[s.sheetEvCtx, { color: c }]}>{ev.context}</Text>
                  </View>
                </View>
              );
            })
          }
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  title: { fontSize: 24, ...FONT.black, color: C.t1, letterSpacing: -0.5 },
  count: { fontSize: 13, ...FONT.medium, color: C.t2 },
  dowRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  dowLabel: { flex: 1, textAlign: 'center', fontSize: 10, ...FONT.bold, color: C.t3, textTransform: 'uppercase', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 8 },
  cell: { width: '14.28%', alignItems: 'center', paddingVertical: 6, borderRadius: 8, gap: 3 },
  cellToday: {},
  cellNum: { fontSize: 13, ...FONT.medium, color: C.t1, lineHeight: 18 },
  cellNumOther: { color: C.t3, opacity: 0.4 },
  cellNumToday: {
    backgroundColor: C.per, color: '#000', ...FONT.black,
    width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26,
  },
  dotRow: { flexDirection: 'row', gap: 2, height: 5 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  secHead: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, borderTopWidth: 1, borderTopColor: C.line },
  secTitle: { fontSize: 11, ...FONT.bold, color: C.t2, textTransform: 'uppercase', letterSpacing: 1.5 },
  evRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14,
  },
  evBar: { width: 3, height: 26, borderRadius: 2 },
  evContent: { flex: 1 },
  evTitle: { fontSize: 14, ...FONT.semibold, color: C.t1 },
  evTime: { fontSize: 11, color: C.t2, marginTop: 2 },
  evTag: { fontSize: 9, ...FONT.bold, textTransform: 'uppercase', letterSpacing: 1 },
  overlay: { flex: 1 },
  sheet: {
    backgroundColor: C.s1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: C.line,
  },
  sheetHandle: { width: 36, height: 4, backgroundColor: C.line, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 16, ...FONT.bold, color: C.t2, marginBottom: 14 },
  sheetEv: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 12 },
  sheetEvTime: { fontSize: 11, color: C.t2, width: 60, paddingTop: 1 },
  sheetEvTitle: { fontSize: 14, ...FONT.semibold, color: C.t1 },
  sheetEvCtx: { fontSize: 10, ...FONT.bold, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  nil: { fontSize: 13, color: C.t3, fontStyle: 'italic' },
});

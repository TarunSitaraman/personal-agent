import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStatus, CTX_COLOR, fmtTime } from '../api';
import { C, FONT } from '../theme';

export default function HomeScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getStatus();
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const acc = data ? CTX_COLOR[data.mode] || C.hex : C.hex;
  const allTodos = data ? [...(data.todos.hexaware || []), ...(data.todos.smartresq || [])] : [];

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.hex} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.logo}>blu<Text style={{ color: acc }}>.</Text></Text>
        <View style={[s.modePill, { backgroundColor: acc + '20', borderColor: acc + '40' }]}>
          <Text style={[s.modeText, { color: acc }]}>{data?.modeLabel?.toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.t2} />}
      >
        {/* Stats */}
        <View style={s.statsRow}>
          <StatCard value={data?.todos?.total ?? '—'} label="Todos" color={C.t1} />
          <StatCard value={data?.prs ?? '—'} label="PRs" color={C.hex} />
          <StatCard value={data?.issues ?? '—'} label="Issues" color={C.srq} />
        </View>

        {/* Mode */}
        <View style={s.modeCard}>
          <Text style={s.modeCardLabel}>CURRENT MODE</Text>
          <Text style={[s.modeCardName, { color: acc }]}>{data?.modeLabel}</Text>
          <Text style={s.modeCardDesc}>{data?.modeDesc}</Text>
        </View>

        {/* Todos */}
        <SectionHeader title="Open Todos" count={allTodos.length} />
        {allTodos.length === 0
          ? <EmptyState text="All clear — nothing pending" />
          : allTodos.map((t, i) => (
            <TodoRow key={t.id || i} todo={t} />
          ))
        }

        {/* Upcoming */}
        <SectionHeader title="Upcoming" />
        {!data?.upcoming?.length
          ? <EmptyState text="Nothing scheduled" />
          : data.upcoming.map((ev, i) => (
            <EventRow key={ev.id || i} event={ev} />
          ))
        }
        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ value, label, color }) {
  return (
    <View style={s.statCard}>
      <Text style={[s.statN, { color }]}>{value}</Text>
      <Text style={s.statL}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, count }) {
  return (
    <View style={s.secHead}>
      <Text style={s.secTitle}>{title}</Text>
      {count !== undefined && <Text style={s.secCount}>{count}</Text>}
    </View>
  );
}

function EmptyState({ text }) {
  return <Text style={s.nil}>{text}</Text>;
}

function TodoRow({ todo }) {
  const c = CTX_COLOR[todo.context] || C.per;
  return (
    <View style={s.row}>
      <View style={[s.rowBar, { backgroundColor: c }]} />
      <View style={s.rowContent}>
        <Text style={[s.rowCtx, { color: c }]}>{todo.context}</Text>
        <Text style={s.rowText} numberOfLines={2}>{todo.content}</Text>
      </View>
    </View>
  );
}

function EventRow({ event }) {
  const c = CTX_COLOR[event.context] || C.per;
  return (
    <View style={s.row}>
      <View style={[s.rowBar, { backgroundColor: c }]} />
      <View style={s.rowContent}>
        <Text style={s.rowText} numberOfLines={1}>{event.title}</Text>
        <Text style={s.rowMeta}>{fmtTime(event.start_at)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  logo: { fontSize: 24, ...FONT.black, color: C.t1, letterSpacing: -1 },
  modePill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1,
  },
  modeText: { fontSize: 10, ...FONT.bold, letterSpacing: 1 },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  statCard: {
    flex: 1, backgroundColor: C.s1, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, padding: 14,
  },
  statN: { fontSize: 30, ...FONT.black, letterSpacing: -1, lineHeight: 34 },
  statL: { fontSize: 9, ...FONT.bold, color: C.t2, letterSpacing: 1, marginTop: 5, textTransform: 'uppercase' },
  modeCard: {
    marginHorizontal: 20, marginVertical: 12, backgroundColor: C.s1,
    borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16,
  },
  modeCardLabel: { fontSize: 9, ...FONT.bold, color: C.t3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  modeCardName: { fontSize: 20, ...FONT.black, letterSpacing: -0.5, marginBottom: 4 },
  modeCardDesc: { fontSize: 12, ...FONT.regular, color: C.t2, lineHeight: 18 },
  secHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  secTitle: { fontSize: 11, ...FONT.bold, color: C.t2, textTransform: 'uppercase', letterSpacing: 1.5 },
  secCount: { fontSize: 11, ...FONT.bold, color: C.t3 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 20, marginBottom: 6,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14,
  },
  rowBar: { width: 3, height: 22, borderRadius: 2 },
  rowContent: { flex: 1 },
  rowCtx: { fontSize: 9, ...FONT.bold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  rowText: { fontSize: 13, ...FONT.medium, color: C.t1, lineHeight: 18 },
  rowMeta: { fontSize: 11, ...FONT.regular, color: C.t3, marginTop: 2 },
  nil: { fontSize: 13, color: C.t3, fontStyle: 'italic', paddingHorizontal: 20, paddingVertical: 8 },
});

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTodos, completeTodo, CTX_COLOR } from '../api';
import { C, FONT } from '../theme';

const CONTEXTS = [
  { key: 'all', label: 'All' },
  { key: "all", label: "All Tasks" },
  { key: 'smartresq', label: 'SmartResQ' },
  { key: 'personal', label: 'Personal' },
];

export default function TodosScreen() {
  const [todos, setTodos] = useState([]);
  const [ctx, setCtx] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (context) => {
    try {
      const data = await getTodos(context === 'all' ? null : context);
      setTodos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(ctx); }, [ctx, load]);

  const handleComplete = useCallback(async (todo) => {
    setTodos(prev => prev.filter(t => t.id !== todo.id));
    try { await completeTodo(todo.content); } catch { load(ctx); }
  }, [ctx, load]);

  const acc = ctx !== 'all' ? CTX_COLOR[ctx] : C.hex;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Todos</Text>
        <Text style={s.count}>{todos.length} open</Text>
      </View>

      {/* Context tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabs} contentContainerStyle={s.tabsContent}>
        {CONTEXTS.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[s.tab, ctx === c.key && { backgroundColor: (CTX_COLOR[c.key] || C.hex) + '18', borderColor: (CTX_COLOR[c.key] || C.hex) + '50' }]}
            onPress={() => { setCtx(c.key); setLoading(true); }}
          >
            <Text style={[s.tabText, ctx === c.key && { color: CTX_COLOR[c.key] || C.hex }]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading
        ? <View style={s.center}><ActivityIndicator color={acc} /></View>
        : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(ctx); }} tintColor={C.t2} />}
            contentContainerStyle={{ padding: 20, gap: 8 }}
          >
            {todos.length === 0
              ? <Text style={s.nil}>Nothing here — all clear</Text>
              : todos.map(todo => (
                <TodoItem key={todo.id} todo={todo} onComplete={handleComplete} />
              ))
            }
            <View style={{ height: 8 }} />
          </ScrollView>
        )
      }
    </SafeAreaView>
  );
}

function TodoItem({ todo, onComplete }) {
  const c = CTX_COLOR[todo.context] || C.per;
  const [done, setDone] = useState(false);

  const handlePress = () => {
    setDone(true);
    setTimeout(() => onComplete(todo), 400);
  };

  return (
    <View style={[s.item, done && { opacity: 0.4 }]}>
      <View style={[s.itemBar, { backgroundColor: c }]} />
      <View style={s.itemContent}>
        <Text style={[s.itemCtx, { color: c }]}>{todo.context}</Text>
        <Text style={[s.itemText, done && { textDecorationLine: 'line-through', color: C.t3 }]} numberOfLines={3}>
          {todo.content}
        </Text>
        {todo.remind_at && (
          <Text style={s.itemMeta}>⏰ {new Date(todo.remind_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</Text>
        )}
      </View>
      <TouchableOpacity style={[s.checkbox, done && s.checkboxDone]} onPress={handlePress}>
        {done && <Text style={s.checkmark}>✓</Text>}
      </TouchableOpacity>
    </View>
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
  tabs: { borderBottomWidth: 1, borderBottomColor: C.line },
  tabsContent: { paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  tab: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.line,
  },
  tabText: { fontSize: 12, ...FONT.semibold, color: C.t2 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14,
  },
  itemBar: { width: 3, height: 26, borderRadius: 2, alignSelf: 'flex-start', marginTop: 2 },
  itemContent: { flex: 1 },
  itemCtx: { fontSize: 9, ...FONT.bold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  itemText: { fontSize: 14, ...FONT.medium, color: C.t1, lineHeight: 20 },
  itemMeta: { fontSize: 11, color: C.t3, marginTop: 4 },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: C.line,
    backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: C.srq, borderColor: C.srq },
  checkmark: { fontSize: 12, ...FONT.bold, color: '#000' },
  nil: { fontSize: 13, color: C.t3, fontStyle: 'italic' },
});

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getNotes, getLearnings, CTX_COLOR, relTime } from '../api';
import { C, FONT } from '../theme';

const VIEWS = [
  { key: 'notes', label: 'Notes' },
  { key: 'learnings', label: 'Learnings' },
];

export default function NotesScreen() {
  const [view, setView] = useState('notes');
  const [notes, setNotes] = useState([]);
  const [learnings, setLearnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [n, l] = await Promise.all([getNotes(), getLearnings()]);
      setNotes(Array.isArray(n) ? n : []);
      setLearnings(Array.isArray(l) ? l : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const data = view === 'notes' ? notes : learnings;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Captured</Text>
        <Text style={s.count}>{data.length}</Text>
      </View>

      {/* Segment */}
      <View style={s.segRow}>
        {VIEWS.map(v => (
          <TouchableOpacity
            key={v.key}
            style={[s.seg, view === v.key && s.segActive]}
            onPress={() => setView(v.key)}
          >
            <Text style={[s.segText, view === v.key && s.segTextActive]}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color={C.per} /></View>
        : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.t2} />}
            contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 24 }}
          >
            {data.length === 0
              ? <Text style={s.nil}>{view === 'notes' ? 'No notes yet' : 'All caught up'}</Text>
              : view === 'notes'
                ? notes.map((n, i) => <NoteCard key={n.id || i} note={n} />)
                : learnings.map((l, i) => <LearningCard key={l.id || i} learning={l} />)
            }
          </ScrollView>
        )
      }
    </SafeAreaView>
  );
}

function NoteCard({ note }) {
  const c = CTX_COLOR[note.context] || C.per;
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <Text style={[s.cardCtx, { color: c }]}>{note.context?.toUpperCase()}</Text>
        <Text style={s.cardTime}>{relTime(note.created_at)}</Text>
      </View>
      <Text style={s.cardText}>{note.content}</Text>
      {note.tags?.length > 0 && (
        <View style={s.tagRow}>
          {note.tags.map((t, i) => (
            <View key={i} style={s.tag}><Text style={s.tagText}>{t}</Text></View>
          ))}
        </View>
      )}
    </View>
  );
}

function LearningCard({ learning }) {
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <Text style={s.learnTopic}>{learning.topic}</Text>
        <Text style={s.cardTime}>{relTime(learning.created_at)}</Text>
      </View>
      <Text style={s.cardText}>{learning.content}</Text>
      {learning.source && (
        <Text style={s.learnSource}>via {learning.source}</Text>
      )}
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
  segRow: {
    flexDirection: 'row', padding: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  seg: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.line,
  },
  segActive: { backgroundColor: C.s2, borderColor: C.t3 },
  segText: { fontSize: 13, ...FONT.semibold, color: C.t2 },
  segTextActive: { color: C.t1 },
  card: {
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardCtx: { fontSize: 9, ...FONT.bold, letterSpacing: 1 },
  cardTime: { fontSize: 10, color: C.t3 },
  cardText: { fontSize: 14, ...FONT.regular, color: C.t1, lineHeight: 22 },
  learnTopic: { fontSize: 14, ...FONT.bold, color: C.t1 },
  learnSource: { fontSize: 11, color: C.t3, marginTop: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { backgroundColor: C.s2, borderWidth: 1, borderColor: C.line, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  tagText: { fontSize: 10, color: C.t2 },
  nil: { fontSize: 13, color: C.t3, fontStyle: 'italic' },
});

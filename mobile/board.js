// Everything the Now screen shows, loaded together and refreshed when the app comes back to the
// foreground. Completing is optimistic and deferred for the toast's lifetime, so Undo never has
// to reach the server.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getTodos, getUpcoming, getNotes, getMessages, getLearnings, getDoneToday, completeTodo, reviewLearning } from './api';
import { TOAST_MS } from './components/Toast';
import { refreshWidget } from './widget/widget';

// A brief from last night is not "from Blu" at 4 am; past this age it stays in the thread only.
const LATEST_MAX_AGE_MS = 6 * 3600 * 1000;

export function useBoard() {
  const [todos, setTodos] = useState([]);
  const [events, setEvents] = useState([]);
  const [notes, setNotes] = useState([]);
  const [latest, setLatest] = useState(null);
  const [learning, setLearning] = useState(null);
  const [doneToday, setDoneToday] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const hidden = useRef(new Set()); // ids completed locally, not yet sent

  const refresh = useCallback(async () => {
    try {
      const [t, e, n, m, l, d] = await Promise.all([
        getTodos(), getUpcoming(), getNotes(), getMessages(),
        getLearnings().catch(() => []), getDoneToday().catch(() => 0),
      ]);
      setTodos(t.filter(x => !hidden.current.has(x.id)));
      setEvents(e);
      setNotes(n);
      const cutoff = Date.now() - LATEST_MAX_AGE_MS;
      // Only what Blu sent on its own (briefs, nudges, reminders). A reply to your own message just
      // repeats what you did ("Todo added: …"), and the list above already shows it.
      setLatest(m.find(x => x.from !== 'me' && x.kind && x.kind !== 'chat' && new Date(x.created_at).getTime() >= cutoff) || null);
      setLearning(l[0] || null);
      setDoneToday(d);
      refreshWidget(t.filter(x => !hidden.current.has(x.id)), e); // keep the home-screen widget in step
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  // Returns an undo function. The server call happens only if Undo isn't pressed in time.
  const complete = useCallback((todo, onFail) => {
    hidden.current.add(todo.id);
    setTodos(prev => prev.filter(x => x.id !== todo.id));
    const timer = setTimeout(async () => {
      try {
        await completeTodo(todo.content);
      } catch {
        onFail?.();
      } finally {
        hidden.current.delete(todo.id);
        refresh();
      }
    }, TOAST_MS + 200);
    return () => {
      clearTimeout(timer);
      hidden.current.delete(todo.id);
      refresh();
    };
  }, [refresh]);

  // Spaced repetition: the server schedules the next review from the answer.
  const review = useCallback(async (item, gotRight) => {
    setLearning(null);
    try { await reviewLearning(item.id, gotRight); } finally { refresh(); }
  }, [refresh]);

  return { todos, events, notes, latest, learning, doneToday, loaded, error, refresh, complete, review };
}

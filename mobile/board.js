// Everything the Now screen shows, loaded together and refreshed when the app comes back to the
// foreground. Completing is optimistic and deferred for the toast's lifetime, so Undo never has
// to reach the server.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getTodos, getUpcoming, getNotes, getMessages, completeTodo } from './api';
import { TOAST_MS } from './components/Toast';

export function useBoard() {
  const [todos, setTodos] = useState([]);
  const [events, setEvents] = useState([]);
  const [notes, setNotes] = useState([]);
  const [latest, setLatest] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const hidden = useRef(new Set()); // ids completed locally, not yet sent

  const refresh = useCallback(async () => {
    try {
      const [t, e, n, m] = await Promise.all([getTodos(), getUpcoming(), getNotes(), getMessages()]);
      setTodos(t.filter(x => !hidden.current.has(x.id)));
      setEvents(e);
      setNotes(n);
      setLatest(m.find(x => x.from !== 'me') || null);
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

  return { todos, events, notes, latest, loaded, error, refresh, complete };
}

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { loadData, saveData, loadHomes, setCurrentHome } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';

const DataCtx = createContext(null);
const MAX_UNDO = 20;

export function DataProvider({ children }) {
  const { isViewer, logout } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conflictError, setConflictError] = useState(false);
  const [homes, setHomes] = useState([]);
  const [activeHome, setActiveHome] = useState(null);

  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const dataRef = useRef(null);
  const serverUpdatedAt = useRef(null);

  const handleApiError = useCallback((e) => {
    if (e.status === 401) { logout(); setData(null); return; }
    if (e.status === 409) { setConflictError(true); return; }
    setError(e.message);
  }, [logout]);

  const clearError = useCallback(() => setError(null), []);

  // Keep dataRef in sync so useCallback functions always see current data
  useEffect(() => { dataRef.current = data; }, [data]);

  // Load homes list then load first home's data
  useEffect(() => {
    loadHomes()
      .then(h => {
        setHomes(h);
        const firstHome = h[0]?.id || 'default';
        setActiveHome(firstHome);
        setCurrentHome(firstHome);
        return loadData(firstHome);
      })
      .then(d => { serverUpdatedAt.current = d._updatedAt || null; setData(d); })
      .catch(handleApiError)
      .finally(() => setLoading(false));
  }, [handleApiError]);

  const switchHome = useCallback((homeId) => {
    setLoading(true);
    setActiveHome(homeId);
    setCurrentHome(homeId);
    undoStack.current = [];
    redoStack.current = [];
    setUndoCount(0);
    setRedoCount(0);
    loadData(homeId)
      .then(d => { serverUpdatedAt.current = d._updatedAt || null; setData(d); })
      .catch(handleApiError)
      .finally(() => setLoading(false));
  }, [handleApiError]);

  const updateData = useCallback(async (newData) => {
    const prevData = dataRef.current;
    if (prevData) {
      undoStack.current.push(JSON.stringify(prevData));
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
      setUndoCount(undoStack.current.length);
    }
    redoStack.current = [];
    setRedoCount(0);
    setData(newData);
    try {
      const result = await saveData(newData, null, serverUpdatedAt.current);
      if (result?._updatedAt) serverUpdatedAt.current = result._updatedAt;
    } catch (e) {
      if (prevData !== null) {
        setData(prevData);
        undoStack.current.pop();
        setUndoCount(undoStack.current.length);
      }
      handleApiError(e);
    }
  }, [handleApiError]);

  const undo = useCallback(async () => {
    if (undoStack.current.length === 0) return;
    const prevState = JSON.parse(undoStack.current.pop());
    setUndoCount(undoStack.current.length);
    const currentState = dataRef.current;
    redoStack.current.push(JSON.stringify(currentState));
    setRedoCount(redoStack.current.length);
    setData(prevState);
    try {
      // Undo saves are unconditional (no clientUpdatedAt) — the user is
      // intentionally reverting their own change, not racing another user.
      const result = await saveData(prevState);
      if (result?._updatedAt) serverUpdatedAt.current = result._updatedAt;
    } catch (e) {
      if (currentState !== null) {
        setData(currentState);
        redoStack.current.pop();
        setRedoCount(redoStack.current.length);
        undoStack.current.push(JSON.stringify(prevState));
        setUndoCount(undoStack.current.length);
      }
      handleApiError(e);
    }
  }, [handleApiError]);

  const redo = useCallback(async () => {
    if (redoStack.current.length === 0) return;
    const nextState = JSON.parse(redoStack.current.pop());
    setRedoCount(redoStack.current.length);
    const currentState = dataRef.current;
    undoStack.current.push(JSON.stringify(currentState));
    setUndoCount(undoStack.current.length);
    setData(nextState);
    try {
      // Redo saves are unconditional (no clientUpdatedAt) — same reasoning as undo.
      const result = await saveData(nextState);
      if (result?._updatedAt) serverUpdatedAt.current = result._updatedAt;
    } catch (e) {
      if (currentState !== null) {
        setData(currentState);
        undoStack.current.pop();
        setUndoCount(undoStack.current.length);
        redoStack.current.push(JSON.stringify(nextState));
        setRedoCount(redoStack.current.length);
      }
      handleApiError(e);
    }
  }, [handleApiError]);

  // Keyboard shortcuts — viewers have no undo/redo capability
  useEffect(() => {
    if (isViewer) return;
    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo, isViewer]);

  const safeUpdateData = isViewer ? async () => { setError('Read-only mode — viewers cannot make changes'); } : updateData;

  return (
    <DataCtx.Provider value={{
      data, loading, error, conflictError, homes, activeHome,
      updateData: safeUpdateData, undo, redo, undoCount, redoCount,
      switchHome, setError, clearError,
    }}>
      {children}
    </DataCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

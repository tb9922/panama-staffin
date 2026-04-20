import { useCallback, useEffect, useMemo, useState } from 'react';
import { listNotifications, markAllNotificationsRead, markNotificationsRead } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { useData } from './DataContext.jsx';
import { NotificationContext } from './notificationContextShared.js';

export function NotificationProvider({ children }) {
  const { user, logout } = useAuth();
  const { activeHome } = useData();
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!user || !activeHome) {
      setItems([]);
      setUnreadCount(0);
      setError(null);
      return;
    }

    if (!silent) setLoading(true);
    try {
      const payload = await listNotifications();
      setItems(payload.items || []);
      setUnreadCount(payload.unreadCount || 0);
      setError(null);
    } catch (err) {
      if (err.status === 401) {
        await logout({ forceLocal: true });
        return;
      }
      setError(err.message || 'Failed to load notifications');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeHome, logout, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user || !activeHome) return undefined;
    const timer = setInterval(() => {
      void refresh({ silent: true });
    }, 60000);
    return () => clearInterval(timer);
  }, [activeHome, refresh, user]);

  const markRead = useCallback(async (keys) => {
    const normalized = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
    if (!normalized.length) return;

    setItems(current => current.map(item => (
      normalized.includes(item.key)
        ? { ...item, isRead: true, readAt: item.readAt || new Date().toISOString() }
        : item
    )));
    setUnreadCount(current => Math.max(0, current - normalized.length));

    try {
      await markNotificationsRead(normalized);
    } catch (err) {
      if (err.status === 401) {
        await logout({ forceLocal: true });
        return;
      }
      setError(err.message || 'Failed to update notifications');
      await refresh({ silent: true });
    }
  }, [logout, refresh]);

  const markAllRead = useCallback(async () => {
    const unreadKeys = items.filter(item => !item.isRead).map(item => item.key);
    if (!unreadKeys.length) return;

    setItems(current => current.map(item => ({ ...item, isRead: true, readAt: item.readAt || new Date().toISOString() })));
    setUnreadCount(0);

    try {
      await markAllNotificationsRead();
    } catch (err) {
      if (err.status === 401) {
        await logout({ forceLocal: true });
        return;
      }
      setError(err.message || 'Failed to update notifications');
      await refresh({ silent: true });
    }
  }, [items, logout, refresh]);

  const value = useMemo(() => ({
    items,
    unreadCount,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  }), [error, items, loading, markAllRead, markRead, refresh, unreadCount]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

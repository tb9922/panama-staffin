import { createContext } from 'react';

export const NotificationContext = createContext({
  items: [],
  unreadCount: 0,
  loading: false,
  error: null,
  refresh: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
});

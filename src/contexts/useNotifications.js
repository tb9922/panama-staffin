import { useContext } from 'react';
import { NotificationContext } from './notificationContextShared.js';

export function useNotifications() {
  return useContext(NotificationContext);
}

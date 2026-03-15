/* eslint-disable react-refresh/only-export-components */
import { vi } from 'vitest';

export const useData = vi.fn(() => ({
  canRead: () => true,
  canWrite: () => true,
  homeRole: 'home_manager',
  staffId: null,
}));

export const DataProvider = ({ children }) => children;

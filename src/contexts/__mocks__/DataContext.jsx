/* eslint-disable react-refresh/only-export-components */
import { vi } from 'vitest';
import { createMockDataContext } from '../../test/dataContextMock.js';

export const useData = vi.fn(() => createMockDataContext());

export const DataProvider = ({ children }) => children;

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DataProvider, useData } from '../DataContext.jsx';
import * as api from '../../lib/api.js';
import { useAuth } from '../AuthContext.jsx';

vi.mock('../../lib/api.js', () => ({
  loadHomes: vi.fn(),
  setCurrentHome: vi.fn(),
}));

vi.mock('../AuthContext.jsx', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: vi.fn(() => ({
    user: { username: 'admin', role: 'admin' },
    logout: vi.fn(),
    isViewer: false,
    isPlatformAdmin: false,
  })),
}));

const HOMES = [
  { id: 'home-1', name: 'Home One' },
  { id: 'home-2', name: 'Home Two' },
];

function wrapper({ children }) {
  return <DataProvider>{children}</DataProvider>;
}

describe('DataContext', () => {
  beforeEach(() => {
    api.loadHomes.mockReset();
    api.setCurrentHome.mockReset();
    localStorage.clear();
    // Reset the useAuth mock to a fresh logout spy per test
    useAuth.mockReturnValue({
      user: { username: 'admin', role: 'admin' },
      logout: vi.fn(),
      isViewer: false,
      isPlatformAdmin: false,
    });
  });

  it('loads homes on mount and sets activeHome to first home', async () => {
    api.loadHomes.mockResolvedValue(HOMES);

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.homes).toEqual(HOMES);
    expect(result.current.activeHome).toBe('home-1');
    expect(api.setCurrentHome).toHaveBeenCalledWith('home-1');
  });

  it('shows loading state initially, then resolves', async () => {
    let resolve;
    api.loadHomes.mockReturnValue(new Promise(r => { resolve = r; }));

    const { result } = renderHook(() => useData(), { wrapper });

    expect(result.current.loading).toBe(true);

    await act(async () => { resolve(HOMES); });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.homes).toEqual(HOMES);
  });

  it('sets error on API failure', async () => {
    api.loadHomes.mockRejectedValue({ message: 'Network error', status: 500 });

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Network error');
    expect(result.current.homes).toEqual([]);
  });

  it('calls logout on 401 error', async () => {
    const logoutFn = vi.fn();
    useAuth.mockReturnValue({
      user: { username: 'admin', role: 'admin' },
      logout: logoutFn,
      isViewer: false,
      isPlatformAdmin: false,
    });

    api.loadHomes.mockRejectedValue({ message: 'Unauthorized', status: 401 });

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(logoutFn).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('switchHome updates activeHome and calls setCurrentHome', async () => {
    api.loadHomes.mockResolvedValue(HOMES);

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeHome).toBe('home-1');

    await act(async () => {
      result.current.switchHome('home-2');
    });

    expect(result.current.activeHome).toBe('home-2');
    expect(api.setCurrentHome).toHaveBeenLastCalledWith('home-2');
  });

  it('useData throws when used outside DataProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useData())).toThrow(
      'useData must be used within DataProvider',
    );

    consoleError.mockRestore();
  });

  it('uses null as activeHome when homes list is empty', async () => {
    api.loadHomes.mockResolvedValue([]);

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeHome).toBeNull();
    expect(api.setCurrentHome).toHaveBeenCalledWith(null);
  });

  it('refreshHomes updates homes list', async () => {
    const updatedHomes = [...HOMES, { id: 'home-3', name: 'Home Three' }];
    api.loadHomes
      .mockResolvedValueOnce(HOMES)
      .mockResolvedValueOnce(updatedHomes);

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.homes).toEqual(HOMES);

    await act(async () => {
      await result.current.refreshHomes();
    });

    expect(result.current.homes).toEqual(updatedHomes);
  });

  it('refreshHomes resets activeHome if current home no longer exists', async () => {
    api.loadHomes
      .mockResolvedValueOnce(HOMES)
      .mockResolvedValueOnce([{ id: 'home-3', name: 'Home Three' }]);

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeHome).toBe('home-1');

    await act(async () => {
      await result.current.refreshHomes();
    });

    expect(result.current.activeHome).toBe('home-3');
    expect(api.setCurrentHome).toHaveBeenLastCalledWith('home-3');
  });

  it('clearError resets error to null', async () => {
    api.loadHomes.mockRejectedValue({ message: 'Something broke', status: 500 });

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.error).toBe('Something broke'));

    await act(async () => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('setError allows manual error setting', async () => {
    api.loadHomes.mockResolvedValue(HOMES);

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setError('Manual error');
    });

    expect(result.current.error).toBe('Manual error');
  });
});

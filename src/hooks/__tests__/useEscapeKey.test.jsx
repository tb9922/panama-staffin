import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import useEscapeKey from '../useEscapeKey.js';

describe('useEscapeKey', () => {
  it('calls onClose when Escape is pressed and isOpen is true', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeKey(true, onClose));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when isOpen is false', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeKey(false, onClose));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call onClose on non-Escape keys', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeKey(true, onClose));

    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the keydown listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(true, onClose));

    unmount();

    // After unmount the listener is gone — Escape should be silent
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the keydown listener when isOpen changes to false', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(
      ({ isOpen }) => useEscapeKey(isOpen, onClose),
      { initialProps: { isOpen: true } },
    );

    // Confirm it works before the toggle
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender({ isOpen: false });
    onClose.mockClear();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

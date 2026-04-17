/**
 * Accessibility utilities for interactive elements.
 */

/**
 * Returns props to make a table row keyboard-accessible.
 * Spread onto <tr> to replace a bare onClick.
 *
 * Usage:
 *   <tr {...clickableRowProps(() => openEdit(item), { label: 'Open item' })} className={TABLE.tr}>
 *
 * Adds: role, onClick, tabIndex, and Enter/Space activation.
 */
export function clickableRowProps(handler, { disabled = false, label } = {}) {
  return {
    role: 'button',
    tabIndex: disabled ? -1 : 0,
    ...(label ? { 'aria-label': label } : {}),
    ...(disabled ? { 'aria-disabled': true } : {}),
    onClick: disabled ? undefined : handler,
    onKeyDown(e) {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    },
  };
}

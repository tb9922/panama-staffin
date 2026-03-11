/**
 * Accessibility utilities for interactive elements.
 */

/**
 * Returns props to make a table row keyboard-accessible.
 * Spread onto <tr> to replace a bare onClick.
 *
 * Usage:
 *   <tr {...clickableRowProps(() => openEdit(item))} className={TABLE.tr}>
 *
 * Adds: onClick, tabIndex=0, onKeyDown (Enter/Space activation).
 */
export function clickableRowProps(handler) {
  return {
    onClick: handler,
    tabIndex: 0,
    onKeyDown(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    },
  };
}

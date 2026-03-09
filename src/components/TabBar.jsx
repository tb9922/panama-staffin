import { useId, useRef } from 'react';
import { TAB } from '../lib/design.js';

/**
 * Accessible tab bar with ARIA attributes and keyboard navigation.
 *
 * @param {Object} props
 * @param {{ id: string, label: string }[]} props.tabs - tab definitions
 * @param {string} props.activeTab - currently active tab id
 * @param {(id: string) => void} props.onTabChange - called when a tab is activated
 * @param {string} [props.className] - extra classes on the tablist wrapper
 */
export default function TabBar({ tabs, activeTab, onTabChange, className = '' }) {
  const prefix = useId();
  const listRef = useRef(null);

  function handleKeyDown(e) {
    const idx = tabs.findIndex(t => t.id === activeTab);
    let next = -1;

    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;

    e.preventDefault();
    onTabChange(tabs[next].id);
    listRef.current?.querySelector(`#${CSS.escape(tabId(prefix, tabs[next].id))}`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      className={`${TAB.bar} ${className}`}
      onKeyDown={handleKeyDown}
    >
      {tabs.map(t => (
        <button
          key={t.id}
          id={tabId(prefix, t.id)}
          role="tab"
          aria-selected={t.id === activeTab}
          aria-controls={panelId(prefix, t.id)}
          tabIndex={t.id === activeTab ? 0 : -1}
          onClick={() => onTabChange(t.id)}
          className={`${TAB.button} ${t.id === activeTab ? TAB.active : TAB.inactive}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function tabId(prefix, id) { return `${prefix}-tab-${id}`; }
function panelId(prefix, id) { return `${prefix}-panel-${id}`; }

/**
 * Returns props for a tab panel element to link it to its tab button.
 * Usage: <div {...tabPanelProps(prefix, activeTabId)}> ... </div>
 */
// eslint-disable-next-line react-refresh/only-export-components
export function tabPanelProps(prefix, tabIdValue) {
  return {
    id: panelId(prefix, tabIdValue),
    role: 'tabpanel',
    'aria-labelledby': tabId(prefix, tabIdValue),
    tabIndex: 0,
  };
}

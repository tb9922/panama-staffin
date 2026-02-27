import { useEffect, useRef, useId } from 'react';
import { MODAL } from '../lib/design.js';

const PANEL_SIZE = {
  sm:   MODAL.panelSm,
  md:   MODAL.panel,
  lg:   MODAL.panelLg,
  xl:   MODAL.panelXl,
  wide: MODAL.panelWide,
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal wrapper with focus trapping, ARIA attributes, and Escape to close.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - whether the modal is visible
 * @param {Function} props.onClose - called when user clicks backdrop, presses Escape, or closes
 * @param {string} props.title - modal heading text (used for aria-labelledby)
 * @param {'sm'|'md'|'lg'|'xl'|'wide'} [props.size='md'] - panel size
 * @param {React.ReactNode} props.children - modal body content
 */
export default function Modal({ isOpen, onClose, title, size = 'md', children }) {
  const panelRef = useRef(null);
  const previousFocus = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  // Keep ref fresh without triggering effect re-runs
  onCloseRef.current = onClose;

  // Focus trap + Escape key + restore focus
  useEffect(() => {
    if (!isOpen) return;

    previousFocus.current = document.activeElement;

    // Focus first focusable element inside modal after render
    const timer = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector(FOCUSABLE);
      if (first) first.focus();
    });

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to previously focused element
      if (previousFocus.current?.focus) previousFocus.current.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={MODAL.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={panelRef} className={PANEL_SIZE[size] || PANEL_SIZE.md}>
        <h3 id={titleId} className={MODAL.title}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

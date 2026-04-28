// Design System — shared className tokens for consistent UI
// Import and use these constants instead of ad-hoc Tailwind strings

// ── Buttons ──────────────────────────────────────────────────────────────────
export const BTN = {
  disabled:  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  primary:   'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] shadow-sm shadow-purple-900/10 transition-colors duration-150 hover:brightness-95 active:brightness-90 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--paper)] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  secondary: 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line-2)] bg-[var(--paper)] px-4 py-2 text-sm font-semibold text-[var(--ink-2)] shadow-sm shadow-slate-900/5 transition-colors duration-150 hover:bg-[var(--paper-2)] active:bg-[var(--paper-3)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--paper)] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  danger:    'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--alert)] bg-[var(--alert)] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-red-900/10 transition-colors duration-150 hover:brightness-95 active:brightness-90 focus:outline-none focus:ring-2 focus:ring-[var(--alert)] focus:ring-offset-2 focus:ring-offset-[var(--paper)] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  ghost:     'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[var(--ink-2)] transition-colors duration-150 hover:bg-[var(--paper-2)] active:bg-[var(--paper-3)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--paper)] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  success:   'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--ok)] bg-[var(--ok)] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-900/10 transition-colors duration-150 hover:brightness-95 active:brightness-90 focus:outline-none focus:ring-2 focus:ring-[var(--ok)] focus:ring-offset-2 focus:ring-offset-[var(--paper)] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  // Size variants — append after base
  xs: 'px-2.5 py-1.5 text-xs rounded-md',
  sm: 'px-3 py-1.5 text-xs rounded-md',
};

// ── Cards ────────────────────────────────────────────────────────────────────
export const CARD = {
  base:     'rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_1px_2px_rgba(20,20,40,0.04),0_6px_20px_-12px_rgba(20,20,40,0.08)]',
  padded:   'rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-[0_1px_2px_rgba(20,20,40,0.04),0_6px_20px_-12px_rgba(20,20,40,0.08)]',
  elevated: 'rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-[0_6px_24px_-14px_rgba(20,20,40,0.22)]',
  flush:    'overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_1px_2px_rgba(20,20,40,0.04),0_6px_20px_-12px_rgba(20,20,40,0.08)]',
};

// ── Badges / Pills ───────────────────────────────────────────────────────────
export const BADGE = {
  blue:    'inline-flex items-center rounded-full border border-[var(--info)] bg-[var(--info-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--info)]',
  green:   'inline-flex items-center rounded-full border border-[var(--ok)] bg-[var(--ok-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--ok)]',
  amber:   'inline-flex items-center rounded-full border border-[var(--caution)] bg-[var(--caution-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--caution)]',
  red:     'inline-flex items-center rounded-full border border-[var(--alert)] bg-[var(--alert-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--alert)]',
  gray:    'inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--paper-2)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-3)]',
  purple:  'inline-flex items-center rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]',
  orange:  'inline-flex items-center rounded-full border border-[var(--warn)] bg-[var(--warn-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--warn)]',
  pink:    'inline-flex items-center rounded-full border border-[var(--alert)] bg-[var(--alert-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--alert)]',
};

// ── Tabs ────────────────────────────────────────────────────────────────────
export const TAB = {
  bar: 'mb-4 flex flex-wrap gap-1 border-b border-[var(--line)] sm:flex-nowrap sm:overflow-x-auto',
  button: 'px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
  active: 'border-[var(--accent)] text-[var(--accent)]',
  inactive: 'border-transparent text-[var(--ink-3)] hover:text-[var(--ink)] hover:border-[var(--line-2)]',
};

// ── Form Inputs ──────────────────────────────────────────────────────────────
export const INPUT = {
  base:   'w-full rounded-lg border border-[var(--line-2)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-4)] shadow-sm shadow-slate-900/5 transition-colors duration-150 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20',
  sm:     'w-full rounded-lg border border-[var(--line-2)] bg-[var(--paper)] px-3 py-1.5 text-sm text-[var(--ink)] placeholder-[var(--ink-4)] shadow-sm shadow-slate-900/5 transition-colors duration-150 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20',
  select: 'w-full rounded-lg border border-[var(--line-2)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] shadow-sm shadow-slate-900/5 transition-colors duration-150 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20',
  label:  'mb-1 block text-sm font-medium text-[var(--ink-2)]',
  inline:       'rounded-md border border-[var(--line-2)] bg-[var(--paper)] px-1.5 py-0.5 text-xs text-[var(--ink)] transition-colors duration-150 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20',
  inlineSelect: 'rounded-md border border-[var(--line-2)] bg-[var(--paper)] px-1 py-0.5 text-xs text-[var(--ink)] transition-colors duration-150 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20',
};

// ── Tables ────────────────────────────────────────────────────────────────────
export const TABLE = {
  wrapper:  'max-w-full overflow-x-auto',
  table:    'w-full text-sm text-[var(--ink)]',
  thead:    'bg-[var(--paper-2)] text-xs font-semibold text-[var(--ink-3)] uppercase tracking-wider',
  th:       'py-3 px-3 text-left',
  tr:       'border-b border-[var(--line)] transition-colors duration-100 hover:bg-[var(--paper-2)]',
  td:       'py-2.5 px-3',
  tdMono:   'py-2.5 px-3 font-mono',
  empty:    'py-8 px-3 text-center text-[var(--ink-3)]',
};

// ── Modals ────────────────────────────────────────────────────────────────────
export const MODAL = {
  overlay:  'fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[80]',
  panel:    'w-full max-w-md mx-4 max-h-[85dvh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-2xl animate-modal-in',
  panelLg:  'w-full max-w-lg mx-4 max-h-[85dvh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-2xl animate-modal-in',
  panelSm:  'w-full max-w-sm mx-4 max-h-[85dvh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-2xl animate-modal-in',
  panelXl:   'w-full max-w-2xl mx-4 max-h-[85dvh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-2xl animate-modal-in',
  panelWide: 'w-full max-w-4xl mx-4 max-h-[85dvh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-2xl animate-modal-in',
  title:    'mb-4 text-lg font-semibold text-[var(--ink)]',
  footer:   'mt-6 flex justify-end gap-3 border-t border-[var(--line)] pt-4',
};

// ── Page Layout ──────────────────────────────────────────────────────────────
export const PAGE = {
  container: 'mx-auto max-w-7xl overflow-x-hidden p-6',
  title:     'text-2xl font-bold text-[var(--ink)]',
  subtitle:  'mt-1 text-sm text-[var(--ink-3)]',
  section:   'mt-6',
  header:    'mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between',
};

// ── Escalation Level Colors ──────────────────────────────────────────────────
export const ESC_COLORS = {
  green:  { card: 'border-[var(--ok)] bg-[var(--ok-soft)]', text: 'text-[var(--ok)]', badge: 'bg-[var(--paper)] text-[var(--ok)] border-[var(--ok)]', bar: 'bg-[var(--ok)]' },
  amber:  { card: 'border-[var(--caution)] bg-[var(--caution-soft)]', text: 'text-[var(--caution)]', badge: 'bg-[var(--paper)] text-[var(--caution)] border-[var(--caution)]', bar: 'bg-[var(--caution)]' },
  yellow: { card: 'border-[var(--warn)] bg-[var(--warn-soft)]', text: 'text-[var(--warn)]', badge: 'bg-[var(--paper)] text-[var(--warn)] border-[var(--warn)]', bar: 'bg-[var(--warn)]' },
  red:    { card: 'border-[var(--alert)] bg-[var(--alert-soft)]', text: 'text-[var(--alert)]', badge: 'bg-[var(--paper)] text-[var(--alert)] border-[var(--alert)]', bar: 'bg-[var(--alert)]' },
};

// ── Heatmap Colors ───────────────────────────────────────────────────────────
export const HEATMAP = {
  green:  'bg-[var(--ok)]',
  amber:  'bg-[var(--caution)]',
  yellow: 'bg-[var(--warn)]',
  red:    'bg-[var(--alert)]',
  empty:  'bg-[var(--line)]',
};

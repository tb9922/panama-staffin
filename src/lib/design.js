// Design System — shared className tokens for consistent UI
// Import and use these constants instead of ad-hoc Tailwind strings

// ── Buttons ──────────────────────────────────────────────────────────────────
export const BTN = {
  primary:   'inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
  secondary: 'inline-flex items-center justify-center px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 text-sm font-medium shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
  danger:    'inline-flex items-center justify-center px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-sm font-medium shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2',
  ghost:     'inline-flex items-center justify-center px-4 py-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 text-gray-600 text-sm font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
  success:   'inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-medium shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2',
  // Size variants — append after base
  xs: 'px-2 py-1 text-xs rounded-md',
  sm: 'px-3 py-1.5 text-xs rounded-md',
};

// ── Cards ────────────────────────────────────────────────────────────────────
export const CARD = {
  base:     'bg-white rounded-xl border border-gray-200 shadow-sm',
  padded:   'bg-white rounded-xl border border-gray-200 shadow-sm p-5',
  elevated: 'bg-white rounded-xl border border-gray-200 shadow-md p-5',
  flush:    'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden',
};

// ── Badges / Pills ───────────────────────────────────────────────────────────
export const BADGE = {
  blue:    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200',
  green:   'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200',
  amber:   'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200',
  red:     'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200',
  gray:    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200',
  purple:  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200',
  orange:  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200',
  pink:    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-pink-50 text-pink-700 border border-pink-200',
};

// ── Form Inputs ──────────────────────────────────────────────────────────────
export const INPUT = {
  base:   'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors duration-150 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
  sm:     'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors duration-150 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
  select: 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors duration-150 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
  label:  'block text-sm font-medium text-gray-700 mb-1',
};

// ── Tables ────────────────────────────────────────────────────────────────────
export const TABLE = {
  wrapper:  'overflow-x-auto',
  table:    'w-full text-sm',
  thead:    'bg-gray-50/80 text-xs font-semibold text-gray-500 uppercase tracking-wider',
  th:       'py-3 px-3 text-left',
  tr:       'border-b border-gray-100 hover:bg-gray-50/50 transition-colors duration-100',
  td:       'py-2.5 px-3',
  tdMono:   'py-2.5 px-3 font-mono',
  empty:    'py-8 px-3 text-center text-gray-400',
};

// ── Modals ────────────────────────────────────────────────────────────────────
export const MODAL = {
  overlay:  'fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50',
  panel:    'bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 animate-modal-in',
  panelLg:  'bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 animate-modal-in',
  panelSm:  'bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-modal-in',
  panelXl:   'bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl mx-4 animate-modal-in max-h-[90vh] overflow-y-auto',
  panelWide: 'bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl mx-4 animate-modal-in max-h-[90vh] overflow-y-auto',
  title:    'text-lg font-semibold text-gray-900 mb-4',
  footer:   'flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100',
};

// ── Page Layout ──────────────────────────────────────────────────────────────
export const PAGE = {
  container: 'p-6 max-w-7xl mx-auto',
  title:     'text-2xl font-bold text-gray-900',
  subtitle:  'text-sm text-gray-500 mt-1',
  section:   'mt-6',
  header:    'flex items-center justify-between mb-5',
};

// ── Escalation Level Colors ──────────────────────────────────────────────────
export const ESC_COLORS = {
  green:  { card: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  amber:  { card: 'border-amber-200 bg-amber-50',     text: 'text-amber-700',   badge: 'bg-amber-100 text-amber-700 border-amber-200',     bar: 'bg-amber-500' },
  yellow: { card: 'border-yellow-200 bg-yellow-50',   text: 'text-yellow-700',  badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',  bar: 'bg-yellow-500' },
  red:    { card: 'border-red-200 bg-red-50',          text: 'text-red-700',     badge: 'bg-red-100 text-red-700 border-red-200',           bar: 'bg-red-500' },
};

// ── Heatmap Colors ───────────────────────────────────────────────────────────
export const HEATMAP = {
  green:  'bg-emerald-500',
  amber:  'bg-amber-500',
  yellow: 'bg-yellow-400',
  red:    'bg-red-500',
  empty:  'bg-gray-200',
};

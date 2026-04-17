# Frontend Patterns — Line-by-Line Reference

Every frontend pattern extracted from the production codebase. Copy these templates when creating new pages.

---

## Design Tokens (src/lib/design.js)

ALWAYS import from design.js. Never write raw Tailwind for core components.

```javascript
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, TAB, ESC_COLORS, HEATMAP } from '../lib/design.js';
```

### Buttons

```jsx
// Variants (pick one base)
<button className={BTN.primary}>Save</button>
<button className={BTN.secondary}>Cancel</button>
<button className={BTN.danger}>Delete</button>
<button className={BTN.ghost}>Link-style</button>
<button className={BTN.success}>Approve</button>

// Sizes (append to base)
<button className={`${BTN.primary} ${BTN.xs}`}>Tiny</button>
<button className={`${BTN.secondary} ${BTN.sm}`}>Small</button>
```

### Cards

```jsx
<div className={CARD.base}>Border only, no padding</div>
<div className={CARD.padded}>Border + padding</div>
<div className={CARD.elevated}>Shadow + padding (for importance)</div>
<div className={CARD.flush}>Overflow hidden (for borderless children)</div>
```

### Tables

```jsx
<div className={TABLE.wrapper}>
  <table className={TABLE.table}>
    <thead className={TABLE.thead}>
      <tr><th className={TABLE.th}>Name</th><th className={TABLE.th}>Amount</th></tr>
    </thead>
    <tbody>
      <tr className={TABLE.tr}>
        <td className={TABLE.td}>Item</td>
        <td className={TABLE.tdMono}>12,345.00</td>  {/* monospace for numbers */}
      </tr>
    </tbody>
  </table>
</div>
```

### Badges

```jsx
<span className={BADGE.blue}>Info</span>
<span className={BADGE.green}>Active</span>
<span className={BADGE.amber}>Warning</span>
<span className={BADGE.red}>Error</span>
<span className={BADGE.gray}>Inactive</span>
<span className={BADGE.purple}>Special</span>

// Dynamic from status object with badge key
<span className={BADGE[status.badge]}>{status.label}</span>
```

### Tabs

```jsx
<div className={TAB.bar}>
  {tabs.map(tab => (
    <button
      key={tab.id}
      className={`${TAB.button} ${activeTab === tab.id ? TAB.active : TAB.inactive}`}
      onClick={() => setActiveTab(tab.id)}
    >
      {tab.label}
    </button>
  ))}
</div>
```

### Forms

```jsx
<label className={INPUT.label}>Field Name</label>
<input className={INPUT.base} value={form.name} onChange={e => setFormField('name', e.target.value)} />
<input className={INPUT.sm} />           {/* compact variant */}
<select className={INPUT.select}>...</select>
<input className={INPUT.inline} />       {/* for compact grids/modals */}
<select className={INPUT.inlineSelect} /> {/* inline select */}
```

### Page Layout

```jsx
<div className={PAGE.container}>
  <div className={PAGE.header}>
    <h1 className={PAGE.title}>Page Title</h1>
    <button className={BTN.primary}>Action</button>
  </div>
  <div className={PAGE.section}>
    <div className={CARD.padded}>Content</div>
  </div>
</div>
```

### Escalation Colors

```jsx
<div className={`${CARD.padded} ${ESC_COLORS.green.card}`}>Safe</div>
<div className={`${CARD.padded} ${ESC_COLORS.amber.card}`}>Warning</div>
<span className={ESC_COLORS.red.text}>Critical text</span>
<span className={ESC_COLORS.green.badge}>OK badge</span>
```

### Modals (MODAL tokens + Modal component)

```jsx
<div className={MODAL.footer}>
  <button className={BTN.secondary} onClick={onClose}>Cancel</button>
  <button className={BTN.primary} onClick={handleSave}>Save</button>
</div>
```

---

## Modal Component (src/components/Modal.jsx)

Use for ALL modals. Never build inline modal markup.

```jsx
import Modal from '../components/Modal.jsx';

<Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Edit Item" size="xl">
  {/* body content */}
  <div className={MODAL.footer}>
    <button className={BTN.secondary} onClick={() => setShowModal(false)}>Cancel</button>
    <button className={BTN.primary} onClick={handleSave}>Save</button>
  </div>
</Modal>
```

**Props**: `isOpen` (bool), `onClose` (fn), `title` (string), `size` ('sm'|'md'|'lg'|'xl'|'wide')

Built-in accessibility: focus trap, Escape key, ARIA attributes, backdrop click, restore focus on close.

---

## API Layer (src/lib/api.js)

### Core Functions

```javascript
// These exist — ALWAYS use them
apiFetch(url, options)     // fetch + 401 handling + error parsing
authHeaders(extra = {})    // Content-Type + Authorization + CSRF
getCurrentHome()           // returns active home slug
h(slug)                    // encodeURIComponent shorthand
```

**NEVER use `fetchJSON`** — it does not exist.

### CRUD Wrapper Pattern

```javascript
// GET list
export async function getEntities(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/entities?${params}`, { headers: authHeaders() });
}

// POST create
export async function createEntity(homeSlug, data) {
  return apiFetch(`${API_BASE}/entities?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

// PUT update
export async function updateEntity(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/entities/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

// DELETE
export async function deleteEntity(homeSlug, id) {
  return apiFetch(`${API_BASE}/entities/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}
```

**Key**: Home is query param `?home=slug`, NOT path param. All IDs `encodeURIComponent()`.

---

## Self-Loading Page Template

Most new pages use this pattern (not data/updateData props).

```jsx
import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, PAGE, BADGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getEntities, createEntity, updateEntity, deleteEntity } from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';

export default function EntityPage() {
  const { canWrite } = useData();
  const canEdit = canWrite('module_name');  // RBAC check
  const home = getCurrentHome();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  // Load data
  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const data = await getEntities(home);
      setItems(data.rows || []);
      setTotal(data.total || 0);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  // Form helpers
  const setFormField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  function openCreate() {
    setEditing(null);
    setForm({ name: '', status: 'active' });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({ name: item.name, status: item.status });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
  }

  async function handleSave() {
    setError(null);
    try {
      if (editing) {
        await updateEntity(home, editing.id, { ...form, _version: editing.version });
      } else {
        await createEntity(home, form);
      }
      closeModal();
      load();  // Reload entire list
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await deleteEntity(home, item.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <div className={PAGE.container}><p>Loading...</p></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>Entities</h1>
        {canEdit && <button className={BTN.primary} onClick={openCreate}>Add Entity</button>}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">{error}</div>}

      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Name</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Amount</th>
                {canEdit && <th className={TABLE.th}></th>}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{item.name}</td>
                  <td className={TABLE.td}>
                    <span className={BADGE[item.status === 'active' ? 'green' : 'gray']}>
                      {item.status}
                    </span>
                  </td>
                  <td className={TABLE.tdMono}>{item.amount?.toFixed(2)}</td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openEdit(item)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Entity' : 'Add Entity'}>
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Name</label>
            <input className={INPUT.base} value={form.name} onChange={e => setFormField('name', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Status</label>
            <select className={INPUT.select} value={form.status} onChange={e => setFormField('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
          <button className={BTN.primary} onClick={handleSave}>Save</button>
        </div>
      </Modal>
    </div>
  );
}
```

---

## RBAC Access Control

```jsx
import { useData } from '../contexts/DataContext.jsx';

const { canRead, canWrite, homeRole, staffId } = useData();

const canEdit = canWrite('finance');    // true if role has write on finance
const canView = canRead('payroll');     // true if role has read on payroll
```

**Modules**: `scheduling`, `staff`, `hr`, `compliance`, `governance`, `finance`, `payroll`, `gdpr`, `reports`, `config`

---

## Navigation (src/lib/navigation.js)

```javascript
// Adding a new page to nav:
// 1. Add to NAV_SECTIONS in the correct group
{ path: '/entity', label: 'Entity Name', module: 'module_name', icon: 'M12 9v2...' }

// 2. Add route in AppRoutes.jsx
const EntityPage = lazy(() => import('../pages/EntityPage.jsx'));
<Route path="/entity" element={
  <RouteErrorBoundary><RequireModule module="module_name"><EntityPage /></RequireModule></RouteErrorBoundary>
} />
```

---

## Pagination

```jsx
import Pagination from '../components/Pagination.jsx';

const [offset, setOffset] = useState(0);
const limit = 25;

// In load():
const data = await getEntities(home, { offset, limit });

// In JSX:
<Pagination total={total} limit={limit} offset={offset} onChange={setOffset} />
```

---

## Custom Hooks

```jsx
// Warn on unsaved changes
import useDirtyGuard from '../hooks/useDirtyGuard.js';
useDirtyGuard(isDirty);

// Reactive today string (updates at midnight)
import { useLiveDate } from '../hooks/useLiveDate.js';
const today = useLiveDate();

// Escape key handler
import useEscapeKey from '../hooks/useEscapeKey.js';
useEscapeKey(() => setShowModal(false));
```

---

## Excel Export (Dynamic Import)

```jsx
async function handleExport() {
  if (!items.length) return;
  const { downloadXLSX } = await import('../lib/excel.js');
  downloadXLSX('entities.xlsx', [{
    name: 'Entities',
    headers: ['Name', 'Status', 'Amount'],
    rows: items.map(i => [i.name, i.status, i.amount]),
  }]);
}

<button className={`${BTN.secondary} ${BTN.sm}`} onClick={handleExport}>Export Excel</button>
```

Never top-level import — ExcelJS is large, only loaded on click.

---

## Constants Pattern

```javascript
// In src/lib/entityConstants.js or inline
export const STATUSES = [
  { id: 'active', label: 'Active', badge: 'green' },
  { id: 'closed', label: 'Closed', badge: 'gray' },
];

export const CATEGORIES = [
  { id: 'type_a', label: 'Type A' },
  { id: 'type_b', label: 'Type B' },
];

export function getLabel(enumArray, id) {
  return enumArray.find(x => x.id === id)?.label || '?';
}

export function formatCurrency(n) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
}
```

---

## Key Rules

1. **Design tokens only**: never write raw Tailwind for buttons, cards, tables, modals, badges, inputs
2. **Modal component**: use `Modal.jsx` for all modals, never inline modal markup
3. **apiFetch only**: never use `fetchJSON`, `fetch` directly, or `axios`
4. **Home as query param**: `?home=slug`, not path param
5. **_version on updates**: `{ ...form, _version: editing.version }` for optimistic locking
6. **useCallback for load**: prevents infinite re-render loops in useEffect
7. **Reload after save**: call `load()` not manual state update (keeps data in sync)
8. **canWrite for edit guards**: `const canEdit = canWrite('module')` — hide buttons, disable forms
9. **Dynamic import for exports**: `await import('../lib/excel.js')` — never top-level
10. **Self-loading pattern**: new pages use `getCurrentHome()` + API calls, not data/updateData props

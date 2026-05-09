import { useState } from 'react';
import { BTN, INPUT } from '../../lib/design.js';
import { reportMySick } from '../../lib/api.js';
import ErrorState from '../../components/ErrorState.jsx';
import useDirtyGuard from '../../hooks/useDirtyGuard.js';

import { addDaysLocalISO, todayLocalISO } from '../../lib/localDates.js';

function getDateBounds() {
  const today = todayLocalISO();
  return {
    today,
    tomorrow: addDaysLocalISO(today, 1),
  };
}

function defaultForm() {
  return {
    date: getDateBounds().today,
    reason: '',
  };
}

export default function ReportSick() {
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { today, tomorrow } = getDateBounds();

  // Reason text or non-default date counts as dirty. Once submitted the form
  // resets and the guard releases. Don't guard on the default date alone or
  // we'd warn on every navigation.
  useDirtyGuard(Boolean(form.reason || (form.date && form.date !== today)));

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await reportMySick({ ...form, reason: form.reason.trim() });
      setMessage('Your sick report has been logged and your manager can review it straight away.');
      setForm(defaultForm());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState title="Unable to report sick" message={error} />}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-2xl font-bold text-slate-900">Report Sick</h2>
        <p className="mt-2 text-sm text-slate-600">Let the home know quickly if you're unable to work today or tomorrow.</p>
      </div>
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="report-sick-date" className={INPUT.label}>Date</label>
            <input id="report-sick-date" type="date" min={today} max={tomorrow} className={INPUT.base} value={form.date} onChange={(e) => setForm((current) => ({ ...current, date: e.target.value }))} required />
          </div>
          <div>
            <label htmlFor="report-sick-reason" className={INPUT.label}>Reason</label>
            <input id="report-sick-reason" className={INPUT.base} value={form.reason} onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))} placeholder="Optional note" maxLength={1000} />
          </div>
        </div>
        {message && <p className="mt-4 text-sm font-medium text-emerald-700">{message}</p>}
        <div className="mt-5 flex justify-end">
          <button type="submit" className={BTN.primary} disabled={saving}>
            {saving ? 'Sending...' : 'Submit sick report'}
          </button>
        </div>
      </form>
    </div>
  );
}

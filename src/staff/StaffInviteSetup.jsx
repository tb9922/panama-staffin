import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { BTN, CARD, INPUT } from '../lib/design.js';
import { consumeStaffInvite, getStaffInvite, getLoggedInUser } from '../lib/api.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';

export default function StaffInviteSetup({ onLogin }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const existingUser = getLoggedInUser();
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    if (!token) {
      setError('Invite link is missing a token.');
      setLoading(false);
      return;
    }
    getStaffInvite(token)
      .then(setInvite)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (existingUser) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!form.username.trim()) {
      setError('Username is required.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const user = await consumeStaffInvite({
        token,
        username: form.username.trim(),
        password: form.password,
      });
      onLogin(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <LoadingState message="Checking your invite..." card />
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <ErrorState title="Invite unavailable" message={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-blue-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className={`${CARD.padded} w-full max-w-lg space-y-5`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Staff setup</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Set up your sign-in</h1>
          <p className="mt-2 text-sm text-slate-600">
            {invite?.staffName ? `${invite.staffName}, ` : ''}finish your Panama Staffing account for {invite?.homeName || 'your home'}.
          </p>
        </div>

        {error && <ErrorState title="Unable to complete setup" message={error} />}

        <div className="space-y-4">
          <div>
            <label htmlFor="staff-setup-username" className={INPUT.label}>Choose a username</label>
            <input
              id="staff-setup-username"
              className={INPUT.base}
              value={form.username}
              onChange={(e) => setForm((current) => ({ ...current, username: e.target.value }))}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="staff-setup-password" className={INPUT.label}>Create a password</label>
            <input
              id="staff-setup-password"
              type="password"
              className={INPUT.base}
              value={form.password}
              onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="staff-setup-password-confirm" className={INPUT.label}>Confirm password</label>
            <input
              id="staff-setup-password-confirm"
              type="password"
              className={INPUT.base}
              value={form.confirmPassword}
              onChange={(e) => setForm((current) => ({ ...current, confirmPassword: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-500">Use at least 10 characters.</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Invite expires {invite?.expiresAt ? new Date(invite.expiresAt).toLocaleString('en-GB') : 'soon'}.
          </span>
          <button type="submit" className={BTN.primary} disabled={submitting}>
            {submitting ? 'Setting up...' : 'Complete setup'}
          </button>
        </div>
      </form>
    </div>
  );
}

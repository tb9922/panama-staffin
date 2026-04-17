import { useEffect, useState } from 'react';
import { BTN, INPUT } from '../../lib/design.js';
import { getMyProfile, staffChangePassword, updateMyProfile } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';

export default function MyProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
  });

  async function load() {
    try {
      setLoading(true);
      setError('');
      setProfile(await getMyProfile());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await updateMyProfile({
        phone: profile.phone || '',
        address: profile.address || '',
        emergency_contact: profile.emergency_contact || '',
      });
      setProfile(updated);
      setMessage('Profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    setPasswordSaving(true);
    setError('');
    setMessage('');
    try {
      await staffChangePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setMessage('Password changed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  }

  if (loading) return <LoadingState message="Loading your profile..." className="p-6" />;
  if (error && !profile) return <div className="p-6"><ErrorState title="Unable to load your profile" message={error} onRetry={() => void load()} /></div>;

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState title="Profile update failed" message={error} />}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-2xl font-bold text-slate-900">My Profile</h2>
        <p className="mt-2 text-sm text-slate-600">Update the contact details the home should use for you.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label className={INPUT.label}>Name</label>
            <input className={`${INPUT.base} bg-slate-50`} value={profile?.name || ''} disabled />
          </div>
          <div>
            <label className={INPUT.label}>Role</label>
            <input className={`${INPUT.base} bg-slate-50`} value={profile?.role || ''} disabled />
          </div>
          <div>
            <label htmlFor="profile-phone" className={INPUT.label}>Phone</label>
            <input id="profile-phone" className={INPUT.base} value={profile?.phone || ''} onChange={(e) => setProfile((current) => ({ ...current, phone: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="profile-emergency" className={INPUT.label}>Emergency contact</label>
            <input id="profile-emergency" className={INPUT.base} value={profile?.emergency_contact || ''} onChange={(e) => setProfile((current) => ({ ...current, emergency_contact: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="profile-address" className={INPUT.label}>Address</label>
            <textarea id="profile-address" className={INPUT.base} rows={4} value={profile?.address || ''} onChange={(e) => setProfile((current) => ({ ...current, address: e.target.value }))} />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="submit" className={BTN.primary} disabled={saving}>
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </form>

      <form onSubmit={handlePasswordChange} className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-semibold text-slate-900">Change password</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="profile-current-password" className={INPUT.label}>Current password</label>
            <input id="profile-current-password" type="password" className={INPUT.base} value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, currentPassword: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="profile-new-password" className={INPUT.label}>New password</label>
            <input id="profile-new-password" type="password" className={INPUT.base} value={passwordForm.newPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, newPassword: e.target.value }))} />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="submit" className={BTN.secondary} disabled={passwordSaving}>
            {passwordSaving ? 'Updating...' : 'Change password'}
          </button>
        </div>
      </form>
    </div>
  );
}

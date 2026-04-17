import { useState } from 'react';
import { login } from '../lib/api.js';
import { INPUT, BTN } from '../lib/design.js';

function getInitialLoginError() {
  try {
    if (window.sessionStorage.getItem('panama_login_notice') === 'session_expired') {
      window.sessionStorage.removeItem('panama_login_notice');
      return 'Your session expired — sign in again';
    }
  } catch {
    return '';
  }
  return '';
}

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => getInitialLoginError());

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    try {
      const user = await login(username, password);
      onLogin(user);
    } catch (err) {
      if (err?.status === 423) {
        setError('Account locked — contact admin');
        return;
      }
      if (!err?.status) {
        setError('Cannot reach server — check your connection');
        return;
      }
      setError('Invalid username or password');
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-100 to-blue-50">
      <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 w-full max-w-sm mx-4">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Panama Staffing</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">Sign in to manage your roster</p>
        {error && <div id="login-error" className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4" role="alert">{error}</div>}
        <div className="space-y-4">
          <div>
            <label htmlFor="login-username" className={INPUT.label}>Username</label>
            <input id="login-username" type="text" value={username} onChange={e => setUsername(e.target.value)}
              className={INPUT.base} placeholder="Enter username" autoFocus autoComplete="username"
              aria-describedby={error ? 'login-error' : undefined} aria-invalid={!!error} />
          </div>
          <div>
            <label htmlFor="login-password" className={INPUT.label}>Password</label>
            <input id="login-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
              className={INPUT.base} placeholder="Enter password" autoComplete="current-password"
              aria-describedby={error ? 'login-error' : undefined} aria-invalid={!!error} />
          </div>
          <button type="submit" className={`${BTN.primary} w-full`}>Sign In</button>
        </div>
      </form>
    </div>
  );
}

import { Component } from 'react';
import { BTN } from '../lib/design.js';

const REFRESH_ERROR_PATTERNS = [
  'ChunkLoadError',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Loading chunk',
];

function isRefreshRequiredError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  const haystack = `${name} ${message}`;
  return REFRESH_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Route error:', error, info);
    if (typeof window !== 'undefined' && window.__SENTRY__) {
      import('@sentry/react').then(Sentry => Sentry.captureException(error, { extra: info })).catch(() => {});
    }
  }

  render() {
    if (this.state.hasError) {
      const refreshRequired = isRefreshRequiredError(this.state.error);
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {refreshRequired ? 'This page needs a refresh' : 'Something went wrong'}
          </h2>
          <p className="text-gray-600 mb-4">
            {refreshRequired
              ? 'The app may have been updated while this tab was open. Reload the app to load the latest version of this page.'
              : 'This page encountered an error. Other pages should still work.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className={BTN.primary}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className={BTN.secondary}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

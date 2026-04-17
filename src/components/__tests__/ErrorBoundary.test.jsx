import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import * as Sentry from '@sentry/react';

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

// Component that throws unconditionally on render
function ThrowingComponent() {
  throw new Error('Test render error');
}

// Component that conditionally throws based on a prop
function MaybeThrow({ shouldThrow }) {
  if (shouldThrow) throw new Error('Conditional render error');
  return <div>Rendered safely</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React's own console.error output for error boundary tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows error UI when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows the descriptive error message in the error UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Your data has not been affected/i)).toBeInTheDocument();
  });

  it('shows a "Reload App" button in the error UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /Reload App/i })).toBeInTheDocument();
  });

  it('calls Sentry.captureException when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: expect.anything() }),
    );
  });

  it('does not call Sentry.captureException when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>No error</div>
      </ErrorBoundary>,
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('hides children and shows error UI — children not present in error state', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    // The throwing component renders nothing, and the error UI replaces children
    expect(screen.queryByText('Rendered safely')).not.toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('console.error is called with the caught error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalled();
  });
});

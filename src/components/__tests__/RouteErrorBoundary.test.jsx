import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RouteErrorBoundary from '../RouteErrorBoundary.jsx';

// Component that throws unconditionally on render
function ThrowingComponent() {
  throw new Error('Route render error');
}

function ChunkThrowingComponent() {
  throw new Error('Failed to fetch dynamically imported module');
}

// Component whose throw behaviour is controlled via a ref-like mutable flag
// so we can reset it between renders without prop drilling.
let shouldThrow = false;
function ToggleThrow() {
  if (shouldThrow) throw new Error('Toggle error');
  return <div>Child rendered</div>;
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = false;
  });

  it('renders children when there is no error', () => {
    render(
      <RouteErrorBoundary>
        <div>Route content</div>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('Route content')).toBeInTheDocument();
  });

  it('shows error UI when a child throws during render', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingComponent />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows the contextual sub-message in error UI', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingComponent />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/Other pages should still work/i)).toBeInTheDocument();
  });

  it('shows a "Try again" button in the error UI', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingComponent />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('shows a "Reload app" button in the error UI', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingComponent />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /Reload app/i })).toBeInTheDocument();
  });

  it('shows refresh guidance for stale lazy-load errors', () => {
    render(
      <RouteErrorBoundary>
        <ChunkThrowingComponent />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('This page needs a refresh')).toBeInTheDocument();
    expect(screen.getByText(/app may have been updated while this tab was open/i)).toBeInTheDocument();
  });

  it('does not show the error UI when children render successfully', () => {
    render(
      <RouteErrorBoundary>
        <div>Fine content</div>
      </RouteErrorBoundary>,
    );
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/i })).not.toBeInTheDocument();
  });

  it('"Try again" resets error state and re-renders children', () => {
    // First render: child throws → error UI appears
    shouldThrow = true;
    render(
      <RouteErrorBoundary>
        <ToggleThrow />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Before clicking Try again, stop the child from throwing
    shouldThrow = false;

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    // Error boundary resets → children re-render successfully
    expect(screen.getByText('Child rendered')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('logs the error via console.error', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingComponent />
      </RouteErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalled();
  });
});

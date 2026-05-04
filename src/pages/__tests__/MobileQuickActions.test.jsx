import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import MobileQuickActions from '../MobileQuickActions.jsx';

describe('MobileQuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders touch-friendly quick flows for a manager role', () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      scanIntakeEnabled: true,
      scanIntakeTargets: ['cqc', 'handover', 'maintenance'],
      isScanTargetEnabled: () => true,
    });

    renderWithProviders(<MobileQuickActions />, { route: '/mobile-quick-actions' });

    expect(screen.getByRole('heading', { name: 'Quick Actions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Report Incident/i })).toHaveAttribute('href', '/incidents?quick=incident&mode=new');
    expect(screen.getByRole('link', { name: /Add Handover Note/i })).toHaveAttribute('href', '/handover?quick=handover&mode=new');
    expect(screen.getByRole('link', { name: /Log Maintenance Issue/i })).toHaveAttribute('href', '/maintenance?quick=maintenance&mode=new');
    expect(screen.getByRole('link', { name: /Complete or Verify Action/i })).toHaveAttribute('href', '/actions?quick=manager-action&status=open');
    expect(screen.getByRole('link', { name: /Start Audit Task/i })).toHaveAttribute('href', '/audit-calendar?quick=audit-task&status=open');
    expect(screen.getByRole('link', { name: /Add Evidence/i })).toHaveAttribute(
      'href',
      '/scan-inbox?launchTarget=cqc&returnTo=%2Fmobile-quick-actions',
    );
  });

  it('only shows flows allowed by module write permissions', () => {
    useData.mockReturnValue({
      canRead: (moduleId) => ['scheduling', 'reports'].includes(moduleId),
      canWrite: (moduleId) => moduleId === 'scheduling',
      homeRole: 'shift_coordinator',
      scanIntakeEnabled: true,
      scanIntakeTargets: ['handover'],
      isScanTargetEnabled: (targetId) => targetId === 'handover',
    });

    renderWithProviders(<MobileQuickActions />, { route: '/mobile-quick-actions' });

    expect(screen.getByRole('link', { name: /Add Handover Note/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Report Incident/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Complete or Verify Action/i })).not.toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows an empty state when no modules are visible', () => {
    useData.mockReturnValue({
      canRead: () => false,
      canWrite: () => false,
      homeRole: 'viewer',
      scanIntakeEnabled: false,
      scanIntakeTargets: [],
      isScanTargetEnabled: () => false,
    });

    renderWithProviders(<MobileQuickActions />, { route: '/mobile-quick-actions' });

    expect(screen.getByText('No quick actions available')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

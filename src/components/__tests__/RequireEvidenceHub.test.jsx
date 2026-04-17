import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireEvidenceHub } from '../RequireRole.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useData } from '../../contexts/DataContext.jsx';

vi.mock('../../contexts/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../contexts/DataContext.jsx', () => ({
  useData: vi.fn(),
}));

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/evidence']}>
      <Routes>
        <Route path="/" element={<div>Home</div>} />
        <Route
          path="/evidence"
          element={<RequireEvidenceHub><div>Evidence Hub Page</div></RequireEvidenceHub>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequireEvidenceHub', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ isPlatformAdmin: false });
    useData.mockReturnValue({
      homeRole: 'home_manager',
      canRead: (moduleId) => moduleId === 'reports',
    });
  });

  it('allows roles with reports access and readable evidence sources', () => {
    renderGuard();
    expect(screen.getByText('Evidence Hub Page')).toBeInTheDocument();
  });

  it('redirects reports-only roles with no readable evidence sources', () => {
    useData.mockReturnValue({
      homeRole: 'reports_only',
      canRead: (moduleId) => moduleId === 'reports',
    });
    renderGuard();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Evidence Hub Page')).not.toBeInTheDocument();
  });

  it('redirects when reports access is missing', () => {
    useData.mockReturnValue({
      homeRole: 'home_manager',
      canRead: () => false,
    });
    renderGuard();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });
});

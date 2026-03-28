import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireUserManagement } from '../../components/RequireRole.jsx';
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
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/" element={<div>Home</div>} />
        <Route
          path="/users"
          element={<RequireUserManagement><div>Users Page</div></RequireUserManagement>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequireUserManagement', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ isPlatformAdmin: false });
    useData.mockReturnValue({ homeRole: 'home_manager' });
  });

  it('allows home managers through', () => {
    renderGuard();
    expect(screen.getByText('Users Page')).toBeInTheDocument();
  });

  it('redirects config-read roles without user-management rights', () => {
    useData.mockReturnValue({ homeRole: 'deputy_manager' });
    renderGuard();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Users Page')).not.toBeInTheDocument();
  });
});

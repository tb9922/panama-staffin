import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext.jsx';
import { mockDataContext } from '../../test/setup.js';
import StaffLayout from '../StaffLayout.jsx';

function renderLayout() {
  localStorage.setItem('user', JSON.stringify({
    username: 'staff',
    role: 'staff_member',
    displayName: 'Staff User',
  }));

  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<StaffLayout />}>
            <Route index element={<div>Child mounted</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('StaffLayout', () => {
  beforeEach(() => {
    mockDataContext({
      staffId: 'S001',
      activeHomeObj: { id: 'test-home', name: 'Test Home', staffId: 'S001', roleId: 'staff_member' },
      homeRole: 'staff_member',
    });
  });

  it('holds child routes until staff portal home data has loaded', () => {
    mockDataContext({
      loading: true,
      activeHome: null,
      activeHomeObj: null,
      staffId: null,
      homes: [],
    });

    renderLayout();

    expect(screen.getByText('Loading your staff portal...')).toBeInTheDocument();
    expect(screen.queryByText('Child mounted')).not.toBeInTheDocument();
  });

  it('shows a profile link error instead of mounting pages without staff id', () => {
    mockDataContext({
      loading: false,
      activeHomeObj: { id: 'test-home', name: 'Test Home', roleId: 'staff_member' },
      staffId: null,
      homeRole: 'staff_member',
    });

    renderLayout();

    expect(screen.getByText('Unable to find your staff profile')).toBeInTheDocument();
    expect(screen.queryByText('Child mounted')).not.toBeInTheDocument();
  });

  it('mounts the active staff page once home and staff context are ready', () => {
    renderLayout();

    expect(screen.getByText('Test Home | Staff User')).toBeInTheDocument();
    expect(screen.getByText('Child mounted')).toBeInTheDocument();
  });
});
